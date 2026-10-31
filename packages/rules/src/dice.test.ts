import { describe, expect, it } from 'vitest';
import { rollDice, resolveD20 } from './dice.js';
import { applyDamage, applyDeathSave, cannotAct, cannotMove, emptyVitals, normalizeVitals } from './damage.js';
import type { HitPointState, RandomInt } from '#shared/combat';

const sequence = (...values: number[]): RandomInt => {
  let index = 0;
  return (min, max) => {
    const value = values[index++];
    if (value === undefined || value < min || value >= max) throw new Error('Unexpected random request');
    return value;
  };
};
const hp = (over: Partial<HitPointState> = {}): HitPointState => ({
  current: 10, max: 10, temp: 0, ...emptyVitals(), defenses: { resistances: [], vulnerabilities: [], immunities: [], conditionImmunities: [] }, ...over,
});

describe('authoritative dice and damage rules', () => {
  it('validates_dice_and_applies_critical_dice', () => {
    expect(rollDice('2d6+3', sequence(1, 1))).toMatchObject({ total: 5, modifier: 3, dice: [{ sides: 6, rolls: [1, 1], sign: 1 }] });
    expect(rollDice('1d6+3', sequence(1, 1), true)).toMatchObject({ total: 5, modifier: 3, critical: true });
    expect(rollDice('2d6-1d4-3', sequence(6, 6, 2)).total).toBe(7);
    expect(rollDice('d1000', sequence(1000)).total).toBe(1000);
    expect(rollDice('100d2', () => 1).total).toBe(100);
    expect(rollDice(' 2d6 + 3 ', () => 1).total).toBe(5);
    for (const expression of ['0d6', '101d6', '60d6+41d4', '2d1001', '2d0', '2d6+Infinity', '1.5d6', '1e3', 'process.exit()', '2d6;alert(1)', '1+2*3', '(2d6)', '2d6++3', '1'.repeat(101)]) {
      expect(() => rollDice(expression, () => 1), expression).toThrow('DICE_INVALID');
    }
    expect(() => rollDice('51d6', () => 1, true)).toThrow('DICE_INVALID');
    expect(() => rollDice('d6', () => 7)).toThrow('RANDOM_INVALID');
  });

  it('resolves_advantage_cancellation_and_natural_attack_rules', () => {
    expect(resolveD20({ kind: 'check', modifier: 3, advantage: true, dc: 15 }, sequence(4, 17))).toMatchObject({ rolls: [4, 17], kept: 17, total: 20, success: true });
    expect(resolveD20({ kind: 'save', modifier: 0, disadvantage: true, dc: 10 }, sequence(4, 17))).toMatchObject({ kept: 4, success: false });
    expect(resolveD20({ kind: 'attack', modifier: 0, advantage: true, disadvantage: true, dc: 99 }, sequence(20))).toMatchObject({ rolls: [20], critical: true, success: true });
    expect(resolveD20({ kind: 'attack', modifier: 100, dc: 10 }, sequence(1))).toMatchObject({ success: false, fumble: true });
    expect(resolveD20({ kind: 'save', modifier: -5, dc: 30 }, sequence(20))).toMatchObject({ success: false, critical: false });
    expect(() => resolveD20({ kind: 'check', modifier: 101 }, () => 1)).toThrow('D20_INVALID');
    expect(() => resolveD20({ kind: 'save', modifier: 1.2 }, () => 1)).toThrow('D20_INVALID');
  });

  it('applies_defenses_in_order_then_temp_hp_without_stacking', () => {
    const state = hp({ temp: 3, defenses: { resistances: ['fire', 'fire'], vulnerabilities: ['fire'], immunities: ['poison'], conditionImmunities: [] } });
    // 7 Fire: resistance 3, then vulnerability 6; temporary HP absorbs 3.
    expect(applyDamage(state, { kind: 'damage', amount: 7, damageType: 'fire' })).toMatchObject({ current: 7, temp: 0 });
    expect(applyDamage(state, { kind: 'damage', amount: 100, damageType: 'poison' })).toEqual(state);
    expect(applyDamage(hp({ current: 2, temp: 8 }), { kind: 'heal', amount: 30 })).toMatchObject({ current: 10, temp: 8 });
    expect(applyDamage(hp({ temp: 8 }), { kind: 'temp', amount: 5 })).toMatchObject({ temp: 8 });
    expect(applyDamage(hp({ temp: 8 }), { kind: 'temp', amount: 5, replaceTemp: true })).toMatchObject({ temp: 5 });
    expect(state.current).toBe(10);
    expect(() => applyDamage(state, { kind: 'damage', amount: -1, damageType: 'fire' })).toThrow('HP_INVALID');
  });

  it('tracks_zero_hp_massive_damage_and_death_saves', () => {
    const down = applyDamage(hp({ current: 4 }), { kind: 'damage', amount: 5, damageType: 'slashing' });
    expect(down).toMatchObject({ current: 0, zeroHpUnconscious: true, deathSaves: { failures: 0, dead: false } });
    expect(applyDamage(hp({ current: 4 }), { kind: 'damage', amount: 14, damageType: 'slashing' }).deathSaves.dead).toBe(true);
    expect(applyDamage(down, { kind: 'temp', amount: 5 })).toMatchObject({ current: 0, zeroHpUnconscious: true });
    const fail = applyDeathSave(down, 1);
    expect(fail.deathSaves.failures).toBe(2);
    expect(applyDamage(fail, { kind: 'damage', amount: 1, damageType: 'fire' }).deathSaves.dead).toBe(true);
    expect(applyDamage(hp({ current: 0, temp: 20 }), { kind: 'damage', amount: 10, damageType: 'fire' }).deathSaves.dead).toBe(true);
    expect(applyDeathSave(down, 20)).toMatchObject({ current: 1, zeroHpUnconscious: false, deathSaves: { successes: 0, failures: 0 } });
    const stable = applyDeathSave(applyDeathSave(applyDeathSave(down, 10), 10), 10);
    expect(stable.deathSaves).toEqual({ successes: 0, failures: 0, stable: true, dead: false });
    expect(applyDamage(stable, { kind: 'damage', amount: 1, damageType: 'fire' }).deathSaves).toMatchObject({ failures: 1, stable: false });
    expect(applyDamage(hp({ deathMode: 'instant' }), { kind: 'damage', amount: 10, damageType: 'fire' }).deathSaves.dead).toBe(true);
    const dead = hp({ current: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
    expect(applyDamage(dead, { kind: 'heal', amount: 10 }).current).toBe(0);
  });

  it('distinguishes_action_restrictions_from_2024_speed_zero_conditions', () => {
    for (const condition of ['condition.incapacitated', 'condition.stunned']) {
      const creature = { hp: { current: 5 }, vitals: { ...emptyVitals(), conditions: [condition] } };
      expect(cannotAct(creature)).toBe(true);
      expect(cannotMove(creature)).toBe(false);
    }
    for (const condition of ['condition.grappled', 'condition.restrained', 'condition.paralyzed', 'condition.petrified', 'condition.unconscious']) {
      expect(cannotMove({ hp: { current: 5 }, vitals: { ...emptyVitals(), conditions: [condition] } }), condition).toBe(true);
    }
  });

  it('preserves_unconscious_immunity_when_vitals_are_stored_and_reloaded', () => {
    const down = applyDamage(hp({ defenses: { resistances: [], vulnerabilities: [], immunities: [], conditionImmunities: ['condition.unconscious'] } }), { kind: 'damage', amount: 10, damageType: 'fire' });
    const { current: _hp, max: _max, temp: _temp, defenses: _profile, ...stored } = down;
    expect(down.zeroHpUnconscious).toBe(false);
    expect(normalizeVitals(stored, 0).zeroHpUnconscious).toBe(false);
  });
});
