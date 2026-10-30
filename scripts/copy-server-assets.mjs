// tsc tidak menyalin file non-TS; migrasi SQL ikut ke output build server.
import { cpSync } from 'node:fs';

cpSync('apps/server/src/db/migrations', 'dist/apps/server/src/db/migrations', { recursive: true });
