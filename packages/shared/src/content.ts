// Hanya `import type` dari file saudara: modul ini juga dijalankan langsung oleh
// Node (type stripping) di scripts/audit-content.ts.
import type { Id, JsonObject, Locale } from './contracts.js';

export const RULESET = 'srd-5.2.1-2024';

/** Jenis entri corpus. ID entri berbentuk `<kind>.<slug>`, mis. `spell.fireball`. */
export const CONTENT_KINDS = [
  'rule',
  'condition',
  'class',
  'subclass',
  'species',
  'background',
  'feat',
  'spell',
  'equipment',
  'magic-item',
  'monster',
] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

/** File data per kategori; pasangan EN/ID memakai nama file yang sama. */
export const CONTENT_FILES = {
  rules: ['rule', 'condition'],
  characters: ['class', 'subclass', 'species', 'background', 'feat'],
  spells: ['spell'],
  items: ['equipment', 'magic-item'],
  monsters: ['monster'],
} as const satisfies Record<string, readonly ContentKind[]>;
export type ContentFile = keyof typeof CONTENT_FILES;

export interface ContentSource {
  ruleset: typeof RULESET;
  /** Judul bagian SRD tempat entri berada, mis. "Spell Descriptions". */
  section: string;
  /** Nomor halaman PDF SRD 5.2.1. */
  page: number;
  license: 'CC-BY-4.0';
}

/**
 * Entri dalam satu locale. Teks (`name`, `summary`, `body`) dilokalkan; `mechanics`,
 * `refs` dan `source` netral bahasa dan identik untuk semua locale.
 */
export interface ContentEntry {
  id: Id;
  kind: ContentKind;
  locale: Locale;
  name: string;
  /** Nama sumber EN, selalu tersedia untuk pencocokan dengan buku/meja. */
  originalName: string;
  summary: string | null;
  /** Markdown. */
  body: string;
  /**
   * source: teks asli SRD (EN); translated: terjemahan aplikasi yang sudah
   * di-review; fallback: terjemahan belum ada/usang sehingga teks EN ditampilkan.
   */
  translation: 'source' | 'translated' | 'fallback';
  mechanics: JsonObject | null;
  refs: Id[];
  source: ContentSource;
}

/** Hasil audit; setiap daftar berisi pesan masalah dan harus kosong sebelum rilis. */
export interface ContentAudit {
  /** Entri manifest yang belum ada di data EN, atau entri data yang tidak ada di manifest. */
  missingIds: string[];
  /** Entri tanpa terjemahan ID atau terjemahannya dibuat dari teks EN yang sudah berubah. */
  missingLocales: string[];
  /** `refs`/tautan ke ID yang tidak dikenal. */
  invalidReferences: string[];
  /** Mekanik tidak valid untuk jenisnya, atau angka/dadu di terjemahan berbeda dari sumber. */
  mechanicMismatches: string[];
}

export interface ValidationResult {
  ok: boolean;
  issues: string[];
}

export interface ContentCatalog {
  ruleset: typeof RULESET;
  ids(): Id[];
  has(id: Id): boolean;
  getContent(id: Id, locale: Locale): ContentEntry;
  auditContent(): ContentAudit;
}
