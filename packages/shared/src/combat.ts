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
  Partial<Pick<Combatant, 'monsterId' | 'tokenId' | 'hidden' | 'speedFeet' | 'hp' | 'budget' | 'characterRevision'>>;
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
