import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { Member, Principal } from '#shared/access';
import type { Id } from '#shared/contracts';
import { type NoteDraft, noteDraftSchema, type NoteSummary, type NoteView, type NoteVisibility, noteVisibilitySchema } from '#shared/notes';
import type { CommandContext } from '../../commands/registry.js';
import { CommandsService } from '../../commands/dispatcher.js';
import { DomainError, forbidden } from '../../common/domain-error.js';
import { DatabaseService } from '../../db/database.service.js';
import { ProjectionService } from '../../realtime/projection.js';
import { findActiveMember } from '../campaigns/access.js';
import { CampaignsService } from '../campaigns/service.js';
import { ReferenceService } from '../reference/search.js';

interface NoteRow {
  id: Id;
  campaign_id: Id;
  kind: NoteDraft['kind'];
  title: string;
  body: string;
  dm_notes: string;
  scene: string | null;
  quest: string | null;
  links: string;
  visibility: string;
  updated_at: string;
}

const savePayload = z.strictObject({ draft: noteDraftSchema });
const sharePayload = z.strictObject({ visibility: noteVisibilitySchema });
const empty = z.strictObject({});

/**
 * Catatan cerita (dunia, bab, scene, NPC, lokasi, quest, handout, ruling). Hanya DM menulis;
 * peserta lain menerima projection yang sudah difilter server — field DM tidak pernah dikirim.
 */
@Injectable()
export class NotesService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly commands: CommandsService,
    private readonly campaigns: CampaignsService,
    private readonly projection: ProjectionService,
    private readonly reference: ReferenceService,
  ) {}

  onModuleInit(): void {
    this.commands.registerCommand('note.save', (ctx, payload) => ({ id: this.saveNote(ctx, (payload as z.infer<typeof savePayload>).draft) }), {
      schema: savePayload,
      roles: ['dm'],
    });
    this.commands.registerCommand('note.share', (ctx, payload) => this.share(ctx, (payload as z.infer<typeof sharePayload>).visibility), {
      schema: sharePayload,
      roles: ['dm'],
    });
    this.commands.registerCommand('note.delete', (ctx) => this.remove(ctx), { schema: empty, roles: ['dm'] });
    this.projection.registerSection('notes', (db, member) => ({ notes: this.summaries(db, member) }));
    // Pencarian referensi campaign: judul+isi yang dibagikan; catatan DM hanya untuk DM.
    this.reference.registerSource({
      name: 'notes',
      entries: (db, campaignId) =>
        this.rows(db, campaignId).map((row) => {
          const visibility = JSON.parse(row.visibility) as NoteVisibility;
          const scene = row.scene ? (JSON.parse(row.scene) as NonNullable<NoteDraft['scene']>) : null;
          const shared = [row.body, scene?.readAloud ?? ''].filter(Boolean).join('\n\n');
          return {
            id: row.id,
            kind: `note.${row.kind}`,
            title: { en: row.title },
            summary: null,
            // Teks DM hanya diindeks bila audiens memang DM saja.
            body: { en: visibility.mode === 'dm' ? [shared, row.dm_notes].filter(Boolean).join('\n\n') : shared },
            audience: visibility.mode === 'dm' ? 'dm' : visibility.mode === 'party' ? 'members' : 'selected',
            ...(visibility.mode === 'members' ? { accountIds: visibility.accountIds } : {}),
          };
        }),
    });
  }

  /** Simpan catatan DM. Catatan yang sudah ada wajib membawa expectedRevision agar tab lain tidak tertimpa diam-diam. */
  saveNote(ctx: CommandContext, draft: NoteDraft): Id {
    const existing = this.row(ctx.db, ctx.campaignId, ctx.targetId);
    if (existing && ctx.expectedRevision === null) throw new DomainError('REVISION_REQUIRED', 409);
    this.requireVisibility(ctx.db, ctx.campaignId, draft.visibility);
    for (const link of draft.links) {
      if (link === ctx.targetId || !this.row(ctx.db, ctx.campaignId, link)) throw new DomainError('NOTE_LINK_INVALID', 409, { link });
    }
    const values = [
      draft.kind,
      draft.title,
      draft.body,
      draft.dmNotes,
      draft.scene ? JSON.stringify(draft.scene) : null,
      draft.quest ? JSON.stringify(draft.quest) : null,
      JSON.stringify([...new Set(draft.links)]),
      JSON.stringify(draft.visibility),
      ctx.now,
    ];
    if (existing) {
      ctx.db
        .prepare('UPDATE notes SET kind = ?, title = ?, body = ?, dm_notes = ?, scene = ?, quest = ?, links = ?, visibility = ?, updated_at = ? WHERE campaign_id = ? AND id = ?')
        .run(...values, ctx.campaignId, ctx.targetId);
    } else {
      ctx.db
        .prepare(
          `INSERT INTO notes (kind, title, body, dm_notes, scene, quest, links, visibility, updated_at, campaign_id, id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(...values, ctx.campaignId, ctx.targetId, ctx.now);
    }
    return ctx.targetId;
  }

  /** Daftar catatan yang boleh dilihat peserta. */
  visibleNotes(principal: Principal, campaignId: Id): NoteSummary[] {
    const member = this.campaigns.requireMember(principal, campaignId);
    return this.summaries(this.database.getHandle(), member);
  }

  /** Satu catatan; rahasia dan tidak ada sama-sama FORBIDDEN (tidak membocorkan keberadaan). */
  getNote(principal: Principal, campaignId: Id, noteId: Id): NoteView {
    const member = this.campaigns.requireMember(principal, campaignId);
    const db = this.database.getHandle();
    const row = this.row(db, campaignId, noteId);
    if (!row || !this.canSee(row, member)) throw forbidden();
    const isDm = member.role === 'dm';
    const scene = row.scene ? (JSON.parse(row.scene) as NonNullable<NoteDraft['scene']>) : null;
    const visible = new Set(this.rows(db, campaignId).filter((candidate) => this.canSee(candidate, member)).map((candidate) => candidate.id));
    const view: NoteView = {
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      scene: scene ? (isDm ? scene : { readAloud: scene.readAloud }) : null,
      quest: row.quest ? (JSON.parse(row.quest) as NoteDraft['quest']) : null,
      links: (JSON.parse(row.links) as Id[]).filter((link) => visible.has(link)),
      revision: this.revision(db, campaignId, row.id),
      updatedAt: row.updated_at,
    };
    if (isDm) {
      view.dmNotes = row.dm_notes;
      view.visibility = JSON.parse(row.visibility) as NoteVisibility;
    }
    return view;
  }

  private share(ctx: CommandContext, visibility: NoteVisibility): { id: Id } {
    const row = this.row(ctx.db, ctx.campaignId, ctx.targetId);
    if (!row) throw new DomainError('NOT_FOUND', 404);
    if (ctx.expectedRevision === null) throw new DomainError('REVISION_REQUIRED', 409);
    this.requireVisibility(ctx.db, ctx.campaignId, visibility);
    ctx.db.prepare('UPDATE notes SET visibility = ?, updated_at = ? WHERE campaign_id = ? AND id = ?').run(JSON.stringify(visibility), ctx.now, ctx.campaignId, row.id);
    return { id: row.id };
  }

  private remove(ctx: CommandContext): { id: Id } {
    const row = this.row(ctx.db, ctx.campaignId, ctx.targetId);
    if (!row) throw new DomainError('NOT_FOUND', 404);
    if (ctx.expectedRevision === null) throw new DomainError('REVISION_REQUIRED', 409);
    ctx.db.prepare('DELETE FROM notes WHERE campaign_id = ? AND id = ?').run(ctx.campaignId, row.id);
    // Tautan dari catatan lain ke catatan yang dihapus ikut dibersihkan.
    for (const other of this.rows(ctx.db, ctx.campaignId)) {
      const links = JSON.parse(other.links) as Id[];
      if (links.includes(row.id)) {
        ctx.db.prepare('UPDATE notes SET links = ? WHERE campaign_id = ? AND id = ?').run(JSON.stringify(links.filter((link) => link !== row.id)), ctx.campaignId, other.id);
      }
    }
    return { id: row.id };
  }

  private requireVisibility(db: DatabaseSync, campaignId: Id, visibility: NoteVisibility): void {
    if (visibility.mode !== 'members') return;
    for (const accountId of visibility.accountIds) if (!findActiveMember(db, campaignId, accountId)) throw new DomainError('MEMBER_NOT_FOUND', 404);
  }

  private canSee(row: NoteRow, member: Member): boolean {
    if (member.role === 'dm') return true;
    const visibility = JSON.parse(row.visibility) as NoteVisibility;
    return visibility.mode === 'party' || (visibility.mode === 'members' && visibility.accountIds.includes(member.accountId));
  }

  private summaries(db: DatabaseSync, member: Member): NoteSummary[] {
    return this.rows(db, member.campaignId)
      .filter((row) => this.canSee(row, member))
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        revision: this.revision(db, member.campaignId, row.id),
        updatedAt: row.updated_at,
        ...(member.role === 'dm' ? { visibility: JSON.parse(row.visibility) as NoteVisibility } : {}),
      }));
  }

  private rows(db: DatabaseSync, campaignId: Id): NoteRow[] {
    return db.prepare('SELECT * FROM notes WHERE campaign_id = ? ORDER BY kind, title, id').all(campaignId) as unknown as NoteRow[];
  }

  private row(db: DatabaseSync, campaignId: Id, noteId: Id): NoteRow | undefined {
    return db.prepare('SELECT * FROM notes WHERE campaign_id = ? AND id = ?').get(campaignId, noteId) as unknown as NoteRow | undefined;
  }

  private revision(db: DatabaseSync, campaignId: Id, targetId: Id): number {
    const row = db.prepare('SELECT revision FROM entity_revisions WHERE campaign_id = ? AND target_id = ?').get(campaignId, targetId) as { revision: number } | undefined;
    return row?.revision ?? 0;
  }
}
