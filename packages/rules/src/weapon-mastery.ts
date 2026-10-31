import type { ContentCatalog, ValidationResult } from '#shared/content';
import type { Id } from '#shared/contracts';
import type { Character, MasteryGrant } from '#shared/characters';

/** Bentuk mekanik corpus yang dibaca di sini (lihat ingest_characters.py / ingest_equipment.py). */
interface ClassMechanics {
  weaponProficiencies: { categories: string[]; martialWithProperty?: Id[] };
  progression: Array<{ level: number; columns?: Record<string, string> }>;
  features: Array<{ level: number; id: string }>;
}
interface WeaponMechanics {
  category: 'simple' | 'martial';
  type: 'melee' | 'ranged';
  properties?: Id[];
  mastery?: Id;
}

/**
 * Feature Weapon Mastery per class menurut teks SRD 5.2.1: Barbarian (Simple/Martial Melee) dan
 * Fighter (Simple/Martial) mengikuti kolom Weapon Mastery; Paladin, Ranger, Rogue dua jenis yang dikuasai.
 */
const MASTERY_RULES: Record<Id, { count: number | 'column'; restriction: MasteryGrant['restriction'] }> = {
  'class.barbarian': { count: 'column', restriction: 'melee' },
  'class.fighter': { count: 'column', restriction: 'simple-or-martial' },
  'class.paladin': { count: 2, restriction: 'proficient' },
  'class.ranger': { count: 2, restriction: 'proficient' },
  'class.rogue': { count: 2, restriction: 'proficient' },
};
const MASTERY_FEATURE = 'weapon-mastery';
const MASTERY_COLUMN = 'weapon-mastery';

function classMechanics(catalog: ContentCatalog, id: Id): ClassMechanics | null {
  if (!id.startsWith('class.') || !catalog.has(id)) return null;
  return catalog.getContent(id, 'en').mechanics as unknown as ClassMechanics | null;
}

export function weaponOf(catalog: ContentCatalog, id: Id): WeaponMechanics | null {
  if (!id.startsWith('equipment.') || !catalog.has(id)) return null;
  return ((catalog.getContent(id, 'en').mechanics as { weapon?: WeaponMechanics } | null)?.weapon ?? null);
}

/** Hak mastery dari setiap class yang sudah memiliki feature Weapon Mastery; grant tiap class terpisah. */
export function masteryGrants(character: Character, catalog: ContentCatalog): MasteryGrant[] {
  const grants: MasteryGrant[] = [];
  for (const { classId, level } of character.classLevels) {
    const rule = MASTERY_RULES[classId];
    const cls = classMechanics(catalog, classId);
    if (!rule || !cls?.features.some((feature) => feature.id === MASTERY_FEATURE && feature.level <= level)) continue;
    const column = Number.parseInt(cls.progression.find((step) => step.level === level)?.columns?.[MASTERY_COLUMN] ?? '', 10);
    const count = rule.count === 'column' ? (Number.isFinite(column) ? column : 0) : rule.count;
    if (count > 0) grants.push({ sourceId: classId, count, restriction: rule.restriction });
  }
  return grants;
}

function proficientWith(character: Character, catalog: ContentCatalog, weapon: WeaponMechanics): boolean {
  return character.classLevels.some(({ classId }) => {
    const proficiencies = classMechanics(catalog, classId)?.weaponProficiencies;
    if (!proficiencies) return false;
    if (proficiencies.categories.includes(weapon.category)) return true;
    return weapon.category === 'martial' && (proficiencies.martialWithProperty ?? []).some((property) => weapon.properties?.includes(property));
  });
}

function fits(grant: MasteryGrant, weapon: WeaponMechanics, character: Character, catalog: ContentCatalog): boolean {
  if (grant.restriction === 'melee') return weapon.type === 'melee';
  if (grant.restriction === 'proficient') return proficientWith(character, catalog, weapon);
  return true;
}

/**
 * Pilihan mastery valid bila setiap senjata punya properti mastery, cocok dengan salah satu grant,
 * dan seluruh pilihan dapat dibagi ke grant tanpa melebihi jumlahnya.
 */
export function validateWeaponMasteries(character: Character, weapons: Id[], catalog: ContentCatalog): ValidationResult {
  const fail = (...issues: string[]): ValidationResult => ({ ok: false, issues });
  if (new Set(weapons).size !== weapons.length) return fail('MASTERY_DUPLICATE');
  const grants = masteryGrants(character, catalog);
  if (weapons.length > grants.reduce((total, grant) => total + grant.count, 0)) return fail('MASTERY_COUNT');

  const candidates: number[][] = [];
  const issues: string[] = [];
  for (const id of weapons) {
    const weapon = weaponOf(catalog, id);
    if (!weapon?.mastery) {
      issues.push(`MASTERY_INVALID:${id}`);
      continue;
    }
    const fitting = grants.flatMap((grant, index) => (fits(grant, weapon, character, catalog) ? [index] : []));
    if (!fitting.length) issues.push(`MASTERY_NOT_ALLOWED:${id}`);
    candidates.push(fitting);
  }
  if (issues.length) return fail(...issues);

  // Pembagian ke grant: jumlah kecil (≤ 10 senjata), backtracking cukup.
  const remaining = grants.map((grant) => grant.count);
  const assign = (index: number): boolean => {
    if (index === candidates.length) return true;
    for (const grant of candidates[index]!) {
      if (remaining[grant]! <= 0) continue;
      remaining[grant]!--;
      if (assign(index + 1)) return true;
      remaining[grant]!++;
    }
    return false;
  };
  return assign(0) ? { ok: true, issues: [] } : fail('MASTERY_COUNT');
}
