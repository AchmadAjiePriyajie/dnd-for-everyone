import { z } from 'zod';
import type { ContentKind } from '#shared/content';

/** `<kind>.<slug>`; slug huruf kecil/angka dengan tanda hubung. */
export const contentIdSchema = z
  .string()
  .regex(/^(rule|condition|class|subclass|species|background|feat|spell|equipment|magic-item|monster)\.[a-z0-9]+(-[a-z0-9]+)*$/);

export const kindOf = (id: string): ContentKind => id.slice(0, id.indexOf('.')) as ContentKind;

const sourceRef = z.strictObject({ section: z.string().min(1), page: z.number().int().positive() });

/** Rekaman EN: teks sumber + mekanik/provenance netral bahasa (satu-satunya tempat angka). */
export const enRecordSchema = z.strictObject({
  id: contentIdSchema,
  name: z.string().min(1),
  summary: z.string().min(1).optional(),
  body: z.string().min(1),
  mechanics: z.record(z.string(), z.json()).optional(),
  refs: z.array(contentIdSchema).optional(),
  source: sourceRef,
});
export type EnRecord = z.infer<typeof enRecordSchema>;

/** Rekaman ID: hanya teks. `sourceHash` = hash teks EN saat diterjemahkan (deteksi usang). */
export const idRecordSchema = z.strictObject({
  id: contentIdSchema,
  name: z.string().min(1),
  summary: z.string().min(1).optional(),
  body: z.string().min(1),
  sourceHash: z.string().regex(/^[0-9a-f]{16}$/),
});
export type IdRecord = z.infer<typeof idRecordSchema>;

export const enFileSchema = z.strictObject({ entries: z.array(enRecordSchema) });
export const idFileSchema = z.strictObject({ entries: z.array(idRecordSchema) });

/**
 * Manifest ekspektasi: daftar entri yang wajib ada menurut struktur SRD resmi.
 * Disusun dari dokumen sumber, terpisah dari data hasil ingest.
 */
export const manifestSchema = z.strictObject({
  source: z.strictObject({
    title: z.string().min(1),
    version: z.literal('5.2.1'),
    license: z.literal('CC-BY-4.0'),
    url: z.url(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    pages: z.number().int().positive(),
  }),
  entries: z.array(
    z.strictObject({
      id: contentIdSchema,
      name: z.string().min(1),
      section: z.string().min(1),
      page: z.number().int().positive(),
    }),
  ),
});
export type Manifest = z.infer<typeof manifestSchema>;

export const attributionSchema = z.strictObject({
  /** Pernyataan atribusi CC-BY-4.0 persis seperti yang diminta SRD. */
  text: z.string().min(1),
  /** Penanda terjemahan per locale non-sumber. */
  translationNotice: z.record(z.string(), z.string().min(1)),
});
export type Attribution = z.infer<typeof attributionSchema>;

// ---------------------------------------------------------------- mekanik

const ability = z.enum(['str', 'dex', 'con', 'int', 'wis', 'cha']);
const damageType = z.enum([
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
]);
const dice = z.string().regex(/^\d+d\d+( ?[+-] ?\d+)?$/);
const size = z.enum(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']);
const cost = z.strictObject({ amount: z.number().nonnegative(), unit: z.enum(['cp', 'sp', 'ep', 'gp', 'pp']) });

const castingUnit = z.enum(['action', 'bonus-action', 'reaction', 'minute', 'hour']);

const spellMechanics = z.strictObject({
  level: z.number().int().min(0).max(9),
  school: z.enum([
    'abjuration',
    'conjuration',
    'divination',
    'enchantment',
    'evocation',
    'illusion',
    'necromancy',
    'transmutation',
  ]),
  classes: z.array(contentIdSchema).min(1),
  castingTime: z.strictObject({
    amount: z.number().int().positive(),
    unit: castingUnit,
    /** Mode lain dari spell yang sama, mis. Plant Growth (Action atau 8 jam). */
    alternative: z.strictObject({ amount: z.number().int().positive(), unit: castingUnit }).optional(),
  }),
  ritual: z.boolean(),
  range: z.strictObject({
    type: z.enum(['self', 'touch', 'feet', 'miles', 'sight', 'unlimited', 'special']),
    distance: z.number().positive().optional(),
    area: z
      .strictObject({ shape: z.enum(['cone', 'cube', 'cylinder', 'emanation', 'line', 'sphere']), size: z.number().positive() })
      .optional(),
  }),
  components: z.strictObject({
    verbal: z.boolean(),
    somatic: z.boolean(),
    material: z.boolean(),
    /** Komponen material berharga (gp) yang wajib; deskripsinya ada di teks. */
    materialCost: z.number().positive().optional(),
    materialConsumed: z.boolean().optional(),
  }),
  duration: z.strictObject({
    type: z.enum(['instantaneous', 'timed', 'until-dispelled', 'until-dispelled-or-triggered', 'special']),
    amount: z.number().int().positive().optional(),
    unit: z.enum(['round', 'minute', 'hour', 'day']).optional(),
    /** "Up to 1 hour": boleh diakhiri lebih awal tanpa Concentration. */
    upTo: z.boolean().optional(),
    concentration: z.boolean(),
  }),
});

const creatureType = z.enum([
  'aberration',
  'beast',
  'celestial',
  'construct',
  'dragon',
  'elemental',
  'fey',
  'fiend',
  'giant',
  'humanoid',
  'monstrosity',
  'ooze',
  'plant',
  'undead',
]);

/**
 * Stat block. Makhluk panggilan spell/magic item (`summoned`) memakai nilai yang
 * bergantung pada caster (mis. HP "10 (Medium or smaller)"), sehingga field angka
 * yang tidak tetap dihilangkan dan teks lengkapnya ada di body.
 */
const monsterMechanics = z.strictObject({
  size: z.array(size).min(1),
  creatureTypes: z.array(creatureType).min(1),
  /** Swarm: ukuran tiap makhluk penyusun, mis. Medium Swarm of Tiny Beasts. */
  swarmOf: size.optional(),
  /** Tag tipe dalam kurung, mis. "wizard" dari Humanoid (Wizard). */
  tags: z.array(z.string().regex(/^[a-z0-9-]+$/)).optional(),
  alignment: z.string().regex(/^[a-z-]+$/),
  summoned: z.boolean().optional(),
  ac: z.number().int().positive().optional(),
  initiative: z.number().int().optional(),
  hp: z.strictObject({ average: z.number().int().positive(), formula: dice }).optional(),
  speed: z.partialRecord(z.enum(['walk', 'burrow', 'climb', 'fly', 'swim']), z.number().int().nonnegative()),
  hover: z.boolean().optional(),
  abilities: z.record(ability, z.number().int().min(1).max(30)),
  saves: z.record(ability, z.number().int()),
  skills: z.record(z.string().regex(/^[a-z-]+$/), z.number().int()).optional(),
  vulnerabilities: z.array(damageType).optional(),
  resistances: z.array(damageType).optional(),
  immunities: z.strictObject({ damage: z.array(damageType), conditions: z.array(contentIdSchema) }).optional(),
  gear: z.array(contentIdSchema).optional(),
  senses: z.partialRecord(z.enum(['blindsight', 'darkvision', 'tremorsense', 'truesight']), z.number().int().nonnegative()),
  passivePerception: z.number().int(),
  cr: z.string().regex(/^(0|1\/8|1\/4|1\/2|[1-9]|[12][0-9]|30)$/).optional(),
  xp: z.number().int().nonnegative().optional(),
  /** XP saat di lair, bila ada. */
  xpInLair: z.number().int().positive().optional(),
  proficiencyBonus: z.number().int().min(2).max(9).optional(),
});

const equipmentMechanics = z.strictObject({
  category: z.enum(['weapon', 'armor', 'tool', 'gear', 'ammunition', 'focus', 'pack', 'mount', 'vehicle', 'tack', 'service']),
  cost: cost.nullable(),
  weight: z.number().nonnegative().nullable(),
  weapon: z
    .strictObject({
      category: z.enum(['simple', 'martial']),
      type: z.enum(['melee', 'ranged']),
      damage: z.strictObject({ dice: z.union([dice, z.literal('1')]), type: damageType }),
      versatile: dice.optional(),
      properties: z.array(z.string()),
      range: z.strictObject({ normal: z.number().int().positive(), long: z.number().int().positive() }).optional(),
      mastery: z.string(),
    })
    .optional(),
  armor: z
    .strictObject({
      category: z.enum(['light', 'medium', 'heavy', 'shield']),
      baseAc: z.number().int().positive(),
      dexCap: z.number().int().nonnegative().nullable(),
      strength: z.number().int().positive().optional(),
      stealthDisadvantage: z.boolean(),
      donMinutes: z.number().nonnegative(),
      doffMinutes: z.number().nonnegative(),
    })
    .optional(),
});

const magicItemMechanics = z.strictObject({
  category: z.enum(['armor', 'potion', 'ring', 'rod', 'scroll', 'staff', 'wand', 'weapon', 'wondrous-item']),
  rarity: z.enum(['common', 'uncommon', 'rare', 'very-rare', 'legendary', 'artifact', 'varies']),
  attunement: z.boolean(),
  /** Pembatas attunement (mis. class tertentu); teks lengkapnya ada di body. */
  attunementBy: z.array(contentIdSchema).optional(),
  charges: z.number().int().positive().optional(),
});

/**
 * Skema mekanik per jenis. Jenis bernilai `null` tidak punya mekanik terstruktur
 * (aturan/kondisi berupa teks). Opsi karakter memakai objek terbuka sampai
 * kategori tersebut di-ingest; skemanya diperketat bersama data (Task 7–10).
 */
export const mechanicsSchemas: Record<ContentKind, z.ZodType | null> = {
  rule: null,
  condition: null,
  class: z.looseObject({}),
  subclass: z.looseObject({}),
  species: z.looseObject({}),
  background: z.looseObject({}),
  feat: z.looseObject({}),
  spell: spellMechanics,
  equipment: equipmentMechanics,
  'magic-item': magicItemMechanics,
  monster: monsterMechanics,
};
