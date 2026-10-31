import type { ContentCatalog } from '#shared/content';
import type { Id } from '#shared/contracts';
import { type Character, HEROIC_INSPIRATION, type RestPreview } from '#shared/characters';
import { availableFeatures, recoverFeatures } from './class-features.ts';
import { deriveCharacter } from './character-stats.ts';
import { deriveSpellcasting } from './spellcasting.ts';

/** Human, Resourceful: "You gain Heroic Inspiration whenever you finish a Long Rest." */
const RESOURCEFUL_SPECIES = 'species.human';

/** Satu Hit Point Die yang dilempar server saat Short Rest. */
export interface HitDieRoll {
  classId: Id;
  roll: number;
}

const fail = (code: string): never => {
  throw new Error(code);
};

/**
 * Hasil rest menurut rule.short-rest / rule.long-rest dan recovery per fitur.
 * Short Rest: Hit Point Dice yang dipakai (lemparan dari server), fitur Short Rest, slot Pact Magic.
 * Long Rest: semua HP dan Hit Point Dice, Temporary HP berakhir, semua slot dan fitur Long Rest.
 * Ruling: katalog ikut sebagai parameter karena recovery dan batas dibaca dari corpus.
 */
export function applyRest(character: Character, catalog: ContentCatalog, rest: 'short' | 'long', hitDiceRolls: HitDieRoll[] = []): Character {
  const derived = deriveCharacter(character, catalog);
  if (derived.currentHitPoints < 1) fail('REST_NEEDS_HP');
  const resources = character.resources;
  const featureState = recoverFeatures(character, catalog, rest);

  if (rest === 'long') {
    if (hitDiceRolls.length) fail('INVALID_ROLL');
    return {
      ...character,
      featureState: {
        ...featureState,
        heroicInspiration: featureState.heroicInspiration || character.draft.speciesId === RESOURCEFUL_SPECIES,
        // Weapon Mastery: "Whenever you finish a Long Rest" pilihan boleh diganti.
        masteryChangeOpen: true,
      },
      resources: {
        ...resources,
        hp: { damage: 0, temp: 0 },
        hitDiceSpent: {},
        slotsSpent: resources.slotsSpent.map(() => 0),
        pactSlotsSpent: 0,
      },
    };
  }

  const hitDiceSpent = { ...resources.hitDiceSpent };
  let healed = 0;
  const conModifier = derived.abilities.con.modifier;
  for (const { classId, roll } of hitDiceRolls) {
    const dice = derived.hitDice.find((entry) => entry.classId === classId);
    if (!dice || !Number.isInteger(roll) || roll < 1 || roll > dice.die) fail('INVALID_ROLL');
    const spent = hitDiceSpent[classId] ?? 0;
    if (spent >= dice!.max) fail('NO_HIT_DICE');
    hitDiceSpent[classId] = spent + 1;
    // "add your Constitution modifier ... (minimum of 1 Hit Point)".
    healed += Math.max(1, roll + conModifier);
  }
  return {
    ...character,
    featureState,
    resources: {
      ...resources,
      hp: { ...resources.hp, damage: Math.max(0, resources.hp.damage - healed) },
      hitDiceSpent,
      pactSlotsSpent: 0,
    },
  };
}

type Snapshot = Map<string, number | boolean>;

function snapshot(character: Character, catalog: ContentCatalog): Snapshot {
  const derived = deriveCharacter(character, catalog);
  const casting = deriveSpellcasting(character, catalog);
  const values: Snapshot = new Map();
  values.set('hitPoints', derived.currentHitPoints);
  values.set('temporaryHitPoints', derived.temporaryHitPoints);
  for (const dice of derived.hitDice) values.set(`hitDice:${dice.classId}`, dice.max - dice.spent);
  for (const slot of casting.slots) values.set(`slot:${slot.level}`, slot.remaining);
  if (casting.pact) values.set('pact', casting.pact.remaining);
  for (const feature of availableFeatures(character, catalog)) {
    if (!feature.resource) continue;
    values.set(feature.key, feature.key === HEROIC_INSPIRATION ? feature.resource.remaining > 0 : feature.resource.remaining);
  }
  return values;
}

/** Perubahan yang akan terjadi bila rest dikonfirmasi; karakter tidak diubah. */
export function previewRest(character: Character, catalog: ContentCatalog, rest: 'short' | 'long', hitDiceRolls: HitDieRoll[] = []): RestPreview {
  const before = snapshot(character, catalog);
  const after = snapshot(applyRest(character, catalog, rest, hitDiceRolls), catalog);
  const changes: RestPreview['changes'] = [];
  for (const [key, value] of after) {
    const previous = before.get(key);
    if (previous !== undefined && previous !== value) changes.push({ key, before: previous, after: value });
  }
  return { rest, changes };
}
