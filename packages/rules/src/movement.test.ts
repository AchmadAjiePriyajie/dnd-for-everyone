import { describe, expect, it } from 'vitest';
import type { GridSettings } from '#shared/scenes';
import { aoeCells, gridDistance, movementCost, straightPath, validateMove } from './movement.ts';

const standardGrid: GridSettings = { columns: 20, rows: 20, cellPixels: 50, offsetX: 0, offsetY: 0, feetPerCell: 5 };
const key = (cells: Array<{ x: number; y: number }>) => cells.map((cell) => `${cell.x},${cell.y}`).sort();

describe('grid movement', () => {
  it('validates_paths_and_supports_touch', () => {
    // Default 2024: diagonal = satu kotak (5 feet).
    expect(movementCost([{ x: 0, y: 0 }, { x: 1, y: 1 }], standardGrid)).toBe(5);
    expect(movementCost([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }], standardGrid)).toBe(15);
    expect(movementCost([{ x: 4, y: 4 }], standardGrid)).toBe(0);
    // Difficult Terrain: "every foot of movement in that space costs 1 extra foot" → 10 feet per kotak.
    const rubble: GridSettings = { ...standardGrid, difficult: [{ x: 1, y: 0 }] };
    expect(movementCost([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], rubble)).toBe(15);
    // Tidak kumulatif: kotak yang sama tetap 10 feet walau tercantum dua kali.
    expect(movementCost([{ x: 0, y: 0 }, { x: 1, y: 0 }], { ...rubble, difficult: [{ x: 1, y: 0 }, { x: 1, y: 0 }] })).toBe(10);
    // Aturan diagonal alternatif (pengaturan scene): 5, 10, 5, 10…
    const alternate: GridSettings = { ...standardGrid, diagonal: 'alternate' };
    expect(movementCost([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }], alternate)).toBe(20);
    // Langkah harus ke kotak tetangga di dalam grid.
    expect(() => movementCost([{ x: 0, y: 0 }, { x: 2, y: 0 }], standardGrid)).toThrow('PATH_INVALID');
    expect(() => movementCost([{ x: 0, y: 0 }, { x: 0, y: 0 }], standardGrid)).toThrow('PATH_INVALID');
    expect(() => movementCost([{ x: 19, y: 0 }, { x: 20, y: 0 }], standardGrid)).toThrow('PATH_INVALID');
    expect(() => movementCost([], standardGrid)).toThrow('PATH_INVALID');

    // Tap-to-move dan drag sama-sama memakai path lurus ini: diagonal dulu, lalu lurus.
    const tap = straightPath({ x: 0, y: 0 }, { x: 3, y: 1 });
    expect(tap).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ]);
    expect(movementCost(tap, standardGrid)).toBe(gridDistance({ x: 0, y: 0 }, { x: 3, y: 1 }, standardGrid));
    expect(gridDistance({ x: 0, y: 0 }, { x: 3, y: 2 }, standardGrid)).toBe(15);
    expect(gridDistance({ x: 0, y: 0 }, { x: 3, y: 2 }, alternate)).toBe(20);

    // Budget speed: 30 feet; 35 feet ditolak.
    const seven = straightPath({ x: 0, y: 0 }, { x: 7, y: 0 });
    expect(() => validateMove(seven, standardGrid, 30)).toThrow('MOVE_OVER_BUDGET');
    expect(validateMove(straightPath({ x: 0, y: 0 }, { x: 6, y: 0 }), standardGrid, 30)).toBe(30);
    expect(validateMove(seven, standardGrid, null)).toBe(35);
  });

  it('marks_area_of_effect_cells', () => {
    // Sphere 5 feet dari titik sudut (2,2): empat kotak di sekelilingnya.
    expect(key(aoeCells({ shape: 'sphere', origin: { x: 2, y: 2 }, sizeFeet: 5, direction: 'E' }, standardGrid))).toEqual(['1,1', '1,2', '2,1', '2,2']);
    expect(aoeCells({ shape: 'sphere', origin: { x: 5, y: 5 }, sizeFeet: 10, direction: 'E' }, standardGrid)).toHaveLength(12);
    // Cube 10 feet dari sudut ke arah tenggara.
    expect(key(aoeCells({ shape: 'cube', origin: { x: 0, y: 0 }, sizeFeet: 10, direction: 'SE' }, standardGrid))).toEqual(['0,0', '0,1', '1,0', '1,1']);
    // Line 15 × 5 feet ke timur dari sisi kotak.
    expect(key(aoeCells({ shape: 'line', origin: { x: 0, y: 2.5 }, sizeFeet: 15, widthFeet: 5, direction: 'E' }, standardGrid))).toEqual(['0,2', '1,2', '2,2']);
    // Cone 15 feet ke timur: lebar sama dengan jarak dari titik asal.
    const cone = key(aoeCells({ shape: 'cone', origin: { x: 0, y: 5 }, sizeFeet: 15, direction: 'E' }, standardGrid));
    expect(cone).toContain('0,4');
    expect(cone).toContain('2,3');
    expect(cone).not.toContain('0,3');
    // Area di luar peta dipotong.
    expect(aoeCells({ shape: 'sphere', origin: { x: 0, y: 0 }, sizeFeet: 5, direction: 'E' }, standardGrid)).toEqual([{ x: 0, y: 0 }]);
  });
});
