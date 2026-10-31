import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { mechanicsSchemas } from '#content/schema';
import { isSafeFormula } from '#rules/formula';
import type { Member, Principal } from '#shared/access';
import type { ContentKind } from '#shared/content';
import type { Id, JsonObject, JsonValue } from '#shared/contracts';
import { HOMEBREW_KINDS, type HomebrewDraft, homebrewDraftSchema, type HomebrewKind, type HomebrewView } from '#shared/encounters';
import type { CommandContext } from '../../commands/registry.js';
import { CommandsService } from '../../commands/dispatcher.js';
import { DomainError, forbidden } from '../../common/domain-error.js';
import { ContentService } from '../../content/content.service.js';
import { DatabaseService } from '../../db/database.service.js';
import { CampaignsService } from '../campaigns/service.js';
import { ReferenceService } from '../reference/search.js';

export interface HomebrewRow {
  id: Id;
  campaign_id: Id;
  kind: HomebrewKind;
  name: string;
  summary: string;
  body: string;
  mechanics: string;
  status: 'pending' | 'approved';
  author_account_id: Id;
}

const savePayload = z.strictObject({ draft: homebrewDraftSchema });
const duplicatePayload = z.strictObject({ sourceId: z.string().min(1).max(120) });
const empty = z.strictObject({});
/** Kunci mekanik yang berisi formula/dadu dan wajib lolos parser formula aman. */
const FORMULA_KEYS = new Set(['formula', 'dice', 'versatile']);

/** Path pertama berisi string formula yang tidak aman, atau null. */
function unsafeFormula(value: JsonValue, path: string[] = []): string | null {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = unsafeFormula(item, [...path, String(index)]);
      if (found) return found;
    }
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string' && (FORMULA_KEYS.has(key) || key.endsWith('Formula')) && !isSafeFormula(item)) return [...path, key].join('.');
      const found = unsafeFormula(item as JsonValue, [...path, key]);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Homebrew campaign: data dengan skema mekanik yang sama seperti corpus SRD dan formula whitelist
 * (tanpa eval). Usulan player menunggu persetujuan DM; yang disetujui dapat dipakai semua anggota.
 * Ruling: payload memakai HomebrewDraft (bukan ContentEntry penuh) karena locale/source diisi server.
 */
@Injectable()
export class HomebrewService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly commands: CommandsService,
    private readonly campaigns: CampaignsService,
    private readonly content: ContentService,
    private readonly reference: ReferenceService,
  ) {}

  onModuleInit(): void {
    this.commands.registerCommand('homebrew.save', (ctx, payload) => ({ id: this.saveHomebrew(ctx, (payload as z.infer<typeof savePayload>).draft) }), { schema: savePayload });
    this.commands.registerCommand('homebrew.approve', (ctx) => this.approve(ctx), { schema: empty, roles: ['dm'] });
    this.commands.registerCommand('homebrew.delete', (ctx) => this.remove(ctx), { schema: empty });
    this.commands.registerCommand('homebrew.duplicate', (ctx, payload) => this.duplicate(ctx, (payload as z.infer<typeof duplicatePayload>).sourceId), {
      schema: duplicatePayload,
      roles: ['dm'],
    });
    this.reference.registerSource({
      name: 'homebrew',
      entries: (db, campaignId) =>
        this.rows(db, campaignId).map((row) => ({
          id: row.id,
          kind: `homebrew.${row.kind}`,
          title: { en: row.name },
          summary: row.summary ? { en: row.summary } : null,
          body: { en: row.body },
          // Usulan yang belum disetujui hanya untuk DM dan pengusulnya.
          audience: row.status === 'approved' ? ('members' as const) : ('selected' as const),
          ...(row.status === 'approved' ? {} : { accountIds: [row.author_account_id] }),
        })),
    });
  }

  saveHomebrew(ctx: CommandContext, draft: HomebrewDraft): Id {
    const isDm = ctx.member.role === 'dm';
    const existing = this.row(ctx.db, ctx.campaignId, ctx.targetId);
    if (existing && !isDm && existing.author_account_id !== ctx.principal.accountId) throw forbidden();
    if (existing && ctx.expectedRevision === null) throw new DomainError('REVISION_REQUIRED', 409);
    this.requireValid(draft.kind, draft.mechanics);
    // Simpanan player selalu kembali menunggu persetujuan; simpanan DM langsung disetujui.
    const status = isDm ? 'approved' : 'pending';
    const values = [draft.kind, draft.name, draft.summary, draft.body, JSON.stringify(draft.mechanics), status, ctx.now];
    if (existing) {
      ctx.db
        .prepare('UPDATE homebrew SET kind = ?, name = ?, summary = ?, body = ?, mechanics = ?, status = ?, updated_at = ? WHERE campaign_id = ? AND id = ?')
        .run(...values, ctx.campaignId, ctx.targetId);
    } else {
      ctx.db
        .prepare(
          `INSERT INTO homebrew (kind, name, summary, body, mechanics, status, updated_at, campaign_id, id, author_account_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(...values, ctx.campaignId, ctx.targetId, ctx.principal.accountId, ctx.now);
    }
    return ctx.targetId;
  }

  /** Daftar homebrew yang boleh dilihat: DM semua; player yang disetujui dan usulannya sendiri. */
  list(principal: Principal, campaignId: Id): HomebrewView[] {
    const member = this.campaigns.requireMember(principal, campaignId);
    const db = this.database.getHandle();
    return this.rows(db, campaignId)
      .filter((row) => this.canSee(row, member))
      .map((row) => this.view(db, row));
  }

  get(principal: Principal, campaignId: Id, id: Id): HomebrewView {
    const member = this.campaigns.requireMember(principal, campaignId);
    const db = this.database.getHandle();
    const row = this.row(db, campaignId, id);
    if (!row || !this.canSee(row, member)) throw forbidden();
    return this.view(db, row);
  }

  /** Homebrew monster yang sudah disetujui, untuk encounter. */
  approvedMonsters(db: DatabaseSync, campaignId: Id): HomebrewRow[] {
    return this.rows(db, campaignId).filter((row) => row.kind === 'monster' && row.status === 'approved');
  }

  private approve(ctx: CommandContext): { id: Id } {
    const row = this.row(ctx.db, ctx.campaignId, ctx.targetId);
    if (!row) throw new DomainError('NOT_FOUND', 404);
    if (ctx.expectedRevision === null) throw new DomainError('REVISION_REQUIRED', 409);
    ctx.db.prepare("UPDATE homebrew SET status = 'approved', updated_at = ? WHERE campaign_id = ? AND id = ?").run(ctx.now, ctx.campaignId, row.id);
    return { id: row.id };
  }

  private remove(ctx: CommandContext): { id: Id } {
    const row = this.row(ctx.db, ctx.campaignId, ctx.targetId);
    if (!row || (ctx.member.role !== 'dm' && row.author_account_id !== ctx.principal.accountId)) throw forbidden();
    ctx.db.prepare('DELETE FROM homebrew WHERE campaign_id = ? AND id = ?').run(ctx.campaignId, row.id);
    return { id: row.id };
  }

  /** Salin entri SRD menjadi homebrew DM (mis. monster yang diperkuat); teks sumber EN ikut. */
  private duplicate(ctx: CommandContext, sourceId: Id): { id: Id } {
    const kind = sourceId.slice(0, sourceId.indexOf('.'));
    if (!(HOMEBREW_KINDS as readonly string[]).includes(kind) || !this.content.has(sourceId)) throw new DomainError('HOMEBREW_INVALID', 409, { issue: 'source' });
    if (this.row(ctx.db, ctx.campaignId, ctx.targetId)) throw new DomainError('HOMEBREW_INVALID', 409, { issue: 'exists' });
    const entry = this.content.getContent(sourceId, 'en');
    this.saveHomebrew(
      { ...ctx, expectedRevision: null },
      { kind: kind as HomebrewKind, name: `${entry.originalName} (copy)`, summary: entry.summary ?? '', body: entry.body, mechanics: (entry.mechanics ?? {}) as JsonObject },
    );
    return { id: ctx.targetId };
  }

  private requireValid(kind: HomebrewKind, mechanics: JsonObject): void {
    // Formula diperiksa lebih dulu: teks kode tidak pernah lolos sebagai "salah bentuk" biasa.
    const path = unsafeFormula(mechanics);
    if (path) throw new DomainError('HOMEBREW_FORMULA', 409, { path });
    const schema = mechanicsSchemas[kind as ContentKind];
    const result = schema?.safeParse(mechanics);
    if (!result?.success) throw new DomainError('HOMEBREW_INVALID', 409, { issue: result?.error.issues[0]?.path.join('.') || 'mechanics' });
  }

  private canSee(row: HomebrewRow, member: Member): boolean {
    return member.role === 'dm' || row.status === 'approved' || row.author_account_id === member.accountId;
  }

  private view(db: DatabaseSync, row: HomebrewRow): HomebrewView {
    const revision = db.prepare('SELECT revision FROM entity_revisions WHERE campaign_id = ? AND target_id = ?').get(row.campaign_id, row.id) as { revision: number } | undefined;
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      summary: row.summary,
      body: row.body,
      mechanics: JSON.parse(row.mechanics) as JsonObject,
      status: row.status,
      authorAccountId: row.author_account_id,
      revision: revision?.revision ?? 0,
    };
  }

  private rows(db: DatabaseSync, campaignId: Id): HomebrewRow[] {
    return db.prepare('SELECT * FROM homebrew WHERE campaign_id = ? ORDER BY kind, name, id').all(campaignId) as unknown as HomebrewRow[];
  }

  private row(db: DatabaseSync, campaignId: Id, id: Id): HomebrewRow | undefined {
    return db.prepare('SELECT * FROM homebrew WHERE campaign_id = ? AND id = ?').get(campaignId, id) as unknown as HomebrewRow | undefined;
  }
}
