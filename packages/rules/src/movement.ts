import type { AreaMarkerInput, GridPoint, GridSettings } from '#shared/scenes';

const fail = (code: string): never => {
  throw new Error(code);
};

const inside = (point: GridPoint, grid: GridSettings) => point.x >= 0 && point.y >= 0 && point.x < grid.columns && point.y < grid.rows;

/**
 * Biaya gerak dalam feet untuk path kotak demi kotak. Default 2024: diagonal = satu kotak.
 * `diagonal: 'alternate'`: diagonal kedua, keempat, … berbiaya dua kotak. Difficult Terrain
 * menggandakan biaya kotak yang dimasuki (tidak kumulatif).
 */
export function movementCost(path: GridPoint[], grid: GridSettings, diagonalsBefore = 0): number {
  if (!path.length || !path.every((point) => Number.isInteger(point.x) && Number.isInteger(point.y) && inside(point, grid))) fail('PATH_INVALID');
  const difficult = new Set((grid.difficult ?? []).map((cell) => `${cell.x},${cell.y}`));
  let feet = 0;
  let diagonals = diagonalsBefore;
  for (let index = 1; index < path.length; index++) {
    const from = path[index - 1]!;
    const to = path[index]!;
    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);
    if (Math.max(dx, dy) !== 1) fail('PATH_INVALID');
    let squares = 1;
    if (dx === 1 && dy === 1 && grid.diagonal === 'alternate') {
      diagonals++;
      if (diagonals % 2 === 0) squares = 2;
    }
    if (difficult.has(`${to.x},${to.y}`)) squares *= 2;
    feet += squares * grid.feetPerCell;
  }
  return feet;
}

/** Jarak antar kotak untuk penggaris (tanpa terrain). */
export function gridDistance(a: GridPoint, b: GridPoint, grid: GridSettings): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  if (grid.diagonal === 'alternate') {
    const diagonal = Math.min(dx, dy);
    return (Math.max(dx, dy) - diagonal + diagonal + Math.floor(diagonal / 2)) * grid.feetPerCell;
  }
  return Math.max(dx, dy) * grid.feetPerCell;
}

/** Path tap-to-move/drag: diagonal ke arah tujuan dulu, lalu lurus. */
export function straightPath(from: GridPoint, to: GridPoint): GridPoint[] {
  const path: GridPoint[] = [{ ...from }];
  let { x, y } = from;
  while (x !== to.x || y !== to.y) {
    x += Math.sign(to.x - x);
    y += Math.sign(to.y - y);
    path.push({ x, y });
  }
  return path;
}

/** Biaya path; melebihi budget (feet) ditolak. `budget` null = tanpa batas (di luar combat). */
export function validateMove(path: GridPoint[], grid: GridSettings, budget: number | null): number {
  const cost = movementCost(path, grid);
  if (budget !== null && cost > budget) fail('MOVE_OVER_BUDGET');
  return cost;
}

const DIRECTIONS = { N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1] } as const;

/**
 * Kotak yang tercakup area of effect (pendekatan grid). Titik asal dalam koordinat sudut grid.
 * Sphere/Cylinder: pusat kotak dalam radius. Cube: persegi sisi `size` dari titik asal ke arah
 * diagonal (sudut) atau ke depan dari sisi (arah lurus). Line: sepanjang arah dengan lebar.
 * Cone: lebar sama dengan jarak; pusat kotak boleh meleset setengah kotak dari tepi cone.
 * Emanation: jarak grid dari kotak asal (tidak termasuk kotak asal).
 */
export function aoeCells(marker: AreaMarkerInput, grid: GridSettings): GridPoint[] {
  const size = marker.sizeFeet / grid.feetPerCell;
  const [dxRaw, dyRaw] = DIRECTIONS[marker.direction];
  const length = Math.hypot(dxRaw, dyRaw);
  const ux = dxRaw / length;
  const uy = dyRaw / length;
  const { x: ox, y: oy } = marker.origin;
  const cells: GridPoint[] = [];
  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.columns; x++) {
      const cx = x + 0.5 - ox;
      const cy = y + 0.5 - oy;
      const along = cx * ux + cy * uy;
      const perp = Math.abs(-cx * uy + cy * ux);
      let hit = false;
      switch (marker.shape) {
        case 'sphere':
        case 'cylinder':
          hit = Math.hypot(cx, cy) <= size;
          break;
        case 'cube':
          if (dxRaw !== 0 && dyRaw !== 0) hit = cx * dxRaw >= 0 && cx * dxRaw <= size && cy * dyRaw >= 0 && cy * dyRaw <= size;
          else hit = along >= 0 && along <= size && perp <= size / 2;
          break;
        case 'line':
          hit = along > 0 && along <= size && perp <= (marker.widthFeet ?? grid.feetPerCell) / grid.feetPerCell / 2;
          break;
        case 'cone':
          hit = along > 0 && along <= size && perp <= along / 2 + 0.5;
          break;
        case 'emanation': {
          const footprint = marker.originSize ?? 1;
          const gapX = Math.max(ox - x, 0, x - (ox + footprint - 1));
          const gapY = Math.max(oy - y, 0, y - (oy + footprint - 1));
          const distance = Math.max(gapX, gapY);
          hit = distance > 0 && distance <= size;
          break;
        }
      }
      if (hit) cells.push({ x, y });
    }
  }
  return cells;
}
