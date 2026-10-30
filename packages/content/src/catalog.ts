import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CONTENT_FILES, type ContentAudit, type ContentCatalog, type ContentEntry, type ContentFile, RULESET } from '#shared/content';
import type { Id, JsonObject, Locale } from '#shared/contracts';
import {
  type Attribution,
  attributionSchema,
  type EnRecord,
  enFileSchema,
  type IdRecord,
  idFileSchema,
  kindOf,
  type Manifest,
  manifestSchema,
  mechanicsSchemas,
} from './schema.ts';

/** Folder `packages/content` (berisi `source/` dan `data/`); sama di source maupun dist. */
export const defaultContentDir = resolve(import.meta.dirname, '..');

export interface CatalogInput {
  manifest: Manifest;
  en: EnRecord[];
  id: IdRecord[];
  attribution?: Attribution;
}

export class ContentNotFoundError extends Error {
  readonly contentId: string;
  constructor(contentId: string) {
    super(`content not found: ${contentId}`);
    this.name = 'ContentNotFoundError';
    this.contentId = contentId;
  }
}

/** Data tidak bisa dimuat sama sekali (JSON rusak, skema file salah, ID ganda). */
export class ContentLoadError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`content data invalid:\n${issues.join('\n')}`);
    this.name = 'ContentLoadError';
    this.issues = issues;
  }
}

/** Hash teks EN yang menjadi dasar terjemahan; berubah → terjemahan dianggap usang. */
export function sourceHash(record: Pick<EnRecord, 'name' | 'summary' | 'body'>): string {
  return createHash('sha256')
    .update(JSON.stringify([record.name, record.summary ?? null, record.body]))
    .digest('hex')
    .slice(0, 16);
}

/**
 * Tanda tangan angka dalam teks: dadu dan bilangan, tanpa pemisah ribuan/desimal
 * agar "1,000"/"1.000" dan "1.5"/"1,5" setara antar locale. Tautan `ref:` diabaikan.
 */
export function numberSignature(text: string): string {
  const withoutRefs = text.replace(/\(ref:[^)]*\)/g, '');
  const tokens = withoutRefs.match(/\d+d\d+|\d+(?:[.,]\d+)*/g) ?? [];
  return tokens
    .map((token) => token.replace(/[.,]/g, ''))
    .sort()
    .join(' ');
}

/** Tautan antarentri di markdown: `[teks](ref:spell.fireball)`. */
export function bodyRefs(text: string): string[] {
  return [...text.matchAll(/\]\(ref:([^)\s]+)\)/g)].map((match) => match[1]!);
}

export function createCatalog(input: CatalogInput): ContentCatalog {
  const en = new Map(input.en.map((record) => [record.id, record]));
  const id = new Map(input.id.map((record) => [record.id, record]));

  const getContent = (contentId: Id, locale: Locale): ContentEntry => {
    const source = en.get(contentId);
    if (!source) throw new ContentNotFoundError(contentId);
    const translated = locale === 'id' ? id.get(contentId) : undefined;
    const usable = translated && translated.sourceHash === sourceHash(source) ? translated : undefined;
    const text = usable ?? source;
    return {
      id: source.id,
      kind: kindOf(source.id),
      locale,
      name: text.name,
      originalName: source.name,
      summary: text.summary ?? null,
      body: text.body,
      translation: locale === 'en' ? 'source' : usable ? 'translated' : 'fallback',
      mechanics: (source.mechanics as JsonObject | undefined) ?? null,
      refs: source.refs ?? [],
      source: { ruleset: RULESET, section: source.source.section, page: source.source.page, license: 'CC-BY-4.0' },
    };
  };

  const auditContent = (): ContentAudit => {
    const audit: ContentAudit = { missingIds: [], missingLocales: [], invalidReferences: [], mechanicMismatches: [] };
    const expected = new Map(input.manifest.entries.map((entry) => [entry.id, entry]));

    for (const entry of input.manifest.entries) {
      if (!en.has(entry.id)) audit.missingIds.push(`${entry.id}: missing (${entry.name}, ${entry.section}, p.${entry.page})`);
    }
    for (const record of en.values()) {
      if (!expected.has(record.id)) audit.missingIds.push(`${record.id}: not in manifest`);
    }

    for (const record of en.values()) {
      const translation = id.get(record.id);
      if (!translation) audit.missingLocales.push(`${record.id}: id missing`);
      else if (translation.sourceHash !== sourceHash(record)) audit.missingLocales.push(`${record.id}: id stale`);
    }

    const checkRefs = (owner: string, refs: string[]) => {
      for (const ref of refs) if (!en.has(ref)) audit.invalidReferences.push(`${owner}: unknown ref ${ref}`);
    };
    for (const record of en.values()) {
      checkRefs(record.id, [...(record.refs ?? []), ...bodyRefs(`${record.summary ?? ''}\n${record.body}`)]);
    }
    for (const record of id.values()) {
      if (!en.has(record.id)) audit.invalidReferences.push(`${record.id}: id translation without EN source`);
      checkRefs(`${record.id} (id)`, bodyRefs(`${record.summary ?? ''}\n${record.body}`));
    }

    for (const record of en.values()) {
      const schema = mechanicsSchemas[kindOf(record.id)];
      if (!schema && record.mechanics) audit.mechanicMismatches.push(`${record.id}: kind has no mechanics`);
      if (schema && !record.mechanics) audit.mechanicMismatches.push(`${record.id}: mechanics missing`);
      if (schema && record.mechanics) {
        const parsed = schema.safeParse(record.mechanics);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            audit.mechanicMismatches.push(`${record.id}: mechanics.${issue.path.join('.')} ${issue.message}`);
          }
        }
      }
      const translation = id.get(record.id);
      if (translation) {
        const expectedNumbers = numberSignature(`${record.summary ?? ''}\n${record.body}`);
        const actualNumbers = numberSignature(`${translation.summary ?? ''}\n${translation.body}`);
        if (expectedNumbers !== actualNumbers) {
          audit.mechanicMismatches.push(`${record.id}: id numbers differ (en: ${expectedNumbers} | id: ${actualNumbers})`);
        }
      }
    }
    return audit;
  };

  return {
    ruleset: RULESET,
    ids: () => [...en.keys()],
    has: (contentId) => en.has(contentId),
    getContent,
    auditContent,
  };
}

function readJson(path: string, issues: string[]): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    issues.push(`${path}: ${(error as Error).message}`);
    return undefined;
  }
}

/**
 * Muat manifest + data EN/ID dari disk. File kategori yang belum ada dianggap
 * kosong (audit melaporkan kekurangannya); data yang rusak menggagalkan load.
 */
export function loadCatalogInput(contentDir = defaultContentDir): CatalogInput {
  const issues: string[] = [];
  const manifestPath = join(contentDir, 'source', 'srd-5.2.1-manifest.json');
  const manifestRaw = readJson(manifestPath, issues);
  const manifest = manifestSchema.safeParse(manifestRaw);
  if (!manifest.success) issues.push(`${manifestPath}: ${manifest.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);

  const en: EnRecord[] = [];
  const id: IdRecord[] = [];
  for (const [file, kinds] of Object.entries(CONTENT_FILES) as [ContentFile, readonly string[]][]) {
    for (const [locale, schema, target] of [
      ['en', enFileSchema, en],
      ['id', idFileSchema, id],
    ] as const) {
      const path = join(contentDir, 'data', locale, `${file}.json`);
      if (!existsSync(path)) continue;
      const parsed = schema.safeParse(readJson(path, issues));
      if (!parsed.success) {
        issues.push(`${path}: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
        continue;
      }
      for (const record of parsed.data.entries) {
        if (!kinds.includes(kindOf(record.id))) issues.push(`${path}: ${record.id} does not belong in ${file}.json`);
        (target as Array<EnRecord | IdRecord>).push(record);
      }
    }
  }
  for (const [locale, records] of [
    ['en', en],
    ['id', id],
  ] as const) {
    const seen = new Set<string>();
    for (const record of records) {
      if (seen.has(record.id)) issues.push(`${locale}: duplicate ${record.id}`);
      seen.add(record.id);
    }
  }

  const attributionPath = join(contentDir, 'data', 'attribution.json');
  const attribution = attributionSchema.safeParse(readJson(attributionPath, issues));
  if (!attribution.success) issues.push(`${attributionPath}: invalid`);

  if (issues.length || !manifest.success) throw new ContentLoadError(issues);
  return { manifest: manifest.data, en, id, ...(attribution.success ? { attribution: attribution.data } : {}) };
}

export function loadCatalog(contentDir = defaultContentDir): ContentCatalog {
  return createCatalog(loadCatalogInput(contentDir));
}
