import { describe, expect, it } from 'vitest';
import { calculateBudget, evaluateEncounter } from './encounter-budget.ts';
import { evaluateFormula, parseFormula } from './formula.ts';

// Tabel "XP Budget per Character" SRD 5.2.1 (rule.combat-encounters), dibaca dari sumber.
describe('encounter budget 2024', () => {
  it('uses_2024_xp_budget', () => {
    expect(calculateBudget([1, 1, 1, 1])).toEqual({ low: 200, moderate: 300, high: 400 });
    // Level campuran: jumlah budget per karakter (3 → 150/225/400, 5 → 500/750/1,100).
    expect(calculateBudget([3, 5])).toEqual({ low: 650, moderate: 975, high: 1500 });
    expect(calculateBudget([20])).toEqual({ low: 6400, moderate: 13200, high: 22000 });
    // Contoh 2 SRD: lima karakter level 3, Moderate 225 × 5 = 1,125.
    expect(calculateBudget([3, 3, 3, 3, 3]).moderate).toBe(1125);

    // Empat musuh 50 XP = 200, tanpa multiplier jumlah musuh 2014.
    const four = evaluateEncounter([1, 1, 1, 1], [{ xp: 50, count: 4 }]);
    expect(four).toMatchObject({ totalXp: 200, monsterCount: 4, label: 'low', remaining: { low: 0, moderate: 100, high: 200 } });
    // Batas label persis.
    const label = (xp: number) => evaluateEncounter([1, 1, 1, 1], [{ xp, count: 1 }]).label;
    expect([199, 200, 299, 300, 399, 400, 401].map(label)).toEqual(['below-low', 'low', 'low', 'moderate', 'moderate', 'high', 'above-high']);
    // XP nol sah (mis. CR 0); hasilnya tetap di bawah Low.
    expect(evaluateEncounter([2], [{ xp: 0, count: 3 }])).toMatchObject({ totalXp: 0, label: 'below-low' });

    // Risiko: kalah jumlah, CR di atas level party, terrain.
    expect(evaluateEncounter([1, 1, 1, 1], [{ xp: 25, count: 8 }]).risks).toContain('OUTNUMBERED');
    expect(evaluateEncounter([1, 1, 1, 1], [{ xp: 1800, count: 1, cr: 5 }]).risks).toContain('HIGH_CR');
    expect(evaluateEncounter([5], [{ xp: 50, count: 1, cr: 0.25 }], { difficultTerrain: true }).risks).toEqual(['TERRAIN']);

    // Input salah tidak menghasilkan difficulty palsu.
    expect(() => calculateBudget([])).toThrow('PARTY_EMPTY');
    expect(() => calculateBudget([0])).toThrow('LEVEL_INVALID');
    expect(() => calculateBudget([21])).toThrow('LEVEL_INVALID');
    expect(() => calculateBudget([2.5])).toThrow('LEVEL_INVALID');
    expect(() => evaluateEncounter([1], [{ xp: Number.NaN, count: 1 }])).toThrow('XP_INVALID');
    expect(() => evaluateEncounter([1], [{ xp: -5, count: 1 }])).toThrow('XP_INVALID');
    expect(() => evaluateEncounter([1], [{ xp: 50, count: 0 }])).toThrow('QUANTITY_INVALID');
    expect(() => evaluateEncounter([1], [{ xp: 50, count: 1.5 }])).toThrow('QUANTITY_INVALID');
  });

  it('parses_safe_formulas_without_eval', () => {
    const roll = (sides: number) => sides; // dadu selalu maksimum
    expect(evaluateFormula(parseFormula('2d6+3'), {}, roll)).toBe(15);
    expect(evaluateFormula(parseFormula('1d8 + str - 1'), { str: 4 }, roll)).toBe(11);
    expect(evaluateFormula(parseFormula('prof * 2 + level'), { prof: 3, level: 5 }, roll)).toBe(11);
    expect(evaluateFormula(parseFormula('(level + 1) / 2'), { level: 6 }, roll)).toBe(3);
    for (const unsafe of ['alert(1)', 'process.exit()', '2d6; drop table', 'constructor', '__proto__', '1e999', '2d6 + str[0]', '', 'd', '2d', 'x'.repeat(200), '999d999']) {
      expect(() => parseFormula(unsafe), unsafe).toThrow('FORMULA_INVALID');
    }
    // Variabel di luar whitelist ditolak saat parse, bukan dievaluasi.
    expect(() => parseFormula('1d6 + hp')).toThrow('FORMULA_INVALID');
  });
});
