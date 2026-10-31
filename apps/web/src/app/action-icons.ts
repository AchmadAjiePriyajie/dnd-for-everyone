import type { ActionOption, DamageType } from '#shared/combat';
import type { FantasyIconName } from './fantasy-icons';

const SCHOOLS = new Set<FantasyIconName>(['abjuration', 'conjuration', 'divination', 'enchantment', 'evocation', 'illusion', 'necromancy', 'transmutation']);
const WEAPON: Partial<Record<DamageType, FantasyIconName>> = { piercing: 'pierce', slashing: 'slash', bludgeoning: 'bludgeon' };

/** One icon per kind of action (heal, damage type, reaction, school, weapon, monster/feature), never per spell. */
export function actionIcon(option: ActionOption): FantasyIconName {
  if (option.heal) return 'heal';
  const type = option.damage[0]?.type ?? null;
  if (option.kind === 'weapon') return (type && WEAPON[type]) || 'action';
  if (type) return type;
  if (option.cost === 'reaction') return 'reaction';
  if (option.cost === 'legendary') return 'legendary';
  const school = option.spell?.school as FantasyIconName | undefined;
  if (school && SCHOOLS.has(school)) return school;
  if (option.kind === 'multiattack') return 'multiattack';
  if (option.kind === 'feature') return 'feature';
  if (option.kind === 'monster') return 'monster';
  return 'action';
}
