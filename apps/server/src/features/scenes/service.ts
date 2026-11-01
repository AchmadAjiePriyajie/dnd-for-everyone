import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { Member } from '#shared/access';
import type { Id } from '#shared/contracts';
import { type FogState, type GridSettings, type SceneDraft, sceneDraftSchema, type TokenDraft, tokenDraftSchema, tokenUpdateSchema } from '#shared/scenes';
import type { CommandContext } from '../../commands/registry.js';
import { CommandsService } from '../../commands/dispatcher.js';
import { DomainError, forbidden } from '../../common/domain-error.js';
import { findActiveMember } from '../campaigns/access.js';
import { AssetsService } from './assets.js';
import { CombatService } from '../combat/service.js';

export interface SceneRow {
  id: Id;
  campaign_id: Id;
  name: string;
  asset_id: Id | null;
  grid: string;
  shared: number;
  fog: string;
}

export interface TokenRow {
  id: Id;
  campaign_id: Id;
  scene_id: Id;
  label: string;
  kind: TokenDraft['kind'];
  character_id: Id | null;
  monster_id: Id | null;
  owner_account_id: Id | null;
  x: number;
  y: number;
  size: number;
  hidden: number;
  hp: string | null;
}

const sharePayload = z.strictObject({ shared: z.boolean() });
const empty = z.strictObject({});

/**
 * Scene dan token. DM mengelola seluruh scene; player hanya menggerakkan token miliknya pada
 * scene yang dibagikan. Token tersembunyi diperlakukan seperti tidak ada bagi player.
 */
@Injectable()
export class ScenesService implements OnModuleInit {
  constructor(
    private readonly commands: CommandsService,
    private readonly assets: AssetsService,
    private readonly combat: CombatService,
  ) {}

  onModuleInit(): void {
    const dm = { roles: ['dm' as const] };
    this.commands.registerCommand('scene.save', (ctx, payload) => this.saveScene(ctx, payload as SceneDraft), { schema: sceneDraftSchema, ...dm });
    this.commands.registerCommand('scene.share', (ctx, payload) => this.share(ctx, (payload as z.infer<typeof sharePayload>).shared), { schema: sharePayload, ...dm });
    this.commands.registerCommand('scene.delete', (ctx) => this.deleteScene(ctx), { schema: empty, ...dm });
    this.commands.registerCommand('token.place', (ctx, payload) => this.place(ctx, payload as TokenDraft), { schema: tokenDraftSchema, ...dm });
    this.commands.registerCommand('token.update', (ctx, payload) => this.update(ctx, payload as z.infer<typeof tokenUpdateSchema>), { schema: tokenUpdateSchema, ...dm });
    this.commands.registerCommand('token.remove', (ctx) => this.remove(ctx), { schema: empty, ...dm });
  }

  scene(db: DatabaseSync, campaignId: Id, sceneId: Id): SceneRow | undefined {
    return db.prepare('SELECT * FROM scenes WHERE campaign_id = ? AND id = ?').get(campaignId, sceneId) as unknown as SceneRow | undefined;
  }

  scenes(db: DatabaseSync, campaignId: Id): SceneRow[] {
    return db.prepare('SELECT * FROM scenes WHERE campaign_id = ? ORDER BY created_at, id').all(campaignId) as unknown as SceneRow[];
  }

  tokens(db: DatabaseSync, campaignId: Id, sceneId: Id): TokenRow[] {
    return db.prepare('SELECT * FROM tokens WHERE campaign_id = ? AND scene_id = ? ORDER BY created_at, id').all(campaignId, sceneId) as unknown as TokenRow[];
  }

  /**
   * Token terlihat bagi member: DM semua; player hanya token tidak tersembunyi pada scene yang
   * dibagikan, dan bila kabut aktif hanya yang menyentuh area terungkap (token sendiri selalu).
   */
  visibleToken(db: DatabaseSync, member: Member, tokenId: Id): TokenRow | null {
    const token = db.prepare('SELECT * FROM tokens WHERE campaign_id = ? AND id = ?').get(member.campaignId, tokenId) as unknown as TokenRow | undefined;
    if (!token) return null;
    if (member.role === 'dm') return token;
    const scene = this.scene(db, member.campaignId, token.scene_id);
    return scene?.shared && this.seenBy(token, member, JSON.parse(scene.fog) as FogState) ? token : null;
  }

  /** Aturan visibilitas token untuk player (tanpa memeriksa scene dibagikan). */
  seenBy(token: TokenRow, member: Member, fog: FogState): boolean {
    if (member.role === 'dm') return true;
    if (token.hidden) return false;
    if (!fog.enabled || token.owner_account_id === member.accountId) return true;
    return fog.revealed.some((area) => token.x < area.x + area.w && token.x + token.size > area.x && token.y < area.y + area.h && token.y + token.size > area.y);
  }

  private saveScene(ctx: CommandContext, draft: SceneDraft): { id: Id } {
    const existing = this.scene(ctx.db, ctx.campaignId, ctx.targetId);
    if (existing && ctx.expectedRevision === null) throw new DomainError('REVISION_REQUIRED', 409);
    if (draft.assetId) {
      const asset = this.assets.find(ctx.db, ctx.campaignId, draft.assetId);
      if (!asset) throw new DomainError('ASSET_INVALID', 409);
      // Latar scene dikirim ke semua peserta: gambar rahasia DM tidak boleh dipakai di sini.
      if (asset.visibility !== 'party') throw new DomainError('ASSET_NOT_SHAREABLE', 409);
    }
    if (existing) {
      // Grid yang mengecil tidak boleh meninggalkan token di luar peta.
      for (const token of this.tokens(ctx.db, ctx.campaignId, ctx.targetId)) this.requireInside(draft.grid, token.x, token.y, token.size);
      ctx.db
        .prepare('UPDATE scenes SET name = ?, asset_id = ?, grid = ?, updated_at = ? WHERE campaign_id = ? AND id = ?')
        .run(draft.name, draft.assetId, JSON.stringify(draft.grid), ctx.now, ctx.campaignId, ctx.targetId);
    } else {
      ctx.db
        .prepare('INSERT INTO scenes (id, campaign_id, name, asset_id, grid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(ctx.targetId, ctx.campaignId, draft.name, draft.assetId, JSON.stringify(draft.grid), ctx.now, ctx.now);
    }
    return { id: ctx.targetId };
  }

  private share(ctx: CommandContext, shared: boolean): { id: Id; shared: boolean } {
    const scene = this.scene(ctx.db, ctx.campaignId, ctx.targetId);
    if (!scene) throw new DomainError('NOT_FOUND', 404);
    if (ctx.expectedRevision === null) throw new DomainError('REVISION_REQUIRED', 409);
    ctx.db.prepare('UPDATE scenes SET shared = ?, updated_at = ? WHERE campaign_id = ? AND id = ?').run(shared ? 1 : 0, ctx.now, ctx.campaignId, scene.id);
    return { id: scene.id, shared };
  }

  private deleteScene(ctx: CommandContext): { id: Id } {
    const scene = this.scene(ctx.db, ctx.campaignId, ctx.targetId);
    if (!scene) throw new DomainError('NOT_FOUND', 404);
    ctx.db.prepare('DELETE FROM tokens WHERE campaign_id = ? AND scene_id = ?').run(ctx.campaignId, scene.id);
    ctx.db.prepare('DELETE FROM map_markers WHERE campaign_id = ? AND scene_id = ?').run(ctx.campaignId, scene.id);
    ctx.db.prepare('DELETE FROM scenes WHERE campaign_id = ? AND id = ?').run(ctx.campaignId, scene.id);
    return { id: scene.id };
  }

  private place(ctx: CommandContext, draft: TokenDraft): { id: Id } {
    const scene = this.scene(ctx.db, ctx.campaignId, draft.sceneId);
    if (!scene) throw new DomainError('NOT_FOUND', 404);
    if (ctx.db.prepare('SELECT 1 FROM tokens WHERE campaign_id = ? AND id = ?').get(ctx.campaignId, ctx.targetId)) throw new DomainError('VALIDATION_FAILED', 400, { field: 'targetId' });
    this.requireInside(JSON.parse(scene.grid) as GridSettings, draft.x, draft.y, draft.size);
    if (draft.ownerAccountId && !findActiveMember(ctx.db, ctx.campaignId, draft.ownerAccountId)) throw new DomainError('MEMBER_NOT_FOUND', 404);
    if (draft.characterId && !ctx.db.prepare('SELECT 1 FROM characters WHERE campaign_id = ? AND id = ?').get(ctx.campaignId, draft.characterId)) {
      throw new DomainError('NOT_FOUND', 404);
    }
    ctx.db
      .prepare(
        `INSERT INTO tokens (id, campaign_id, scene_id, label, kind, character_id, monster_id, owner_account_id, x, y, size, hidden, hp, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ctx.targetId,
        ctx.campaignId,
        scene.id,
        draft.label,
        draft.kind,
        draft.characterId ?? null,
        draft.monsterId ?? null,
        draft.ownerAccountId ?? null,
        draft.x,
        draft.y,
        draft.size,
        draft.hidden ? 1 : 0,
        draft.hp ? JSON.stringify(draft.hp) : null,
        ctx.now,
        ctx.now,
      );
    return { id: ctx.targetId };
  }

  private update(ctx: CommandContext, input: z.infer<typeof tokenUpdateSchema>): { id: Id } {
    const token = this.visibleToken(ctx.db, ctx.member, ctx.targetId);
    if (!token) throw new DomainError('NOT_FOUND', 404);
    if (input.hp !== undefined && this.combat.tokenHitPoints(ctx.db, ctx.campaignId, token.id)) throw new DomainError('HP_LINKED', 409);
    if (input.size !== undefined) this.requireInside(JSON.parse(this.scene(ctx.db, ctx.campaignId, token.scene_id)!.grid) as GridSettings, token.x, token.y, input.size);
    if (input.ownerAccountId && !findActiveMember(ctx.db, ctx.campaignId, input.ownerAccountId)) throw new DomainError('MEMBER_NOT_FOUND', 404);
    const next = {
      label: input.label ?? token.label,
      hidden: input.hidden === undefined ? token.hidden : input.hidden ? 1 : 0,
      size: input.size ?? token.size,
      owner: input.ownerAccountId === undefined ? token.owner_account_id : input.ownerAccountId,
      hp: input.hp === undefined ? token.hp : input.hp === null ? null : JSON.stringify(input.hp),
    };
    ctx.db
      .prepare('UPDATE tokens SET label = ?, hidden = ?, size = ?, owner_account_id = ?, hp = ?, updated_at = ? WHERE campaign_id = ? AND id = ?')
      .run(next.label, next.hidden, next.size, next.owner, next.hp, ctx.now, ctx.campaignId, token.id);
    return { id: token.id };
  }

  private remove(ctx: CommandContext): { id: Id } {
    const result = ctx.db.prepare('DELETE FROM tokens WHERE campaign_id = ? AND id = ?').run(ctx.campaignId, ctx.targetId);
    if (!result.changes) throw new DomainError('NOT_FOUND', 404);
    return { id: ctx.targetId };
  }

  requireInside(grid: GridSettings, x: number, y: number, size: number): void {
    if (x < 0 || y < 0 || x + size > grid.columns || y + size > grid.rows) throw new DomainError('TOKEN_OUT_OF_BOUNDS', 409, { columns: grid.columns, rows: grid.rows });
  }
}
