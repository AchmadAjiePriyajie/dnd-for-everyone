// Hanya `import type` dari file saudara dan zod: dipakai server, web, dan packages/rules.
import { z } from 'zod';
import type { Id, JsonObject } from './contracts.js';

export type DifficultyLabel = 'below-low' | 'low' | 'moderate' | 'high' | 'above-high';
export type EncounterRisk = 'OUTNUMBERED' | 'HIGH_CR' | 'TERRAIN';

export interface EncounterEstimate {
  budget: { low: number; moderate: number; high: number };
  totalXp: number;
  monsterCount: number;
  label: DifficultyLabel;
  /** Budget − total; negatif = melebihi. */
  remaining: { low: number; moderate: number; high: number };
  risks: EncounterRisk[];
}

const id = z.string().min(1).max(120);

/**
 * Template encounter (persiapan). Terpisah dari instance combat: HP saat bermain tidak mengubah
 * template. Party dari karakter campaign atau level manual.
 */
export const encounterTemplateSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  target: z.enum(['low', 'moderate', 'high']),
  party: z.union([
    z.strictObject({ mode: z.literal('characters'), characterIds: z.array(id).min(1).max(12) }),
    z.strictObject({ mode: z.literal('levels'), levels: z.array(z.number().int().min(1).max(20)).min(1).max(12) }),
  ]),
  monsters: z
    .array(
      z.strictObject({
        /** ID monster SRD (`monster.*`) atau homebrew yang disetujui. */
        monsterId: id,
        count: z.number().int().min(1).max(50),
        /** average = HP rata-rata stat block; rolled = dilempar saat combat dimulai. */
        hp: z.enum(['average', 'rolled']),
      }),
    )
    .max(30),
  difficultTerrain: z.boolean(),
  notes: z.string().max(5000),
});
export type EncounterTemplate = z.infer<typeof encounterTemplateSchema>;

export interface EncounterView {
  id: Id;
  template: EncounterTemplate;
  /** null bila party/monster belum valid; `issues` menjelaskan alasannya. */
  estimate: EncounterEstimate | null;
  issues: string[];
  revision: number;
}

/** Monster untuk monster picker: SRD dan homebrew yang disetujui. */
export interface MonsterInstance {
  id: Id;
  name: string;
  originalName: string;
  cr: string;
  xp: number;
  creatureTypes: string[];
  size: string[];
  homebrew: boolean;
}

export const HOMEBREW_KINDS = ['spell', 'equipment', 'magic-item', 'monster', 'feat', 'species', 'background', 'subclass'] as const;
export type HomebrewKind = (typeof HOMEBREW_KINDS)[number];

/** Draft homebrew; `mechanics` divalidasi dengan skema kind yang sama seperti corpus SRD. */
export const homebrewDraftSchema = z.strictObject({
  kind: z.enum(HOMEBREW_KINDS),
  name: z.string().trim().min(1).max(120),
  summary: z.string().max(500),
  body: z.string().max(30_000),
  mechanics: z.record(z.string(), z.json()),
});
export type HomebrewDraft = z.infer<typeof homebrewDraftSchema>;

export interface HomebrewView {
  id: Id;
  kind: HomebrewKind;
  name: string;
  summary: string;
  body: string;
  mechanics: JsonObject;
  status: 'pending' | 'approved';
  authorAccountId: Id;
  revision: number;
}
