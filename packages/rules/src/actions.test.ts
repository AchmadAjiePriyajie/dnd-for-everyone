import { describe, expect, it } from 'vitest';
import { loadCatalog } from '#content/catalog';
import { type Character, type CharacterDraft, type CharacterResources, emptyDraft, emptyFeatureState, emptyResources } from '#shared/characters';
import { type ActionActor, type ActionInput, type ActionUsage, type ActionView, emptyActionUsage, type RandomInt, type TurnBudget } from '#shared/combat';
import { applyActionCost, characterActor, monsterActor, previewAction, resolveAction } from './actions.ts';
import { parseStatBlock } from './monster-actions.ts';
import { startingResources } from './equipment.ts';
import { advanceTurn } from './turns.ts';

const catalog = loadCatalog();
const fullBudget = (): TurnBudget => ({ action: 1, bonus: 1, reaction: 1, movement: 30 });
const turnState = (over: Partial<{ budget: TurnBudget; usage: ActionUsage; activeTurn: boolean; turn: number; position: { x: number; y: number; size: number } | null }> = {}) => ({
  budget: fullBudget(), usage: emptyActionUsage(), activeTurn: true, turn: 4, canAct: true, position: { x: 0, y: 0, size: 1 }, ...over,
});
const monster = (id: string, combatantId: string, over: Parameters<typeof turnState>[0] = {}): ActionActor => {
  const entry = catalog.getContent(id, 'en');
  return monsterActor({ combatantId, monsterId: id, name: entry.name, body: entry.body, ...turnState(over) });
};

const draft = (over: Partial<CharacterDraft>): CharacterDraft => ({
  ...emptyDraft(), name: 'Caster', speciesId: 'species.human', size: 'medium', backgroundId: 'background.acolyte',
  backgroundIncrease: { mode: '2-1', plus2: 'wis', plus1: 'cha' }, abilityMethod: 'standard-array',
  baseScores: { str: 10, dex: 14, con: 13, int: 8, wis: 15, cha: 12 }, classSkills: ['insight', 'medicine'], languages: ['Elvish', 'Dwarvish'],
  classEquipment: 'A', backgroundEquipment: 'B', equippedArmorId: null, ...over,
});
const character = (classLevels: Character['classLevels'], over: Partial<CharacterDraft>, resources: Partial<CharacterResources>): Character => {
  const base: Character = {
    id: 'char-1', campaignId: 'camp-1', ownerAccountId: 'acc-1', status: 'final', classLevels, draft: draft(over), rolls: [], overrides: {},
    featureState: emptyFeatureState(), resources: emptyResources(), advancements: [], pendingAdvancement: null, revision: 1, updatedAt: '2026-10-31T00:00:00.000Z',
  };
  return { ...base, resources: { ...startingResources(base, catalog), ...resources } };
};
/** Cleric Wis 17 (+3): spell save DC 13, spell attack +5 at level 1–4. */
const cleric = (level: number, resources: Partial<CharacterResources> = {}) => character([{ classId: 'class.cleric', level }], { classId: 'class.cleric' }, {
  spells: [{ classId: 'class.cleric', cantrips: ['spell.sacred-flame', 'spell.guidance', 'spell.thaumaturgy'], prepared: ['spell.cure-wounds', 'spell.bless', 'spell.guiding-bolt'] }], ...resources,
});
/** Wizard Int 17 (+3). */
const wizard = (level: number, resources: Partial<CharacterResources> = {}) => character([{ classId: 'class.wizard', level }], {
  classId: 'class.wizard', backgroundId: 'background.sage', backgroundIncrease: { mode: '2-1', plus2: 'int', plus1: 'con' }, baseScores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
}, { spells: [{ classId: 'class.wizard', cantrips: ['spell.fire-bolt', 'spell.light', 'spell.mage-hand'], prepared: ['spell.magic-missile', 'spell.shield', 'spell.fireball'] }], ...resources });
const pc = (sheet: Character, over: Parameters<typeof turnState>[0] = {}) => characterActor(sheet, catalog, { combatantId: 'pc', ...turnState(over) });

const view: ActionView = {
  grid: { feetPerCell: 5, diagonal: 'standard' },
  targets: [
    { id: 'orc', name: 'Orc', position: { x: 1, y: 0, size: 1 }, ac: 12, saves: { dex: 1, wis: 0 } },
    { id: 'far', name: 'Far', position: { x: 20, y: 0, size: 1 }, ac: 12, saves: { dex: 1 } },
    { id: 'very-far', name: 'Very far', position: { x: 70, y: 0, size: 1 }, ac: 12, saves: { dex: 1 } },
    { id: 'ally', name: 'Ally', position: { x: 0, y: 1, size: 1 }, ac: 15, saves: { dex: 2 } },
  ],
};
const input = (actor: ActionActor, name: string, over: Partial<ActionInput> = {}): ActionInput => {
  const option = actor.options.find((o) => o.originalName === name);
  if (!option) throw new Error(`No option ${name}: ${actor.options.map((o) => o.originalName).join(', ')}`);
  return { combatantId: actor.combatantId, optionId: option.id, targetIds: [], ...over };
};
const draws = (...values: number[]): RandomInt => (min, max) => {
  const value = values.shift();
  if (value === undefined || value < min || value >= max) throw new Error(`Fixture out of range ${value} [${min}, ${max})`);
  return value;
};

describe('guided actions', () => {
  it('supports_non_damage_and_restricted_actions', () => {
    // Exhausted Action and hidden/unknown targets are rejected.
    const dragon = monster('monster.adult-red-dragon', 'dragon', { budget: { ...fullBudget(), action: 0 } });
    expect(previewAction(dragon, input(dragon, 'Rend', { targetIds: ['orc'] }), view).issues).toContain('BUDGET_EXHAUSTED');
    const fresh = monster('monster.adult-red-dragon', 'dragon');
    expect(previewAction(fresh, input(fresh, 'Rend', { targetIds: ['hidden-wizard'] }), view).issues).toContain('TARGET_INVALID');
    expect(previewAction(fresh, input(fresh, 'Rend', { targetIds: ['orc'] }), view).issues).toEqual([]);

    // Buff/heal/utility spells are not attack damage.
    const priest = pc(cleric(1));
    const bless = previewAction(priest, input(priest, 'Bless', { targetIds: ['ally'], slotLevel: 1 }), view);
    expect(bless.issues).toEqual([]);
    expect(bless.rolls).toEqual([]);
    expect(bless.effects.some((e) => e.kind === 'damage')).toBe(false);
    expect(bless.effects).toContainEqual({ kind: 'concentration', spellId: 'spell.bless', replaces: null });
    expect(bless.automation).toBe('manual');
    expect(bless.duration).toBe('Concentration, up to 1 minute');
    expect(bless.cost).toMatchObject({ turn: 'action', slot: { level: 1, pact: false } });
    const cure = previewAction(priest, input(priest, 'Cure Wounds', { targetIds: ['ally'], slotLevel: 1 }), view);
    expect(cure.rolls).toEqual([]);
    expect(cure.effects).toEqual([{ kind: 'heal', dice: '2d8', bonus: 3 }]);
    const light = pc(wizard(1));
    expect(previewAction(light, input(light, 'Light', { targetIds: [] }), view)).toMatchObject({ issues: [], rolls: [], automation: 'manual', cost: { slot: null } });

    // Multiattack follows the stat block: three Rend attacks, and may swap one for Spellcasting.
    const multi = previewAction(fresh, input(fresh, 'Multiattack'), view);
    expect(multi.cost.turn).toBe('action');
    expect(multi.effects).toContainEqual({ kind: 'pool', remaining: 3, names: ['Rend', 'Spellcasting'] });
    const paid = applyActionCost(fresh, multi);
    expect(paid.budget.action).toBe(0);
    let state = monster('monster.adult-red-dragon', 'dragon', paid);
    const rend = previewAction(state, input(state, 'Rend', { targetIds: ['orc'] }), view);
    expect(rend).toMatchObject({ issues: [], cost: { turn: 'pool' } });
    expect(previewAction(state, input(state, 'Fire Breath', { targetIds: ['orc'] }), view).issues).toContain('BUDGET_EXHAUSTED');
    for (let attack = 0; attack < 3; attack++) {
      state = monster('monster.adult-red-dragon', 'dragon', applyActionCost(state, previewAction(state, input(state, 'Rend', { targetIds: ['orc'] }), view)));
    }
    expect(previewAction(state, input(state, 'Rend', { targetIds: ['orc'] }), view).issues).toContain('BUDGET_EXHAUSTED');

    // Recharge 5–6 is spent until recharged.
    const breath = previewAction(fresh, input(fresh, 'Fire Breath', { targetIds: ['orc', 'ally'] }), view);
    expect(breath.issues).toEqual([]);
    expect(breath.rolls).toEqual([
      { kind: 'save', targetId: 'orc', ability: 'dex', dc: 21, modifier: 1 },
      { kind: 'save', targetId: 'ally', ability: 'dex', dc: 21, modifier: 2 },
    ]);
    expect(breath.effects).toContainEqual({ kind: 'damage', dice: '17d6', average: 59, type: 'fire', onSave: 'half' });
    const spent = monster('monster.adult-red-dragon', 'dragon', applyActionCost(fresh, breath));
    expect(spent.usage.recharge).toEqual(['fire-breath']);
    expect(previewAction(spent, input(spent, 'Fire Breath', { targetIds: ['orc'] }), view).issues).toContain('RECHARGE_SPENT');

    // Legendary Actions: 3 uses, never on its own turn, once-per-round options.
    expect(fresh.legendaryMax).toBe(3);
    expect(previewAction(fresh, input(fresh, 'Pounce', { targetIds: ['orc'] }), view).issues).toContain('LEGENDARY_OWN_TURN');
    let offTurn = monster('monster.adult-red-dragon', 'dragon', { activeTurn: false });
    const command = previewAction(offTurn, input(offTurn, 'Commanding Presence', { targetIds: ['orc'] }), view);
    expect(command).toMatchObject({ issues: [], cost: { turn: 'legendary', legendary: 1 }, automation: 'manual' });
    offTurn = monster('monster.adult-red-dragon', 'dragon', { activeTurn: false, ...applyActionCost(offTurn, command) });
    expect(previewAction(offTurn, input(offTurn, 'Commanding Presence', { targetIds: ['orc'] }), view).issues).toContain('LEGENDARY_ONCE_PER_ROUND');
    offTurn = monster('monster.adult-red-dragon', 'dragon', { activeTurn: false, usage: { ...emptyActionUsage(), legendary: 3 } });
    expect(previewAction(offTurn, input(offTurn, 'Pounce', { targetIds: ['orc'] }), view).issues).toContain('LEGENDARY_EXHAUSTED');
    // Legendary Resistance (3/Day) is a free per-day use.
    const resistance = previewAction(offTurn, input(offTurn, 'Legendary Resistance'), view);
    expect(resistance).toMatchObject({ issues: [], cost: { turn: 'free', uses: 'per-day' } });
    const resisted = monster('monster.adult-red-dragon', 'dragon', { usage: { ...emptyActionUsage(), perDay: { 'legendary-resistance': 3 } } });
    expect(previewAction(resisted, input(resisted, 'Legendary Resistance'), view).issues).toContain('USES_EXHAUSTED');
  });

  it('chooses_average_or_rolled_damage_and_checks_slots_and_reactions', () => {
    const goblin = monster('monster.goblin-warrior', 'goblin');
    const scimitar = previewAction(goblin, input(goblin, 'Scimitar', { targetIds: ['orc'] }), view);
    expect(scimitar.rolls).toEqual([{ kind: 'attack', targetId: 'orc', modifier: 4, ac: 12 }]);
    expect(scimitar.effects).toContainEqual({ kind: 'damage', dice: '1d6+2', average: 5, type: 'slashing', onSave: null });
    expect(scimitar.prompts).toContain('CONDITIONAL_DAMAGE');
    expect(scimitar.automation).toBe('assisted');
    const average = resolveAction(scimitar, { damageMode: 'average' }, draws(15));
    expect(average.attacks[0]).toMatchObject({ targetId: 'orc', hit: true });
    expect(average.damage).toEqual([{ targetId: 'orc', type: 'slashing', roll: null, total: 5 }]);
    expect(average.proposed).toEqual([{ targetId: 'orc', input: { kind: 'damage', amount: 5, damageType: 'slashing' }, decision: false }]);
    const rolled = resolveAction(scimitar, { damageMode: 'roll' }, draws(15, 3));
    expect(rolled.damage[0]!.total).toBe(5);
    expect(rolled.damage[0]!.roll!.dice[0]!.rolls).toEqual([3]);
    // Critical: dice doubled even in average mode, modifier once.
    const critical = resolveAction(scimitar, { damageMode: 'average' }, draws(20, 1, 6));
    expect(critical.damage[0]).toMatchObject({ total: 9, roll: { critical: true } });
    const miss = resolveAction(scimitar, { damageMode: 'roll' }, draws(1));
    expect(miss).toMatchObject({ attacks: [{ hit: false }], damage: [], proposed: [] });

    // Range: reach 5 ft.; Shortbow 80/320 ft. has long-range Disadvantage.
    expect(previewAction(goblin, input(goblin, 'Scimitar', { targetIds: ['far'] }), view).issues).toContain('OUT_OF_RANGE');
    expect(previewAction(goblin, input(goblin, 'Shortbow', { targetIds: ['far'] }), view)).toMatchObject({ issues: [], prompts: expect.arrayContaining(['CONDITIONAL_DAMAGE']) });
    const longShot = { ...view, targets: [{ ...view.targets[1]!, position: { x: 30, y: 0, size: 1 } }] };
    expect(previewAction(goblin, input(goblin, 'Shortbow', { targetIds: ['far'] }), longShot).prompts).toContain('LONG_RANGE_DISADVANTAGE');
    expect(previewAction(goblin, input(goblin, 'Shortbow', { targetIds: ['very-far'] }), view).issues).toContain('OUT_OF_RANGE');

    // Narrative feature: no dice, still runnable with rule text and a DM decision.
    const escape = previewAction(goblin, input(goblin, 'Nimble Escape'), view);
    expect(escape).toMatchObject({ issues: [], rolls: [], automation: 'manual', cost: { turn: 'bonus' } });
    expect(escape.effects).toEqual([{ kind: 'manual', text: expect.stringContaining('Disengage or Hide') }]);

    // Reaction trigger: usable off-turn, shows the trigger, needs Reaction budget.
    const mage = pc(wizard(1), { activeTurn: false });
    const shield = previewAction(mage, input(mage, 'Shield', { slotLevel: 1 }), view);
    expect(shield).toMatchObject({ issues: [], cost: { turn: 'reaction' } });
    expect(shield.trigger).toContain('hit by an attack roll');
    expect(shield.prompts).toContain('REACTION_TRIGGER');
    const tired = pc(wizard(1), { activeTurn: false, budget: { ...fullBudget(), reaction: 0 } });
    expect(previewAction(tired, input(tired, 'Shield', { slotLevel: 1 }), view).issues).toContain('BUDGET_EXHAUSTED');
    const captain = monster('monster.bandit-captain', 'captain', { activeTurn: false });
    expect(previewAction(captain, input(captain, 'Parry'), view)).toMatchObject({ issues: [], cost: { turn: 'reaction' }, trigger: expect.stringContaining('hit by a melee attack roll') });

    // Insufficient slot, slot below spell level, one slot per turn, upcast and cantrip scaling.
    const empty = pc(wizard(1, { slotsSpent: [2, 0, 0, 0, 0, 0, 0, 0, 0] }));
    expect(previewAction(empty, input(empty, 'Magic Missile', { targetIds: ['orc'], slotLevel: 1 }), view).issues).toContain('NO_SLOT_LEFT');
    expect(previewAction(empty, input(empty, 'Fire Bolt', { targetIds: ['orc'] }), view).issues).toEqual([]);
    const evoker = pc(wizard(5));
    expect(previewAction(evoker, input(evoker, 'Fireball', { targetIds: ['orc'], slotLevel: 2 }), view).issues).toContain('SLOT_TOO_LOW');
    const fireball = previewAction(evoker, input(evoker, 'Fireball', { targetIds: ['orc', 'far'], slotLevel: 3 }), view);
    expect(fireball.rolls).toEqual([
      { kind: 'save', targetId: 'orc', ability: 'dex', dc: 14, modifier: 1 },
      { kind: 'save', targetId: 'far', ability: 'dex', dc: 14, modifier: 1 },
    ]);
    expect(fireball.effects).toContainEqual({ kind: 'damage', dice: '8d6', average: null, type: 'fire', onSave: 'half' });
    expect(fireball.automation).toBe('assisted');
    expect(previewAction(evoker, input(evoker, 'Fireball', { targetIds: ['orc'], slotLevel: 4 }), view).effects).toContainEqual({ kind: 'damage', dice: '9d6', average: null, type: 'fire', onSave: 'half' });
    const saved = resolveAction(fireball, {}, draws(...Array(8).fill(2), 2, 19));
    expect(saved.saves).toMatchObject([{ targetId: 'orc', success: false }, { targetId: 'far', success: true }]);
    expect(saved.proposed).toEqual([
      { targetId: 'orc', input: { kind: 'damage', amount: 16, damageType: 'fire' }, decision: false },
      { targetId: 'far', input: { kind: 'damage', amount: 8, damageType: 'fire' }, decision: false },
    ]);
    const castThisTurn = pc(wizard(5), { usage: { ...emptyActionUsage(), slotTurn: 4 } });
    expect(previewAction(castThisTurn, input(castThisTurn, 'Magic Missile', { targetIds: ['orc'], slotLevel: 1 }), view).issues).toContain('ONE_SLOT_PER_TURN');
    expect(previewAction(evoker, input(evoker, 'Fire Bolt', { targetIds: ['orc'] }), view).effects).toContainEqual({ kind: 'damage', dice: '2d10', average: null, type: 'fire', onSave: null });
    const healer = pc(cleric(3));
    expect(previewAction(healer, input(healer, 'Cure Wounds', { targetIds: ['ally'], slotLevel: 2 }), view).effects).toEqual([{ kind: 'heal', dice: '4d8', bonus: 3 }]);
    const healing = resolveAction(previewAction(healer, input(healer, 'Cure Wounds', { targetIds: ['ally'], slotLevel: 1 }), view), {}, draws(4, 5));
    expect(healing.proposed).toEqual([{ targetId: 'ally', input: { kind: 'heal', amount: 12 }, decision: false }]);
    expect(applyActionCost(healer, previewAction(healer, input(healer, 'Cure Wounds', { targetIds: ['ally'], slotLevel: 1 }), view)).usage.slotTurn).toBe(4);
  });

  it('parses_stat_block_sections_and_uses', () => {
    const block = parseStatBlock(catalog.getContent('monster.adult-red-dragon', 'en').body);
    expect(block.legendaryUses).toBe(3);
    expect(block.actions.find((a) => a.name === 'Fire Breath')).toMatchObject({ section: 'action', recharge: { min: 5 } });
    expect(block.actions.find((a) => a.name === 'Rend')).toMatchObject({ attack: { bonus: 14, reach: 10 }, damage: [{ dice: '1d10+8', average: 13, type: 'slashing' }, { dice: '2d4', average: 5, type: 'fire' }] });
    expect(block.actions.find((a) => a.name === 'Legendary Resistance')).toMatchObject({ section: 'trait', perDay: 3 });
    expect(block.actions.find((a) => a.name === 'Multiattack')!.multiattack).toEqual({ count: 3, names: ['Rend', 'Spellcasting'], alternatives: false });
    const hydra = parseStatBlock(catalog.getContent('monster.hydra', 'en').body);
    expect(hydra.actions.find((a) => a.name === 'Multiattack')!.multiattack!.count).toBeNull();
    const devil = parseStatBlock(catalog.getContent('monster.chain-devil', 'en').body);
    expect(devil.actions.find((a) => a.name === 'Unnerving Gaze')).toMatchObject({ section: 'reaction', save: { ability: 'wis', dc: 15 } });
  });

  it('resets_legendary_and_pools_at_the_start_of_own_turn_only', () => {
    const used: ActionUsage = { recharge: ['fire-breath'], perDay: { 'legendary-resistance': 1 }, legendary: 3, legendaryUsed: ['fiery-rays'], pool: { remaining: 1, names: ['Rend'] }, slotTurn: 2 };
    const creature = (id: string, initiative: number) => ({
      id, name: id, characterId: null, monsterId: 'monster.adult-red-dragon', tokenId: null, ownerAccountId: null, initiative, tieOrder: 0, hidden: false, defeated: false,
      speedFeet: 40, diagonalsMoved: 0, hp: { current: 10, max: 10, temp: 0 }, budget: fullBudget(), actions: used,
    });
    const combat = { id: 'c', campaignId: 'camp', name: 'c', templateId: 't', sceneId: null, status: 'active' as const, round: 1, turn: 1, activeId: 'a', combatants: [creature('a', 20), creature('b', 10)], revision: 0 };
    const next = advanceTurn(combat);
    expect(next.combatants.find((c) => c.id === 'a')!.actions).toEqual(used);
    // Recharge and per-day uses stay spent; recharge rolls happen on the server at turn start.
    expect(next.combatants.find((c) => c.id === 'b')!.actions).toEqual({ ...used, legendary: 0, legendaryUsed: [], pool: null });
  });
});
