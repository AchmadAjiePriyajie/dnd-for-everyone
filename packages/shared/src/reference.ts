import { z } from 'zod';
import { localeSchema } from './access.js';
import type { ContentKind, ContentSource } from './content.js';
import type { Id, Locale } from './contracts.js';

/**
 * Asal hit pencarian. `srd` = corpus SRD 5.2.1; `guide` = panduan pemula buatan aplikasi
 * (bukan teks SRD, ditandai jelas); `campaign` = entri milik campaign (homebrew/catatan).
 */
export type ReferenceSource =
  | ({ kind: 'srd' } & ContentSource)
  | { kind: 'guide' }
  | { kind: 'campaign'; campaignId: Id; provider: string };

export interface SearchHit {
  entryId: Id;
  /** Jenis corpus, `guide`, atau jenis yang diberikan sumber campaign. */
  entryKind: ContentKind | 'guide' | string;
  /** Judul pada locale yang diminta (atau EN bila belum diterjemahkan). */
  title: string;
  /** Judul sumber EN, selalu ada untuk pencocokan dengan buku/meja. */
  originalTitle: string;
  summary: string | null;
  /** Bantuan singkat "kapan dipakai" yang dikurasi; null bila belum ada. */
  whenToUse: string | null;
  relatedIds: Id[];
  source: ReferenceSource;
  /** `fallback` = teks EN ditampilkan karena belum ada terjemahan pada locale ini. */
  translation: 'source' | 'translated' | 'fallback';
}

export interface ReferenceEntryView extends SearchHit {
  locale: Locale;
  /** Markdown. */
  body: string;
}

/** Panjang query maksimum yang diproses; sisanya diabaikan. */
export const MAX_QUERY_LENGTH = 200;

const entryId = z.string().regex(/^[a-z0-9-]+\.[a-z0-9]+(-[a-z0-9]+)*$/).max(120);
const campaignId = z.string().min(1).max(64).optional();

/** Query mentah dibatasi; server hanya memproses MAX_QUERY_LENGTH karakter pertama. */
export const searchQuery = z.strictObject({
  q: z.string().max(1000).default(''),
  locale: localeSchema,
  campaignId,
});
export const entryQuery = z.strictObject({ locale: localeSchema, campaignId });
export const entryParams = z.strictObject({ id: entryId });
