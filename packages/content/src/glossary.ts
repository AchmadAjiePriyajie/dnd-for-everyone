import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Id } from '#shared/contracts';
import { bodyRefs, ContentLoadError } from './catalog.ts';

/**
 * Glossary pemula yang dikurasi (bukan AI): alias istilah EN/ID per entri corpus,
 * bantuan singkat "kapan dipakai", dan panduan buatan aplikasi (`guide.*`).
 * Panduan bukan teks SRD dan selalu ditandai demikian di UI.
 */
const localized = z.strictObject({ en: z.string().min(1), id: z.string().min(1) });
const localizedList = z.strictObject({ en: z.array(z.string().min(1)), id: z.array(z.string().min(1)) });

const glossarySchema = z.strictObject({
  version: z.literal(1),
  terms: z.record(
    z.string(),
    z.strictObject({ aliases: localizedList, whenToUse: localized.optional() }),
  ),
  guides: z.array(
    z.strictObject({
      id: z.string().regex(/^guide\.[a-z0-9]+(-[a-z0-9]+)*$/),
      relatedIds: z.array(z.string()),
      phrases: localizedList,
      title: localized,
      summary: localized,
      whenToUse: localized,
      body: localized,
    }),
  ),
});
export type Glossary = z.infer<typeof glossarySchema>;
export type Guide = Glossary['guides'][number];

/** Muat dan validasi glossary; setiap ID yang dirujuk harus ada di corpus. */
export function loadGlossary(contentDir: string, knownIds: (id: Id) => boolean): Glossary {
  const path = join(contentDir, 'data', 'glossary.json');
  const parsed = glossarySchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    throw new ContentLoadError(parsed.error.issues.map((issue) => `${path}: ${issue.path.join('.')} ${issue.message}`));
  }
  const glossary = parsed.data;
  const issues: string[] = [];
  for (const id of Object.keys(glossary.terms)) if (!knownIds(id)) issues.push(`${path}: unknown term ${id}`);
  for (const guide of glossary.guides) {
    const refs = [...guide.relatedIds, ...bodyRefs(guide.body.en), ...bodyRefs(guide.body.id)];
    for (const id of refs) if (!knownIds(id)) issues.push(`${path}: ${guide.id} references unknown ${id}`);
  }
  if (issues.length) throw new ContentLoadError(issues);
  return glossary;
}
