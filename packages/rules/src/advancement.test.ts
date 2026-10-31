import { describe, expect, it } from 'vitest';
import { loadCatalog } from '#content/catalog';
import {
  ABILITIES,
  type AdvancementChoice,
  type Character,
  type CharacterDraft,
  emptyDraft,
  emptyFeatureState,
  emptyResources,
} from '#shared/characters';
import { advancementStatus, applyAdvancement, previewAdvancement } from './advancement.ts';
import { deriveCharacter } from './character-stats.ts';
import { availableFeatures } from './class-features.ts';

const catalog = loadCatalog();

/** Fighter Dwarf Soldier: Str 17, Dex 13, Con 15 (+2), Int 8, Wis 12, Cha 10; HP level 1 = 13. */
const brakkaDraft = (over: Partial<CharacterDraft> = {}): CharacterDraft => ({
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

const make = (draft: CharacterDraft, classLevels: Character['classLevels']): Character => ({
  id: 'char-1',
  campaignId: 'camp-1',
  ownerAccountId: 'acc-1',
  status: 'final',
  classLevels,
  draft,
  rolls: [],
  overrides: {},
  featureState: emptyFeatureState(),
  resources: emptyResources(),
  advancements: [],
  pendingAdvancement: null,
  revision: 1,
  updatedAt: '2026-10-31T00:00:00.000Z',
});

const fixed = (classId: string, over: Partial<AdvancementChoice> = {}): AdvancementChoice => ({ classId, hp: 'fixed', ...over });
const advance = (character: Character, choice: AdvancementChoice) => {
  const preview = previewAdvancement(character, choice, catalog);
  expect(preview.issues, `${choice.classId} → ${preview.level}`).toEqual([]);
  expect(preview.required, `${choice.classId} → ${preview.level}`).toEqual([]);
  return applyAdvancement(character, preview);
};

/** Tabel Character Advancement SRD: Proficiency Bonus per level karakter. */
const PROFICIENCY = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6];

describe('character advancement', () => {
  it('advances_all_srd_classes_and_multiclass', () => {
    // ---------------------------------------------------------------- Fighter 1 → 2: d10 tetap 6 + Con 2 + Dwarf 1
    let brakka = make(brakkaDraft(), [{ classId: 'class.fighter', level: 1 }]);
    const two = previewAdvancement(brakka, fixed('class.fighter'), catalog);
    expect(two).toMatchObject({ level: 2, classLevel: 2, multiclass: false, hitDie: 10, hpDie: 6, required: [], issues: [] });
    expect(two.before).toMatchObject({ level: 1, hitPoints: 13, proficiencyBonus: 2 });
    expect(two.after).toMatchObject({ level: 2, hitPoints: 22, proficiencyBonus: 2 });
    expect(two.newFeatures.map((feature) => feature.key)).toEqual(['class.fighter/action-surge', 'class.fighter/tactical-mind']);
    // Lemparan: nilai di luar 1–10 ditolak; preview tanpa lemparan belum bisa diterapkan.
    const rolled = previewAdvancement(brakka, { classId: 'class.fighter', hp: 'roll' }, catalog);
    expect(rolled.hpDie).toBeNull();
    expect(() => applyAdvancement(brakka, rolled)).toThrow('HP_ROLL_MISSING');
    expect(() => applyAdvancement(brakka, { ...rolled, hpDie: 11 })).toThrow('HP_ROLL_MISSING');
    expect(deriveCharacter(applyAdvancement(brakka, { ...rolled, hpDie: 3 }), catalog).hitPoints.value).toBe(13 + 3 + 2 + 1);
    brakka = applyAdvancement(brakka, two);
    expect(brakka.classLevels).toEqual([{ classId: 'class.fighter', level: 2 }]);
    expect(brakka.advancements).toEqual([{ level: 2, classId: 'class.fighter', hpDie: 6, hpMethod: 'fixed' }]);

    // ---------------------------------------------------------------- level 3: subclass wajib; tanpa pilihan tetap draft
    const three = previewAdvancement(brakka, fixed('class.fighter'), catalog);
    expect(three.required).toEqual(['subclass']);
    expect(() => applyAdvancement(brakka, three)).toThrow('ADVANCEMENT_INCOMPLETE');
    expect(previewAdvancement(brakka, fixed('class.fighter', { subclassId: 'subclass.thief' }), catalog).issues).toEqual(['SUBCLASS_INVALID:subclass.thief']);
    brakka = advance(brakka, fixed('class.fighter', { subclassId: 'subclass.champion' }));
    expect(brakka.classLevels).toEqual([{ classId: 'class.fighter', level: 3, subclassId: 'subclass.champion' }]);
    expect(availableFeatures(brakka, catalog).map((feature) => feature.key)).toContain('subclass.champion/improved-critical');
    // Subclass tidak boleh diganti setelah dipilih.
    expect(previewAdvancement(brakka, fixed('class.fighter', { subclassId: 'subclass.champion' }), catalog).issues).toEqual(['SUBCLASS_NOT_ALLOWED']);

    // ---------------------------------------------------------------- level 4: Ability Score Improvement (feat umum)
    const four = previewAdvancement(brakka, fixed('class.fighter'), catalog);
    expect(four).toMatchObject({ required: ['feat'], featCategory: 'general' });
    const asi = (increases: Record<string, number>) => fixed('class.fighter', { feat: { featId: 'feat.ability-score-improvement', increases } });
    expect(previewAdvancement(brakka, asi({ str: 1, dex: 1, con: 1 }), catalog).issues).toEqual(['FEAT_INCREASES:feat.ability-score-improvement']);
    // "or another feat of your choice for which you qualify": Epic Boon butuh level 19; origin feat boleh.
    expect(previewAdvancement(brakka, fixed('class.fighter', { feat: { featId: 'feat.boon-of-fate', increases: { str: 1 } } }), catalog).issues).toEqual(['FEAT_PREREQUISITE:feat.boon-of-fate']);
    expect(previewAdvancement(brakka, fixed('class.fighter', { feat: { featId: 'feat.alert', increases: {} } }), catalog).issues).toEqual([]);
    // Savage Attacker sudah dari background Soldier dan tidak Repeatable.
    expect(previewAdvancement(brakka, fixed('class.fighter', { feat: { featId: 'feat.savage-attacker', increases: {} } }), catalog).issues).toEqual(['FEAT_TAKEN:feat.savage-attacker']);
    expect(previewAdvancement(brakka, fixed('class.fighter', { feat: { featId: 'feat.grappler', increases: { con: 1 } } }), catalog).issues).toEqual(['FEAT_INCREASES:feat.grappler']);
    brakka = advance(brakka, asi({ str: 2 }));
    expect(deriveCharacter(brakka, catalog).abilities.str.score.value).toBe(19);
    expect(deriveCharacter(brakka, catalog).feats).toContain('feat.ability-score-improvement');
    brakka = advance(brakka, fixed('class.fighter'));
    // Fighter mendapat ASI tambahan di level 6; Strength tidak boleh lewat 20.
    expect(previewAdvancement(brakka, asi({ str: 2 }), catalog).issues).toEqual(['ABILITY_CAP:str']);
    // ASI bisa diulang (Repeatable).
    brakka = advance(brakka, asi({ str: 1, con: 1 }));
    expect(deriveCharacter(brakka, catalog).abilities.con.score.value).toBe(16);
    // Champion level 7: Additional Fighting Style → hanya feat Fighting Style.
    const seven = previewAdvancement(brakka, fixed('class.fighter'), catalog);
    expect(seven).toMatchObject({ required: ['feat'], featCategory: 'fighting-style' });
    expect(previewAdvancement(brakka, asi({ dex: 2 }), catalog).issues).toEqual(['FEAT_CATEGORY:feat.ability-score-improvement']);
    expect(previewAdvancement(brakka, fixed('class.fighter', { feat: { featId: 'feat.defense', increases: {} } }), catalog).issues).toEqual([]);

    // ---------------------------------------------------------------- multiclass: prerequisite 13 di primary ability
    expect(previewAdvancement(brakka, fixed('class.wizard'), catalog).issues).toEqual(['MULTICLASS_PREREQUISITE:class.wizard']);
    // Paladin: Strength dan Charisma 13+ (Cha 10 gagal).
    expect(previewAdvancement(brakka, fixed('class.paladin'), catalog).issues).toEqual(['MULTICLASS_PREREQUISITE:class.paladin']);
    const smart = make(brakkaDraft({ baseScores: { str: 15, dex: 13, con: 14, int: 13, wis: 12, cha: 10 } }), [{ classId: 'class.fighter', level: 4 }]);
    const dip = previewAdvancement(smart, fixed('class.wizard'), catalog);
    // Hit Points multiclass memakai nilai level berikutnya: d6 → 4.
    expect(dip).toMatchObject({ level: 5, classLevel: 1, multiclass: true, hitDie: 6, hpDie: 4, issues: [] });
    expect(dip.after.hitPoints - dip.before.hitPoints).toBe(4 + 2 + 1);
    expect(dip.after.slots).toEqual([2]);
    expect(dip.after.proficiencyBonus).toBe(3);
    // Rogue multiclass: satu skill dari daftar Rogue.
    expect(previewAdvancement(smart, fixed('class.rogue'), catalog).required).toEqual(['skill']);
    expect(previewAdvancement(smart, fixed('class.rogue', { skill: 'arcana' }), catalog).issues).toEqual(['SKILL_INVALID:arcana']);
    const rogue = advance(smart, fixed('class.rogue', { skill: 'stealth' }));
    expect(deriveCharacter(rogue, catalog).skills.stealth.sources).toContain('class.rogue');

    // Wizard → Fighter: Martial weapons, Light/Medium armor, Shields — bukan Heavy armor.
    const wizard = make(brakkaDraft({ classId: 'class.wizard', baseScores: { str: 13, dex: 14, con: 13, int: 15, wis: 12, cha: 8 } }), [{ classId: 'class.wizard', level: 1 }]);
    // Fitur level 1 Fighter ikut, termasuk Fighting Style (feat Fighting Style wajib).
    expect(previewAdvancement(wizard, fixed('class.fighter'), catalog)).toMatchObject({ required: ['feat'], featCategory: 'fighting-style' });
    const gish = advance(wizard, fixed('class.fighter', { feat: { featId: 'feat.defense', increases: {} } }));
    const gishSheet = deriveCharacter(gish, catalog);
    expect(gishSheet.armorTraining).toEqual(['light', 'medium', 'shield']);
    expect(gishSheet.weaponProficiencies.categories).toEqual(['simple', 'martial']);
    // Saving throw hanya dari class pertama.
    expect(gishSheet.savingThrows.str.proficient).toBe(false);
    expect(gish.classLevels).toEqual([
      { classId: 'class.wizard', level: 1 },
      { classId: 'class.fighter', level: 1 },
    ]);

    // ---------------------------------------------------------------- caster + Pact Magic
    const wizard4 = make(brakkaDraft({ classId: 'class.wizard' }), [{ classId: 'class.wizard', level: 4 }]);
    const wizard5 = previewAdvancement(wizard4, fixed('class.wizard'), catalog);
    expect(wizard5.before.slots).toEqual([4, 3]);
    expect(wizard5.after.slots).toEqual([4, 3, 2]);
    const warlock = make(brakkaDraft({ classId: 'class.warlock', baseScores: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 } }), [{ classId: 'class.warlock', level: 2 }]);
    const pactSorcerer = previewAdvancement(warlock, fixed('class.sorcerer'), catalog);
    expect(pactSorcerer.issues).toEqual([]);
    expect(pactSorcerer.after).toMatchObject({ slots: [2], pact: { level: 1, max: 2 } });

    // ---------------------------------------------------------------- batas level 20 dan Epic Boon di 19
    const veteran = make(brakkaDraft(), [{ classId: 'class.fighter', level: 18, subclassId: 'subclass.champion' }]);
    const nineteen = previewAdvancement(veteran, fixed('class.fighter'), catalog);
    expect(nineteen).toMatchObject({ required: ['feat'], featCategory: 'epic-boon' });
    // Level 19 juga boleh feat lain yang memenuhi syarat, termasuk ASI.
    expect(previewAdvancement(veteran, asi({ str: 2 }), catalog).issues).toEqual([]);
    expect(previewAdvancement(veteran, fixed('class.fighter', { feat: { featId: 'feat.boon-of-spell-recall', increases: { str: 1 } } }), catalog).issues).toEqual(['FEAT_INCREASES:feat.boon-of-spell-recall']);
    const boon = advance(veteran, fixed('class.fighter', { feat: { featId: 'feat.boon-of-irresistible-offense', increases: { str: 1 } } }));
    expect(deriveCharacter(boon, catalog).abilities.str.score.value).toBe(18);
    const capped = make(brakkaDraft(), [{ classId: 'class.fighter', level: 20 }]);
    expect(previewAdvancement(capped, fixed('class.fighter'), catalog).issues).toEqual(['LEVEL_CAP']);
    expect(previewAdvancement(capped, fixed('class.rogue'), catalog).issues).toContain('LEVEL_CAP');

    // ---------------------------------------------------------------- semua class SRD 1 → 20
    const subclassOf = (classId: string) =>
      catalog.ids().find((id) => id.startsWith('subclass.') && (catalog.getContent(id, 'en').mechanics as { class: string }).class === classId)!;
    const classes = catalog.ids().filter((id) => id.startsWith('class.'));
    for (const classId of classes) {
      let character = make(brakkaDraft({ classId, baseScores: { str: 15, dex: 15, con: 15, int: 15, wis: 15, cha: 15 } }), [{ classId, level: 1 }]);
      let round = 0;
      for (let level = 2; level <= 20; level++) {
        const preview = previewAdvancement(character, fixed(classId), catalog);
        const choice = fixed(classId);
        if (preview.required.includes('subclass')) choice.subclassId = subclassOf(classId);
        if (preview.featCategory === 'general') {
          const pair: [string, string] = [ABILITIES[round % 6]!, ABILITIES[(round + 1) % 6]!];
          round += 2;
          choice.feat = { featId: 'feat.ability-score-improvement', increases: { [pair[0]]: 1, [pair[1]]: 1 } };
        } else if (preview.featCategory === 'epic-boon') choice.feat = { featId: 'feat.boon-of-fate', increases: { cha: 1 } };
        else if (preview.featCategory === 'fighting-style') choice.feat = { featId: 'feat.defense', increases: {} };
        const next = previewAdvancement(character, choice, catalog);
        expect(next.after.proficiencyBonus, `${classId} ${level}`).toBe(PROFICIENCY[level - 1]);
        character = advance(character, choice);
      }
      const sheet = deriveCharacter(character, catalog);
      const die = (catalog.getContent(classId, 'en').mechanics as { hitDie: number }).hitDie;
      // HP: level 1 maksimum + 19 × nilai tetap + Con × 20 + Dwarven Toughness 20.
      expect(sheet.hitPoints.value, classId).toBe(die + 19 * (die / 2 + 1) + sheet.abilities.con.modifier * 20 + 20);
      const mechanics = (id: string) => catalog.getContent(id, 'en').mechanics as { features: unknown[] };
      const features = availableFeatures(character, catalog);
      expect(features.filter((feature) => feature.sourceId === classId).length, classId).toBe(
        // Extra Attack tidak bertumpuk, sisanya semua fitur class level 1–20.
        mechanics(classId).features.length,
      );
      expect(features.filter((feature) => feature.sourceId === subclassOf(classId)).length, classId).toBe(mechanics(subclassOf(classId)).features.length);
    }
  });

  it('gates_level_up_by_xp_milestone_and_starting_level', () => {
    expect(advancementStatus(1, { mode: 'xp', startingLevel: 1 }, { xp: 299, levelsGranted: 0 })).toMatchObject({ canAdvance: false, nextLevelXp: 300 });
    expect(advancementStatus(1, { mode: 'xp', startingLevel: 1 }, { xp: 300, levelsGranted: 0 }).canAdvance).toBe(true);
    // Level 5 → 6 butuh 14.000 XP.
    expect(advancementStatus(5, { mode: 'xp', startingLevel: 1 }, { xp: 13_999, levelsGranted: 0 })).toMatchObject({ canAdvance: false, nextLevelXp: 14_000 });
    expect(advancementStatus(3, { mode: 'milestone', startingLevel: 1 }, { xp: 0, levelsGranted: 0 }).canAdvance).toBe(false);
    expect(advancementStatus(3, { mode: 'milestone', startingLevel: 1 }, { xp: 0, levelsGranted: 1 }).canAdvance).toBe(true);
    // Mulai di level lebih tinggi: level up bebas sampai level awal campaign.
    expect(advancementStatus(1, { mode: 'milestone', startingLevel: 5 }, { xp: 0, levelsGranted: 0 }).canAdvance).toBe(true);
    expect(advancementStatus(5, { mode: 'milestone', startingLevel: 5 }, { xp: 0, levelsGranted: 0 }).canAdvance).toBe(false);
    expect(advancementStatus(20, { mode: 'xp', startingLevel: 1 }, { xp: 999_999, levelsGranted: 3 })).toMatchObject({ canAdvance: false, nextLevelXp: null });
  });
});
