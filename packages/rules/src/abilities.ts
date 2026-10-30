import {
  ABILITIES,
  type AbilityKey,
  type AbilityMethod,
  type AbilityScores,
  type DraftIssue,
  type RecordedRoll,
  type SkillKey,
} from '#shared/characters';

/** Modifier ability: (score − 10) / 2, dibulatkan ke bawah. */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Standard Array SRD 5.2.1 ("Generate Your Scores"). */
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

/** Biaya Point Buy per score; anggaran 27 poin, rentang 8–15. */
export const POINT_BUY_COSTS: Readonly<Record<number, number>> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const POINT_BUY_BUDGET = 27;

/** Batas score dari peningkatan saat pembuatan karakter. */
export const ABILITY_SCORE_CAP = 20;

/** Bahasa pada tabel Standard Languages SRD (selain Common, yang diketahui semua karakter). */
export const STANDARD_LANGUAGES = [
  'Common Sign Language',
  'Draconic',
  'Dwarvish',
  'Elvish',
  'Giant',
  'Gnomish',
  'Goblin',
  'Halfling',
  'Orc',
];

/** Ability tiap skill (tabel Skills, "Proficiency"). */
export const SKILL_ABILITIES: Readonly<Record<SkillKey, AbilityKey>> = {
  acrobatics: 'dex',
  'animal-handling': 'wis',
  arcana: 'int',
  athletics: 'str',
  deception: 'cha',
  history: 'int',
  insight: 'wis',
  intimidation: 'cha',
  investigation: 'int',
  medicine: 'wis',
  nature: 'int',
  perception: 'wis',
  performance: 'cha',
  persuasion: 'cha',
  religion: 'int',
  'sleight-of-hand': 'dex',
  stealth: 'dex',
  survival: 'wis',
};

const isComplete = (scores: Partial<AbilityScores>): scores is AbilityScores =>
  ABILITIES.every((ability) => Number.isInteger(scores[ability]));

const sorted = (values: number[]) => [...values].sort((a, b) => b - a);
const sameMultiset = (a: number[], b: number[]) => sorted(a).join(',') === sorted(b).join(',');

export function pointBuyCost(scores: AbilityScores): number {
  return ABILITIES.reduce((sum, ability) => sum + (POINT_BUY_COSTS[scores[ability]] ?? Number.POSITIVE_INFINITY), 0);
}

/**
 * Lempar 4d6 dan buang dadu terendah, enam kali. `roll` mengembalikan satu d6 (1–6);
 * server memakai RNG kriptografis dan menyimpan hasilnya agar tidak dapat diganti klien.
 */
export function rollAbilityScores(roll: () => number): RecordedRoll[] {
  return ABILITIES.map(() => {
    const dice = [roll(), roll(), roll(), roll()] as RecordedRoll['dice'];
    const total = sorted(dice).slice(0, 3).reduce((sum, value) => sum + value, 0);
    return { dice, total };
  });
}

/** Masalah pada score dasar untuk metode yang dipilih; kosong berarti valid. */
export function validateBaseScores(method: AbilityMethod, scores: Partial<AbilityScores>, rolls: RecordedRoll[]): DraftIssue[] {
  if (!isComplete(scores)) return [{ field: 'baseScores', code: 'REQUIRED' }];
  const values = ABILITIES.map((ability) => scores[ability]);
  switch (method) {
    case 'standard-array':
      return sameMultiset(values, STANDARD_ARRAY) ? [] : [{ field: 'baseScores', code: 'INVALID' }];
    case 'point-buy': {
      if (values.some((value) => !(value in POINT_BUY_COSTS))) return [{ field: 'baseScores', code: 'INVALID', params: { min: 8, max: 15 } }];
      const cost = pointBuyCost(scores);
      return cost > POINT_BUY_BUDGET ? [{ field: 'baseScores', code: 'INVALID', params: { cost, budget: POINT_BUY_BUDGET } }] : [];
    }
    case 'roll':
      if (rolls.length !== ABILITIES.length) return [{ field: 'rolls', code: 'REQUIRED' }];
      return sameMultiset(values, rolls.map((roll) => roll.total)) ? [] : [{ field: 'baseScores', code: 'INVALID' }];
  }
}
