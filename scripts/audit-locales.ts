/**
 * Audit catalog UI: setiap key ada di semua locale, tidak kosong, dan memakai
 * parameter interpolasi yang sama. Mengembalikan satu pesan per key bermasalah.
 *
 * CLI: `node scripts/audit-locales.ts` (keluar 1 bila ada masalah).
 */

import { pathToFileURL } from 'node:url';

type Catalog ={ [key: string]: unknown };

function flatten(catalog: Catalog, prefix = '', out = new Map<string, unknown>()): Map<string, unknown> {
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) flatten(value as Catalog, path, out);
    else out.set(path, value);
  }
  return out;
}

function params(text: string): string {
  const names = [...text.matchAll(/\{\{\s*([^},\s]+)[^}]*\}\}/g)].map((m) => m[1]!);
  return [...new Set(names)].sort().join(',');
}

export function auditLocales(catalogs: Record<string, Catalog>): string[] {
  const locales = Object.keys(catalogs);
  const flat = new Map(locales.map((locale) => [locale, flatten(catalogs[locale]!)]));
  const keys = new Set<string>();
  for (const entries of flat.values()) for (const key of entries.keys()) keys.add(key);

  const problems: string[] = [];
  for (const key of [...keys].sort()) {
    const missing = locales.filter((locale) => !flat.get(locale)!.has(key));
    if (missing.length) {
      problems.push(`${key}: missing in ${missing.join(', ')}`);
      continue;
    }
    const values = locales.map((locale) => flat.get(locale)!.get(key));
    const invalid = locales.filter((_, i) => typeof values[i] !== 'string' || (values[i] as string).trim() === '');
    if (invalid.length) {
      problems.push(`${key}: empty or not text in ${invalid.join(', ')}`);
      continue;
    }
    const signatures = values.map((value) => params(value as string));
    if (new Set(signatures).size > 1) {
      const detail = locales.map((locale, i) => `${locale}={${signatures[i]}}`).join(' ');
      problems.push(`${key}: interpolation params differ (${detail})`);
    }
  }
  return problems;
}

async function main(): Promise<void> {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { join, resolve } = await import('node:path');
  const root = resolve(import.meta.dirname, '../apps/web/src/locales');
  const locales = readdirSync(root);
  const files = new Set(locales.flatMap((locale) => readdirSync(join(root, locale))));
  let failed = false;
  for (const file of files) {
    const catalogs: Record<string, Catalog> = {};
    for (const locale of locales) {
      try {
        catalogs[locale] = JSON.parse(readFileSync(join(root, locale, file), 'utf8')) as Catalog;
      } catch {
        catalogs[locale] = {};
      }
    }
    const problems = auditLocales(catalogs);
    for (const problem of problems) console.error(`${file} ${problem}`);
    failed ||= problems.length > 0;
  }
  if (failed) process.exit(1);
  console.log(`locales ok: ${locales.join(', ')} (${files.size} catalog file(s))`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
