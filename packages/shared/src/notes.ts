// Hanya `import type` dari file saudara dan zod: dipakai server dan web.
import { z } from 'zod';
import type { Id } from './contracts.js';

export const NOTE_KINDS = ['world', 'chapter', 'scene', 'npc', 'location', 'quest', 'handout', 'ruling'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const QUEST_STATUSES = ['open', 'done', 'failed'] as const;

const id = z.string().min(1).max(100);
const text = (max: number) => z.string().max(max);
const MAX_BODY = 50_000;

/** Siapa yang melihat bagian catatan yang dibagikan. `dm` = rahasia (default persiapan). */
export const noteVisibilitySchema = z.union([
  z.strictObject({ mode: z.literal('dm') }),
  z.strictObject({ mode: z.literal('party') }),
  z.strictObject({ mode: z.literal('members'), accountIds: z.array(id).min(1).max(20) }),
]);
export type NoteVisibility = z.infer<typeof noteVisibilitySchema>;

/**
 * Isi editor. `body` = teks yang ikut dibagikan; `dmNotes` dan bagian persiapan scene
 * (trigger/hasil/reward/stat block) selalu khusus DM. Markdown disimpan sebagai teks biasa.
 */
export const noteDraftSchema = z.strictObject({
  kind: z.enum(NOTE_KINDS),
  title: z.string().trim().min(1).max(160),
  body: text(MAX_BODY),
  dmNotes: text(MAX_BODY),
  scene: z
    .strictObject({
      /** Teks dibacakan ke pemain; ikut dibagikan bersama body. */
      readAloud: text(10_000),
      triggers: text(10_000),
      outcomes: text(10_000),
      rewards: text(10_000),
      /** Rujukan stat block (ID monster corpus). */
      statBlocks: z.array(z.string().regex(/^monster\.[a-z0-9-]+$/).max(120)).max(30),
    })
    .nullable(),
  quest: z.strictObject({ status: z.enum(QUEST_STATUSES) }).nullable(),
  /** Tautan ke catatan lain di campaign yang sama. */
  links: z.array(id).max(50),
  visibility: noteVisibilitySchema,
});
export type NoteDraft = z.infer<typeof noteDraftSchema>;

/** Catatan seperti yang dilihat peserta; field DM hanya ada untuk DM. */
export interface NoteView {
  id: Id;
  kind: NoteKind;
  title: string;
  body: string;
  scene: { readAloud: string } | NonNullable<NoteDraft['scene']> | null;
  quest: NoteDraft['quest'];
  /** Hanya tautan ke catatan yang juga boleh dilihat peserta ini. */
  links: Id[];
  revision: number;
  updatedAt: string;
  /** Khusus DM. */
  dmNotes?: string;
  visibility?: NoteVisibility;
}

/** Ringkasan daftar catatan. */
export interface NoteSummary {
  id: Id;
  kind: NoteKind;
  title: string;
  revision: number;
  updatedAt: string;
  /** Khusus DM. */
  visibility?: NoteVisibility;
}

/** Baris cheat sheet party untuk DM; HP dipisah dari statistik pasif. */
export interface CheatSheetRow {
  characterId: Id;
  name: string;
  ownerAccountId: Id;
  armorClass: number;
  hitPoints: { current: number; max: number; temp: number };
  passivePerception: number;
  /** Nama EN fitur (snapshot netral bahasa). */
  resources: Array<{ key: string; name: string; remaining: number; max: number }>;
  concentration: Id | null;
}
