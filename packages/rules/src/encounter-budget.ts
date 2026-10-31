import type { EncounterEstimate } from '#shared/encounters';

/**
 * Tabel "XP Budget per Character" SRD 5.2.1 (rule.combat-encounters), indeks = level − 1:
 * [Low, Moderate, High]. Tidak ada multiplier jumlah musuh (aturan 2014).
 */
const XP_BUDGET_PER_CHARACTER: ReadonlyArray<readonly [number, number, number]> = [
  [50, 75, 100],
  [100, 150, 200],
  [150, 225, 400],
  [250, 375, 500],
  [500, 750, 1_100],
  [600, 1_000, 1_400],
  [750, 1_300, 1_700],
  [1_000, 1_700, 2_100],
  [1_300, 2_000, 2_600],
  [1_600, 2_300, 3_100],
  [1_900, 2_900, 4_100],
  [2_200, 3_700, 4_700],
  [2_600, 4_200, 5_400],
  [2_900, 4_900, 6_200],
  [3_300, 5_400, 7_800],
  [3_800, 6_100, 9_800],
  [4_500, 7_200, 11_700],
  [5_000, 8_700, 14_200],
  [5_500, 10_700, 17_200],
  [6_400, 13_200, 22_000],
];

/** Kalah jumlah bila musuh ≥ 2 × jumlah karakter (penanda estimasi pembuat, bukan aturan SRD). */
const OUTNUMBERED_RATIO = 2;

const fail = (code: string): never => {
  throw new Error(code);
};

/** Budget party: jumlah budget tiap karakter sesuai levelnya. */
export function calculateBudget(levels: number[]): { low: number; moderate: number; high: number } {
  if (!levels.length) fail('PARTY_EMPTY');
  const budget = { low: 0, moderate: 0, high: 0 };
  for (const level of levels) {
    const row = Number.isInteger(level) ? XP_BUDGET_PER_CHARACTER[level - 1] : undefined;
    if (!row) return fail('LEVEL_INVALID');
    budget.low += row[0];
    budget.moderate += row[1];
    budget.high += row[2];
  }
  return budget;
}

/**
 * Estimasi susunan: label dari total XP terhadap budget (di bawah Low; Low sampai sebelum Moderate;
 * Moderate sampai sebelum High; tepat High; melampaui High), sisa per tingkat, dan penanda risiko.
 */
export function evaluateEncounter(
  levels: number[],
  monsters: Array<{ xp: number; count: number; cr?: number }>,
  options: { difficultTerrain?: boolean } = {},
): EncounterEstimate {
  const budget = calculateBudget(levels);
  let totalXp = 0;
  let monsterCount = 0;
  for (const monster of monsters) {
    if (!Number.isInteger(monster.xp) || monster.xp < 0) fail('XP_INVALID');
    if (!Number.isInteger(monster.count) || monster.count < 1) fail('QUANTITY_INVALID');
    totalXp += monster.xp * monster.count;
    monsterCount += monster.count;
  }
  const label: EncounterEstimate['label'] =
    totalXp < budget.low ? 'below-low' : totalXp < budget.moderate ? 'low' : totalXp < budget.high ? 'moderate' : totalXp === budget.high ? 'high' : 'above-high';
  const risks: EncounterEstimate['risks'] = [];
  if (monsterCount >= levels.length * OUTNUMBERED_RATIO) risks.push('OUTNUMBERED');
  const topLevel = Math.max(...levels);
  if (monsters.some((monster) => monster.cr !== undefined && monster.cr > topLevel)) risks.push('HIGH_CR');
  if (options.difficultTerrain) risks.push('TERRAIN');
  return {
    budget,
    totalXp,
    monsterCount,
    label,
    remaining: { low: budget.low - totalXp, moderate: budget.moderate - totalXp, high: budget.high - totalXp },
    risks,
  };
}
