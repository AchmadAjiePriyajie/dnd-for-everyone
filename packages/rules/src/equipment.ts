import type { ContentCatalog, ValidationResult } from '#shared/content';
import type { Id } from '#shared/contracts';
import { type Character, type CharacterResources, type Coin, COINS, type InventoryEntry } from '#shared/characters';
import { availableFeatures } from './class-features.ts';
import { deriveCharacter } from './character-stats.ts';

const SHIELD_ID = 'equipment.shield';
/** rule.attunement: "no more than three magic items at a time". */
const ATTUNEMENT_LIMIT = 3;
/** Thief level 13 (Use Magic Device): "attune to up to four magic items at once". */
const USE_MAGIC_DEVICE = 'subclass.thief/use-magic-device';
const USE_MAGIC_DEVICE_LIMIT = 4;

interface MagicItemMechanics {
  attunement?: boolean;
  attunementBy?: Id[];
}

const fail = (code: string): never => {
  throw new Error(code);
};

/**
 * Resource awal karakter final: paket equipment dan gp dari wizard menjadi inventory yang bisa diubah.
 * Karakter yang sudah diinisialisasi dikembalikan apa adanya.
 */
export function startingResources(character: Character, catalog: ContentCatalog): CharacterResources {
  if (character.resources.initialized) return character.resources;
  const derived = deriveCharacter(character, catalog);
  return {
    ...character.resources,
    initialized: true,
    inventory: derived.inventory.map((item, index) => ({
      entryId: `item-${index + 1}`,
      itemId: item.id,
      ...(item.custom ? { custom: item.custom } : {}),
      quantity: item.quantity,
      ...(item.note ? { note: item.note } : {}),
    })),
    coins: { ...character.resources.coins, gp: character.resources.coins.gp + derived.gp },
  };
}

export function addItem(
  resources: CharacterResources,
  item: { itemId?: Id; custom?: string; quantity: number; note?: string },
  entryId: string,
): CharacterResources {
  if (!Number.isInteger(item.quantity) || item.quantity < 1) fail('INVENTORY_NEGATIVE');
  if (!item.itemId === !item.custom) fail('INVALID_ITEM');
  if (resources.inventory.some((entry) => entry.entryId === entryId)) fail('ENTRY_EXISTS');
  const entry: InventoryEntry = {
    entryId,
    itemId: item.itemId ?? null,
    ...(item.custom ? { custom: item.custom } : {}),
    quantity: item.quantity,
    ...(item.note ? { note: item.note } : {}),
  };
  return { ...resources, inventory: [...resources.inventory, entry] };
}

/** Ubah jumlah; hasil negatif ditolak, tepat nol menghapus baris. */
export function adjustItem(resources: CharacterResources, entryId: string, delta: number): CharacterResources {
  const entry = resources.inventory.find((candidate) => candidate.entryId === entryId) ?? fail('ENTRY_NOT_FOUND');
  const quantity = entry.quantity + delta;
  if (!Number.isInteger(delta) || quantity < 0) fail('INVENTORY_NEGATIVE');
  const inventory =
    quantity === 0
      ? resources.inventory.filter((candidate) => candidate.entryId !== entryId)
      : resources.inventory.map((candidate) => (candidate.entryId === entryId ? { ...candidate, quantity } : candidate));
  return { ...resources, inventory };
}

export function adjustCoins(resources: CharacterResources, coin: Coin, delta: number): CharacterResources {
  const amount = resources.coins[coin] + delta;
  if (!Number.isInteger(delta) || amount < 0) fail('COINS_NEGATIVE');
  return { ...resources, coins: { ...resources.coins, [coin]: amount } };
}

function attunementLimit(character: Character, catalog: ContentCatalog): number {
  return availableFeatures(character, catalog).some((feature) => feature.key === USE_MAGIC_DEVICE) ? USE_MAGIC_DEVICE_LIMIT : ATTUNEMENT_LIMIT;
}

/** Masalah attunement satu item, atau null bila boleh. */
function attunementIssue(character: Character, itemId: Id | null, catalog: ContentCatalog): string | null {
  const mechanics = itemId?.startsWith('magic-item.') && catalog.has(itemId) ? (catalog.getContent(itemId, 'en').mechanics as MagicItemMechanics | null) : null;
  if (!mechanics?.attunement) return 'ATTUNEMENT_NOT_REQUIRED';
  if (mechanics.attunementBy && !character.classLevels.some(({ classId }) => mechanics.attunementBy!.includes(classId))) return 'ATTUNEMENT_CLASS';
  return null;
}

export function setAttunement(character: Character, entryId: string, attuned: boolean, catalog: ContentCatalog): CharacterResources {
  const resources = character.resources;
  const entry = resources.inventory.find((candidate) => candidate.entryId === entryId) ?? fail('ENTRY_NOT_FOUND');
  if (attuned) {
    const issue = attunementIssue(character, entry.itemId, catalog);
    if (issue) fail(issue);
    const count = resources.inventory.filter((candidate) => candidate.attuned && candidate.entryId !== entryId).length;
    if (count >= attunementLimit(character, catalog)) fail('ATTUNEMENT_LIMIT');
  }
  const inventory = resources.inventory.map((candidate) => {
    if (candidate.entryId !== entryId) return candidate;
    const { attuned: _previous, ...rest } = candidate;
    return attuned ? { ...rest, attuned: true } : rest;
  });
  return { ...resources, inventory };
}

/** Loadout konsisten: jumlah tidak negatif, attunement sah, armor/shield yang dipakai memang dibawa. */
export function validateLoadout(character: Character, catalog: ContentCatalog): ValidationResult {
  const resources = startingResources(character, catalog);
  const issues: string[] = [];
  for (const entry of resources.inventory) {
    if (!Number.isInteger(entry.quantity) || entry.quantity < 0) issues.push(`INVENTORY_NEGATIVE:${entry.entryId}`);
  }
  for (const coin of COINS) if (resources.coins[coin] < 0) issues.push(`COINS_NEGATIVE:${coin}`);
  const attuned = resources.inventory.filter((entry) => entry.attuned);
  if (attuned.length > attunementLimit(character, catalog)) issues.push('ATTUNEMENT_LIMIT');
  for (const entry of attuned) {
    const issue = attunementIssue(character, entry.itemId, catalog);
    if (issue) issues.push(`${issue}:${entry.itemId ?? entry.entryId}`);
  }
  const carries = (id: Id) => resources.inventory.some((entry) => entry.itemId === id && entry.quantity > 0);
  if (character.draft.equippedArmorId && !carries(character.draft.equippedArmorId)) issues.push('ARMOR_NOT_CARRIED');
  if (character.draft.shieldEquipped && !carries(SHIELD_ID)) issues.push('SHIELD_NOT_CARRIED');
  return { ok: issues.length === 0, issues };
}
