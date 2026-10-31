import { describe, expect, it } from 'vitest';
import { loadCatalog } from '#content/catalog';
import {
  type Character,
  type CharacterDraft,
  type CharacterResources,
  emptyDraft,
  emptyFeatureState,
  emptyResources,
  type FeatureState,
} from '#shared/characters';
import { deriveCharacter } from './character-stats.ts';
import { addItem, adjustCoins, adjustItem, setAttunement, startingResources, validateLoadout } from './equipment.ts';
import { applyRest, previewRest } from './rests.ts';
import { deriveSpellcasting, setConcentration, spendSlot, validateSpells } from './spellcasting.ts';

const catalog = loadCatalog();

/** Fighter Dwarf Soldier level 1 (Task 7): AC 16 Chain Mail, HP 13, Str 17, Con 15. */
const fighterDraft = (over: Partial<CharacterDraft> = {}): CharacterDraft => ({
  ...emptyDraft(),
  name: 'Brakka',
  speciesId: 'species.dwarf',
  size: 'medium',
  backgroundId: 'background.soldier',
  backgroundIncrease: { mode: '2-1', plus2: 'str', plus1: 'con' },
  classId: 'class.fighter',
  abilityMethod: 'standard-array',
  baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  classSkills: ['perception', 'survival'],
  languages: ['Dwarvish', 'Giant'],
  toolChoices: [{ group: 'gaming-set', variant: 'dice' }],
  classEquipment: 'A',
  backgroundEquipment: 'B',
  equippedArmorId: 'equipment.chain-mail',
  ...over,
});

const make = (
  draft: CharacterDraft,
  classLevels: Character['classLevels'],
  resources: Partial<CharacterResources> = {},
  featureState: Partial<FeatureState> = {},
): Character => {
  const base: Character = {
    id: 'char-1',
    campaignId: 'camp-1',
    ownerAccountId: 'acc-1',
    status: 'final',
    classLevels,
    draft,
    rolls: [],
    overrides: {},
    featureState: { ...emptyFeatureState(), ...featureState },
    resources: emptyResources(),
    advancements: [],
    pendingAdvancement: null,
    revision: 1,
    updatedAt: '2026-10-31T00:00:00.000Z',
  };
  return { ...base, resources: { ...startingResources(base, catalog), ...resources } };
};

const fighter = (classLevels: Character['classLevels'] = [{ classId: 'class.fighter', level: 1 }]) => make(fighterDraft(), classLevels);
/** Wizard Int 16 (+3), Dex 14, Con 13; level 1: 3 cantrip, 4 prepared, 2 slot level 1. */
const wizardDraft = (over: Partial<CharacterDraft> = {}) =>
  fighterDraft({ classId: 'class.wizard', baseScores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }, backgroundIncrease: { mode: '2-1', plus2: 'int', plus1: 'con' }, backgroundId: 'background.sage', classEquipment: 'A', equippedArmorId: null, ...over });

describe('character resources', () => {
  it('tracks_resources_without_double_spending', () => {
    // ---------------------------------------------------------------- inventory & koin
    const brakka = fighter();
    const javelins = brakka.resources.inventory.find((entry) => entry.itemId === 'equipment.javelin')!;
    expect(javelins.quantity).toBe(8);
    expect(brakka.resources.coins.gp).toBe(54);
    let resources = adjustItem(brakka.resources, javelins.entryId, -3);
    expect(resources.inventory.find((entry) => entry.entryId === javelins.entryId)?.quantity).toBe(5);
    expect(() => adjustItem(resources, javelins.entryId, -6)).toThrow('INVENTORY_NEGATIVE');
    // Habis tepat nol → baris hilang.
    resources = adjustItem(resources, javelins.entryId, -5);
    expect(resources.inventory.some((entry) => entry.entryId === javelins.entryId)).toBe(false);
    expect(() => adjustCoins(resources, 'gp', -55)).toThrow('COINS_NEGATIVE');
    expect(adjustCoins(resources, 'gp', -54).coins.gp).toBe(0);

    // ---------------------------------------------------------------- equipment → AC/attacks, override tetap
    const sheet = deriveCharacter(brakka, catalog);
    expect(sheet.armorClass.value).toBe(16);
    // Greatsword: Str +3 + proficiency +2; 2d6+3 Slashing; mastery hanya bila dipilih.
    const greatsword = sheet.attacks.find((attack) => attack.itemId === 'equipment.greatsword')!;
    expect(greatsword).toMatchObject({ ability: 'str', proficient: true, damage: { dice: '2d6', bonus: 3, type: 'slashing' }, mastery: null });
    expect(greatsword.attackBonus.value).toBe(5);
    const mastered = deriveCharacter({ ...brakka, featureState: { ...brakka.featureState, weaponMasteries: ['equipment.greatsword'] } }, catalog);
    expect(mastered.attacks.find((attack) => attack.itemId === 'equipment.greatsword')?.mastery).toBe('rule.mastery-graze');
    const corrected = { ...brakka, overrides: { armorClass: 18 } };
    const unarmored = deriveCharacter({ ...corrected, draft: { ...corrected.draft, equippedArmorId: null } }, catalog);
    // 10 + Dex +1; koreksi DM tetap ada di atas nilai aturan yang baru.
    expect(unarmored.armorClass).toMatchObject({ base: 11, value: 18, override: 18 });
    // Armor yang sudah dibuang tidak lagi bisa dipakai.
    const mail = brakka.resources.inventory.find((entry) => entry.itemId === 'equipment.chain-mail')!;
    const noMail = { ...brakka, resources: adjustItem(brakka.resources, mail.entryId, -1) };
    expect(validateLoadout(noMail, catalog).issues).toContain('ARMOR_NOT_CARRIED');
    expect(validateLoadout(brakka, catalog)).toEqual({ ok: true, issues: [] });

    // ---------------------------------------------------------------- attunement
    let carried = brakka.resources;
    for (const [index, id] of ['magic-item.amulet-of-health', 'magic-item.amulet-of-the-planes', 'magic-item.animated-shield', 'magic-item.armor-of-invulnerability', 'magic-item.hat-of-many-spells', 'magic-item.adamantine-armor'].entries()) {
      carried = addItem(carried, { itemId: id, quantity: 1 }, `loot-${index}`);
    }
    const owner = { ...brakka, resources: carried };
    let attuned = owner;
    for (const entry of ['loot-0', 'loot-1', 'loot-2']) attuned = { ...attuned, resources: setAttunement(attuned, entry, true, catalog) };
    expect(() => setAttunement(attuned, 'loot-3', true, catalog)).toThrow('ATTUNEMENT_LIMIT');
    expect(() => setAttunement(owner, 'loot-5', true, catalog)).toThrow('ATTUNEMENT_NOT_REQUIRED');
    // Hat of Many Spells: "Requires Attunement by a Wizard".
    expect(() => setAttunement(owner, 'loot-4', true, catalog)).toThrow('ATTUNEMENT_CLASS');
    expect(validateLoadout(attuned, catalog).ok).toBe(true);
    expect(() => addItem(carried, { itemId: 'equipment.rope', quantity: 0 }, 'x')).toThrow('INVENTORY_NEGATIVE');

    // ---------------------------------------------------------------- spell preparation
    const wizard = make(wizardDraft(), [{ classId: 'class.wizard', level: 1 }], {
      spellbook: ['spell.burning-hands', 'spell.charm-person', 'spell.detect-magic', 'spell.alarm', 'spell.color-spray', 'spell.disguise-self'],
    });
    const prepared = (cantrips: string[], spells: string[]) => ({
      ...wizard,
      resources: { ...wizard.resources, spells: [{ classId: 'class.wizard', cantrips, prepared: spells }] },
    });
    const ok = prepared(['spell.fire-bolt', 'spell.acid-splash', 'spell.chill-touch'], ['spell.burning-hands', 'spell.detect-magic']);
    const casting = deriveSpellcasting(ok, catalog);
    // DC 8 + Int +3 + proficiency +2; attack +5.
    expect(casting.classes[0]).toMatchObject({ classId: 'class.wizard', ability: 'int', saveDc: 13, attackBonus: 5, cantripsMax: 3, preparedMax: 4, maxSpellLevel: 1 });
    expect(casting.slots).toEqual([{ level: 1, max: 2, spent: 0, remaining: 2 }]);
    expect(casting.issues).toEqual([]);
    expect(validateSpells(prepared([], ['spell.fireball']), catalog).issues).toEqual(['SPELL_LEVEL:spell.fireball']);
    expect(validateSpells(prepared([], ['spell.cure-wounds']), catalog).issues).toEqual(['SPELL_NOT_ON_LIST:spell.cure-wounds']);
    expect(validateSpells(prepared([], ['spell.chromatic-orb']), catalog).issues).toEqual(['SPELL_NOT_IN_SPELLBOOK:spell.chromatic-orb']);
    // Prepared vs cantrip/spellbook tidak dicampur.
    expect(validateSpells(prepared([], ['spell.fire-bolt']), catalog).issues).toEqual(['SPELL_NOT_LEVELED:spell.fire-bolt']);
    expect(validateSpells(prepared(['spell.burning-hands'], []), catalog).issues).toEqual(['SPELL_NOT_CANTRIP:spell.burning-hands']);
    expect(validateSpells(prepared([], ['spell.burning-hands', 'spell.charm-person', 'spell.detect-magic', 'spell.alarm', 'spell.color-spray']), catalog).issues).toEqual(['PREPARED_COUNT:class.wizard']);
    expect(validateSpells(prepared(['spell.fire-bolt', 'spell.acid-splash', 'spell.chill-touch', 'spell.dancing-lights'], []), catalog).issues).toEqual(['CANTRIP_COUNT:class.wizard']);
    expect(validateSpells(prepared([], ['spell.alarm']), catalog).ok).toBe(true);

    // ---------------------------------------------------------------- slot: sampai nol, lalu ditolak
    let caster = ok;
    caster = { ...caster, resources: spendSlot(caster, catalog, 1) };
    caster = { ...caster, resources: spendSlot(caster, catalog, 1) };
    expect(deriveSpellcasting(caster, catalog).slots[0]).toEqual({ level: 1, max: 2, spent: 2, remaining: 0 });
    expect(() => spendSlot(caster, catalog, 1)).toThrow('NO_SLOT_LEFT');
    expect(() => spendSlot(caster, catalog, 2)).toThrow('NO_SLOT_LEFT');
    // Concentration hanya untuk spell yang membutuhkannya, dan harus spell yang dimiliki.
    expect(setConcentration(caster, catalog, 'spell.detect-magic').concentration).toBe('spell.detect-magic');
    expect(() => setConcentration(caster, catalog, 'spell.burning-hands')).toThrow('NOT_CONCENTRATION');
    expect(() => setConcentration(caster, catalog, 'spell.bless')).toThrow('SPELL_NOT_PREPARED');

    // Multiclass (contoh SRD): Ranger 4 / Sorcerer 3 → slot 4/3/2; tiap class menyiapkan seolah single-class.
    const multi = make(wizardDraft({ classId: 'class.ranger' }), [
      { classId: 'class.ranger', level: 4 },
      { classId: 'class.sorcerer', level: 3 },
    ]);
    const multiCasting = deriveSpellcasting(multi, catalog);
    expect(multiCasting.slots.map((slot) => [slot.level, slot.max])).toEqual([
      [1, 4],
      [2, 3],
      [3, 2],
    ]);
    expect(multiCasting.classes.map((entry) => [entry.classId, entry.preparedMax, entry.maxSpellLevel, entry.cantripsMax])).toEqual([
      ['class.ranger', 5, 1, 0],
      ['class.sorcerer', 6, 2, 4],
    ]);

    // ---------------------------------------------------------------- rests per class
    // Warlock 5: dua slot Pact Magic level 3, pulih pada Short Rest. Wizard: slot hanya pulih pada Long Rest.
    const warlock = make(wizardDraft({ classId: 'class.warlock' }), [{ classId: 'class.warlock', level: 5 }], { pactSlotsSpent: 2 });
    expect(deriveSpellcasting(warlock, catalog).pact).toEqual({ level: 3, max: 2, spent: 2, remaining: 0 });
    expect(applyRest(warlock, catalog, 'short').resources.pactSlotsSpent).toBe(0);
    expect(applyRest(caster, catalog, 'short').resources.slotsSpent[0]).toBe(2);
    expect(applyRest(caster, catalog, 'long').resources.slotsSpent[0]).toBe(0);

    // Fighter level 2, HP maks 13 + (10/2+1) + 2 + 1 = 22; luka 15 → HP 7. Short Rest: satu Hit Die d10 (roll 6) + Con 2 = 8.
    const hurt = make(fighterDraft(), [{ classId: 'class.fighter', level: 2 }], { hp: { damage: 15, temp: 3 } }, { spent: { 'class.fighter/second-wind': 2, 'class.fighter/action-surge': 1 } });
    expect(deriveCharacter(hurt, catalog).currentHitPoints).toBe(7);
    const short = applyRest(hurt, catalog, 'short', [{ classId: 'class.fighter', roll: 6 }]);
    expect(short.resources.hp.damage).toBe(7);
    expect(short.resources.hitDiceSpent).toEqual({ 'class.fighter': 1 });
    expect(short.featureState.spent).toEqual({ 'class.fighter/second-wind': 1 });
    expect(() => applyRest(hurt, catalog, 'short', [{ classId: 'class.fighter', roll: 11 }])).toThrow('INVALID_ROLL');
    expect(() => applyRest({ ...hurt, resources: { ...hurt.resources, hitDiceSpent: { 'class.fighter': 2 } } }, catalog, 'short', [{ classId: 'class.fighter', roll: 1 }])).toThrow('NO_HIT_DICE');
    // Long Rest: semua HP dan semua Hit Point Dice; Temporary HP berakhir ("last until depleted or you finish a Long Rest").
    expect(short.resources.hp.temp).toBe(3);
    const long = applyRest(short, catalog, 'long');
    expect(long.resources.hp).toEqual({ damage: 0, temp: 0 });
    expect(long.resources.hitDiceSpent).toEqual({});
    expect(long.featureState.spent).toEqual({});
    expect(long.featureState.heroicInspiration).toBe(false);
    // Human (Resourceful): Heroic Inspiration setiap selesai Long Rest.
    const human = make(fighterDraft({ speciesId: 'species.human', extraOriginFeatId: 'feat.alert', speciesSkills: ['athletics'] }), [{ classId: 'class.fighter', level: 1 }]);
    expect(applyRest(human, catalog, 'long').featureState.heroicInspiration).toBe(true);
    expect(applyRest(human, catalog, 'short').featureState.heroicInspiration).toBe(false);
    // Long Rest membuka kesempatan mengganti Weapon Mastery (Fighter: satu pilihan); Short Rest tidak.
    expect(applyRest(hurt, catalog, 'long').featureState.masteryChangeOpen).toBe(true);
    expect(applyRest(hurt, catalog, 'short').featureState.masteryChangeOpen).toBeFalsy();

    // Preview menyebut perubahan yang akan terjadi tanpa mengubah karakter.
    expect(previewRest(hurt, catalog, 'long').changes).toEqual(
      expect.arrayContaining([
        { key: 'hitPoints', before: 7, after: 22 },
        { key: 'class.fighter/second-wind', before: 0, after: 2 },
        { key: 'class.fighter/action-surge', before: 0, after: 1 },
      ]),
    );
    expect(hurt.resources.hp.damage).toBe(15);
  });
});
