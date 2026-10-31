import type { Combat, Combatant, TurnBudget } from '#shared/combat';

export const freshTurnBudget = (speedFeet: number): TurnBudget => ({ action: 1, bonus: 1, reaction: 1, movement: speedFeet });
export const initiativeOrder = (combatants: Combatant[]): Combatant[] =>
  [...combatants].sort((a, b) => b.initiative - a.initiative || a.tieOrder - b.tieOrder || a.id.localeCompare(b.id));

/** Only the creature starting its turn regains budgets, including its Reaction. */
export function advanceTurn(combat: Combat): Combat {
  const ordered = initiativeOrder(combat.combatants);
  if (!ordered.some((c) => !c.defeated)) return { ...combat, activeId: null };
  const current = ordered.findIndex((c) => c.id === combat.activeId);
  for (let step = 1; step <= ordered.length; step++) {
    const index = (current + step) % ordered.length;
    const next = ordered[index]!;
    if (next.defeated) continue;
    return {
      ...combat,
      activeId: next.id,
      round: combat.round === 0 ? 1 : combat.round + (current >= 0 && index <= current ? 1 : 0),
      turn: combat.turn + 1,
      combatants: combat.combatants.map((c) => c.id === next.id ? { ...c, budget: freshTurnBudget(c.speedFeet), diagonalsMoved: 0 } : c),
    };
  }
  return { ...combat, activeId: null };
}
