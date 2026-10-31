import type { ContentCatalog } from '#shared/content';
import type { Id } from '#shared/contracts';
import {
  ABILITIES,
  type AbilityKey,
  type AdvancementChoice,
  type AdvancementPreview,
  type AdvancementRecord,
  type AdvancementStatus,
  type AdvancementSummary,
  type Character,
  SKILLS,
  type SkillKey,
} from '#shared/characters';
import { ABILITY_SCORE_CAP } from './abilities.ts';
import { availableFeatures } from './class-features.ts';
import { deriveCharacter } from './character-stats.ts';
import { canMulticlass, MULTICLASS_TRAITS } from './multiclass.ts';
import { deriveSpellcasting } from './spellcasting.ts';

export const MAX_LEVEL = 20;
/** Tabel Character Advancement (rule.level-advancement): XP untuk mencapai level 1–20. */
export const XP_THRESHOLDS = [
  0, 300, 900, 2_700, 6_500, 14_000, 23_000, 34_000, 48_000, 64_000, 85_000, 100_000, 120_000, 140_000, 165_000, 195_000, 225_000, 265_000, 305_000,
  355_000,
];
const EPIC_BOON_CAP = 30;

interface ClassMechanics {
  hitDie: number;
  skillChoices: { count: number; from?: SkillKey[] };
  /** `features` per level di tabel class; ASI muncul di setiap level ASI (daftar `features` hanya sekali). */
  progression: Array<{ level: number; features: string[] }>;
}
interface SubclassMechanics {
  class: Id;
  features: Array<{ level: number; id: string }>;
}
interface FeatMechanics {
  category: 'origin' | 'general' | 'fighting-style' | 'epic-boon';
  prerequisiteLevel?: number;
  repeatable?: boolean;
}

/**
 * Kenaikan ability per feat menurut baris "Ability Score Increase" SRD 5.2.1. Feat yang tidak
 * tercantum (origin, Fighting Style) tidak menaikkan ability.
 */
const FEAT_INCREASES: Record<Id, { abilities: readonly AbilityKey[]; total: number; maxEach: number }> = {
  'feat.ability-score-improvement': { abilities: ABILITIES, total: 2, maxEach: 2 },
  'feat.grappler': { abilities: ['str', 'dex'], total: 1, maxEach: 1 },
  'feat.boon-of-combat-prowess': { abilities: ABILITIES, total: 1, maxEach: 1 },
  'feat.boon-of-dimensional-travel': { abilities: ABILITIES, total: 1, maxEach: 1 },
  'feat.boon-of-fate': { abilities: ABILITIES, total: 1, maxEach: 1 },
  'feat.boon-of-irresistible-offense': { abilities: ['str', 'dex'], total: 1, maxEach: 1 },
  'feat.boon-of-spell-recall': { abilities: ['int', 'wis', 'cha'], total: 1, maxEach: 1 },
  'feat.boon-of-the-night-spirit': { abilities: ABILITIES, total: 1, maxEach: 1 },
  'feat.boon-of-truesight': { abilities: ABILITIES, total: 1, maxEach: 1 },
};
/** Prasyarat ability feat ("Prerequisite: Level 4+, Strength or Dexterity 13+"). */
const FEAT_ABILITY_PREREQUISITES: Record<Id, { any: AbilityKey[]; score: number }> = {
  'feat.grappler': { any: ['str', 'dex'], score: 13 },
};

function mechanics<T>(catalog: ContentCatalog, id: Id | undefined, kind: string): T | null {
  if (!id || !id.startsWith(`${kind}.`) || !catalog.has(id)) return null;
  return catalog.getContent(id, 'en').mechanics as unknown as T | null;
}

const totalLevel = (character: Character) => character.classLevels.reduce((total, entry) => total + entry.level, 0);

/** Boleh naik level: XP cukup (mode XP), milestone dari DM, atau masih di bawah level awal campaign. */
export function advancementStatus(
  level: number,
  settings: { mode: 'milestone' | 'xp'; startingLevel: number },
  progress: { xp: number; levelsGranted: number },
): AdvancementStatus {
  const nextLevelXp = level >= MAX_LEVEL ? null : XP_THRESHOLDS[level]!;
  const earned = settings.mode === 'xp' ? nextLevelXp !== null && progress.xp >= nextLevelXp : progress.levelsGranted > 0;
  return {
    mode: settings.mode,
    xp: progress.xp,
    nextLevelXp,
    levelsGranted: progress.levelsGranted,
    startingLevel: settings.startingLevel,
    canAdvance: level < MAX_LEVEL && (level < settings.startingLevel || earned),
  };
}

function summary(character: Character, catalog: ContentCatalog): AdvancementSummary {
  const derived = deriveCharacter(character, catalog);
  const casting = deriveSpellcasting(character, catalog);
  return {
    level: totalLevel(character),
    proficiencyBonus: derived.proficiencyBonus,
    hitPoints: derived.hitPoints.value,
    slots: casting.slots.map((slot) => slot.max),
    pact: casting.pact ? { level: casting.pact.level, max: casting.pact.max } : null,
  };
}

/** Pratinjau satu level: pilihan wajib, masalah prasyarat, fitur baru, serta angka sebelum/sesudah. */
export function previewAdvancement(character: Character, choice: AdvancementChoice, catalog: ContentCatalog): AdvancementPreview {
  const issues: string[] = [];
  const required: AdvancementPreview['required'] = [];
  const level = totalLevel(character) + 1;
  const before = summary(character, catalog);
  if (level > MAX_LEVEL) issues.push('LEVEL_CAP');

  const cls = mechanics<ClassMechanics>(catalog, choice.classId, 'class');
  const existing = character.classLevels.find((entry) => entry.classId === choice.classId);
  const multiclass = !existing;
  const classLevel = (existing?.level ?? 0) + 1;
  if (!cls) {
    issues.push(`CLASS_INVALID:${choice.classId}`);
    return { choice, level, classLevel, multiclass, hpDie: null, hitDie: 0, required, featCategory: null, newFeatures: [], issues, before, after: before };
  }
  const derived = deriveCharacter(character, catalog);
  const scores = Object.fromEntries(ABILITIES.map((ability) => [ability, derived.abilities[ability].score.value])) as Record<AbilityKey, number>;
  if (
    multiclass &&
    !canMulticlass(
      character.classLevels.map((entry) => entry.classId),
      choice.classId,
      scores,
    )
  ) {
    issues.push(`MULTICLASS_PREREQUISITE:${choice.classId}`);
  }
  const hitDie = cls.hitDie;
  const hpDie = choice.hp === 'fixed' ? hitDie / 2 + 1 : null;

  // ---------------------------------------------------------------- subclass
  const gained = cls.progression.find((step) => step.level === classLevel)?.features ?? [];
  const subclassLevel = gained.some((id) => id.endsWith('-subclass'));
  let subclassId = existing?.subclassId;
  if (choice.subclassId) {
    const sub = mechanics<SubclassMechanics>(catalog, choice.subclassId, 'subclass');
    if (!subclassLevel || existing?.subclassId) issues.push('SUBCLASS_NOT_ALLOWED');
    else if (!sub || sub.class !== choice.classId) issues.push(`SUBCLASS_INVALID:${choice.subclassId}`);
    else subclassId = choice.subclassId;
  } else if (subclassLevel && !existing?.subclassId) required.push('subclass');
  const subGained = mechanics<SubclassMechanics>(catalog, subclassId, 'subclass')?.features.filter((feature) => feature.level === classLevel) ?? [];

  // ---------------------------------------------------------------- feat
  const gainedIds = [...gained, ...subGained.map((feature) => feature.id)];
  const featCategory: AdvancementPreview['featCategory'] = gainedIds.some((id) => id.includes('fighting-style'))
    ? 'fighting-style'
    : gainedIds.includes('epic-boon')
      ? 'epic-boon'
      : gainedIds.includes('ability-score-improvement')
        ? 'general'
        : null;
  if (choice.feat) {
    if (!featCategory) issues.push('FEAT_NOT_ALLOWED');
    else issues.push(...featIssues(character, choice, featCategory, level, scores, derived.feats, catalog));
  } else if (featCategory) required.push('feat');

  // ---------------------------------------------------------------- skill multiclass
  const trait = multiclass ? MULTICLASS_TRAITS[choice.classId] : undefined;
  if (trait?.skill) {
    if (!choice.skill) required.push('skill');
    else {
      const allowed = trait.skill === 'any' ? SKILLS : (cls.skillChoices.from ?? SKILLS);
      if (!allowed.includes(choice.skill) || derived.skills[choice.skill].proficient) issues.push(`SKILL_INVALID:${choice.skill}`);
    }
  } else if (choice.skill) issues.push('SKILL_NOT_ALLOWED');

  const preview: AdvancementPreview = { choice, level, classLevel, multiclass, hpDie, hitDie, required, featCategory, newFeatures: [], issues, before, after: before };
  if (issues.length) return preview;
  // Angka sesudah: terapkan pilihan sementara (lemparan yang belum ada memakai nilai tetap).
  const after = advanced(character, preview, hpDie ?? hitDie / 2 + 1);
  const known = new Set(availableFeatures(character, catalog).map((feature) => feature.key));
  preview.newFeatures = availableFeatures(after, catalog)
    .filter((feature) => !known.has(feature.key))
    .map((feature) => ({ key: feature.key, name: feature.name }));
  preview.after = summary(after, catalog);
  return preview;
}

function featIssues(
  character: Character,
  choice: AdvancementChoice,
  slot: NonNullable<AdvancementPreview['featCategory']>,
  level: number,
  scores: Record<AbilityKey, number>,
  taken: Id[],
  catalog: ContentCatalog,
): string[] {
  const feat = choice.feat!;
  const meta = mechanics<FeatMechanics>(catalog, feat.featId, 'feat');
  if (!meta) return [`FEAT_INVALID:${feat.featId}`];
  // Fighting Style hanya menerima feat Fighting Style; ASI/Epic Boon menerima "another feat ... for which you qualify".
  if (slot === 'fighting-style' && meta.category !== 'fighting-style') return [`FEAT_CATEGORY:${feat.featId}`];
  if (meta.prerequisiteLevel && level < meta.prerequisiteLevel) return [`FEAT_PREREQUISITE:${feat.featId}`];
  const abilityRule = FEAT_ABILITY_PREREQUISITES[feat.featId];
  if (abilityRule && !abilityRule.any.some((ability) => scores[ability] >= abilityRule.score)) return [`FEAT_PREREQUISITE:${feat.featId}`];
  if (slot !== 'fighting-style' && meta.category === 'fighting-style') {
    // Prasyarat "Fighting Style Feature".
    const hasStyle = availableFeatures(character, catalog).some((feature) => feature.featureId.includes('fighting-style'));
    if (!hasStyle) return [`FEAT_PREREQUISITE:${feat.featId}`];
  }
  if (taken.includes(feat.featId) && !meta.repeatable) return [`FEAT_TAKEN:${feat.featId}`];

  const rule = FEAT_INCREASES[feat.featId] ?? { abilities: [], total: 0, maxEach: 0 };
  const entries = Object.entries(feat.increases) as Array<[AbilityKey, number]>;
  const sum = entries.reduce((total, [, value]) => total + value, 0);
  const valid = sum === rule.total && entries.every(([ability, value]) => rule.abilities.includes(ability) && Number.isInteger(value) && value >= 1 && value <= rule.maxEach);
  if (!valid) return [`FEAT_INCREASES:${feat.featId}`];
  const cap = meta.category === 'epic-boon' ? EPIC_BOON_CAP : ABILITY_SCORE_CAP;
  return entries.filter(([ability, value]) => scores[ability] + value > cap).map(([ability]) => `ABILITY_CAP:${ability}`);
}

function advanced(character: Character, preview: AdvancementPreview, hpDie: number): Character {
  const { choice } = preview;
  const record: AdvancementRecord = {
    level: preview.level,
    classId: choice.classId,
    hpDie,
    hpMethod: choice.hp,
    ...(choice.subclassId ? { subclassId: choice.subclassId } : {}),
    ...(choice.feat ? { feat: choice.feat } : {}),
    ...(choice.skill ? { skill: choice.skill } : {}),
    ...(choice.notes?.trim() ? { notes: choice.notes.trim() } : {}),
  };
  const exists = character.classLevels.some((entry) => entry.classId === choice.classId);
  const classLevels = exists
    ? character.classLevels.map((entry) =>
        entry.classId === choice.classId ? { ...entry, level: entry.level + 1, ...(choice.subclassId ? { subclassId: choice.subclassId } : {}) } : entry,
      )
    : [...character.classLevels, { classId: choice.classId, level: 1 }];
  return { ...character, classLevels, advancements: [...character.advancements, record], pendingAdvancement: null };
}

/**
 * Terapkan pratinjau yang sudah lengkap. Server membuat ulang pratinjau dari pilihan dan mengisi
 * lemparan HP sebelum memanggil ini; pratinjau dari client tidak dipercaya.
 */
export function applyAdvancement(character: Character, preview: AdvancementPreview): Character {
  if (preview.issues.length) throw new Error('ADVANCEMENT_INVALID');
  if (preview.required.length) throw new Error('ADVANCEMENT_INCOMPLETE');
  if (preview.hpDie === null || !Number.isInteger(preview.hpDie) || preview.hpDie < 1 || preview.hpDie > preview.hitDie) throw new Error('HP_ROLL_MISSING');
  return advanced(character, preview, preview.hpDie);
}
