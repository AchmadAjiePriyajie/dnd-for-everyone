import type { AbilityMethod, Character, DerivedCharacter, FeatureUse, MasteryGrant } from '#shared/characters';

/** Respons GET karakter: data tersimpan, sheet turunan dari server, dan metode yang diizinkan DM. */
export interface CharacterView {
  character: Character;
  derived: DerivedCharacter;
  features: FeatureUse[];
  masteryGrants: MasteryGrant[];
  allowedMethods: AbilityMethod[];
}
