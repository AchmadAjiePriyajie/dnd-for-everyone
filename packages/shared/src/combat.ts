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
  /** Recharge, per-day, Legendary Action and attack-pool usage (Task 17). */
  actions?: ActionUsage;
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
export type Standing = 'healthy' | 'bloodied' | 'defeated';
export type CombatantView = Pick<Combatant, 'id' | 'name' | 'characterId' | 'ownerAccountId' | 'initiative' | 'tieOrder' | 'defeated'> &
  Partial<Pick<Combatant, 'monsterId' | 'tokenId' | 'hidden' | 'speedFeet' | 'hp' | 'budget' | 'characterRevision' | 'vitals' | 'actions'>> & {
    /** Players: coarse state of creatures outside the party (no HP numbers). */
    standing?: Standing;
    /** Players: visible conditions of party members and visible creatures. */
    conditions?: string[];
    /** Players: Concentration spell of party members. */
    concentration?: Id | null;
    deathSaves?: VitalState['deathSaves'];
  };
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
  id: Id; accountId: Id; audience: RollAudience; kind: 'dice' | D20Result['kind'] | 'action';
  actor?: { combatId: Id; combatantId: Id };
  result: RollResult | D20Result | ActionOutcome;
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

// ---------------------------------------------------------------- guided actions (Task 17)
export type ActionAbility = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
/** Turn resource an option spends. `pool` = an attack inside Attack action / Multiattack already paid for. */
export type ActionCostKind = 'action' | 'bonus' | 'reaction' | 'legendary' | 'free' | 'pool';
/**
 * automatic: cost, rolls and HP changes come from structured data (DM still confirms HP);
 * assisted: cost and some rolls are computed, other effects need the DM;
 * manual: cost is tracked, rule text + DM decision resolve the effect.
 */
export type AutomationLevel = 'automatic' | 'assisted' | 'manual';
export interface ActionDamage { dice: string; average: number | null; type: DamageType | null }
export type ActionUses =
  | { kind: 'recharge'; min: number; available: boolean }
  | { kind: 'rest'; available: boolean }
  | { kind: 'per-day'; max: number; remaining: number }
  | { kind: 'feature'; key: string; amount: number; remaining: number };

/** One thing an actor can do, derived from the sheet or stat block. */
export interface ActionOption {
  id: string;
  kind: 'weapon' | 'spell' | 'feature' | 'monster' | 'multiattack';
  name: string;
  originalName: string;
  sourceId: Id;
  cost: Exclude<ActionCostKind, 'pool'>;
  /** Casting time longer than one turn (minutes/hours): not usable during a combat turn. */
  longCast?: string;
  attack?: { bonus: number; reach?: number; range?: { normal: number; long: number } };
  save?: { ability: ActionAbility; dc: number; onSuccess: 'half' | 'none' };
  damage: ActionDamage[];
  heal?: { dice: string; bonus: number };
  /** Spell range in feet (touch = 5); null = self/area/sight: the DM checks targets. */
  rangeFeet?: number | null;
  spell?: { level: number; school: string; concentration: boolean; duration: string; upcastDice: string | null; upcastTarget: 'damage' | 'heal' | null; upcastManual: boolean };
  uses?: ActionUses;
  multiattack?: { count: number | null; names: string[]; alternatives: boolean };
  /** Legendary action cost in uses, and whether it is limited to once per round. */
  legendary?: { cost: number; oncePerRound: boolean };
  trigger?: string;
  automation: AutomationLevel;
  /** Prompt codes known from the source text alone (conditional riders, spellcasting, …). */
  notes: string[];
  text: string;
}

/** Per-combatant usage that is not a turn budget. Reset rules live in packages/rules/turns. */
export interface ActionUsage {
  recharge: string[];
  perDay: Record<string, number>;
  legendary: number;
  legendaryUsed: string[];
  pool: { remaining: number | null; names: string[] | null } | null;
  /** Turn number on which a spell slot was spent (2024: one slot per turn). */
  slotTurn?: number;
}
export const emptyActionUsage = (): ActionUsage => ({ recharge: [], perDay: {}, legendary: 0, legendaryUsed: [], pool: null });

export interface ActionActor {
  combatantId: Id;
  kind: 'character' | 'monster';
  sourceId: Id;
  name: string;
  level: number;
  options: ActionOption[];
  budget: TurnBudget;
  usage: ActionUsage;
  activeTurn: boolean;
  turn: number;
  canAct: boolean;
  attacksPerAction: number;
  legendaryMax: number;
  slots: Array<{ level: number; remaining: number }>;
  pact: { level: number; remaining: number } | null;
  concentration: Id | null;
  position: { x: number; y: number; size: number } | null;
}
export interface ActionTarget {
  id: Id;
  name: string;
  position: { x: number; y: number; size: number } | null;
  /** null when the viewer may not see the number (players never see monster AC/saves). */
  ac: number | null;
  saves: Partial<Record<ActionAbility, number>> | null;
}
export interface ActionView {
  grid: { feetPerCell: number; diagonal: 'standard' | 'alternate' } | null;
  targets: ActionTarget[];
}

export const actionInputSchema = z.strictObject({
  combatantId: id,
  optionId: z.string().min(1).max(200),
  targetIds: z.array(id).max(20),
  slotLevel: z.number().int().min(1).max(9).optional(),
  pact: z.boolean().optional(),
  damageMode: z.enum(['roll', 'average']).optional(),
  advantage: z.boolean().optional(),
  disadvantage: z.boolean().optional(),
  audience: audience.optional(),
  /** Reaction declared against an open resolution (Task 18). */
  respondsTo: id.optional(),
});
export type ActionInput = z.infer<typeof actionInputSchema>;

export type ActionRoll =
  | { kind: 'attack'; targetId: Id; modifier: number; ac: number | null }
  | { kind: 'save'; targetId: Id; ability: ActionAbility; dc: number; modifier: number | null };
export type ActionEffect =
  | { kind: 'damage'; dice: string; average: number | null; type: DamageType | null; onSave: 'half' | 'none' | null }
  | { kind: 'heal'; dice: string; bonus: number }
  | { kind: 'concentration'; spellId: Id; replaces: Id | null }
  | { kind: 'pool'; remaining: number | null; names: string[] | null }
  | { kind: 'manual'; text: string };

export interface ActionPreview {
  sourceId: Id;
  optionId: string;
  actorId: Id;
  targetIds: Id[];
  name: string;
  cost: {
    turn: ActionCostKind;
    slot: { level: number; pact: boolean } | null;
    feature: { key: string; amount: number } | null;
    uses: 'recharge' | 'rest' | 'per-day' | null;
    legendary: number;
  };
  automation: AutomationLevel;
  rolls: ActionRoll[];
  effects: ActionEffect[];
  duration: string | null;
  /** DM decision prompt codes: shown, never blocking. */
  prompts: string[];
  /** Blocking issue codes; empty = the action may be taken. */
  issues: string[];
  trigger: string | null;
  text: string;
}

export interface ProposedEffect { targetId: Id; input: DamageInput; decision: boolean }
export interface ActionOutcome {
  preview: Omit<ActionPreview, 'text'>;
  attacks: Array<{ targetId: Id; roll: D20Result; hit: boolean | null }>;
  saves: Array<{ targetId: Id; roll: D20Result | null; success: boolean | null }>;
  damage: Array<{ targetId: Id | null; type: DamageType | null; roll: RollResult | null; total: number }>;
  heal: RollResult | null;
  proposed: ProposedEffect[];
}

// ---------------------------------------------------------------- durable resolutions (Task 18)
/** pending: reactions offered; awaitingDecision: DM commits or cancels; resolved/cancelled: closed. */
export type ResolutionPhase = 'pending' | 'awaitingDecision' | 'resolved' | 'cancelled';
export interface PendingReaction {
  combatantId: Id;
  optionId: string;
  name: string;
  trigger: string | null;
  status: 'offered' | 'declared' | 'declined';
  /** Resolution created by the declared reaction. */
  resolutionId?: Id;
}
export interface CommittedEffect {
  targetId: Id;
  input: DamageInput;
  before: { current: number; temp: number };
  after: { current: number; temp: number };
}
export interface Resolution {
  id: Id;
  combatId: Id;
  actorId: Id;
  phase: ResolutionPhase;
  audience: RollAudience;
  outcome: ActionOutcome;
  costs: ActionPreview['cost'];
  /** Turn number the costs were paid on; refunds only restore budgets of that turn. */
  turn: number;
  proposed: ProposedEffect[];
  pendingReactions: PendingReaction[];
  committedEffects: CommittedEffect[];
  /** Concentration saves the DM should call for after committed damage (SRD: DC 10 or half the damage, max 30). */
  concentrationChecks: Array<{ targetId: Id; dc: number }>;
  /** Default: cancelling never refunds; refunds are explicit DM corrections with a reason. */
  cancellationPolicy: 'no-refund';
  refund: { reason: string } | null;
  compensation: { reason: string } | null;
  respondsTo: Id | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
const effectInput = z.strictObject({ targetId: id, input: damageInputSchema, decision: z.boolean() });
export const resolutionDecisionSchema = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('decline'), combatantId: id }),
  z.strictObject({ decision: z.literal('commit'), effects: z.array(effectInput).max(40).optional(), force: z.boolean().optional() }),
  z.strictObject({ decision: z.literal('cancel'), reason: z.string().trim().min(1).max(500).optional(), refund: z.boolean().optional() }),
  z.strictObject({ decision: z.literal('compensate'), reason: z.string().trim().min(1).max(500) }),
]);
export type ResolutionDecision = z.infer<typeof resolutionDecisionSchema>;
