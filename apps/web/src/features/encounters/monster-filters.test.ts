import { describe, expect, it } from 'vitest';
import type { MonsterInstance } from '#shared/encounters';
import { defaultMonsterFilters, filterMonsters } from './monster-filters';

const monster = (id: string, over: Partial<MonsterInstance>): MonsterInstance => ({
  id,
  name: id,
  originalName: id,
  cr: '1',
  xp: 200,
  creatureTypes: ['humanoid'],
  size: ['medium'],
  homebrew: false,
  ...over,
});

const list = [
  monster('Goblin', { cr: '1/4', xp: 50, creatureTypes: ['fey'], size: ['small'] }),
  monster('Ogre', { cr: '2', xp: 450, creatureTypes: ['giant'], size: ['large'] }),
  monster('Animated Object', { cr: null, xp: null, creatureTypes: ['construct'] }),
  monster('Adult Red Dragon', { cr: '17', xp: 18000, creatureTypes: ['dragon'], size: ['huge'] }),
  monster('Mudling', { cr: '1/4', xp: 50, creatureTypes: ['elemental'], size: ['small'], homebrew: true }),
  monster('Bandit', { name: 'Bandit', originalName: 'Bandit', cr: '1/8', xp: 25 }),
];
const names = (filters: Partial<ReturnType<typeof defaultMonsterFilters>>) => filterMonsters(list, { ...defaultMonsterFilters(), ...filters }).map((entry) => entry.id);

describe('monster filters', () => {
  it('filters_and_sorts_monsters', () => {
    // Default: urut nama A–Z, semua sumber.
    expect(names({})).toEqual(['Adult Red Dragon', 'Animated Object', 'Bandit', 'Goblin', 'Mudling', 'Ogre']);
    expect(names({ query: 'drag' })).toEqual(['Adult Red Dragon']);
    // Rentang CR inklusif; stat block tanpa CR keluar saat rentang dipakai.
    expect(names({ minCr: '1/4', maxCr: '2' })).toEqual(['Goblin', 'Mudling', 'Ogre']);
    expect(names({ maxCr: '1/8' })).toEqual(['Bandit']);
    expect(names({ creatureType: 'giant' })).toEqual(['Ogre']);
    expect(names({ size: 'small' })).toEqual(['Goblin', 'Mudling']);
    expect(names({ source: 'homebrew' })).toEqual(['Mudling']);
    expect(names({ source: 'srd', size: 'small' })).toEqual(['Goblin']);
    // Sort: CR/XP naik-turun; tanpa CR/XP selalu di akhir; seri diurutkan nama.
    expect(names({ sort: 'cr-asc' })).toEqual(['Bandit', 'Goblin', 'Mudling', 'Ogre', 'Adult Red Dragon', 'Animated Object']);
    expect(names({ sort: 'cr-desc' })).toEqual(['Adult Red Dragon', 'Ogre', 'Goblin', 'Mudling', 'Bandit', 'Animated Object']);
    expect(names({ sort: 'xp-desc', creatureType: '' })[0]).toBe('Adult Red Dragon');
    expect(names({ sort: 'xp-asc' }).at(-1)).toBe('Animated Object');
    expect(names({ sort: 'name-desc' })[0]).toBe('Ogre');
  });
});
