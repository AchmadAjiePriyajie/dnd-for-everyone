import { type ActionAbility, type ActionDamage, DAMAGE_TYPES, type DamageType } from '#shared/combat';

/**
 * Stat block parser for the SRD 5.2.1 EN markdown body. Monster mechanics carry no structured
 * actions, so actions are read from the fixed 2024 stat block wording (`***Name (Recharge 5–6).***`,
 * `*Melee Attack Roll:* +14, reach 10 ft.`, `*Hit:* 13 (1d10 + 8) Slashing damage`, …). Anything the
 * parser does not recognise stays as rule text with a prompt for the DM; it never guesses numbers.
 */
export type StatBlockSection = 'trait' | 'action' | 'bonus' | 'reaction' | 'legendary';
export interface StatBlockAction {
  slug: string;
  name: string;
  section: StatBlockSection;
  text: string;
  recharge?: { min: number } | 'rest';
  perDay?: number;
  attack?: { bonus: number; reach?: number; range?: { normal: number; long: number } };
  save?: { ability: ActionAbility; dc: number; onSuccess: 'half' | 'none' };
  damage: ActionDamage[];
  multiattack?: { count: number | null; names: string[]; alternatives: boolean };
  legendary?: { cost: number; oncePerRound: boolean };
  trigger?: string;
  /** Prompt codes: CONDITIONAL_DAMAGE, RIDER_EFFECT, SPELLCASTING, … */
  notes: string[];
}
export interface StatBlock { actions: StatBlockAction[]; legendaryUses: number | null }

const SECTIONS: Record<string, StatBlockSection> = {
  Traits: 'trait', Actions: 'action', 'Bonus Actions': 'bonus', Reactions: 'reaction', 'Legendary Actions': 'legendary',
};
const ABILITY_NAMES: Record<string, ActionAbility> = {
  Strength: 'str', Dexterity: 'dex', Constitution: 'con', Intelligence: 'int', Wisdom: 'wis', Charisma: 'cha',
};
const NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const TYPE_PATTERN = DAMAGE_TYPES.map((type) => type[0]!.toUpperCase() + type.slice(1)).join('|');

export const slugOf = (name: string): string => name.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** `1d6 + 2` → `1d6+2`; the minus sign in stat blocks is U+2212. */
export const compactDice = (dice: string): string => dice.replace(/−/g, '-').replace(/\s+/g, '');

/**
 * Damage at the start of a Hit/Failure clause: `5 (1d6 + 2) Slashing damage plus 2 (1d4) Fire damage`.
 * A segment followed by "if …" is conditional and left to the DM; ", or …" alternatives keep the first.
 */
export function parseDamageClause(clause: string): { damage: ActionDamage[]; notes: string[] } {
  const pattern = new RegExp(`(\\d+)(?: \\((\\d+d\\d+(?: ?[+−-] ?\\d+)?)\\))? (${TYPE_PATTERN}) damage`, 'g');
  const damage: ActionDamage[] = [];
  const notes = new Set<string>();
  let end = 0;
  let rest = clause;
  for (const match of clause.matchAll(pattern)) {
    const between = clause.slice(end, match.index);
    if (damage.length === 0 ? between.trim() !== '' : !/^,? plus $/.test(between)) {
      if (damage.length > 0 && /^,? or /.test(between)) notes.add('DAMAGE_ALTERNATIVE');
      break;
    }
    const after = clause.slice(match.index + match[0].length);
    if (/^,? if\b/.test(after) || /^ (?:instead|when)\b/.test(after)) {
      notes.add('CONDITIONAL_DAMAGE');
      rest = after.replace(/^[^.]*\.?/, '');
      end = -1;
      break;
    }
    damage.push({ dice: match[2] ? compactDice(match[2]) : match[1]!, average: Number(match[1]), type: match[3]!.toLowerCase() as DamageType });
    end = match.index + match[0].length;
  }
  if (end >= 0) rest = clause.slice(end);
  if (damage.length > 0 && rest.replace(/[\s.,]/g, '') !== '') notes.add('RIDER_EFFECT');
  return { damage, notes: [...notes] };
}

function qualifiers(entry: StatBlockAction, raw: string | undefined): void {
  if (!raw) return;
  for (const part of raw.split(/;\s*/)) {
    const recharge = /^Recharge (\d)(?:–6)?$/.exec(part);
    const perDay = /^(\d+)\/Day/.exec(part);
    if (recharge) entry.recharge = { min: Number(recharge[1]) };
    else if (/Recharges? after a/.test(part)) entry.recharge = 'rest';
    else if (perDay) {
      entry.perDay = Number(perDay[1]);
      if (/in Lair/.test(part)) entry.notes.push('LAIR_USES');
    } else if (/Costs (\d) Actions/.test(part)) entry.legendary = { cost: Number(/Costs (\d)/.exec(part)![1]), oncePerRound: false };
    else entry.notes.push('USE_RESTRICTED');
  }
}

function multiattack(text: string, names: string[]): StatBlockAction['multiattack'] {
  const first = text.split(/\.\s/)[0]!;
  const alternatives = first.split(/, or /);
  let count: number | null = 0;
  for (const alternative of alternatives) {
    if (/a number of|as many/.test(alternative)) { count = null; break; }
    let sum = 0;
    for (const match of alternative.matchAll(/\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten)\b[^.,]*?\battacks?\b/gi)) sum += NUMBERS[match[1]!.toLowerCase()]!;
    sum += [...alternative.matchAll(/\b(?:uses|can use) (?:either )?[A-Z*]/g)].length;
    count = Math.max(count, sum);
  }
  const found = names
    .map((name) => ({ name, index: text.search(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)) }))
    .filter((entry) => entry.index >= 0)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.name);
  return { count: count === 0 ? null : count, names: found, alternatives: alternatives.length > 1 };
}

export function parseStatBlock(body: string): StatBlock {
  const actions: StatBlockAction[] = [];
  let legendaryUses: number | null = null;
  const parts = body.split(/^#### (.+)$/m);
  for (let index = 1; index < parts.length; index += 2) {
    const section = SECTIONS[parts[index]!.trim()];
    const content = parts[index + 1] ?? '';
    if (!section) continue;
    if (section === 'legendary') {
      const uses = /Legendary Action Uses: (\d+)/.exec(content);
      if (uses) legendaryUses = Number(uses[1]);
    }
    const entries = content.split(/^(?=\*\*\*)/m).filter((chunk) => chunk.startsWith('***'));
    for (const chunk of entries) {
      const head = /^\*\*\*(.+?)\.\*\*\*\s*/.exec(chunk);
      if (!head) continue;
      const qualified = /^(.*?)(?: \(([^)]*)\))?$/.exec(head[1]!)!;
      const name = qualified[1]!.trim();
      const text = chunk.slice(head[0].length).trim();
      const entry: StatBlockAction = { slug: slugOf(name), name, section, text, damage: [], notes: [] };
      qualifiers(entry, qualified[2]);
      const attack = /\*(?:Melee|Ranged|Melee or Ranged) Attack Roll:\* \+(\d+)(?: to hit)?( \([^)]*\))?, (?:reach (\d+) (?:ft\.|feet)(?: or range (\d+)(?:\/(\d+))? (?:ft\.|feet))?|range (\d+)(?:\/(\d+))? (?:ft\.|feet))/.exec(text);
      if (attack) {
        const normal = attack[4] ?? attack[6];
        const long = attack[5] ?? attack[7] ?? normal;
        entry.attack = { bonus: Number(attack[1]), ...(attack[3] ? { reach: Number(attack[3]) } : {}), ...(normal ? { range: { normal: Number(normal), long: Number(long) } } : {}) };
        if (attack[2]) entry.notes.push('CONDITIONAL_ADVANTAGE');
        const hit = /\*Hit:\* ([^*]*)/.exec(text);
        if (hit) {
          const parsed = parseDamageClause(hit[1]!.trim());
          entry.damage = parsed.damage;
          entry.notes.push(...parsed.notes);
          if (/\*(?:Miss|Hit or Miss):\*/.test(text)) entry.notes.push('RIDER_EFFECT');
        }
      } else if (/Attack Roll:\*/.test(text)) entry.notes.push('ATTACK_MANUAL');
      const save = /\*(?:[A-Za-z]+—)?(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw:\* DC (\d+)/.exec(text);
      if (save) {
        const failure = /\*Failure:\* ([^*]*)/.exec(text);
        const success = /\*Success:\* ([^*]*)/.exec(text);
        entry.save = { ability: ABILITY_NAMES[save[1]!]!, dc: Number(save[2]), onSuccess: success && /^Half damage\.?/.test(success[1]!.trim()) ? 'half' : 'none' };
        if (failure) {
          const parsed = parseDamageClause(failure[1]!.trim());
          entry.damage = parsed.damage;
          entry.notes.push(...parsed.notes);
        }
        if (success && !/^Half damage\.?$/.test(success[1]!.trim())) entry.notes.push('RIDER_EFFECT');
        if (/\*Failure or Success:\*|\*First Failure:\*|\*Second Failure:\*/.test(text)) entry.notes.push('RIDER_EFFECT');
      }
      const trigger = /\*Trigger:\* ([^*]*?)\s*\*Response/.exec(text);
      if (trigger) entry.trigger = trigger[1]!.trim();
      if (section === 'legendary') {
        entry.legendary = { cost: entry.legendary?.cost ?? 1, oncePerRound: /can[’']t take this action again until the start of its next turn/.test(text) };
      }
      if (/\bSpellcasting\b/.test(name) || /uses Spellcasting/.test(text)) entry.notes.push('SPELLCASTING');
      entry.notes = [...new Set(entry.notes)];
      actions.push(entry);
    }
  }
  const usable = actions.filter((entry) => entry.section !== 'trait' && entry.name !== 'Multiattack').map((entry) => entry.name);
  for (const entry of actions) {
    if (entry.name === 'Multiattack' && entry.section === 'action') entry.multiattack = multiattack(entry.text, usable);
  }
  return { actions, legendaryUses };
}
