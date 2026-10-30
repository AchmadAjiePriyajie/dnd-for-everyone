// tsc tidak menyalin file non-TS; migrasi SQL dan corpus content ikut ke output build server.
import { cpSync } from 'node:fs';

cpSync('apps/server/src/db/migrations', 'dist/apps/server/src/db/migrations', { recursive: true });
cpSync('packages/content/source', 'dist/packages/content/source', { recursive: true });
cpSync('packages/content/data', 'dist/packages/content/data', { recursive: true });
