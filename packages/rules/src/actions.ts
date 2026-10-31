import type { Character } from '#shared/characters';
import {
  type ActionActor, type ActionCostKind, type ActionDamage, type ActionEffect, type ActionInput, type ActionOption, type ActionOutcome,
  type ActionPreview, type ActionRoll, type ActionTarget, type ActionUsage, type ActionView, type AutomationLevel, DAMAGE_TYPES, type DamageType,
  type ProposedEffect, type RandomInt, type TurnBudget,
} from '#shared/combat';
import type { ContentCatalog } from '#shared/content';
import type { Id, Locale } from '#shared/contracts';
import { deriveCharacter } from './character-stats.ts';
import { availableFeatures } from './class-features.ts';
import { resolveD20, rollDice } from './dice.ts';
import { compactDice, parseStatBlock, type StatBlockAction } from './monster-actions.ts';
import { deriveSpellcasting } from './spellcasting.ts';

/**
 * Guided actions (Task 17). Pure: previews validate cost, range, targets and resources; the server
 * re-runs the same preview against its own state before spending anything. Effects are proposed,
 * never applied here: HP changes are confirmed by the DM, other effects are rule text + decision.
 */
interface TurnState {
  combatantId: Id;
  budget: TurnBudget;
  usage: ActionUsage;
  activeTurn: boolean;
  turn: number;
  canAct: boolean;
  position: ActionActor['position'];
}

const ABILITIES = { Strength: 'str', Dexterity: 'dex', Constitution: 'con', Intelligence: 'int', Wisdom: 'wis', Charisma: 'cha' } as const;
const TYPE_PATTERN = DAMAGE_TYPES.join('|');
const slugOfOption = (option: ActionOption) => option.id.slice(option.id.indexOf(':') + 1);

// ---------------------------------------------------------------- monsters

const SECTION_COST: Record<StatBlockAction['section'], ActionOption['cost']> = { trait: 'free', action: 'action', bonus: 'bonus', reaction: 'reaction', legendary: 'legendary' };

function monsterOption(entry: StatBlockAction, monsterId: Id, usage: ActionUsage): ActionOption {
  const notes = [...entry.notes];
  let uses: ActionOption['uses'];
  if (entry.recharge === 'rest') uses = { kind: 'rest', available: !usage.recharge.includes(entry.slug) };
  else if (entry.recharge) uses = { kind: 'recharge', min: entry.recharge.min, available: !usage.recharge.includes(entry.slug) };
  else if (entry.perDay) uses = { kind: 'per-day', max: entry.perDay, remaining: Math.max(0, entry.perDay - (usage.perDay[entry.slug] ?? 0)) };
  let automation: AutomationLevel = 'manual';
  if (entry.multiattack) automation = entry.multiattack.count === null || entry.multiattack.alternatives ? 'assisted' : 'automatic';
  else if (entry.damage.length > 0) automation = notes.length > 0 ? 'assisted' : 'automatic';
  else if (entry.attack || entry.save) automation = 'assisted';
  if (entry.multiattack?.count === null) notes.push('MULTIATTACK_COUNT_DM');
  if (entry.multiattack?.alternatives) notes.push('MULTIATTACK_ALTERNATIVES');
  return {
    id: `monster:${entry.slug}`, kind: entry.multiattack ? 'multiattack' : 'monster', name: entry.name, originalName: entry.name, sourceId: monsterId,
    cost: SECTION_COST[entry.section],
    ...(entry.attack ? { attack: entry.attack } : {}), ...(entry.save ? { save: entry.save } : {}), damage: entry.damage,
    ...(entry.save && !entry.attack ? { rangeFeet: null } : {}),
    ...(uses ? { uses } : {}), ...(entry.multiattack ? { multiattack: entry.multiattack } : {}), ...(entry.legendary ? { legendary: entry.legendary } : {}),
    ...(entry.trigger ? { trigger: entry.trigger } : {}),
    automation, notes, text: entry.text,
  };
}

/** Actor from an SRD/homebrew stat block (EN body). Traits are options only when they have limited uses. */
export function monsterActor(input: TurnState & { monsterId: Id; name: string; body: string }): ActionActor {
  const block = parseStatBlock(input.body);
  const options = block.actions
    .filter((entry) => entry.section !== 'trait' || entry.perDay !== undefined || entry.recharge !== undefined)
    .map((entry) => monsterOption(entry, input.monsterId, input.usage));
  return {
    combatantId: input.combatantId, kind: 'monster', sourceId: input.monsterId, name: input.name, level: 0, options,
    budget: input.budget, usage: input.usage, activeTurn: input.activeTurn, turn: input.turn, canAct: input.canAct,
    attacksPerAction: 1, legendaryMax: block.legendaryUses ?? 0, slots: [], pact: null, concentration: null, position: input.position,
  };
}

// ---------------------------------------------------------------- characters

const CAST_COST: Record<string, ActionOption['cost']> = { action: 'action', 'bonus-action': 'bonus', reaction: 'reaction' };
const FEATURE_COST: Record<string, ActionOption['cost']> = { action: 'action', 'magic-action': 'action', 'bonus-action': 'bonus', reaction: 'reaction', 'no-action': 'free', special: 'free' };
const EXTRA_ATTACKS: Record<string, number> = { 'extra-attack': 2, 'two-extra-attacks': 3, 'three-extra-attacks': 4 };

interface SpellMechanics {
  level: number;
  castingTime: { amount: number; unit: string };
  range: { type: string; distance?: number };
  duration: { concentration: boolean };
}
interface WeaponMechanics { weapon?: { range?: { normal: number; long: number }; properties: Id[] } }

/** Reads attack/save/damage/heal sentences of a spell description; unknown wording stays manual. */
function spellOption(catalog: ContentCatalog, spellId: Id, cls: { classId: Id; saveDc: number; attackBonus: number; modifier: number }, level: number, locale: Locale): ActionOption {
  const en = catalog.getContent(spellId, 'en');
  const local = catalog.getContent(spellId, locale);
  const mechanics = en.mechanics as unknown as SpellMechanics;
  const body = en.body;
  const description = body.split(/\*\*\*(?:Using a Higher-Level Spell Slot|Cantrip Upgrade)\.\*\*\*/)[0]!;
  const notes: string[] = [];
  const option: ActionOption = {
    id: `spell:${cls.classId}:${spellId}`, kind: 'spell', name: local.name, originalName: en.name, sourceId: spellId,
    cost: CAST_COST[mechanics.castingTime.unit] ?? 'action', damage: [], automation: 'manual', notes, text: local.body,
    rangeFeet: mechanics.range.type === 'feet' ? mechanics.range.distance ?? null : mechanics.range.type === 'touch' ? 5 : null,
    spell: {
      level: mechanics.level, concentration: mechanics.duration.concentration,
      duration: /\*\*Duration:\*\* ([^\n]+)/.exec(body)?.[1]?.trim() ?? '', upcastDice: null, upcastTarget: null, upcastManual: false,
    },
  };
  if (!CAST_COST[mechanics.castingTime.unit]) option.longCast = `${mechanics.castingTime.amount} ${mechanics.castingTime.unit}`;
  const trigger = /\*\*Casting Time:\*\* Reaction, which you take (?:when|in response to) ([^\n]+)/.exec(body);
  if (trigger) option.trigger = trigger[1]!.trim();
  if (/\b(?:melee|ranged) spell attack/i.test(description)) option.attack = { bonus: cls.attackBonus };
  const save = /\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/.exec(description);
  if (save) option.save = { ability: ABILITIES[save[1] as keyof typeof ABILITIES], dc: cls.saveDc, onSuccess: /half as much damage/i.test(description) ? 'half' : 'none' };
  const heal = /regains? (?:a number of )?Hit Points equal to (\d+d\d+)( plus your spellcasting ability modifier)?/.exec(description);
  if (heal) option.heal = { dice: heal[1]!, bonus: heal[2] ? cls.modifier : 0 };
  const damage = new RegExp(`(\\d+d\\d+(?: ?\\+ ?\\d+)?) (${TYPE_PATTERN}) damage`, 'i').exec(description);
  if (damage && !heal) {
    let dice = compactDice(damage[1]!);
    const upgrade = /\*\*\*Cantrip Upgrade\.\*\*\*[^\n]*?levels 5 \((\d+d\d+)\), 11 \((\d+d\d+)\), and 17 \((\d+d\d+)\)/.exec(body);
    if (upgrade && mechanics.level === 0) {
      const scaled = level >= 17 ? upgrade[3] : level >= 11 ? upgrade[2] : level >= 5 ? upgrade[1] : null;
      if (scaled) dice = dice.replace(/^\d+d\d+/, scaled);
    }
    option.damage = [{ dice, average: null, type: damage[2]!.toLowerCase() as DamageType }];
  }
  const upcast = /\*\*\*Using a Higher-Level Spell Slot\.\*\*\* The (damage|healing) increases by (\d+d\d+) for each spell slot level above \d/.exec(body);
  if (upcast) { option.spell!.upcastDice = upcast[2]!; option.spell!.upcastTarget = upcast[1] === 'damage' ? 'damage' : 'heal'; }
  else if (/\*\*\*Using a Higher-Level Spell Slot\.\*\*\*/.test(body)) option.spell!.upcastManual = true;
  if (option.attack || option.save || option.heal || option.damage.length > 0) option.automation = 'assisted';
  if (option.automation === 'assisted') notes.push('SPELL_EFFECT_REVIEW');
  return option;
}

/** Actor from a final character sheet: weapon attacks, prepared spells/cantrips and class features with actions. */
export function characterActor(character: Character, catalog: ContentCatalog, state: TurnState, locale: Locale = 'en'): ActionActor {
  const derived = deriveCharacter(character, catalog);
  const casting = deriveSpellcasting(character, catalog);
  const features = availableFeatures(character, catalog, locale);
  const options: ActionOption[] = [];
  for (const attack of derived.attacks) {
    const en = catalog.getContent(attack.itemId, 'en');
    const weapon = (en.mechanics as unknown as WeaponMechanics).weapon;
    const bonus = attack.damage.bonus;
    const reach = weapon?.properties.includes('rule.property-reach') ? 10 : 5;
    const ranged = weapon && !weapon.properties.includes('rule.property-thrown') && weapon.range;
    options.push({
      id: `weapon:${attack.itemId}`, kind: 'weapon', name: catalog.getContent(attack.itemId, locale).name, originalName: en.name, sourceId: attack.itemId,
      cost: 'action', attack: { bonus: attack.attackBonus.value, ...(ranged ? {} : { reach }), ...(weapon?.range ? { range: weapon.range } : {}) },
      damage: [{ dice: compactDice(`${attack.damage.dice}${bonus === 0 ? '' : bonus > 0 ? `+${bonus}` : `${bonus}`}`), average: null, type: attack.damage.type.toLowerCase() as DamageType }],
      automation: attack.mastery ? 'assisted' : 'automatic', notes: attack.mastery ? ['WEAPON_MASTERY'] : [], text: en.body,
    });
  }
  for (const cls of casting.classes) {
    const modifier = derived.abilities[cls.ability].modifier;
    for (const spellId of [...cls.cantrips, ...cls.prepared]) {
      if (!catalog.has(spellId)) continue;
      options.push(spellOption(catalog, spellId, { classId: cls.classId, saveDc: cls.saveDc, attackBonus: cls.attackBonus, modifier }, derived.level, locale));
    }
  }
  for (const feature of features) {
    if (!feature.action) continue;
    let uses: ActionOption['uses'];
    if (feature.cost) {
      const target = features.find((entry) => entry.key === feature.cost!.resource);
      uses = { kind: 'feature', key: feature.cost.resource, amount: feature.cost.amount, remaining: target?.resource?.remaining ?? 0 };
    } else if (feature.resource) uses = { kind: 'feature', key: feature.key, amount: 1, remaining: feature.resource.remaining };
    options.push({
      id: `feature:${feature.key}`, kind: 'feature', name: feature.name, originalName: feature.originalName, sourceId: feature.sourceId,
      cost: FEATURE_COST[feature.action] ?? 'free', damage: [], ...(uses ? { uses } : {}), automation: 'manual',
      notes: feature.action === 'special' || feature.action === 'no-action' ? ['FEATURE_TIMING'] : [], text: feature.text,
    });
  }
  const attacksPerAction = Math.max(1, ...features.map((feature) => EXTRA_ATTACKS[feature.featureId] ?? 1));
  return {
    combatantId: state.combatantId, kind: 'character', sourceId: character.id, name: character.draft.name, level: derived.level, options,
    budget: state.budget, usage: state.usage, activeTurn: state.activeTurn, turn: state.turn, canAct: state.canAct, attacksPerAction, legendaryMax: 0,
    slots: casting.slots.map((slot) => ({ level: slot.level, remaining: slot.remaining })),
    pact: casting.pact ? { level: casting.pact.level, remaining: casting.pact.remaining } : null,
    concentration: character.resources.concentration, position: state.position,
  };
}

// ---------------------------------------------------------------- preview

function distanceFeet(a: NonNullable<ActionActor['position']>, b: NonNullable<ActionTarget['position']>, grid: NonNullable<ActionView['grid']>): number {
  const dx = Math.max(0, b.x - (a.x + a.size - 1), a.x - (b.x + b.size - 1));
  const dy = Math.max(0, b.y - (a.y + a.size - 1), a.y - (b.y + b.size - 1));
  const diagonal = Math.min(dx, dy);
  const squares = grid.diagonal === 'alternate' ? Math.max(dx, dy) + Math.floor(diagonal / 2) : Math.max(dx, dy);
  return squares * grid.feetPerCell;
}

/** `8d6` + `1d6` × levels → `9d6`; different dice are appended. */
function addDice(dice: string, extra: string, times: number): string {
  if (times <= 0) return dice;
  const [count, sides] = extra.split('d').map(Number) as [number, number];
  const same = new RegExp(`^(\\d+)d${sides}(?!\\d)`).exec(dice);
  if (same) return dice.replace(same[0], `${Number(same[1]) + count * times}d${sides}`);
  return `${dice}+${count * times}d${sides}`;
}

function poolCovers(actor: ActionActor, option: ActionOption): boolean {
  const pool = actor.usage.pool;
  if (!pool || (pool.remaining !== null && pool.remaining < 1)) return false;
  return pool.names === null ? option.kind === 'weapon' : pool.names.includes(option.originalName);
}

export function previewAction(actor: ActionActor, input: ActionInput, view: ActionView): ActionPreview {
  const option = actor.options.find((entry) => entry.id === input.optionId);
  const preview: ActionPreview = {
    sourceId: option?.sourceId ?? '', optionId: input.optionId, actorId: actor.combatantId, targetIds: [...input.targetIds], name: option?.name ?? '',
    cost: { turn: option?.cost ?? 'free', slot: null, feature: null, uses: null, legendary: 0 },
    automation: option?.automation ?? 'manual', rolls: [], effects: [], duration: option?.spell?.duration ?? null,
    prompts: [...(option?.notes ?? [])], issues: [], trigger: option?.trigger ?? null, text: option?.text ?? '',
  };
  const issue = (code: string) => { if (!preview.issues.includes(code)) preview.issues.push(code); };
  const prompt = (code: string) => { if (!preview.prompts.includes(code)) preview.prompts.push(code); };
  if (!option || input.combatantId !== actor.combatantId) { issue('OPTION_UNKNOWN'); return preview; }
  if (!actor.canAct) issue('CANNOT_ACT');
  const slug = slugOfOption(option);

  // Turn economy.
  let turn: ActionCostKind = option.cost;
  if (option.cost === 'action' && option.kind !== 'multiattack' && poolCovers(actor, option)) turn = 'pool';
  preview.cost.turn = turn;
  if ((turn === 'action' || turn === 'bonus' || turn === 'pool') && !actor.activeTurn) issue('NOT_YOUR_TURN');
  if ((turn === 'action' || turn === 'bonus' || turn === 'reaction') && actor.budget[turn] < 1) issue('BUDGET_EXHAUSTED');
  if (turn === 'reaction' && option.trigger) prompt('REACTION_TRIGGER');
  if (turn === 'legendary') {
    const cost = option.legendary?.cost ?? 1;
    preview.cost.legendary = cost;
    if (actor.activeTurn) issue('LEGENDARY_OWN_TURN');
    if (actor.legendaryMax - actor.usage.legendary < cost) issue('LEGENDARY_EXHAUSTED');
    if (option.legendary?.oncePerRound && actor.usage.legendaryUsed.includes(slug)) issue('LEGENDARY_ONCE_PER_ROUND');
    prompt('LEGENDARY_TIMING');
  }
  if (option.longCast) issue('CASTING_TIME_TOO_LONG');

  // Limited uses.
  const uses = option.uses;
  if (uses?.kind === 'recharge' || uses?.kind === 'rest') {
    preview.cost.uses = uses.kind;
    if (actor.usage.recharge.includes(slug)) issue('RECHARGE_SPENT');
  } else if (uses?.kind === 'per-day') {
    preview.cost.uses = 'per-day';
    if (uses.remaining < 1) issue('USES_EXHAUSTED');
  } else if (uses?.kind === 'feature') {
    preview.cost.feature = { key: uses.key, amount: uses.amount };
    if (uses.remaining < uses.amount) issue('NO_USES_LEFT');
  }

  // Spell slots: one slot per turn (SRD 5.2.1 "Casting Spells"), upcast from the slot level.
  const spell = option.spell;
  let slotLevel = 0;
  if (spell && spell.level > 0) {
    slotLevel = input.slotLevel ?? spell.level;
    const pact = input.pact ?? false;
    preview.cost.slot = { level: slotLevel, pact };
    if (slotLevel < spell.level) issue('SLOT_TOO_LOW');
    else if (pact ? !actor.pact || actor.pact.level !== slotLevel || actor.pact.remaining < 1 : !actor.slots.some((slot) => slot.level === slotLevel && slot.remaining > 0)) issue('NO_SLOT_LEFT');
    if (actor.usage.slotTurn === actor.turn) issue('ONE_SLOT_PER_TURN');
    if (slotLevel > spell.level && spell.upcastManual) prompt('UPCAST_MANUAL');
  }

  // Targets: only creatures in the viewer's projection exist; hidden ones are indistinguishable from unknown IDs.
  const targets: ActionTarget[] = [];
  for (const id of input.targetIds) {
    const target = view.targets.find((entry) => entry.id === id);
    if (!target || targets.includes(target)) issue('TARGET_INVALID');
    else targets.push(target);
  }
  if ((option.attack || option.heal) && targets.length === 0) issue('TARGET_REQUIRED');
  if (option.attack && option.kind !== 'spell' && targets.length > 1) issue('TARGET_COUNT');
  if (option.kind === 'spell' && targets.length > 1) prompt('TARGET_COUNT_DM');
  if (option.save && targets.length === 0) prompt('NO_TARGETS');
  for (const target of targets) {
    const range = option.attack?.range;
    const reach = option.attack?.reach;
    const limit = option.attack && option.kind !== 'spell' ? Math.max(reach ?? 0, range?.long ?? 0) : option.rangeFeet;
    if (limit === null || limit === undefined) { if (option.save || option.heal || option.rangeFeet === null) prompt('RANGE_UNVERIFIED'); continue; }
    if (!view.grid || !actor.position || !target.position) { prompt('RANGE_UNVERIFIED'); continue; }
    const feet = distanceFeet(actor.position, target.position, view.grid);
    if (feet > limit) issue('OUT_OF_RANGE');
    else if (range && feet > range.normal && !(reach !== undefined && feet <= reach)) prompt('LONG_RANGE_DISADVANTAGE');
  }

  // Rolls and proposed effects.
  for (const target of targets) {
    if (option.attack) preview.rolls.push({ kind: 'attack', targetId: target.id, modifier: option.attack.bonus, ac: target.ac });
    else if (option.save) preview.rolls.push({ kind: 'save', targetId: target.id, ability: option.save.ability, dc: option.save.dc, modifier: target.saves?.[option.save.ability] ?? null });
  }
  const levelsAbove = spell ? Math.max(0, slotLevel - spell.level) : 0;
  option.damage.forEach((damage: ActionDamage, index) => {
    const upcast = index === 0 && spell?.upcastDice && spell.upcastTarget === 'damage' && levelsAbove > 0;
    preview.effects.push({
      kind: 'damage', dice: upcast ? addDice(damage.dice, spell.upcastDice!, levelsAbove) : damage.dice, average: upcast ? null : damage.average, type: damage.type,
      onSave: option.save && !option.attack ? option.save.onSuccess : null,
    });
  });
  if (option.heal) {
    const upcast = spell?.upcastDice && spell.upcastTarget === 'heal' ? addDice(option.heal.dice, spell.upcastDice, levelsAbove) : option.heal.dice;
    preview.effects.push({ kind: 'heal', dice: upcast, bonus: option.heal.bonus });
  }
  if (spell?.concentration) {
    const replaces = actor.concentration && actor.concentration !== option.sourceId ? actor.concentration : null;
    preview.effects.push({ kind: 'concentration', spellId: option.sourceId, replaces });
    if (replaces) prompt('CONCENTRATION_REPLACES');
  }
  if (option.multiattack) preview.effects.push({ kind: 'pool', remaining: option.multiattack.count, names: option.multiattack.names });
  else if (option.kind === 'weapon' && turn === 'action' && actor.attacksPerAction > 1) preview.effects.push({ kind: 'pool', remaining: actor.attacksPerAction - 1, names: null });
  if (option.automation === 'manual') preview.effects.push({ kind: 'manual', text: option.text });
  return preview;
}

/** Budget/usage after paying for a valid preview. Slots and feature resources live on the sheet (server). */
export function applyActionCost(actor: ActionActor, preview: ActionPreview): { budget: TurnBudget; usage: ActionUsage } {
  const budget = { ...actor.budget };
  const usage: ActionUsage = { ...actor.usage, recharge: [...actor.usage.recharge], perDay: { ...actor.usage.perDay }, legendaryUsed: [...actor.usage.legendaryUsed], pool: actor.usage.pool ? { ...actor.usage.pool } : null };
  const option = actor.options.find((entry) => entry.id === preview.optionId)!;
  const slug = slugOfOption(option);
  const turn = preview.cost.turn;
  if (turn === 'action' || turn === 'bonus' || turn === 'reaction') budget[turn] -= 1;
  if (turn === 'pool' && usage.pool && usage.pool.remaining !== null) usage.pool.remaining -= 1;
  if (turn === 'legendary') {
    usage.legendary += preview.cost.legendary;
    if (option.legendary?.oncePerRound) usage.legendaryUsed.push(slug);
  }
  if (preview.cost.uses === 'recharge' || preview.cost.uses === 'rest') usage.recharge.push(slug);
  if (preview.cost.uses === 'per-day') usage.perDay[slug] = (usage.perDay[slug] ?? 0) + 1;
  if (preview.cost.slot) usage.slotTurn = actor.turn;
  const pool = preview.effects.find((effect): effect is Extract<ActionEffect, { kind: 'pool' }> => effect.kind === 'pool');
  if (pool) usage.pool = { remaining: pool.remaining, names: pool.names };
  return { budget, usage };
}

// ---------------------------------------------------------------- resolution

function damageTotal(effect: Extract<ActionEffect, { kind: 'damage' }>, mode: 'roll' | 'average', critical: boolean, random: RandomInt) {
  if (mode === 'average' && !critical && effect.average !== null) return { roll: null, total: effect.average };
  const roll = rollDice(effect.dice, random, critical);
  return { roll, total: Math.max(0, roll.total) };
}

/**
 * Roll what the preview asks for with the server random source. Damage is rolled before saves
 * (one roll for every target, SRD "Damage Rolls"); attacks roll damage per target hit.
 */
export function resolveAction(preview: ActionPreview, options: { damageMode?: 'roll' | 'average'; advantage?: boolean; disadvantage?: boolean }, random: RandomInt): ActionOutcome {
  const { text: _text, ...summary } = preview;
  const outcome: ActionOutcome = { preview: summary, attacks: [], saves: [], damage: [], heal: null, proposed: [] };
  const mode = options.damageMode ?? 'roll';
  const damages = preview.effects.filter((effect): effect is Extract<ActionEffect, { kind: 'damage' }> => effect.kind === 'damage');
  const attacks = preview.rolls.filter((roll): roll is Extract<ActionRoll, { kind: 'attack' }> => roll.kind === 'attack');
  const saves = preview.rolls.filter((roll): roll is Extract<ActionRoll, { kind: 'save' }> => roll.kind === 'save');
  const propose = (effect: ProposedEffect) => { if (effect.input.amount > 0) outcome.proposed.push(effect); };
  if (attacks.length > 0) {
    for (const attack of attacks) {
      const roll = resolveD20({ kind: 'attack', modifier: attack.modifier, ...(options.advantage ? { advantage: true } : {}), ...(options.disadvantage ? { disadvantage: true } : {}) }, random);
      const hit = roll.critical ? true : roll.fumble ? false : attack.ac === null ? null : roll.total >= attack.ac;
      outcome.attacks.push({ targetId: attack.targetId, roll, hit });
      if (hit === false) continue;
      for (const effect of damages) {
        const result = damageTotal(effect, mode, roll.critical, random);
        outcome.damage.push({ targetId: attack.targetId, type: effect.type, ...result });
        if (effect.type) propose({ targetId: attack.targetId, input: { kind: 'damage', amount: result.total, damageType: effect.type }, decision: hit === null });
      }
    }
  } else {
    const rolled = damages.map((effect) => ({ effect, ...damageTotal(effect, mode, false, random) }));
    for (const entry of rolled) outcome.damage.push({ targetId: null, type: entry.effect.type, roll: entry.roll, total: entry.total });
    const targets = saves.length > 0 ? saves.map((save) => save.targetId) : preview.targetIds;
    for (const save of saves) {
      const roll = save.modifier === null ? null : resolveD20({ kind: 'save', modifier: save.modifier, dc: save.dc }, random);
      outcome.saves.push({ targetId: save.targetId, roll, success: roll ? roll.success ?? null : null });
    }
    for (const targetId of targets) {
      const success = outcome.saves.find((save) => save.targetId === targetId)?.success ?? null;
      for (const entry of rolled) {
        if (!entry.effect.type) continue;
        const amount = success === true ? (entry.effect.onSave === 'half' ? Math.floor(entry.total / 2) : 0) : entry.total;
        propose({ targetId, input: { kind: 'damage', amount, damageType: entry.effect.type }, decision: saves.length === 0 || success === null });
      }
    }
  }
  const heal = preview.effects.find((effect): effect is Extract<ActionEffect, { kind: 'heal' }> => effect.kind === 'heal');
  if (heal) {
    outcome.heal = rollDice(heal.bonus ? `${heal.dice}+${heal.bonus}` : heal.dice, random);
    for (const targetId of preview.targetIds) propose({ targetId, input: { kind: 'heal', amount: Math.max(0, outcome.heal.total) }, decision: false });
  }
  return outcome;
}

/** Players' copy of an outcome: target AC, save modifiers and save dice stay with the DM; success/failure remains. */
export function redactOutcome(outcome: ActionOutcome): ActionOutcome {
  return {
    ...outcome,
    preview: { ...outcome.preview, rolls: outcome.preview.rolls.map((roll) => roll.kind === 'attack' ? { ...roll, ac: null } : { ...roll, modifier: null }) },
    saves: outcome.saves.map((save) => ({ ...save, roll: null })),
  };
}
