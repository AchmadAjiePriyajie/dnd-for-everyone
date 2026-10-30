import { Injectable } from '@nestjs/common';
import MiniSearch, { type SearchOptions } from 'minisearch';
import type { DatabaseSync } from 'node:sqlite';
import type { Guide } from '#content/glossary';
import type { Principal } from '#shared/access';
import type { Id, Locale } from '#shared/contracts';
import { MAX_QUERY_LENGTH, type ReferenceEntryView, type SearchHit } from '#shared/reference';
import { DomainError, forbidden } from '../../common/domain-error.js';
import { ContentService } from '../../content/content.service.js';
import { DatabaseService } from '../../db/database.service.js';
import { findActiveMember } from '../campaigns/access.js';

/** Teks per locale; EN wajib sebagai sumber/fallback. */
export type LocalizedText = { en: string } & Partial<Record<Locale, string>>;

/** Entri milik campaign (homebrew, catatan) yang disediakan fitur lain. */
export interface CampaignReferenceEntry {
  id: Id;
  /** `dm` hanya untuk DM campaign; `members` untuk semua anggota. */
  audience: 'dm' | 'members';
  kind?: string;
  title: LocalizedText;
  summary: LocalizedText | null;
  body: LocalizedText;
  relatedIds?: Id[];
}

export interface ReferenceSourceProvider {
  name: string;
  entries(db: DatabaseSync, campaignId: Id): CampaignReferenceEntry[];
}

const MAX_HITS = 20;
const MAX_TOKENS = 12;

/** Huruf kecil, tanpa diakritik/apostrof/tanda baca; dipakai untuk query, judul dan alias. */
export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Peringkat: judul persis > alias/frasa persis > alias di dalam query > pencarian teks. */
const enum Tier {
  Text = 1,
  AliasInQuery = 2,
  Alias = 3,
  Title = 4,
}

interface Doc {
  id: Id;
  title: string;
  originalTitle: string;
  aliases: string;
  summary: string;
  body: string;
}

const searchOptions: SearchOptions = {
  boost: { title: 5, originalTitle: 4, aliases: 4, summary: 2, body: 0.3 },
  prefix: (term) => term.length >= 3,
  fuzzy: (term) => (term.length >= 5 ? 0.2 : false),
  combineWith: 'AND',
};

function buildIndex(docs: Doc[]): MiniSearch<Doc> {
  const index = new MiniSearch<Doc>({
    fields: ['title', 'originalTitle', 'aliases', 'summary', 'body'],
    processTerm: (term) => normalize(term) || null,
    searchOptions,
  });
  index.addAll(docs);
  return index;
}

type Scored = Map<Id, { tier: Tier; score: number }>;

function bump(scored: Scored, id: Id, tier: Tier, score = 0): void {
  const current = scored.get(id);
  if (!current || tier > current.tier || (tier === current.tier && score > current.score)) scored.set(id, { tier, score });
}

/** Cocokkan query ke judul/alias; `names` berisi teks per entri yang sudah dinormalisasi. */
function matchNames(scored: Scored, query: string, tokens: Set<string>, names: Map<Id, { titles: string[]; aliases: string[] }>): void {
  for (const [id, { titles, aliases }] of names) {
    if (titles.includes(query)) bump(scored, id, Tier.Title);
    for (const alias of aliases) {
      if (alias === query) bump(scored, id, Tier.Alias);
      else if (alias.split(' ').every((part) => tokens.has(part))) bump(scored, id, Tier.AliasInQuery);
    }
  }
}

function rank(scored: Scored): Id[] {
  return [...scored]
    .sort(([, a], [, b]) => b.tier - a.tier || b.score - a.score)
    .slice(0, MAX_HITS)
    .map(([id]) => id);
}

@Injectable()
export class ReferenceService {
  private readonly providers = new Map<string, ReferenceSourceProvider>();
  private readonly corpus = new Map<Locale, { index: MiniSearch<Doc>; names: Map<Id, { titles: string[]; aliases: string[] }> }>();

  constructor(
    private readonly content: ContentService,
    private readonly database: DatabaseService,
  ) {}

  /** Fitur lain (homebrew, catatan) mendaftarkan entri campaign; nama ganda gagal. */
  registerSource(provider: ReferenceSourceProvider): void {
    if (this.providers.has(provider.name)) throw new Error(`duplicate reference source ${provider.name}`);
    this.providers.set(provider.name, provider);
  }

  searchReference(principal: Principal, query: string, locale: Locale, campaignId?: Id): SearchHit[] {
    // Akses diperiksa sebelum query apa pun dijalankan, bahkan query kosong.
    const campaign = campaignId === undefined ? undefined : this.campaignEntries(principal, campaignId);
    const normalized = normalize(query.slice(0, MAX_QUERY_LENGTH)).split(' ').slice(0, MAX_TOKENS).join(' ');
    if (!normalized) return [];
    const tokens = new Set(normalized.split(' '));

    const scored: Scored = new Map();
    const corpus = this.corpusIndex(locale);
    matchNames(scored, normalized, tokens, corpus.names);
    for (const result of corpus.index.search(normalized)) bump(scored, result.id as Id, Tier.Text, result.score);

    const local = new Map<Id, CampaignReferenceEntry & { provider: string }>();
    if (campaign && campaign.length) {
      for (const entry of campaign) local.set(entry.id, entry);
      const names = new Map(campaign.map((entry) => [entry.id, { titles: [normalize(entry.title.en), normalize(pick(entry.title, locale))], aliases: [] }]));
      matchNames(scored, normalized, tokens, names);
      const index = buildIndex(campaign.map((entry) => campaignDoc(entry, locale)));
      for (const result of index.search(normalized)) bump(scored, result.id as Id, Tier.Text, result.score);
    }

    return rank(scored).map((id) => {
      const entry = local.get(id);
      return entry ? campaignHit(entry, locale, campaignId!) : this.corpusHit(id, locale);
    });
  }

  /**
   * Isi lengkap satu entri untuk reader. Entri campaign yang tidak boleh dilihat
   * menghasilkan NOT_FOUND yang sama dengan ID tak dikenal (tidak membocorkan keberadaan).
   */
  getReferenceEntry(principal: Principal, id: Id, locale: Locale, campaignId?: Id): ReferenceEntryView {
    if (campaignId !== undefined) {
      const entry = this.campaignEntries(principal, campaignId).find((candidate) => candidate.id === id);
      if (entry) return { ...campaignHit(entry, locale, campaignId), locale, body: pick(entry.body, locale) };
    }
    const guide = this.guides().get(id);
    if (guide) return { ...this.corpusHit(id, locale), locale, body: guide.body[locale] };
    if (!this.content.has(id)) throw new DomainError('NOT_FOUND', 404);
    return { ...this.corpusHit(id, locale), locale, body: this.content.getContent(id, locale).body };
  }

  /** Bookmark akun untuk entri corpus/panduan, urut berdasarkan ID. */
  listBookmarks(principal: Principal): Id[] {
    const rows = this.database
      .getHandle()
      .prepare('SELECT entry_id FROM reference_bookmarks WHERE account_id = ? ORDER BY entry_id')
      .all(principal.accountId) as Array<{ entry_id: Id }>;
    return rows.map((row) => row.entry_id);
  }

  addBookmark(principal: Principal, id: Id, now: string): void {
    if (!this.content.has(id) && !this.guides().has(id)) throw new DomainError('NOT_FOUND', 404);
    this.database
      .getHandle()
      .prepare('INSERT OR IGNORE INTO reference_bookmarks (account_id, entry_id, created_at) VALUES (?, ?, ?)')
      .run(principal.accountId, id, now);
  }

  removeBookmark(principal: Principal, id: Id): void {
    this.database.getHandle().prepare('DELETE FROM reference_bookmarks WHERE account_id = ? AND entry_id = ?').run(principal.accountId, id);
  }

  /** Entri campaign yang boleh dilihat principal; bukan anggota → FORBIDDEN tanpa detail. */
  private campaignEntries(principal: Principal, campaignId: Id): Array<CampaignReferenceEntry & { provider: string }> {
    const db = this.database.getHandle();
    const member = findActiveMember(db, campaignId, principal.accountId);
    if (!member) throw forbidden();
    return [...this.providers.values()].flatMap((provider) =>
      provider
        .entries(db, campaignId)
        .filter((entry) => entry.audience === 'members' || member.role === 'dm')
        .map((entry) => ({ ...entry, provider: provider.name })),
    );
  }

  private guideMap?: Map<Id, Guide>;

  private guides(): Map<Id, Guide> {
    this.guideMap ??= new Map(this.content.getGlossary().guides.map((guide) => [guide.id, guide]));
    return this.guideMap;
  }

  private corpusIndex(locale: Locale) {
    const cached = this.corpus.get(locale);
    if (cached) return cached;
    const { terms, guides } = this.content.getGlossary();
    const docs: Doc[] = [];
    const names = new Map<Id, { titles: string[]; aliases: string[] }>();
    for (const id of this.content.ids()) {
      const entry = this.content.getContent(id, locale);
      const aliases = terms[id] ? [...terms[id].aliases.en, ...terms[id].aliases.id] : [];
      docs.push({ id, title: entry.name, originalTitle: entry.originalName, aliases: aliases.join(' '), summary: entry.summary ?? '', body: entry.body });
      names.set(id, { titles: [normalize(entry.name), normalize(entry.originalName)], aliases: aliases.map(normalize) });
    }
    for (const guide of guides) {
      const phrases = [...guide.phrases.en, ...guide.phrases.id];
      docs.push({ id: guide.id, title: guide.title[locale], originalTitle: guide.title.en, aliases: phrases.join(' '), summary: guide.summary[locale], body: guide.body[locale] });
      names.set(guide.id, { titles: [normalize(guide.title[locale]), normalize(guide.title.en)], aliases: phrases.map(normalize) });
    }
    const built = { index: buildIndex(docs), names };
    this.corpus.set(locale, built);
    return built;
  }

  private corpusHit(id: Id, locale: Locale): SearchHit {
    const guide = this.guides().get(id);
    if (guide) {
      return {
        entryId: id,
        entryKind: 'guide',
        title: guide.title[locale],
        originalTitle: guide.title.en,
        summary: guide.summary[locale],
        whenToUse: guide.whenToUse[locale],
        relatedIds: guide.relatedIds,
        source: { kind: 'guide' },
        translation: locale === 'en' ? 'source' : 'translated',
      };
    }
    const entry = this.content.getContent(id, locale);
    return {
      entryId: id,
      entryKind: entry.kind,
      title: entry.name,
      originalTitle: entry.originalName,
      summary: entry.summary,
      whenToUse: this.content.getGlossary().terms[id]?.whenToUse?.[locale] ?? null,
      relatedIds: entry.refs,
      source: { kind: 'srd', ...entry.source },
      translation: entry.translation,
    };
  }
}

const pick = (text: LocalizedText, locale: Locale): string => text[locale] ?? text.en;

function campaignDoc(entry: CampaignReferenceEntry, locale: Locale): Doc {
  return {
    id: entry.id,
    title: pick(entry.title, locale),
    originalTitle: entry.title.en,
    aliases: '',
    summary: entry.summary ? pick(entry.summary, locale) : '',
    body: pick(entry.body, locale),
  };
}

function campaignHit(entry: CampaignReferenceEntry & { provider: string }, locale: Locale, campaignId: Id): SearchHit {
  return {
    entryId: entry.id,
    entryKind: entry.kind ?? 'campaign',
    title: pick(entry.title, locale),
    originalTitle: entry.title.en,
    summary: entry.summary ? pick(entry.summary, locale) : null,
    whenToUse: null,
    relatedIds: entry.relatedIds ?? [],
    source: { kind: 'campaign', campaignId, provider: entry.provider },
    translation: locale === 'en' ? 'source' : entry.title[locale] ? 'translated' : 'fallback',
  };
}
