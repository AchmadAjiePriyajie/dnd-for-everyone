import { randomUUID } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { Member, Principal } from '#shared/access';
import type { Id, JsonValue } from '#shared/contracts';
import {
  journalSchema, linkSessionSchema, type PlaySession, recapSchema, ruleNoteResolveSchema, ruleNoteSchema, type SessionLogEntry, type SessionSummary,
  type SessionView, startSessionSchema,
} from '#shared/sessions';
import { CommandsService } from '../../commands/dispatcher.js';
import { currentSequence } from '../../commands/events.js';
import type { CommandContext } from '../../commands/registry.js';
import { DomainError, forbidden } from '../../common/domain-error.js';
import { DatabaseService } from '../../db/database.service.js';
import { ProjectionService } from '../../realtime/projection.js';
import { CampaignsService } from '../campaigns/service.js';
import { ResolutionsService } from '../combat/resolutions.js';
import { CombatService } from '../combat/service.js';
import { ScenesProjection } from '../scenes/projection.js';

const empty = z.strictObject({});
/** Events players may see in the session log; data is never sent, only kind/time/actor/target. */
const PLAYER_LOG = new Set(['session.start', 'session.pause', 'session.resume', 'session.end', 'session.recap', 'combat.start', 'combat.begin', 'combat.next', 'combat.pause', 'combat.resume', 'combat.end']);
const LOG_LIMIT = 500;

/**
 * Play sessions: lifecycle, play time, recap/journal/rule notes and a structured log. The session
 * stores links (scene, combat) and reads committed state through the existing projections on resume.
 */
@Injectable()
export class SessionsService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly commands: CommandsService,
    private readonly campaigns: CampaignsService,
    private readonly combat: CombatService,
    private readonly scenes: ScenesProjection,
    private readonly resolutions: ResolutionsService,
    private readonly projection: ProjectionService,
  ) {}

  onModuleInit(): void {
    const dm = { roles: ['dm' as const] };
    this.commands.registerCommand('session.start', (ctx, payload) => this.reply(this.startSession(ctx, ctx.campaignId, payload as z.infer<typeof startSessionSchema>)), { schema: startSessionSchema, ...dm });
    this.commands.registerCommand('session.pause', (ctx) => this.reply(this.pauseSession(ctx, ctx.targetId)), { schema: empty, ...dm });
    this.commands.registerCommand('session.resume', (ctx) => this.reply(this.resume(ctx)), { schema: empty, ...dm });
    this.commands.registerCommand('session.end', (ctx) => this.reply(this.end(ctx)), { schema: empty, ...dm });
    this.commands.registerCommand('session.link', (ctx, payload) => this.reply(this.link(ctx, (payload as z.infer<typeof linkSessionSchema>).sceneId)), { schema: linkSessionSchema, ...dm });
    this.commands.registerCommand('session.recap', (ctx, payload) => {
      if (ctx.expectedRevision === null) throw new DomainError('REVISION_REQUIRED', 409);
      const session = this.require(ctx);
      session.recap = payload as z.infer<typeof recapSchema>;
      return this.reply(this.save(ctx, session));
    }, { schema: recapSchema, ...dm });
    this.commands.registerCommand('session.journal', (ctx, payload) => {
      const session = this.require(ctx);
      const input = payload as z.infer<typeof journalSchema>;
      const id = randomUUID();
      session.journal.push({ id, accountId: ctx.principal.accountId, text: input.text, visibility: input.visibility, createdAt: ctx.now });
      this.save(ctx, session);
      return { id }; // Event data never copies journal text.
    }, { schema: journalSchema });
    this.commands.registerCommand('session.rule-note', (ctx, payload) => {
      const session = this.require(ctx);
      const input = payload as z.infer<typeof ruleNoteSchema>;
      const id = randomUUID();
      session.ruleNotes = [...(session.ruleNotes ?? []), { id, text: input.text, ruleId: input.ruleId ?? null, resolved: false, createdAt: ctx.now }];
      this.save(ctx, session);
      return { id };
    }, { schema: ruleNoteSchema, ...dm });
    this.commands.registerCommand('session.rule-note-resolve', (ctx, payload) => {
      const session = this.require(ctx);
      const input = payload as z.infer<typeof ruleNoteResolveSchema>;
      if (!session.ruleNotes?.some((note) => note.id === input.noteId)) throw new DomainError('NOT_FOUND', 404);
      session.ruleNotes = session.ruleNotes.map((note) => note.id === input.noteId ? { ...note, resolved: input.resolved } : note);
      this.save(ctx, session);
      return { id: input.noteId };
    }, { schema: ruleNoteResolveSchema, ...dm });
    this.projection.registerSection('session', (db, member) => ({ session: this.current(db, member.campaignId) }));
  }

  startSession(ctx: CommandContext, campaignId: Id, input: z.infer<typeof startSessionSchema> = {}): PlaySession {
    if (ctx.db.prepare("SELECT 1 FROM play_sessions WHERE campaign_id = ? AND (status != 'ended' OR id = ?)").get(campaignId, ctx.targetId)) throw new DomainError('SESSION_EXISTS', 409);
    if (input.sceneId && !ctx.db.prepare('SELECT 1 FROM scenes WHERE campaign_id = ? AND id = ?').get(campaignId, input.sceneId)) throw new DomainError('NOT_FOUND', 404);
    const number = ((ctx.db.prepare('SELECT MAX(number) AS n FROM play_sessions WHERE campaign_id = ?').get(campaignId) as { n: number | null }).n ?? 0) + 1;
    const session: PlaySession = {
      id: ctx.targetId, campaignId, number, title: input.title ?? `Session ${number}`, status: 'active', startedAt: ctx.now, endedAt: null,
      segments: [{ start: ctx.now, end: null }], sceneId: input.sceneId ?? null, combatId: null, pausedCombat: false,
      recap: { shared: '', dm: '' }, journal: [], ruleNotes: [], firstSequence: currentSequence(ctx.db, campaignId) + 1, lastSequence: null, revision: 0,
    };
    ctx.db.prepare('INSERT INTO play_sessions (id, campaign_id, number, status, record, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(session.id, campaignId, number, session.status, '{}', ctx.now, ctx.now);
    return this.save(ctx, session);
  }

  /** Pausing closes the play-time segment, links the open combat and pauses it if it is running. */
  pauseSession(ctx: CommandContext, sessionId: Id): PlaySession {
    const session = this.require({ ...ctx, targetId: sessionId });
    if (session.status === 'ended') throw new DomainError('SESSION_ENDED', 409);
    if (session.status !== 'active') throw new DomainError('SESSION_NOT_ACTIVE', 409);
    this.closeSegment(session, ctx.now);
    session.combatId = session.combatId ?? this.combat.openCombatId(ctx.db, ctx.campaignId);
    session.pausedCombat = session.combatId ? this.combat.setPausedForSession(ctx, session.combatId, true) : false;
    session.status = 'paused';
    return this.save(ctx, session);
  }

  /** Read side of resume: the committed state reached through the live projections for this member. */
  resumeSession(principal: Principal, campaignId: Id, sessionId: Id): SessionView {
    const member = this.campaigns.requireMember(principal, campaignId);
    const db = this.database.getHandle();
    const session = this.load(db, campaignId, sessionId);
    if (!session) throw forbidden();
    const combatId = session.combatId ?? (session.status === 'ended' ? null : this.combat.openCombatId(db, campaignId));
    const combat = combatId ? this.combat.get(principal, campaignId, combatId) : null;
    let scene = null;
    if (session.sceneId) {
      try { scene = this.scenes.projectScene(principal, campaignId, session.sceneId); } catch { scene = null; }
    }
    return {
      session: this.filter(session, member), turnId: combat ? `${combat.id}:${combat.turn}` : null, round: combat?.round ?? null, combat, scene,
      resolutions: combat ? this.resolutions.list(db, member).filter((r) => r.combatId === combat.id) : [], log: this.log(db, member, session),
    };
  }

  list(principal: Principal, campaignId: Id): SessionSummary[] {
    this.campaigns.requireMember(principal, campaignId);
    const rows = this.database.getHandle().prepare('SELECT record FROM play_sessions WHERE campaign_id = ? ORDER BY number').all(campaignId) as Array<{ record: string }>;
    return rows.map((row) => this.summary(JSON.parse(row.record) as PlaySession));
  }

  private resume(ctx: CommandContext): PlaySession {
    const session = this.require(ctx);
    if (session.status === 'ended') throw new DomainError('SESSION_ENDED', 409);
    if (session.status !== 'paused') throw new DomainError('SESSION_NOT_ACTIVE', 409);
    session.segments.push({ start: ctx.now, end: null });
    if (session.pausedCombat && session.combatId) this.combat.setPausedForSession(ctx, session.combatId, false);
    session.pausedCombat = false;
    session.status = 'active';
    return this.save(ctx, session);
  }

  private end(ctx: CommandContext): PlaySession {
    const session = this.require(ctx);
    if (session.status === 'ended') throw new DomainError('SESSION_ENDED', 409);
    this.closeSegment(session, ctx.now);
    session.combatId = session.combatId ?? this.combat.openCombatId(ctx.db, ctx.campaignId);
    session.status = 'ended';
    session.endedAt = ctx.now;
    session.lastSequence = currentSequence(ctx.db, ctx.campaignId) + 1;
    return this.save(ctx, session);
  }

  private link(ctx: CommandContext, sceneId: Id | null): PlaySession {
    const session = this.require(ctx);
    if (sceneId && !ctx.db.prepare('SELECT 1 FROM scenes WHERE campaign_id = ? AND id = ?').get(ctx.campaignId, sceneId)) throw new DomainError('NOT_FOUND', 404);
    session.sceneId = sceneId;
    return this.save(ctx, session);
  }

  private closeSegment(session: PlaySession, now: string): void {
    const open = session.segments.at(-1);
    if (open && open.end === null) open.end = now;
  }

  private filter(session: PlaySession, member: Member): PlaySession {
    if (member.role === 'dm') return session;
    const { ruleNotes: _notes, recap, ...rest } = session;
    return { ...rest, recap: { shared: recap.shared }, journal: session.journal.filter((entry) => entry.visibility === 'party' || entry.accountId === member.accountId) };
  }

  private log(db: DatabaseSync, member: Member, session: PlaySession): SessionLogEntry[] {
    const rows = db.prepare(`SELECT sequence, kind, created_at, actor_account_id, target_id FROM campaign_events
      WHERE campaign_id = ? AND sequence >= ? AND sequence <= ? ORDER BY sequence DESC LIMIT ?`)
      .all(session.campaignId, session.firstSequence, session.lastSequence ?? Number.MAX_SAFE_INTEGER, LOG_LIMIT * 4) as Array<{ sequence: number; kind: string; created_at: string; actor_account_id: Id | null; target_id: Id }>;
    return rows
      .filter((row) => member.role === 'dm' || PLAYER_LOG.has(row.kind))
      .slice(0, LOG_LIMIT)
      .reverse()
      .map((row) => ({ sequence: row.sequence, kind: row.kind, at: row.created_at, actorAccountId: row.actor_account_id, targetId: row.target_id }));
  }

  private current(db: DatabaseSync, campaignId: Id): SessionSummary | null {
    const row = db.prepare("SELECT record FROM play_sessions WHERE campaign_id = ? ORDER BY status = 'ended', number DESC LIMIT 1").get(campaignId) as { record: string } | undefined;
    return row ? this.summary(JSON.parse(row.record) as PlaySession) : null;
  }

  private summary(session: PlaySession): SessionSummary {
    return { id: session.id, number: session.number, title: session.title, status: session.status, startedAt: session.startedAt, endedAt: session.endedAt };
  }

  private require(ctx: CommandContext): PlaySession {
    const session = this.load(ctx.db, ctx.campaignId, ctx.targetId);
    if (!session) throw forbidden();
    return session;
  }

  private load(db: DatabaseSync, campaignId: Id, sessionId: Id): PlaySession | null {
    const row = db.prepare('SELECT record FROM play_sessions WHERE campaign_id = ? AND id = ?').get(campaignId, sessionId) as { record: string } | undefined;
    if (!row) return null;
    const revision = db.prepare('SELECT revision FROM entity_revisions WHERE campaign_id = ? AND target_id = ?').get(campaignId, sessionId) as { revision: number } | undefined;
    return { ...(JSON.parse(row.record) as PlaySession), revision: revision?.revision ?? 0 };
  }

  private save(ctx: CommandContext, session: PlaySession): PlaySession {
    const { revision: _revision, ...record } = session;
    ctx.db.prepare('UPDATE play_sessions SET status = ?, record = ?, updated_at = ? WHERE campaign_id = ? AND id = ?')
      .run(session.status, JSON.stringify(record), ctx.now, ctx.campaignId, session.id);
    return session;
  }

  /** Command results carry no recap/journal text, so the event log stays free of secrets. */
  private reply(session: PlaySession): JsonValue {
    return { id: session.id, status: session.status };
  }
}
