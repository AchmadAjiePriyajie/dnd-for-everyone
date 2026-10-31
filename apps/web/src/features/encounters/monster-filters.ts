import type { MonsterInstance } from '#shared/encounters';

/** Nilai CR SRD yang dipakai pilihan filter, urut naik. */
export const CR_STEPS = ['0', '1/8', '1/4', '1/2', ...Array.from({ length: 30 }, (_, index) => String(index + 1))];

export const MONSTER_SORTS = ['name-asc', 'name-desc', 'cr-asc', 'cr-desc', 'xp-asc', 'xp-desc'] as const;
export type MonsterSort = (typeof MONSTER_SORTS)[number];

export interface MonsterFilters {
  query: string;
  /** CR minimum/maksimum (inklusif); '' = tanpa batas. */
  minCr: string;
  maxCr: string;
  creatureType: string;
  size: string;
  source: 'all' | 'srd' | 'homebrew';
  sort: MonsterSort;
}

export const defaultMonsterFilters = (): MonsterFilters => ({ query: '', minCr: '', maxCr: '', creatureType: '', size: '', source: 'all', sort: 'name-asc' });

/** "1/4" → 0.25; tanpa CR → NaN. */
export function crValue(cr: string | null): number {
  if (cr === null) return Number.NaN;
  const [top, bottom] = cr.split('/');
  return bottom ? Number(top) / Number(bottom) : Number(top);
}

/** Nilai kosong (tanpa CR/XP) selalu di akhir, ke mana pun arah sort. */
function compareNumbers(a: number, b: number, direction: 1 | -1): number {
  const missingA = Number.isNaN(a);
  const missingB = Number.isNaN(b);
  if (missingA || missingB) return missingA === missingB ? 0 : missingA ? 1 : -1;
  return (a - b) * direction;
}

export function filterMonsters(monsters: MonsterInstance[], filters: MonsterFilters): MonsterInstance[] {
  const query = filters.query.trim().toLowerCase();
  const min = filters.minCr ? crValue(filters.minCr) : Number.NaN;
  const max = filters.maxCr ? crValue(filters.maxCr) : Number.NaN;
  const byName = (a: MonsterInstance, b: MonsterInstance) => a.name.localeCompare(b.name);
  const result = monsters.filter((monster) => {
    if (query && !`${monster.name} ${monster.originalName}`.toLowerCase().includes(query)) return false;
    const cr = crValue(monster.cr);
    // Stat block tanpa CR tidak dapat dibandingkan dengan rentang CR.
    if (!Number.isNaN(min) && !(cr >= min)) return false;
    if (!Number.isNaN(max) && !(cr <= max)) return false;
    if (filters.creatureType && !monster.creatureTypes.includes(filters.creatureType)) return false;
    if (filters.size && !monster.size.includes(filters.size)) return false;
    if (filters.source === 'srd' && monster.homebrew) return false;
    if (filters.source === 'homebrew' && !monster.homebrew) return false;
    return true;
  });
  const [field, order] = filters.sort.split('-') as ['name' | 'cr' | 'xp', 'asc' | 'desc'];
  const direction = order === 'asc' ? 1 : -1;
  return result.sort((a, b) => {
    if (field === 'name') return byName(a, b) * direction;
    const value = field === 'cr' ? compareNumbers(crValue(a.cr), crValue(b.cr), direction) : compareNumbers(a.xp ?? Number.NaN, b.xp ?? Number.NaN, direction);
    return value || byName(a, b);
  });
}
