// Starts the built server on a fresh temporary data directory for Playwright (npm run build first).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const entry = resolve(import.meta.dirname, '../dist/apps/server/src/index.js');
if (!existsSync(entry)) {
  console.error('dist/ is missing: run `npm run build` before `npm run test:e2e`.');
  process.exit(1);
}
const dataDir = mkdtempSync(join(tmpdir(), 'dnd-e2e-'));
const child = spawn(process.execPath, ['--enable-source-maps', entry], {
  stdio: 'inherit',
  env: { ...process.env, DATA_DIR: dataDir, HOST: '127.0.0.1', PORT: process.env.PORT ?? '3931' },
});
const stop = () => child.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => {
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(code ?? 0);
});
