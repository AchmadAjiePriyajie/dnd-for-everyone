import type { Id } from '#shared/contracts';
import type { AbilityKey, AbilityScores } from '#shared/characters';

/** rule.multiclassing: "a score of at least 13 in the primary ability of the new class and your current classes". */
const PREREQUISITE_SCORE = 13;

/**
 * Primary Ability per class dari baris "Primary Ability" SRD 5.2.1. `any` = salah satu
 * (Fighter: Strength or Dexterity), `all` = semuanya (Monk: Dexterity and Wisdom).
 */
export const PRIMARY_ABILITIES: Record<Id, { any?: AbilityKey[]; all?: AbilityKey[] }> = {
  'class.barbarian': { all: ['str'] },
  'class.bard': { all: ['cha'] },
  'class.cleric': { all: ['wis'] },
  'class.druid': { all: ['wis'] },
  'class.fighter': { any: ['str', 'dex'] },
  'class.monk': { all: ['dex', 'wis'] },
  'class.paladin': { all: ['str', 'cha'] },
  'class.ranger': { all: ['dex', 'wis'] },
  'class.rogue': { all: ['dex'] },
  'class.sorcerer': { all: ['cha'] },
  'class.warlock': { all: ['cha'] },
  'class.wizard': { all: ['int'] },
};

/**
 * Trait yang diperoleh saat masuk class sebagai multiclass (bagian "As a Multiclass Character").
 * Saving throw dan sebagian besar skill tidak ikut; Hit Point Die selalu ikut.
 */
export const MULTICLASS_TRAITS: Record<Id, { armor: string[]; weapons: string[]; skill?: 'any' | 'class-list'; tool?: Id | 'musical-instrument' }> = {
  'class.barbarian': { armor: ['shield'], weapons: ['martial'] },
  'class.bard': { armor: ['light'], weapons: [], skill: 'any', tool: 'musical-instrument' },
  'class.cleric': { armor: ['light', 'medium', 'shield'], weapons: [] },
  'class.druid': { armor: ['light', 'shield'], weapons: [] },
  'class.fighter': { armor: ['light', 'medium', 'shield'], weapons: ['martial'] },
  'class.monk': { armor: [], weapons: [] },
  'class.paladin': { armor: ['light', 'medium', 'shield'], weapons: ['martial'] },
  'class.ranger': { armor: ['light', 'medium', 'shield'], weapons: ['martial'], skill: 'class-list' },
  'class.rogue': { armor: ['light'], weapons: [], skill: 'class-list', tool: 'equipment.thieves-tools' },
  'class.sorcerer': { armor: [], weapons: [] },
  'class.warlock': { armor: ['light'], weapons: [] },
  'class.wizard': { armor: [], weapons: [] },
};

export function meetsPrimary(classId: Id, scores: AbilityScores): boolean {
  const rule = PRIMARY_ABILITIES[classId];
  if (!rule) return false;
  if (rule.all && !rule.all.every((ability) => scores[ability] >= PREREQUISITE_SCORE)) return false;
  if (rule.any && !rule.any.some((ability) => scores[ability] >= PREREQUISITE_SCORE)) return false;
  return true;
}

/** Masuk class baru: class baru dan semua class yang sudah dimiliki harus memenuhi syarat. */
export function canMulticlass(current: Id[], newClassId: Id, scores: AbilityScores): boolean {
  return [...current, newClassId].every((classId) => meetsPrimary(classId, scores));
}
