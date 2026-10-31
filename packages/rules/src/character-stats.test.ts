import { describe, expect, it } from 'vitest';
import { loadCatalog } from '#content/catalog';
import { type Character, type CharacterDraft, emptyDraft, emptyFeatureState, emptyResources } from '#shared/characters';
import {
  abilityModifier,
  pointBuyCost,
  rollAbilityScores,
  SKILL_ABILITIES,
  STANDARD_ARRAY,
  STANDARD_LANGUAGES,
  validateBaseScores,
} from './abilities.ts';
import { deriveCharacter } from './character-stats.ts';

const catalog = loadCatalog();

/** Fighter Dwarf Soldier, standard array, paket A (Chain Mail). Angka dihitung manual dari SRD 5.2.1. */
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

const character = (draft: CharacterDraft, over: Partial<Character> = {}): Character => ({
  id: 'char-1',
  campaignId: 'camp-1',
  ownerAccountId: 'acc-1',
  status: 'draft',
  classLevels: draft.classId ? [{ classId: draft.classId, level: 1 }] : [],
  draft,
  rolls: [],
  overrides: {},
  featureState: emptyFeatureState(),
  resources: emptyResources(),
  revision: 1,
  updatedAt: '2026-10-30T00:00:00.000Z',
  ...over,
});

describe('character stats', () => {
  it('derives_stats_from_origin_and_equipment', () => {
    expect(abilityModifier(16)).toBe(3);
    expect(abilityModifier(8)).toBe(-1);
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(1)).toBe(-5);
    expect(abilityModifier(30)).toBe(10);

    const sheet = deriveCharacter(character(fighterDraft()), catalog);
    expect(sheet.issues).toEqual([]);
    expect(sheet.warnings).toEqual([]);
    expect(sheet.level).toBe(1);
    expect(sheet.proficiencyBonus).toBe(2);
    // Background Soldier: +2 STR, +1 CON.
    expect(sheet.abilities.str.score.value).toBe(17);
    expect(sheet.abilities.str.score.contributions).toEqual([
      { source: 'base', value: 15 },
      { source: 'background.soldier', value: 2 },
    ]);
    expect(sheet.abilities.str.modifier).toBe(3);
    expect(sheet.abilities.con.score.value).toBe(15);
    // Saving throw Fighter: STR dan CON.
    expect(sheet.savingThrows.str).toMatchObject({ proficient: true, bonus: { value: 5 } });
    expect(sheet.savingThrows.dex).toMatchObject({ proficient: false, bonus: { value: 1 } });
    // Skill: Athletics/Intimidation dari background, Perception/Survival dari class.
    expect(sheet.skills.athletics).toMatchObject({ ability: 'str', proficient: true, sources: ['background.soldier'], bonus: { value: 5 } });
    expect(sheet.skills.perception).toMatchObject({ ability: 'wis', proficient: true, sources: ['class.fighter'], bonus: { value: 3 } });
    expect(sheet.skills.stealth).toMatchObject({ proficient: false, bonus: { value: 1 } });
    expect(sheet.passivePerception.value).toBe(13);
    // Chain Mail: AC 16, tanpa Dex; STR 17 memenuhi syarat 13.
    expect(sheet.armorClass).toEqual({ base: 16, value: 16, override: null, contributions: [{ source: 'equipment.chain-mail', value: 16 }] });
    // HP level 1: d10 maksimum + mod CON + Dwarven Toughness.
    expect(sheet.hitPoints.value).toBe(13);
    expect(sheet.hitPoints.contributions).toEqual([
      { source: 'class.fighter', value: 10 },
      { source: 'rule.ability-modifier', detail: 'con', value: 2 },
      { source: 'species.dwarf', value: 1 },
    ]);
    expect(sheet.initiative.value).toBe(1);
    expect(sheet.speed.value).toBe(30);
    expect(sheet.darkvision).toBe(120);
    expect(sheet.languages).toEqual(['Common', 'Dwarvish', 'Giant']);
    expect(sheet.feats).toEqual(['feat.savage-attacker']);
    expect(sheet.armorTraining).toEqual(['light', 'medium', 'heavy', 'shield']);
    expect(sheet.inventory).toContainEqual({ id: 'equipment.javelin', quantity: 8, sources: ['class.fighter'] });
    expect(sheet.gp).toBe(54);

    // Override DM tidak menghapus nilai dasar.
    const overridden = deriveCharacter(character(fighterDraft(), { overrides: { armorClass: 18 } }), catalog);
    expect(overridden.armorClass).toMatchObject({ base: 16, value: 18, override: 18 });

    // Syarat Strength Chain Mail tidak terpenuhi: Speed −10.
    const weak = deriveCharacter(character(fighterDraft({ backgroundIncrease: { mode: '1-1-1' }, baseScores: { str: 10, dex: 13, con: 14, int: 8, wis: 12, cha: 15 } })), catalog);
    expect(weak.warnings).toContainEqual({ code: 'ARMOR_STRENGTH', params: { armor: 'equipment.chain-mail', strength: 13 } });
    expect(weak.speed.value).toBe(20);

    // Cleric paket A: Chain Shirt (13 + Dex maks 2) + Shield (+2).
    const cleric = deriveCharacter(
      character(fighterDraft({ classId: 'class.cleric', classSkills: ['history', 'insight'], baseScores: { str: 12, dex: 14, con: 13, int: 8, wis: 15, cha: 10 }, equippedArmorId: 'equipment.chain-shirt', shieldEquipped: true })),
      catalog,
    );
    expect(cleric.armorClass.value).toBe(17);
    expect(cleric.armorClass.contributions).toEqual([
      { source: 'equipment.chain-shirt', value: 13 },
      { source: 'rule.ability-modifier', detail: 'dex', value: 2 },
      { source: 'equipment.shield', value: 2 },
    ]);

    // Wizard tanpa armor training memakai armor yang bukan miliknya: peringatan + masalah.
    const wizard = deriveCharacter(
      character(fighterDraft({ classId: 'class.wizard', classSkills: ['arcana', 'history'], classEquipment: 'A', equippedArmorId: 'equipment.chain-mail' })),
      catalog,
    );
    expect(wizard.warnings).toContainEqual({ code: 'ARMOR_UNTRAINED', params: { armor: 'equipment.chain-mail' } });
    expect(wizard.issues).toContainEqual({ field: 'equippedArmorId', code: 'NOT_ALLOWED' });
    // Tanpa armor: 10 + Dex.
    const unarmored = deriveCharacter(character(fighterDraft({ equippedArmorId: null })), catalog);
    expect(unarmored.armorClass.contributions).toEqual([
      { source: 'rule.base-ac', value: 10 },
      { source: 'rule.ability-modifier', detail: 'dex', value: 1 },
    ]);
  });

  it('requires_choices_before_final', () => {
    const blank = deriveCharacter(character(emptyDraft()), catalog);
    const fields = blank.issues.map((issue) => issue.field);
    for (const field of ['name', 'speciesId', 'backgroundId', 'classId', 'abilityMethod', 'backgroundIncrease', 'languages', 'classEquipment', 'backgroundEquipment']) {
      expect(fields).toContain(field);
    }
    const tooFewSkills = deriveCharacter(character(fighterDraft({ classSkills: ['perception'] })), catalog);
    expect(tooFewSkills.issues).toContainEqual({ field: 'classSkills', code: 'COUNT', params: { expected: 2 } });
    const wrongSkill = deriveCharacter(character(fighterDraft({ classSkills: ['perception', 'arcana'] })), catalog);
    expect(wrongSkill.issues).toContainEqual({ field: 'classSkills', code: 'INVALID', params: { value: 'arcana' } });
    const badIncrease = deriveCharacter(character(fighterDraft({ backgroundIncrease: { mode: '2-1', plus2: 'wis', plus1: 'con' } })), catalog);
    expect(badIncrease.issues).toContainEqual({ field: 'backgroundIncrease', code: 'INVALID', params: { value: 'wis' } });
    const noTool = deriveCharacter(character(fighterDraft({ toolChoices: [] })), catalog);
    expect(noTool.issues).toContainEqual({ field: 'toolChoices', code: 'COUNT', params: { expected: 1 } });
    // Elf wajib memilih satu skill Keen Senses.
    const elf = deriveCharacter(character(fighterDraft({ speciesId: 'species.elf', speciesSkills: ['arcana'] })), catalog);
    expect(elf.issues).toContainEqual({ field: 'speciesSkills', code: 'INVALID', params: { value: 'arcana' } });
  });

  it('validates_ability_generation_methods', () => {
    expect(STANDARD_ARRAY).toEqual([15, 14, 13, 12, 10, 8]);
    expect(validateBaseScores('standard-array', { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }, [])).toEqual([]);
    expect(validateBaseScores('standard-array', { str: 15, dex: 15, con: 13, int: 12, wis: 10, cha: 8 }, [])).not.toEqual([]);
    expect(pointBuyCost({ str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 })).toBe(27);
    expect(validateBaseScores('point-buy', { str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 }, [])).toEqual([]);
    expect(validateBaseScores('point-buy', { str: 15, dex: 15, con: 15, int: 9, wis: 8, cha: 8 }, [])).toContainEqual({ field: 'baseScores', code: 'INVALID', params: { cost: 28, budget: 27 } });
    expect(validateBaseScores('point-buy', { str: 16, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }, [])).not.toEqual([]);

    // Roll: 4d6 buang terendah, dicatat; score harus memakai total yang dicatat.
    const faces = [6, 5, 4, 1, 3, 3, 3, 3, 6, 6, 6, 6, 2, 2, 2, 2, 5, 4, 3, 2, 1, 1, 1, 6];
    let i = 0;
    const rolls = rollAbilityScores(() => faces[i++]!);
    expect(rolls.map((roll) => roll.total)).toEqual([15, 9, 18, 6, 12, 8]);
    expect(rolls[0]!.dice).toEqual([6, 5, 4, 1]);
    expect(validateBaseScores('roll', { str: 18, dex: 15, con: 12, int: 9, wis: 8, cha: 6 }, rolls)).toEqual([]);
    expect(validateBaseScores('roll', { str: 18, dex: 18, con: 12, int: 9, wis: 8, cha: 6 }, rolls)).not.toEqual([]);
    expect(validateBaseScores('roll', { str: 18, dex: 15, con: 12, int: 9, wis: 8, cha: 6 }, [])).toContainEqual({ field: 'rolls', code: 'REQUIRED' });
  });

  it('matches_srd_language_and_skill_tables', () => {
    // Data aturan di packages/rules dicocokkan dengan tabel SRD, bukan dengan dirinya sendiri.
    const creation = catalog.getContent('rule.create-your-character', 'en').body;
    const table = creation.slice(creation.indexOf('**Standard Languages**'), creation.indexOf('**Rare Languages**'));
    const srdLanguages = [...table.matchAll(/^\| [^|]+ \| ([^|]+) \|$/gm)].map((m) => m[1]!.trim()).filter((l) => l !== 'Language');
    expect(['Common', ...STANDARD_LANGUAGES]).toEqual(srdLanguages);

    const proficiency = catalog.getContent('rule.proficiency-overview', 'en').body;
    const rows = [...proficiency.matchAll(/^\| ([A-Z][^|]+?) \| (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) \| /gm)];
    expect(rows).toHaveLength(18);
    for (const [, skill, ability] of rows) {
      const key = skill!.toLowerCase().replace(/ /g, '-') as keyof typeof SKILL_ABILITIES;
      expect(SKILL_ABILITIES[key]).toBe(ability!.slice(0, 3).toLowerCase());
    }
  });
});
