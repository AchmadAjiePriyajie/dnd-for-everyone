import { describe, expect, it } from 'vitest';
import { type CatalogInput, ContentNotFoundError, createCatalog, loadCatalog, numberSignature, sourceHash } from './catalog.ts';
import type { EnRecord } from './schema.ts';

const fireballMechanics = {
  level: 3,
  school: 'evocation',
  classes: ['class.sorcerer', 'class.wizard'],
  castingTime: { amount: 1, unit: 'action' },
  ritual: false,
  range: { type: 'feet', distance: 150 },
  components: { verbal: true, somatic: true, material: true },
  duration: { type: 'instantaneous', concentration: false },
};

const en: EnRecord[] = [
  {
    id: 'spell.fireball',
    name: 'Fireball',
    body: 'Each creature in a 20-foot-radius Sphere makes a Dexterity saving throw, taking 8d6 Fire damage. See [Sphere](ref:rule.sphere).',
    mechanics: fireballMechanics,
    refs: ['class.wizard'],
    source: { section: 'Spells', page: 140 },
  },
  { id: 'rule.sphere', name: 'Sphere', body: 'A Sphere is an area of effect.', source: { section: 'Rules Glossary', page: 189 } },
  { id: 'class.wizard', name: 'Wizard', body: 'Wizards study arcane magic.', mechanics: {}, source: { section: 'Classes', page: 77 } },
];

const translate = (record: EnRecord, name: string, body: string) => ({ id: record.id, name, body, sourceHash: sourceHash(record) });

const manifestFor = (ids: string[]): CatalogInput['manifest'] => ({
  source: {
    title: 'System Reference Document 5.2.1',
    version: '5.2.1',
    license: 'CC-BY-4.0',
    url: 'https://www.dndbeyond.com/srd',
    sha256: '0'.repeat(64),
    pages: 364,
  },
  entries: ids.map((id) => ({ id, name: id, section: 'Test', page: 1 })),
});

function cleanInput(): CatalogInput {
  return {
    manifest: manifestFor(en.map((r) => r.id)),
    en: structuredClone(en),
    id: [
      translate(
        en[0]!,
        'Bola Api',
        'Setiap makhluk dalam Sphere berjari-jari 20 kaki melakukan saving throw Dexterity, menerima 8d6 damage Fire. Lihat [Sphere](ref:rule.sphere).',
      ),
      translate(en[1]!, 'Sphere', 'Sphere adalah area of effect.'),
      translate(en[2]!, 'Wizard', 'Wizard mempelajari sihir arcane.'),
    ],
  };
}

describe('content catalog', () => {
  it('requires_all_manifest_entries_in_both_locales', () => {
    // Gate corpus nyata: manifest SRD 5.2.1 lengkap dalam EN dan ID.
    const audit = loadCatalog().auditContent();
    expect(audit.missingIds).toEqual([]);
    expect(audit.missingLocales).toEqual([]);
    expect(audit.invalidReferences).toEqual([]);
    expect(audit.mechanicMismatches).toEqual([]);
  });

  it('audits_a_complete_bilingual_catalog_as_clean', () => {
    expect(createCatalog(cleanInput()).auditContent()).toEqual({
      missingIds: [],
      missingLocales: [],
      invalidReferences: [],
      mechanicMismatches: [],
    });
  });

  it('reports_missing_unexpected_and_untranslated_entries', () => {
    const input = cleanInput();
    input.manifest = manifestFor(['spell.fireball', 'rule.sphere', 'class.wizard', 'spell.wish']);
    input.en.push({ id: 'rule.extra', name: 'Extra', body: 'Not in SRD.', source: { section: 'X', page: 1 } });
    input.id = input.id.filter((r) => r.id !== 'rule.sphere');
    const audit = createCatalog(input).auditContent();
    expect(audit.missingIds).toEqual(['spell.wish: missing (spell.wish, Test, p.1)', 'rule.extra: not in manifest']);
    expect(audit.missingLocales).toEqual(['rule.sphere: id missing', 'rule.extra: id missing']);
  });

  it('marks_translation_stale_when_source_text_changes', () => {
    const input = cleanInput();
    input.en[1]!.body = 'A Sphere is an area of effect that extends from a point.';
    const catalog = createCatalog(input);
    expect(catalog.auditContent().missingLocales).toEqual(['rule.sphere: id stale']);
    const entry = catalog.getContent('rule.sphere', 'id');
    expect(entry.translation).toBe('fallback');
    expect(entry.body).toBe(input.en[1]!.body);
  });

  it('detects_changed_numbers_and_dice_in_translation', () => {
    const input = cleanInput();
    input.id[0]!.body = input.id[0]!.body.replace('8d6', '6d8').replace('20 kaki', '30 kaki');
    const [problem] = createCatalog(input).auditContent().mechanicMismatches;
    expect(problem).toMatch(/^spell\.fireball: id numbers differ/);
    // Pemisah ribuan/desimal boleh beda format antar locale.
    expect(numberSignature('costs 1,000 GP or 1.5 lb.')).toBe(numberSignature('seharga 1.000 GP atau 1,5 lb.'));
  });

  it('validates_mechanics_and_references', () => {
    const input = cleanInput();
    input.en[0]!.mechanics = { ...fireballMechanics, level: 12 };
    input.en[0]!.refs = ['class.wizard', 'class.artificer'];
    input.en[1]!.mechanics = { area: 'sphere' };
    const audit = createCatalog(input).auditContent();
    expect(audit.mechanicMismatches).toEqual(
      expect.arrayContaining([expect.stringMatching(/^spell\.fireball: mechanics\.level/), 'rule.sphere: kind has no mechanics']),
    );
    expect(audit.invalidReferences).toEqual(['spell.fireball: unknown ref class.artificer']);
  });

  it('serves_localized_text_with_shared_mechanics', () => {
    const catalog = createCatalog(cleanInput());
    const enEntry = catalog.getContent('spell.fireball', 'en');
    const idEntry = catalog.getContent('spell.fireball', 'id');
    expect(idEntry).toMatchObject({ name: 'Bola Api', originalName: 'Fireball', translation: 'translated', kind: 'spell' });
    expect(enEntry.translation).toBe('source');
    expect(idEntry.mechanics).toEqual(enEntry.mechanics);
    expect(idEntry.source).toEqual({ ruleset: 'srd-5.2.1-2024', section: 'Spells', page: 140, license: 'CC-BY-4.0' });
    expect(() => catalog.getContent('spell.nope', 'en')).toThrow(ContentNotFoundError);
  });
});
