/**
 * Gate corpus: setiap entri manifest SRD 5.2.1 ada dalam EN dan ID, referensi
 * valid, mekanik sesuai skema, dan angka terjemahan sama dengan sumber.
 *
 * `npm run content:audit` (keluar 1 bila ada masalah).
 */
import { loadCatalog } from '#content/catalog';
import type { ContentAudit } from '#shared/content';

const catalog = loadCatalog();
const audit = catalog.auditContent();
const LIMIT = 15;
let failed = false;
for (const [key, problems] of Object.entries(audit) as [keyof ContentAudit, string[]][]) {
  console.log(`${key}: ${problems.length}`);
  for (const problem of problems.slice(0, LIMIT)) console.log(`  ${problem}`);
  if (problems.length > LIMIT) console.log(`  … ${problems.length - LIMIT} more`);
  failed ||= problems.length > 0;
}
console.log(`entries: ${catalog.ids().length}`);
if (failed) process.exit(1);
