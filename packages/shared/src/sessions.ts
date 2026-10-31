import { z } from 'zod';
import type { CombatView, Resolution } from './combat.js';
import type { Id } from './contracts.js';
import type { SceneView } from './scenes.js';

export type SessionStatus = 'active' | 'paused' | 'ended';

/** Journal entry written by any member; `private` = author and DM only. */
export interface JournalEntry {
  id: Id;
  accountId: Id;
  text: string;
  visibility: 'party' | 'private';
  createdAt: string;
}

/** Rule question noted during play, to check after the session (DM only). */
export interface RuleNote {
  id: Id;
  text: string;
  ruleId: Id | null;
  resolved: boolean;
  createdAt: string;
}

/**
 * One meeting of the table. Scene/combat are links to the live records, never copies, so a
 * resumed session always shows the last committed state.
 */
export interface PlaySession {
  id: Id;
  campaignId: Id;
  number: number;
  title: string;
  status: SessionStatus;
  startedAt: string;
  endedAt: string | null;
  /** Play time: one segment per active stretch (pause closes it). */
  segments: Array<{ start: string; end: string | null }>;
  sceneId: Id | null;
  combatId: Id | null;
  /** Set when a pause also paused the linked combat, so resume can restart it. */
  pausedCombat: boolean;
  /** `dm` is omitted for players. */
  recap: { shared: string; dm?: string };
  journal: JournalEntry[];
  /** Omitted for players. */
  ruleNotes?: RuleNote[];
  /** First campaign event sequence that belongs to the session; the log ends at `lastSequence` once ended. */
  firstSequence: number;
  lastSequence: number | null;
  revision: number;
}

export interface SessionSummary { id: Id; number: number; title: string; status: SessionStatus; startedAt: string; endedAt: string | null }

/** Locale-neutral log line; the client renders `kind` in the participant's language. */
export interface SessionLogEntry { sequence: number; kind: string; at: string; actorAccountId: Id | null; targetId: Id }

export interface SessionView {
  session: PlaySession;
  /** `<combatId>:<turn>` of the linked combat; null without combat. */
  turnId: string | null;
  round: number | null;
  combat: CombatView | null;
  scene: SceneView | null;
  resolutions: Resolution[];
  log: SessionLogEntry[];
}

const id = z.string().min(1).max(100);
export const startSessionSchema = z.strictObject({ title: z.string().trim().min(1).max(120).optional(), sceneId: id.nullable().optional() });
export const linkSessionSchema = z.strictObject({ sceneId: id.nullable() });
export const recapSchema = z.strictObject({ shared: z.string().max(20_000), dm: z.string().max(20_000) });
export const journalSchema = z.strictObject({ text: z.string().trim().min(1).max(5_000), visibility: z.enum(['party', 'private']) });
export const ruleNoteSchema = z.strictObject({ text: z.string().trim().min(1).max(1_000), ruleId: z.string().regex(/^[a-z-]+\.[a-z0-9-]+$/).max(120).nullable().optional() });
export const ruleNoteResolveSchema = z.strictObject({ noteId: id, resolved: z.boolean() });
