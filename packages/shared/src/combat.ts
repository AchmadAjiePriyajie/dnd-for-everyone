import { z } from 'zod';
import type { Id } from './contracts.js';

export type CombatStatus = 'preparing' | 'active' | 'paused' | 'ended';
export const turnBudgetSchema = z.strictObject({
  action: z.number().int().min(0).max(1),
  bonus: z.number().int().min(0).max(1),
  reaction: z.number().int().min(0).max(1),
  movement: z.number().int().min(0).max(9999),
});
export type TurnBudget = z.infer<typeof turnBudgetSchema>;
export type TurnResource = keyof TurnBudget;

/** Full server/DM state. Character HP is read from its sheet, never a separate pool. */
export interface Combatant {
  id: Id;
  name: string;
  characterId: Id | null;
  /** Revision of the authoritative character sheet, required when correcting its HP. */
  characterRevision?: number;
  monsterId: Id | null;
  tokenId: Id | null;
  ownerAccountId: Id | null;
  initiative: number;
  /** Ascending, chosen by the DM to break equal initiative. */
  tieOrder: number;
  hidden: boolean;
  defeated: boolean;
  speedFeet: number;
  /** Alternate diagonal parity is shared across all movement in this turn. */
  diagonalsMoved: number;
  hp: { current: number; max: number; temp: number };
  vitals?: VitalState;
  budget: TurnBudget;
}

export interface Combat {
  id: Id;
  campaignId: Id;
  name: string;
  templateId: Id;
  sceneId: Id | null;
  status: CombatStatus;
  round: number;
  turn: number;
  activeId: Id | null;
  combatants: Combatant[];
  revision: number;
}

/** Public order omits hidden creatures and secret stat blocks; owners retain their trackers. */
export type CombatantView = Pick<Combatant, 'id' | 'name' | 'characterId' | 'ownerAccountId' | 'initiative' | 'tieOrder' | 'defeated'> &
  Partial<Pick<Combatant, 'monsterId' | 'tokenId' | 'hidden' | 'speedFeet' | 'hp' | 'budget' | 'characterRevision' | 'vitals'>>;
export interface CombatView extends Omit<Combat, 'templateId' | 'combatants'> {
  templateId?: Id;
  combatants: CombatantView[];
}

const id = z.string().min(1).max(100);
export const startCombatSchema = z.strictObject({ templateId: id, sceneId: id.optional() });
export const combatantTargetSchema = z.strictObject({ combatantId: id });
export const spendTurnSchema = z.strictObject({
  combatantId: id,
  resource: z.enum(['action', 'bonus', 'reaction', 'movement']),
  amount: z.number().int().min(1).max(9999).optional(),
});
const reason = z.string().trim().min(1).max(500);
export const correctCombatantSchema = z.strictObject({
  combatantId: id,
  sourceRevision: z.number().int().min(0).optional(),
  reason,
  patch: z.strictObject({
    initiative: z.number().int().min(-100).max(999).optional(),
    tieOrder: z.number().int().min(0).max(9999).optional(),
    hidden: z.boolean().optional(),
    defeated: z.boolean().optional(),
    hpCurrent: z.number().int().min(0).max(99999).optional(),
    speedFeet: z.number().int().min(0).max(9999).optional(),
    budget: turnBudgetSchema.optional(),
  }).refine((patch) => Object.keys(patch).length > 0),
});
export const setTurnSchema = z.strictObject({ combatantId: id, reason });
export const bindTokenSchema = z.strictObject({ combatantId: id, tokenId: id.nullable() });
export const reinforcementSchema = z.union([
  z.strictObject({ characterId: id, initiative: z.number().int().min(-100).max(999), hidden: z.boolean() }),
  z.strictObject({
    monsterId: z.string().min(1).max(120), count: z.number().int().min(1).max(50), hp: z.enum(['average', 'rolled']),
    initiative: z.number().int().min(-100).max(999), hidden: z.boolean(),
  }),
]);
export type Reinforcement = z.infer<typeof reinforcementSchema>;

export type RandomInt = (min: number, maxExclusive: number) => number;
export interface RollResult {
  expression: string;
  dice: Array<{ sides: number; rolls: number[]; sign: 1 | -1 }>;
  modifier: number;
  total: number;
  critical: boolean;
}
export const d20InputSchema = z.strictObject({
  kind: z.enum(['check', 'attack', 'save', 'initiative']),
  modifier: z.number().int().min(-100).max(100),
  advantage: z.boolean().optional(), disadvantage: z.boolean().optional(),
  dc: z.number().int().min(0).max(999).optional(),
});
export type D20Input = z.infer<typeof d20InputSchema>;
export interface D20Result {
  kind: D20Input['kind'] | 'death'; rolls: number[]; kept: number; modifier: number; total: number;
  critical: boolean; fumble: boolean; success?: boolean;
}
export const DAMAGE_TYPES = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'] as const;
export type DamageType = typeof DAMAGE_TYPES[number];
export const CONDITIONS = ['blinded', 'charmed', 'deafened', 'exhaustion', 'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious'].map((value) => `condition.${value}`);
export const conditionIdSchema = z.string().refine((value) => CONDITIONS.includes(value));
export const defensesSchema = z.strictObject({
  resistances: z.array(z.enum(DAMAGE_TYPES)).max(13), vulnerabilities: z.array(z.enum(DAMAGE_TYPES)).max(13),
  immunities: z.array(z.enum(DAMAGE_TYPES)).max(13), conditionImmunities: z.array(conditionIdSchema).max(15),
});
export type DefenseProfile = z.infer<typeof defensesSchema>;
export interface VitalState {
  conditions: string[];
  exhaustion: number;
  deathMode: 'saves' | 'instant';
  deathSaves: { successes: number; failures: number; stable: boolean; dead: boolean };
  zeroHpUnconscious: boolean;
  lastDeathSaveTurn?: number;
  lastDeathSaveCombatId?: Id;
  /** Derived from the effective defense profile when HP/conditions are committed. */
  unconsciousImmune?: boolean;
  defenses?: DefenseProfile;
}
export interface HitPointState extends VitalState { current: number; max: number; temp: number; defenses: DefenseProfile }
export const damageInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('damage'), amount: z.number().int().min(0).max(99999), damageType: z.enum(DAMAGE_TYPES), critical: z.boolean().optional() }),
  z.strictObject({ kind: z.literal('heal'), amount: z.number().int().min(0).max(99999) }),
  z.strictObject({ kind: z.literal('temp'), amount: z.number().int().min(0).max(99999), replaceTemp: z.boolean().optional() }),
]);
export type DamageInput = z.infer<typeof damageInputSchema>;
export type RollAudience = 'public' | 'dm';
export interface RollRecord {
  id: Id; accountId: Id; audience: RollAudience; kind: 'dice' | D20Result['kind'];
  actor?: { combatId: Id; combatantId: Id };
  result: RollResult | D20Result;
  createdAt: string;
}
const actorSchema = z.strictObject({ combatId: id, combatantId: id, expectedRevision: z.number().int().min(0).optional() });
const audience = z.enum(['public', 'dm']);
export const diceCommandSchema = z.strictObject({ expression: z.string().min(1).max(100), critical: z.boolean().optional(), audience, actor: actorSchema.optional() });
export const d20CommandSchema = z.strictObject({ input: d20InputSchema, audience, actor: actorSchema.optional() });
export const hpCommandSchema = z.strictObject({ combatantId: id, input: damageInputSchema, sourceRevision: z.number().int().min(0).optional() });
export const conditionsCommandSchema = z.strictObject({
  combatantId: id, conditions: z.array(conditionIdSchema).max(15), exhaustion: z.number().int().min(0).max(6),
  deathMode: z.enum(['saves', 'instant']).optional(), defenses: defensesSchema.optional(), sourceRevision: z.number().int().min(0).optional(),
});
export const deathSaveCommandSchema = z.strictObject({ combatantId: id, audience, sourceRevision: z.number().int().min(0).optional() });
export const stabilizeCommandSchema = z.strictObject({ combatantId: id, sourceRevision: z.number().int().min(0).optional() });
