import { damageInputSchema, type DamageInput, type DefenseProfile, type HitPointState, type VitalState } from '#shared/combat';

export const emptyDefenses = (): DefenseProfile => ({ resistances: [], vulnerabilities: [], immunities: [], conditionImmunities: [] });
export const emptyVitals = (deathMode: VitalState['deathMode'] = 'saves'): VitalState => ({
  conditions: [], exhaustion: 0, deathMode, deathSaves: { successes: 0, failures: 0, stable: false, dead: false }, zeroHpUnconscious: false, unconsciousImmune: false,
});

/** Old resources remain readable. Explicit HP corrections above zero reset the dying state. */
export function normalizeVitals(vitals: VitalState | undefined, current: number, mode: VitalState['deathMode'] = 'saves'): VitalState {
  const value = { ...emptyVitals(mode), ...vitals, conditions: [...(vitals?.conditions ?? [])], deathSaves: { ...emptyVitals().deathSaves, ...vitals?.deathSaves } };
  if (current > 0) {
    value.zeroHpUnconscious = false;
    value.deathSaves = emptyVitals().deathSaves;
  } else if (!value.deathSaves.dead) value.zeroHpUnconscious = !(value.defenses?.conditionImmunities.includes('condition.unconscious') ?? value.unconsciousImmune ?? false);
  if (value.exhaustion >= 6) value.deathSaves.dead = true;
  return value;
}

export function cannotAct(state: { hp: { current: number }; vitals?: VitalState }): boolean {
  return (state.hp.current === 0 && !(state.vitals?.unconsciousImmune || state.vitals?.defenses?.conditionImmunities.includes('condition.unconscious'))) || Boolean(state.vitals?.deathSaves.dead) || Boolean(state.vitals?.conditions.some((c) => ['condition.incapacitated', 'condition.unconscious', 'condition.stunned', 'condition.paralyzed', 'condition.petrified'].includes(c)));
}

/** 2024 Incapacitated/Stunned forbid actions, but do not set Speed to zero. */
export function cannotMove(state: { hp: { current: number }; vitals?: VitalState }): boolean {
  return (state.hp.current === 0 && !(state.vitals?.unconsciousImmune || state.vitals?.defenses?.conditionImmunities.includes('condition.unconscious'))) || Boolean(state.vitals?.deathSaves.dead) || Boolean(state.vitals?.conditions.some((c) => ['condition.grappled', 'condition.restrained', 'condition.unconscious', 'condition.paralyzed', 'condition.petrified'].includes(c)));
}

/** SRD rule.damage-and-healing: Resistance before Vulnerability, then Temporary HP. */
export function applyDamage(state: HitPointState, input: DamageInput): HitPointState {
  if (!damageInputSchema.safeParse(input).success || ![state.current, state.max, state.temp].every((n) => Number.isSafeInteger(n) && n >= 0) || state.current > state.max) throw new Error('HP_INVALID');
  const next: HitPointState = { ...state, conditions: [...state.conditions], deathSaves: { ...state.deathSaves }, unconsciousImmune: state.defenses.conditionImmunities.includes('condition.unconscious') };
  if (input.kind === 'temp') { next.temp = input.replaceTemp ? input.amount : Math.max(next.temp, input.amount); return next; }
  if (input.kind === 'heal') {
    if (next.deathSaves.dead || input.amount === 0) return next;
    next.current = Math.min(next.max, next.current + input.amount);
    return { ...next, ...normalizeVitals(next, next.current) };
  }
  let amount = input.amount;
  if (state.defenses.immunities.includes(input.damageType)) amount = 0;
  if (state.defenses.resistances.includes(input.damageType)) amount = Math.floor(amount / 2);
  if (state.defenses.vulnerabilities.includes(input.damageType)) amount *= 2;
  if (amount === 0 || next.deathSaves.dead) return next;
  const remaining = Math.max(0, amount - next.temp);
  next.temp = Math.max(0, next.temp - amount);
  next.current = Math.max(0, next.current - remaining);
  if (state.current === 0) {
    next.deathSaves.stable = false;
    next.deathSaves.failures = Math.min(3, next.deathSaves.failures + (input.critical ? 2 : 1));
  }
  if (next.current === 0) {
    next.zeroHpUnconscious = !state.defenses.conditionImmunities.includes('condition.unconscious');
    if (next.deathMode === 'instant' || (state.current === 0 ? amount >= state.max : remaining - state.current >= state.max) || next.deathSaves.failures >= 3) next.deathSaves.dead = true;
  }
  return next;
}

export function applyDeathSave(state: HitPointState, roll: number): HitPointState {
  if (!Number.isInteger(roll) || roll < 1 || roll > 20 || state.current !== 0 || state.deathSaves.dead || state.deathSaves.stable || state.deathMode !== 'saves') throw new Error('DEATH_SAVE_INVALID');
  if (roll === 20) return { ...state, ...normalizeVitals(state, 1), current: 1 };
  const next = { ...state, deathSaves: { ...state.deathSaves } };
  if (roll === 1) next.deathSaves.failures = Math.min(3, next.deathSaves.failures + 2);
  else if (roll >= 10) next.deathSaves.successes++;
  else next.deathSaves.failures++;
  if (next.deathSaves.failures >= 3) next.deathSaves.dead = true;
  if (next.deathSaves.successes >= 3) next.deathSaves = { successes: 0, failures: 0, stable: true, dead: false };
  return next;
}
