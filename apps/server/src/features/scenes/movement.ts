import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { movementCost, straightPath } from '#rules/movement';
import type { Principal } from '#shared/access';
import type { Id } from '#shared/contracts';
import { areaMarkerSchema, fogSchema, type FogState, type GridPoint, type GridSettings, type MoveTokenInput, moveTokenSchema } from '#shared/scenes';
import type { CommandContext } from '../../commands/registry.js';
import { CommandsService } from '../../commands/dispatcher.js';
import { DomainError, forbidden } from '../../common/domain-error.js';
import { DomainEvents } from '../../common/domain-events.js';
import { ContentService } from '../../content/content.service.js';
import { DatabaseService } from '../../db/database.service.js';
import { CampaignsService } from '../campaigns/service.js';
import { CharactersService } from '../characters/service.js';
import { CombatService } from '../combat/service.js';
import { RateLimiter } from '../auth/rate-limit.js';
import { ScenesService, type TokenRow } from './service.js';

const empty = z.strictObject({});
/** Ping: paling banyak 5 per 5 detik per akun; tidak disimpan. */
const pingLimiter = new RateLimiter(5, 5_000);

const fail = (code: string): never => {
  throw new DomainError(code as 'PATH_INVALID', 409);
};

/**
 * Gerak token terverifikasi (path, Difficult Terrain, aturan diagonal, batas speed opsional),
 * kabut manual, penanda AoE, dan ping sementara. Override DM tercatat di event command.
 */
@Injectable()
export class MovementService implements OnModuleInit {
  constructor(
    private readonly commands: CommandsService,
    private readonly scenes: ScenesService,
    private readonly database: DatabaseService,
    private readonly campaigns: CampaignsService,
    private readonly content: ContentService,
    private readonly characters: CharactersService,
    private readonly combat: CombatService,
    private readonly events: DomainEvents,
  ) {}

  onModuleInit(): void {
    const dm = { roles: ['dm' as const] };
    this.commands.registerCommand('token.move', (ctx, payload) => this.moveToken(ctx, payload as MoveTokenInput), { schema: moveTokenSchema });
    this.commands.registerCommand('scene.fog', (ctx, payload) => this.setFog(ctx, payload as FogState), { schema: fogSchema, ...dm });
    this.commands.registerCommand('marker.place', (ctx, payload) => this.placeMarker(ctx, payload as z.infer<typeof areaMarkerSchema>), { schema: areaMarkerSchema });
    this.commands.registerCommand('marker.remove', (ctx) => this.removeMarker(ctx), { schema: empty });
  }

  /** Gerak dalam satuan kotak; hasil berisi biaya feet dan apakah DM memakai override. */
  moveToken(ctx: CommandContext, input: MoveTokenInput): { id: Id; x: number; y: number; costFeet: number; override: boolean } {
    const isDm = ctx.member.role === 'dm';
    const token = this.scenes.visibleToken(ctx.db, ctx.member, ctx.targetId);
    if (!token) throw isDm ? new DomainError('NOT_FOUND', 404) : forbidden();
    if (!isDm && (token.owner_account_id !== ctx.principal.accountId || input.override)) throw forbidden();
    const scene = this.scenes.scene(ctx.db, ctx.campaignId, token.scene_id)!;
    const grid = JSON.parse(scene.grid) as GridSettings;
    this.scenes.requireInside(grid, input.x, input.y, token.size);
    const path: GridPoint[] = input.path ?? straightPath({ x: token.x, y: token.y }, { x: input.x, y: input.y });
    const first = path[0]!;
    const last = path.at(-1)!;
    if (first.x !== token.x || first.y !== token.y || last.x !== input.x || last.y !== input.y) fail('PATH_INVALID');
    let costFeet = 0;
    try {
      // Path diukur pada kotak kiri-atas token; token besar memakai sudut yang sama.
      costFeet = movementCost(path, { ...grid, columns: grid.columns - token.size + 1, rows: grid.rows - token.size + 1 });
    } catch (error) {
      fail(error instanceof Error ? error.message : 'PATH_INVALID');
    }
    const override = isDm && input.override === true;
    const combatCost = this.combat.consumeMovement(ctx, token, path, grid, override);
    if (combatCost !== null) costFeet = combatCost;
    if (combatCost === null && grid.enforceSpeed && !override) {
      const speed = this.speedFeet(ctx.db, ctx.campaignId, token);
      if (speed !== null && costFeet > speed) throw new DomainError('MOVE_OVER_BUDGET', 409, { costFeet, speed });
    }
    ctx.db.prepare('UPDATE tokens SET x = ?, y = ?, updated_at = ? WHERE campaign_id = ? AND id = ?').run(input.x, input.y, ctx.now, ctx.campaignId, token.id);
    return { id: token.id, x: input.x, y: input.y, costFeet, override };
  }

  /** Ping sementara ke peserta room; tidak membuat event, receipt, atau baris database. */
  ping(principal: Principal, campaignId: Id, sceneId: Id, point: GridPoint): void {
    const member = this.campaigns.requireMember(principal, campaignId);
    const db = this.database.getHandle();
    const scene = this.scenes.scene(db, campaignId, sceneId);
    if (!scene || (member.role !== 'dm' && !scene.shared)) throw forbidden();
    const grid = JSON.parse(scene.grid) as GridSettings;
    if (point.x >= grid.columns || point.y >= grid.rows) throw new DomainError('VALIDATION_FAILED', 400, { field: 'x' });
    pingLimiter.consume(`${campaignId}:${principal.accountId}`);
    this.events.publish('map.ping', { campaignId, sceneId, x: point.x, y: point.y, accountId: principal.accountId, dmOnly: !scene.shared });
  }

  private setFog(ctx: CommandContext, fog: FogState): { id: Id } {
    const scene = this.scenes.scene(ctx.db, ctx.campaignId, ctx.targetId);
    if (!scene) throw new DomainError('NOT_FOUND', 404);
    ctx.db.prepare('UPDATE scenes SET fog = ?, updated_at = ? WHERE campaign_id = ? AND id = ?').run(JSON.stringify(fog), ctx.now, ctx.campaignId, scene.id);
    return { id: scene.id };
  }

  private placeMarker(ctx: CommandContext, marker: z.infer<typeof areaMarkerSchema>): { id: Id } {
    const scene = this.scenes.scene(ctx.db, ctx.campaignId, marker.sceneId);
    if (!scene || (ctx.member.role !== 'dm' && !scene.shared)) throw forbidden();
    if (ctx.db.prepare('SELECT 1 FROM map_markers WHERE campaign_id = ? AND id = ?').get(ctx.campaignId, ctx.targetId)) throw new DomainError('VALIDATION_FAILED', 400, { field: 'targetId' });
    ctx.db
      .prepare('INSERT INTO map_markers (id, campaign_id, scene_id, owner_account_id, marker, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ctx.targetId, ctx.campaignId, scene.id, ctx.principal.accountId, JSON.stringify(marker), ctx.now);
    return { id: ctx.targetId };
  }

  private removeMarker(ctx: CommandContext): { id: Id } {
    const row = ctx.db.prepare('SELECT owner_account_id FROM map_markers WHERE campaign_id = ? AND id = ?').get(ctx.campaignId, ctx.targetId) as
      | { owner_account_id: Id }
      | undefined;
    if (!row || (ctx.member.role !== 'dm' && row.owner_account_id !== ctx.principal.accountId)) throw forbidden();
    ctx.db.prepare('DELETE FROM map_markers WHERE campaign_id = ? AND id = ?').run(ctx.campaignId, ctx.targetId);
    return { id: ctx.targetId };
  }

  /** Speed berjalan token: sheet karakter, stat block monster, atau homebrew; null = tanpa batas. */
  private speedFeet(db: DatabaseSync, campaignId: Id, token: TokenRow): number | null {
    if (token.character_id) return this.characters.speedFeet(db, campaignId, token.character_id);
    if (!token.monster_id) return null;
    type Speed = { speed?: { walk?: number } };
    let mechanics: Speed | null = null;
    if (token.monster_id.startsWith('monster.') && this.content.has(token.monster_id)) {
      mechanics = this.content.getContent(token.monster_id, 'en').mechanics as Speed | null;
    } else {
      const row = db.prepare("SELECT mechanics FROM homebrew WHERE campaign_id = ? AND id = ? AND status = 'approved'").get(campaignId, token.monster_id) as { mechanics: string } | undefined;
      mechanics = row ? (JSON.parse(row.mechanics) as Speed) : null;
    }
    return mechanics?.speed?.walk ?? null;
  }
}
