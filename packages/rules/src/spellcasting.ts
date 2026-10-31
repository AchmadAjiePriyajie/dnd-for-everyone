import type { ContentCatalog, ValidationResult } from '#shared/content';
import type { Id } from '#shared/contracts';
import type { AbilityKey, Character, CharacterResources, SpellcastingState } from '#shared/characters';
import { deriveCharacter } from './character-stats.ts';

/** Spellcasting Ability per class (teks fitur Spellcasting/Pact Magic SRD 5.2.1). */
const SPELLCASTING_ABILITY: Record<Id, AbilityKey> = {
  'class.bard': 'cha',
  'class.cleric': 'wis',
  'class.druid': 'wis',
  'class.paladin': 'cha',
  'class.ranger': 'wis',
  'class.sorcerer': 'cha',
  'class.warlock': 'cha',
  'class.wizard': 'int',
};
/** rule.multiclassing: semua level Bard/Cleric/Druid/Sorcerer/Wizard + setengah (dibulatkan ke atas) Paladin/Ranger. */
const FULL_CASTERS = new Set(['class.bard', 'class.cleric', 'class.druid', 'class.sorcerer', 'class.wizard']);
const HALF_CASTERS = new Set(['class.paladin', 'class.ranger']);
const PACT_CASTER = 'class.warlock';
const WIZARD = 'class.wizard';
/** Tabel Multiclass Spellcaster sama dengan kolom slot class full caster; dibaca dari progression Wizard. */
const MULTICLASS_TABLE = WIZARD;

interface ClassMechanics {
  progression: Array<{ level: number; spellSlots?: number[]; columns?: Record<string, string> }>;
}
interface SpellMechanics {
  level: number;
  classes: Id[];
  duration: { concentration: boolean };
}

const fail = (code: string): never => {
  throw new Error(code);
};

function step(catalog: ContentCatalog, classId: Id, level: number) {
  const mechanics = catalog.has(classId) ? (catalog.getContent(classId, 'en').mechanics as unknown as ClassMechanics) : null;
  return mechanics?.progression.find((entry) => entry.level === level) ?? null;
}

const column = (value: string | undefined) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

function spellOf(catalog: ContentCatalog, id: Id): SpellMechanics | null {
  if (!id.startsWith('spell.') || !catalog.has(id)) return null;
  return catalog.getContent(id, 'en').mechanics as unknown as SpellMechanics;
}

function slotTable(character: Character, catalog: ContentCatalog): number[] {
  const casters = character.classLevels.filter(({ classId }) => FULL_CASTERS.has(classId) || HALF_CASTERS.has(classId));
  if (casters.length === 1) return step(catalog, casters[0]!.classId, casters[0]!.level)?.spellSlots ?? [];
  if (!casters.length) return [];
  const casterLevel = casters.reduce((total, { classId, level }) => total + (HALF_CASTERS.has(classId) ? Math.ceil(level / 2) : level), 0);
  return step(catalog, MULTICLASS_TABLE, Math.min(20, casterLevel))?.spellSlots ?? [];
}

/** Class spellcasting, slot gabungan, Pact Magic dan pilihan spell beserta masalahnya. */
export function deriveSpellcasting(character: Character, catalog: ContentCatalog): SpellcastingState {
  const derived = deriveCharacter(character, catalog);
  const resources = character.resources;
  const classes: SpellcastingState['classes'] = [];
  let pact: SpellcastingState['pact'] = null;
  for (const { classId, level } of character.classLevels) {
    const ability = SPELLCASTING_ABILITY[classId];
    const progression = step(catalog, classId, level);
    if (!ability || !progression) continue;
    const modifier = derived.abilities[ability].modifier;
    const chosen = resources.spells.find((entry) => entry.classId === classId);
    const slots = progression.spellSlots ?? [];
    const maxSpellLevel = classId === PACT_CASTER ? column(progression.columns?.['slot-level']) : slots.reduce((max, count, index) => (count > 0 ? index + 1 : max), 0);
    classes.push({
      classId,
      ability,
      saveDc: 8 + derived.proficiencyBonus + modifier,
      attackBonus: derived.proficiencyBonus + modifier,
      cantripsMax: column(progression.columns?.cantrips),
      preparedMax: column(progression.columns?.['prepared-spells']),
      maxSpellLevel,
      cantrips: chosen?.cantrips ?? [],
      prepared: chosen?.prepared ?? [],
    });
    if (classId === PACT_CASTER) {
      const max = column(progression.columns?.['spell-slots']);
      const spent = Math.min(resources.pactSlotsSpent, max);
      pact = { level: maxSpellLevel, max, spent, remaining: max - spent };
    }
  }
  const slots = slotTable(character, catalog).flatMap((max, index) => {
    if (max <= 0) return [];
    const spent = Math.min(resources.slotsSpent[index] ?? 0, max);
    return [{ level: index + 1, max, spent, remaining: max - spent }];
  });
  const isWizard = classes.some((entry) => entry.classId === WIZARD);
  return {
    classes,
    spellbook: isWizard ? resources.spellbook : null,
    slots,
    pact,
    concentration: resources.concentration,
    issues: spellIssues(character, catalog, classes),
  };
}

function spellIssues(character: Character, catalog: ContentCatalog, classes: SpellcastingState['classes']): string[] {
  const issues: string[] = [];
  const resources = character.resources;
  const wizard = classes.find((entry) => entry.classId === WIZARD);
  for (const chosen of resources.spells) {
    const caster = classes.find((entry) => entry.classId === chosen.classId);
    if (!caster) {
      issues.push(`NOT_A_CASTER:${chosen.classId}`);
      continue;
    }
    const check = (id: Id, cantrip: boolean): string | null => {
      const spell = spellOf(catalog, id);
      if (!spell) return 'SPELL_UNKNOWN';
      if (cantrip && spell.level !== 0) return 'SPELL_NOT_CANTRIP';
      if (!cantrip && spell.level === 0) return 'SPELL_NOT_LEVELED';
      if (!spell.classes.includes(chosen.classId)) return 'SPELL_NOT_ON_LIST';
      if (!cantrip && spell.level > caster.maxSpellLevel) return 'SPELL_LEVEL';
      if (!cantrip && chosen.classId === WIZARD && !resources.spellbook.includes(id)) return 'SPELL_NOT_IN_SPELLBOOK';
      return null;
    };
    for (const [list, cantrip] of [[chosen.cantrips, true], [chosen.prepared, false]] as const) {
      if (new Set(list).size !== list.length) issues.push(`SPELL_DUPLICATE:${chosen.classId}`);
      for (const id of list) {
        const issue = check(id, cantrip);
        if (issue) issues.push(`${issue}:${id}`);
      }
    }
    if (chosen.cantrips.length > caster.cantripsMax) issues.push(`CANTRIP_COUNT:${chosen.classId}`);
    if (chosen.prepared.length > caster.preparedMax) issues.push(`PREPARED_COUNT:${chosen.classId}`);
  }
  if (!wizard && resources.spellbook.length) issues.push('SPELLBOOK_NOT_ALLOWED');
  for (const id of wizard ? resources.spellbook : []) {
    const spell = spellOf(catalog, id);
    if (!spell || spell.level === 0 || !spell.classes.includes(WIZARD) || spell.level > wizard!.maxSpellLevel) issues.push(`SPELLBOOK_INVALID:${id}`);
  }
  return issues;
}

/** Validasi pilihan spell (cantrip, prepared, spellbook) terhadap daftar class dan level. */
export function validateSpells(character: Character, catalog: ContentCatalog): ValidationResult {
  const issues = deriveSpellcasting(character, catalog).issues;
  return { ok: issues.length === 0, issues };
}

/** Pakai satu slot (atau slot Pact Magic); tidak pernah di bawah nol. */
export function spendSlot(character: Character, catalog: ContentCatalog, level: number, pact = false): CharacterResources {
  const state = deriveSpellcasting(character, catalog);
  const resources = character.resources;
  if (pact) {
    if (!state.pact || state.pact.level !== level || state.pact.remaining < 1) fail('NO_SLOT_LEFT');
    return { ...resources, pactSlotsSpent: resources.pactSlotsSpent + 1 };
  }
  const slot = state.slots.find((entry) => entry.level === level);
  if (!slot || slot.remaining < 1) fail('NO_SLOT_LEFT');
  const slotsSpent = [...resources.slotsSpent];
  slotsSpent[level - 1] = (slotsSpent[level - 1] ?? 0) + 1;
  return { ...resources, slotsSpent };
}

/** Mulai Concentration pada spell yang disiapkan (mengakhiri yang lama), atau akhiri dengan null. */
export function setConcentration(character: Character, catalog: ContentCatalog, spellId: Id | null): CharacterResources {
  if (spellId !== null) {
    const known = character.resources.spells.some((entry) => entry.cantrips.includes(spellId) || entry.prepared.includes(spellId));
    if (!known) fail('SPELL_NOT_PREPARED');
    if (!spellOf(catalog, spellId)?.duration.concentration) fail('NOT_CONCENTRATION');
  }
  return { ...character.resources, concentration: spellId };
}
