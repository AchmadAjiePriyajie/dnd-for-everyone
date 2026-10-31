import { describe, expect, it } from 'vitest';
import { loadCatalog } from '#content/catalog';
import { type Character, type CharacterDraft, emptyDraft, emptyFeatureState, emptyResources, type FeatureState } from '#shared/characters';
import { availableFeatures, FEATURE_RULES, recoverFeatures, spendFeature, validateFeatureUse } from './class-features.ts';
import { masteryGrants, validateWeaponMasteries } from './weapon-mastery.ts';

const catalog = loadCatalog();

const draft = (over: Partial<CharacterDraft> = {}): CharacterDraft => ({
  ...emptyDraft(),
  name: 'Fixture',
  baseScores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  ...over,
});

const character = (
  classLevels: Character['classLevels'],
  state: Partial<FeatureState> = {},
  over: Partial<CharacterDraft> = {},
): Character => ({
  id: 'char-1',
  campaignId: 'camp-1',
  ownerAccountId: 'acc-1',
  status: 'final',
  classLevels,
  draft: draft({ classId: classLevels[0]?.classId ?? null, ...over }),
  rolls: [],
  overrides: {},
  featureState: { ...emptyFeatureState(), ...state },
  resources: emptyResources(),
  revision: 1,
  updatedAt: '2026-10-31T00:00:00.000Z',
});

const feature = (c: Character, key: string) => availableFeatures(c, catalog).find((use) => use.key === key);

// Angka di bawah dibaca dari teks/tabel SRD 5.2.1, bukan dari FEATURE_RULES.
describe('class features', () => {
  it('uses_2024_features_and_recovery', () => {
    const fighter2 = character([{ classId: 'class.fighter', level: 2 }]);
    // Second Wind: Bonus Action, dua kali; Short Rest memulihkan satu, Long Rest semua.
    expect(feature(fighter2, 'class.fighter/second-wind')).toMatchObject({
      action: 'bonus-action',
      automation: 'tracked',
      resource: { max: 2, spent: 0, remaining: 2, recovery: { short: 'one', long: 'all' } },
    });
    // Action Surge: sekali, kembali penuh pada Short atau Long Rest.
    expect(feature(fighter2, 'class.fighter/action-surge')?.resource).toMatchObject({ max: 1, recovery: { short: 'all', long: 'all' } });
    // Belum level: Indomitable baru level 9; fitur class lain tidak dimiliki.
    expect(feature(fighter2, 'class.fighter/indomitable')).toBeUndefined();
    expect(validateFeatureUse(fighter2, 'class.fighter/indomitable', catalog)).toEqual({ ok: false, issues: ['FEATURE_NOT_OWNED'] });
    expect(validateFeatureUse(fighter2, 'class.barbarian/rage', catalog)).toEqual({ ok: false, issues: ['FEATURE_NOT_OWNED'] });
    expect(validateFeatureUse(fighter2, 'class.fighter/unknown', catalog).ok).toBe(false);
    // Fitur pasif/naratif tetap terlihat dengan teks, tanpa tracker palsu.
    expect(feature(fighter2, 'class.fighter/fighting-style')).toMatchObject({ automation: 'manual', resource: null });
    expect(feature(fighter2, 'class.fighter/second-wind')?.text).toContain('1d10 plus your Fighter level');
    expect(availableFeatures(fighter2, catalog, 'id').find((use) => use.key === 'class.fighter/second-wind')?.originalName).toBe('Second Wind');

    // Pemakaian habis → ditolak; tidak menjadi negatif.
    let state = spendFeature(fighter2, 'class.fighter/action-surge', catalog);
    expect(state.spent['class.fighter/action-surge']).toBe(1);
    const surged = { ...fighter2, featureState: state };
    expect(validateFeatureUse(surged, 'class.fighter/action-surge', catalog)).toEqual({ ok: false, issues: ['NO_USES_LEFT'] });
    expect(() => spendFeature(surged, 'class.fighter/action-surge', catalog)).toThrow('NO_USES_LEFT');
    // Level 17: Action Surge dua kali.
    expect(feature(character([{ classId: 'class.fighter', level: 17 }]), 'class.fighter/action-surge')?.resource?.max).toBe(2);

    // Heroic Inspiration: punya atau tidak; dipakai satu kali.
    const inspired = character([{ classId: 'class.fighter', level: 1 }], { heroicInspiration: true });
    expect(validateFeatureUse(inspired, 'rule.heroic-inspiration', catalog).ok).toBe(true);
    state = spendFeature(inspired, 'rule.heroic-inspiration', catalog);
    expect(state.heroicInspiration).toBe(false);
    expect(validateFeatureUse({ ...inspired, featureState: state }, 'rule.heroic-inspiration', catalog)).toEqual({ ok: false, issues: ['NO_USES_LEFT'] });

    // Recovery tidak disamaratakan antar fitur/class.
    const tired = character([{ classId: 'class.fighter', level: 2 }], {
      spent: { 'class.fighter/second-wind': 2, 'class.fighter/action-surge': 1 },
    });
    expect(recoverFeatures(tired, catalog, 'short').spent).toEqual({ 'class.fighter/second-wind': 1 });
    expect(recoverFeatures(tired, catalog, 'long').spent).toEqual({});
    // Sorcery Points (Sorcerer level 2 = 2) hanya kembali pada Long Rest.
    const sorcerer = character([{ classId: 'class.sorcerer', level: 2 }], { spent: { 'class.sorcerer/font-of-magic': 2 } });
    expect(feature(sorcerer, 'class.sorcerer/font-of-magic')?.resource).toMatchObject({ max: 2, unit: 'points', recovery: { short: 'none' } });
    expect(recoverFeatures(sorcerer, catalog, 'short').spent).toEqual({ 'class.sorcerer/font-of-magic': 2 });
    expect(recoverFeatures(sorcerer, catalog, 'long').spent).toEqual({});
    // Bardic Inspiration: Charisma modifier (minimum sekali); Short Rest baru memulihkan setelah Font of Inspiration (level 5).
    const bard1 = character([{ classId: 'class.bard', level: 1 }], { spent: { 'class.bard/bardic-inspiration': 1 } });
    expect(feature(bard1, 'class.bard/bardic-inspiration')?.resource).toMatchObject({ max: 1, remaining: 0, recovery: { short: 'none', long: 'all' } });
    expect(recoverFeatures(bard1, catalog, 'short').spent).toEqual({ 'class.bard/bardic-inspiration': 1 });
    const bard5 = character([{ classId: 'class.bard', level: 5 }], { spent: { 'class.bard/bardic-inspiration': 3 } }, {
      baseScores: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 16 },
    });
    expect(feature(bard5, 'class.bard/bardic-inspiration')?.resource).toMatchObject({ max: 3, recovery: { short: 'all' } });
    expect(recoverFeatures(bard5, catalog, 'short').spent).toEqual({});
    // Lay On Hands: pool lima kali level Paladin; boleh dipakai sebagian.
    const paladin = character([{ classId: 'class.paladin', level: 3 }]);
    expect(feature(paladin, 'class.paladin/lay-on-hands')?.resource).toMatchObject({ max: 15, unit: 'points' });
    expect(spendFeature(paladin, 'class.paladin/lay-on-hands', catalog, 4).spent['class.paladin/lay-on-hands']).toBe(4);
    expect(validateFeatureUse(paladin, 'class.paladin/lay-on-hands', catalog, 16).issues).toEqual(['NO_USES_LEFT']);
    expect(validateFeatureUse(fighter2, 'class.fighter/second-wind', catalog, 2).issues).toEqual(['AMOUNT_NOT_ALLOWED']);

    // Fitur subclass memakai resource class: Preserve Life menghabiskan Channel Divinity.
    const cleric = character([{ classId: 'class.cleric', level: 3, subclassId: 'subclass.life-domain' }]);
    expect(feature(cleric, 'subclass.life-domain/preserve-life')).toMatchObject({ action: 'magic-action', cost: { resource: 'class.cleric/channel-divinity', amount: 1 } });
    state = spendFeature(cleric, 'subclass.life-domain/preserve-life', catalog);
    expect(state.spent).toEqual({ 'class.cleric/channel-divinity': 1 });
    expect(feature(character([{ classId: 'class.cleric', level: 3 }]), 'subclass.life-domain/preserve-life')).toBeUndefined();

    // Duplicate grant: Extra Attack dari dua class tidak bertumpuk; mastery tiap class tetap terpisah.
    const multi = character([
      { classId: 'class.fighter', level: 5 },
      { classId: 'class.ranger', level: 5 },
    ]);
    expect(availableFeatures(multi, catalog).filter((use) => use.featureId === 'extra-attack')).toHaveLength(1);
    expect(masteryGrants(multi, catalog).map((grant) => [grant.sourceId, grant.count])).toEqual([
      // Tabel Fighter: Weapon Mastery 4 mulai level 4.
      ['class.fighter', 4],
      ['class.ranger', 2],
    ]);
  });

  it('validates_weapon_mastery_choices', () => {
    const fighter = character([{ classId: 'class.fighter', level: 1 }]);
    expect(validateWeaponMasteries(fighter, ['equipment.longsword', 'equipment.longbow', 'equipment.dagger'], catalog)).toEqual({ ok: true, issues: [] });
    expect(validateWeaponMasteries(fighter, ['equipment.longsword', 'equipment.longbow', 'equipment.dagger', 'equipment.club'], catalog).issues).toEqual(['MASTERY_COUNT']);
    expect(validateWeaponMasteries(fighter, ['equipment.dagger', 'equipment.dagger'], catalog).issues).toEqual(['MASTERY_DUPLICATE']);
    expect(validateWeaponMasteries(fighter, ['equipment.rope'], catalog).issues).toEqual(['MASTERY_INVALID:equipment.rope']);
    // Barbarian: hanya senjata Melee.
    const barbarian = character([{ classId: 'class.barbarian', level: 1 }]);
    expect(validateWeaponMasteries(barbarian, ['equipment.longbow'], catalog).issues).toEqual(['MASTERY_NOT_ALLOWED:equipment.longbow']);
    // Rogue: hanya senjata yang dikuasai (Simple, atau Martial dengan Finesse/Light).
    const rogue = character([{ classId: 'class.rogue', level: 1 }]);
    expect(validateWeaponMasteries(rogue, ['equipment.dagger', 'equipment.rapier'], catalog).ok).toBe(true);
    expect(validateWeaponMasteries(rogue, ['equipment.greataxe'], catalog).issues).toEqual(['MASTERY_NOT_ALLOWED:equipment.greataxe']);
    // Wizard tidak punya Weapon Mastery.
    const wizard = character([{ classId: 'class.wizard', level: 1 }]);
    expect(validateWeaponMasteries(wizard, ['equipment.dagger'], catalog).issues).toEqual(['MASTERY_COUNT']);
    expect(masteryGrants(wizard, catalog)).toEqual([]);
    // Jumlah mengikuti kolom Weapon Mastery (Barbarian level 4 = 3).
    expect(masteryGrants(character([{ classId: 'class.barbarian', level: 4 }]), catalog)[0]?.count).toBe(3);
  });

  it('references_every_class_feature_in_corpus', () => {
    const classes = catalog.ids().filter((id) => id.startsWith('class.'));
    expect(classes).toHaveLength(12);
    for (const id of classes) {
      const mechanics = catalog.getContent(id, 'en').mechanics as { progression: Array<{ level: number; proficiencyBonus: number }>; features: Array<{ level: number; id: string }> };
      expect(mechanics.progression.map((step) => step.level), id).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
      expect(mechanics.features.length, id).toBeGreaterThan(0);
    }
    const subclasses = catalog.ids().filter((id) => id.startsWith('subclass.'));
    for (const id of subclasses) {
      const parent = (catalog.getContent(id, 'en').mechanics as { class: string }).class;
      expect(classes, id).toContain(parent);
    }
    // Setiap fitur class/subclass level 20 punya teks referensi di kedua locale, dan setiap aturan menunjuk fitur nyata.
    const known = new Set<string>();
    for (const id of [...classes, ...subclasses]) {
      const parent = id.startsWith('class.') ? id : (catalog.getContent(id, 'en').mechanics as { class: string }).class;
      const c = character([{ classId: parent, level: 20, ...(id.startsWith('subclass.') ? { subclassId: id } : {}) }]);
      for (const locale of ['en', 'id'] as const) {
        for (const use of availableFeatures(c, catalog, locale).filter((entry) => entry.sourceId === id)) {
          expect(use.text.length, `${use.key} ${locale}`).toBeGreaterThan(20);
          known.add(use.key);
        }
      }
    }
    for (const key of Object.keys(FEATURE_RULES)) expect(known, key).toContain(key);
  });
});
