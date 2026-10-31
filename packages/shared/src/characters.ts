// Hanya `import type` dari file saudara dan zod: dipakai server, web, dan packages/rules.
import { z } from 'zod';
import type { Id } from './contracts.js';

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type AbilityKey = (typeof ABILITIES)[number];
export type AbilityScores = Record<AbilityKey, number>;

export const SKILLS = [
  'acrobatics', 'animal-handling', 'arcana', 'athletics', 'deception', 'history', 'insight', 'intimidation', 'investigation',
  'medicine', 'nature', 'perception', 'performance', 'persuasion', 'religion', 'sleight-of-hand', 'stealth', 'survival',
] as const;
export type SkillKey = (typeof SKILLS)[number];

export const ABILITY_METHODS = ['standard-array', 'point-buy', 'roll'] as const;
export type AbilityMethod = (typeof ABILITY_METHODS)[number];

/** Kelompok alat yang dipilih "jenisnya" (variannya teks bebas, mis. "lute"). */
export const TOOL_GROUPS = ['musical-instrument', 'gaming-set'] as const;
export type ToolGroup = (typeof TOOL_GROUPS)[number];

/** Satu lemparan 4d6 yang dicatat server; nilai = jumlah tiga dadu tertinggi. */
export interface RecordedRoll {
  dice: [number, number, number, number];
  total: number;
}

const abilityKey = z.enum(ABILITIES);
const skillKey = z.enum(SKILLS);
const contentId = z.string().regex(/^[a-z-]+\.[a-z0-9]+(-[a-z0-9]+)*$/).max(120);
const shortText = (max: number) => z.string().max(max);

/** Pilihan alat: ID equipment (mis. artisan's tools) atau kelompok + varian teks. */
export const toolChoiceSchema = z.union([
  z.strictObject({ id: contentId }),
  z.strictObject({ group: z.enum(TOOL_GROUPS), variant: z.string().trim().min(1).max(40) }),
]);
export type ToolChoice = z.infer<typeof toolChoiceSchema>;

/**
 * Isi wizard; semua field boleh kosong selama draft. Validasi lengkap terhadap
 * corpus terjadi saat finalisasi (lihat validateDraft di packages/rules).
 */
export const characterDraftSchema = z.strictObject({
  name: shortText(80),
  concept: shortText(2000),
  motivation: shortText(2000),
  partyBond: shortText(2000),
  speciesId: contentId.nullable(),
  size: z.enum(['small', 'medium']).nullable(),
  backgroundId: contentId.nullable(),
  /** Peningkatan dari background: +2/+1 pada dua ability berbeda, atau +1 pada ketiganya. */
  backgroundIncrease: z
    .union([
      z.strictObject({ mode: z.literal('2-1'), plus2: abilityKey, plus1: abilityKey }),
      z.strictObject({ mode: z.literal('1-1-1') }),
    ])
    .nullable(),
  classId: contentId.nullable(),
  abilityMethod: z.enum(ABILITY_METHODS).nullable(),
  /** Score dasar per ability sebelum peningkatan background. */
  baseScores: z.partialRecord(abilityKey, z.number().int().min(3).max(18)),
  classSkills: z.array(skillKey).max(18),
  /** Skill dari species (Keen Senses/Skillful) dan dari feat Skilled. */
  speciesSkills: z.array(skillKey).max(4),
  featSkills: z.array(skillKey).max(6),
  /** Origin feat tambahan (Human: Versatile). */
  extraOriginFeatId: contentId.nullable(),
  /** Dua bahasa standar selain Common. */
  languages: z.array(z.string().min(1).max(40)).max(4),
  toolChoices: z.array(toolChoiceSchema).max(6),
  classEquipment: z.enum(['A', 'B', 'C']).nullable(),
  backgroundEquipment: z.enum(['A', 'B']).nullable(),
  equippedArmorId: contentId.nullable(),
  shieldEquipped: z.boolean(),
});
export type CharacterDraft = z.infer<typeof characterDraftSchema>;

export const emptyDraft = (): CharacterDraft => ({
  name: '',
  concept: '',
  motivation: '',
  partyBond: '',
  speciesId: null,
  size: null,
  backgroundId: null,
  backgroundIncrease: null,
  classId: null,
  abilityMethod: null,
  baseScores: {},
  classSkills: [],
  speciesSkills: [],
  featSkills: [],
  extraOriginFeatId: null,
  languages: [],
  toolChoices: [],
  classEquipment: null,
  backgroundEquipment: null,
  equippedArmorId: null,
  shieldEquipped: false,
});

/** Angka sheet yang dapat dikoreksi DM; nilai dasar tetap terlihat. */
export const OVERRIDE_FIELDS = ['armorClass', 'hitPoints', 'initiative', 'speed', 'passivePerception'] as const;
export type OverrideField = (typeof OVERRIDE_FIELDS)[number];

/** Kunci resource Heroic Inspiration pada daftar fitur (punya atau tidak, tanpa jumlah). */
export const HEROIC_INSPIRATION = 'rule.heroic-inspiration';

/** State fitur yang berubah selama bermain; batas maksimum selalu dihitung ulang dari corpus. */
export interface FeatureState {
  /** Pemakaian/poin yang sudah dihabiskan per kunci fitur pemilik resource (`<sourceId>/<featureId>`). */
  spent: Record<string, number>;
  /** Jenis senjata (ID equipment) yang mastery-nya dipakai. */
  weaponMasteries: Id[];
  heroicInspiration: boolean;
}

export const emptyFeatureState = (): FeatureState => ({ spent: {}, weaponMasteries: [], heroicInspiration: false });

export interface Character {
  id: Id;
  campaignId: Id;
  ownerAccountId: Id;
  status: 'draft' | 'final';
  /** Level per class; Task 7 membuat karakter level 1 pada satu class. Subclass dipilih saat level up (Task 10). */
  classLevels: Array<{ classId: Id; level: number; subclassId?: Id }>;
  draft: CharacterDraft;
  /** Lemparan ability yang dicatat server (metode roll). */
  rolls: RecordedRoll[];
  overrides: Partial<Record<OverrideField, number>>;
  featureState: FeatureState;
  revision: number;
  updatedAt: string;
}

/** Biaya waktu fitur. `special` = lihat teks (mis. saat roll Initiative atau Short Rest). */
export type FeatureAction = 'action' | 'magic-action' | 'bonus-action' | 'reaction' | 'no-action' | 'special';

/** none = tidak pulih pada rest itu; one = pulih satu pemakaian; all = pulih penuh. */
export type FeatureRecovery = 'none' | 'one' | 'all';

/**
 * Satu fitur class/subclass (atau Heroic Inspiration) milik karakter.
 * `tracked`: aplikasi menghitung pemakaian; efeknya tetap diselesaikan pemain/DM.
 * `manual`: hanya teks referensi; keputusan dan efek diselesaikan di meja.
 */
export interface FeatureUse {
  key: string;
  sourceId: Id;
  featureId: string;
  /** Level class tempat fitur diperoleh. */
  level: number;
  /** Nama dalam locale diminta; `originalName` tetap EN. */
  name: string;
  originalName: string;
  action: FeatureAction | null;
  automation: 'tracked' | 'manual';
  resource: {
    max: number;
    spent: number;
    remaining: number;
    unit: 'uses' | 'points';
    recovery: { short: FeatureRecovery; long: FeatureRecovery };
  } | null;
  /** Fitur yang menghabiskan resource fitur lain, mis. Preserve Life → Channel Divinity. */
  cost: { resource: string; amount: number } | null;
  /** Markdown bagian fitur pada entri sumber. */
  text: string;
}

/** Hak memilih mastery dari satu class. */
export interface MasteryGrant {
  sourceId: Id;
  count: number;
  /** melee = hanya senjata Melee; proficient = hanya senjata yang dikuasai. */
  restriction: 'simple-or-martial' | 'melee' | 'proficient';
}

/**
 * Asal satu kontribusi angka. `source` adalah ID corpus (class/species/equipment/...)
 * atau kata kunci aturan; UI menerjemahkan `rule` dan memakai judul entri untuk ID.
 */
export interface Contribution {
  source: Id | 'base' | 'rule.base-ac' | 'rule.proficiency' | 'rule.ability-modifier' | 'rule.passive' | 'override';
  /** Ability/skill terkait bila ada, mis. "dex". */
  detail?: string;
  value: number;
}

export interface DerivedValue {
  /** Nilai hasil aturan sebelum override DM. */
  base: number;
  /** Nilai yang dipakai (override bila ada). */
  value: number;
  override: number | null;
  contributions: Contribution[];
}

export interface DerivedWarning {
  code: 'ARMOR_UNTRAINED' | 'SHIELD_UNTRAINED' | 'ARMOR_STRENGTH' | 'FEAT_CHOICES_PENDING';
  params: Record<string, string | number>;
}

/** Masalah yang mencegah finalisasi; `field` merujuk field draft. */
export interface DraftIssue {
  field: string;
  code: 'REQUIRED' | 'INVALID' | 'NOT_ALLOWED' | 'COUNT';
  params?: Record<string, string | number>;
}

export interface InventoryItem {
  id: Id | null;
  /** Item non-corpus (mis. spellbook) atau kelompok pilihan. */
  custom?: string;
  quantity: number;
  note?: string;
  sources: Id[];
}

export interface DerivedCharacter {
  level: number;
  proficiencyBonus: number;
  abilities: Record<AbilityKey, { score: DerivedValue; modifier: number }>;
  savingThrows: Record<AbilityKey, { proficient: boolean; bonus: DerivedValue }>;
  skills: Record<SkillKey, { ability: AbilityKey; proficient: boolean; bonus: DerivedValue; sources: Id[] }>;
  armorClass: DerivedValue;
  hitPoints: DerivedValue;
  initiative: DerivedValue;
  speed: DerivedValue;
  passivePerception: DerivedValue;
  darkvision: number | null;
  armorTraining: string[];
  weaponProficiencies: { categories: string[]; martialWithProperty: Id[] };
  tools: ToolChoice[];
  languages: string[];
  feats: Id[];
  inventory: InventoryItem[];
  gp: number;
  warnings: DerivedWarning[];
  issues: DraftIssue[];
}

/** Ringkasan untuk anggota lain di room (tanpa catatan pribadi pemain). */
export interface CharacterSummary {
  id: Id;
  ownerAccountId: Id;
  name: string;
  status: 'draft' | 'final';
  classId: Id | null;
  speciesId: Id | null;
  level: number;
}

/** Satu opsi wizard: nama lokal, nama asli EN, dan mekanik yang relevan untuk pilihan. */
export interface CharacterOption {
  id: Id;
  name: string;
  originalName: string;
  translation: 'source' | 'translated' | 'fallback';
  mechanics: Record<string, unknown>;
}

export interface CharacterOptions {
  species: CharacterOption[];
  backgrounds: CharacterOption[];
  classes: CharacterOption[];
  originFeats: CharacterOption[];
  languages: string[];
  artisanTools: CharacterOption[];
  allowedMethods: AbilityMethod[];
  /** Senjata yang punya properti mastery; `mechanics` = mekanik weapon (category/type/mastery/properties). */
  masteryWeapons: CharacterOption[];
  /** Armor (bukan shield) yang dirujuk paket awal, dengan kategorinya. */
  armor: Record<Id, 'light' | 'medium' | 'heavy'>;
  /** Judul lokal untuk ID yang muncul di opsi/sheet (equipment, feat, dll.). */
  names: Record<Id, string>;
}
