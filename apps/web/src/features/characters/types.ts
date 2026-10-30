import type { AbilityMethod, Character, DerivedCharacter } from '#shared/characters';

/** Respons GET karakter: data tersimpan, sheet turunan dari server, dan metode yang diizinkan DM. */
export interface CharacterView {
  character: Character;
  derived: DerivedCharacter;
  allowedMethods: AbilityMethod[];
}
