// Hanya `import type` dari file saudara dan zod: dipakai server dan web.
import { z } from 'zod';
import type { Id } from './contracts.js';

export const ASSET_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AssetMime = (typeof ASSET_MIME_TYPES)[number];
/** Batas awal upload: 20 MiB dan 40 megapixel. */
export const MAX_ASSET_BYTES = 20 * 1024 * 1024;
export const MAX_ASSET_PIXELS = 40_000_000;

export const assetVisibilitySchema = z.enum(['dm', 'party']);
export type AssetVisibility = z.infer<typeof assetVisibilitySchema>;

/** Upload mentah dari HTTP; tipe dan dimensi dibaca ulang dari isi file. */
export interface AssetUpload {
  bytes: Buffer;
  declaredMime: string;
  name: string;
  visibility: AssetVisibility;
}

export interface Asset {
  id: Id;
  campaignId: Id;
  name: string;
  mime: AssetMime;
  width: number;
  height: number;
  bytes: number;
  visibility: AssetVisibility;
}

const id = z.string().min(1).max(100);
const cells = z.number().int().min(1).max(200);

/**
 * Kalibrasi grid. Posisi token selalu dalam satuan sel grid (bukan pixel viewport);
 * `cellPixels`/`offset*` hanya memetakan grid ke gambar latar.
 */
export const gridSettingsSchema = z.strictObject({
  columns: cells,
  rows: cells,
  cellPixels: z.number().min(4).max(1000),
  offsetX: z.number().min(-10_000).max(10_000),
  offsetY: z.number().min(-10_000).max(10_000),
  feetPerCell: z.number().int().min(1).max(100),
  /** standard (default 2024): diagonal = satu kotak; alternate: 5-10-5. */
  diagonal: z.enum(['standard', 'alternate']).optional(),
  /** Kotak Difficult Terrain yang ditandai DM. */
  difficult: z.array(z.strictObject({ x: z.number().int().min(0).max(199), y: z.number().int().min(0).max(199) })).max(5000).optional(),
  /** Batasi satu gerakan token pada speed-nya (eksplorasi taktis); DM bisa override. */
  enforceSpeed: z.boolean().optional(),
});
export type GridSettings = z.infer<typeof gridSettingsSchema>;

export const sceneDraftSchema = z.strictObject({ name: z.string().trim().min(1).max(120), assetId: id.nullable(), grid: gridSettingsSchema });
export type SceneDraft = z.infer<typeof sceneDraftSchema>;

export const TOKEN_KINDS = ['character', 'monster', 'npc', 'object'] as const;
const coordinate = z.number().int().min(0).max(199);
const hp = z.strictObject({ current: z.number().int().min(0).max(99_999), max: z.number().int().min(1).max(99_999) });

export const tokenDraftSchema = z.strictObject({
  sceneId: id,
  label: z.string().trim().min(1).max(60),
  kind: z.enum(TOKEN_KINDS),
  characterId: id.optional(),
  monsterId: z.string().regex(/^(monster\.[a-z0-9-]+|hb-[a-z0-9-]+)$/).max(120).optional(),
  ownerAccountId: id.optional(),
  x: coordinate,
  y: coordinate,
  /** Lebar/tinggi dalam sel (Large = 2, Huge = 3, Gargantuan = 4). */
  size: z.number().int().min(1).max(4),
  hidden: z.boolean(),
  /** HP token monster/NPC; hanya dikirim ke DM. */
  hp: hp.optional(),
});
export type TokenDraft = z.infer<typeof tokenDraftSchema>;

const point = z.strictObject({ x: coordinate, y: coordinate });
export type GridPoint = z.infer<typeof point>;

/** Gerak token: path kotak demi kotak (tap/drag membuat path lurus); DM boleh override batas. */
export const moveTokenSchema = z.strictObject({ x: coordinate, y: coordinate, path: z.array(point).min(1).max(400).optional(), override: z.boolean().optional() });
export type MoveTokenInput = z.infer<typeof moveTokenSchema>;

export const AREA_SHAPES = ['sphere', 'cube', 'cone', 'line', 'emanation', 'cylinder'] as const;
export const AREA_DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Penanda area of effect; titik asal di koordinat sudut grid (boleh setengah kotak). */
export const areaMarkerSchema = z.strictObject({
  sceneId: id,
  shape: z.enum(AREA_SHAPES),
  origin: z.strictObject({ x: z.number().min(0).max(200).multipleOf(0.5), y: z.number().min(0).max(200).multipleOf(0.5) }),
  sizeFeet: z.number().int().min(5).max(500),
  widthFeet: z.number().int().min(5).max(100).optional(),
  originSize: z.number().int().min(1).max(4).optional(),
  direction: z.enum(AREA_DIRECTIONS),
  label: z.string().trim().max(60),
});
export type AreaMarkerInput = Omit<z.infer<typeof areaMarkerSchema>, 'sceneId' | 'label'>;
export interface AreaMarker extends z.infer<typeof areaMarkerSchema> {
  id: Id;
  ownerAccountId: Id;
}

/** Kabut manual: bila aktif, hanya persegi yang diungkap DM yang terlihat bagi player. */
export const fogSchema = z.strictObject({
  enabled: z.boolean(),
  revealed: z.array(z.strictObject({ x: coordinate, y: coordinate, w: z.number().int().min(1).max(200), h: z.number().int().min(1).max(200) })).max(500),
});
export type FogState = z.infer<typeof fogSchema>;

export const tokenUpdateSchema = z.strictObject({
  label: z.string().trim().min(1).max(60).optional(),
  hidden: z.boolean().optional(),
  size: z.number().int().min(1).max(4).optional(),
  ownerAccountId: id.nullable().optional(),
  hp: hp.nullable().optional(),
});

/** Token seperti yang dilihat peserta; `hidden`, `hp`, `monsterId` hanya untuk DM. */
export interface Token {
  id: Id;
  sceneId: Id;
  label: string;
  kind: (typeof TOKEN_KINDS)[number];
  x: number;
  y: number;
  size: number;
  ownerAccountId: Id | null;
  characterId: Id | null;
  hidden?: boolean;
  hp?: { current: number; max: number };
  monsterId?: Id;
}

export interface SceneView {
  id: Id;
  name: string;
  assetId: Id | null;
  grid: GridSettings;
  tokens: Token[];
  markers: AreaMarker[];
  fog: FogState;
  revision: number;
  /** Khusus DM. */
  shared?: boolean;
}

export interface SceneSummary {
  id: Id;
  name: string;
  shared?: boolean;
}
