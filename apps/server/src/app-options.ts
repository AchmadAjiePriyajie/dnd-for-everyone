export interface AppOptions {
  /** Direktori data host: database, backup dan asset. Wajib eksplisit. */
  dataDir: string;
  /** Override folder migrasi; hanya untuk pengujian migrasi/backup. */
  migrationsDir?: string;
  /** Hasil build Vite yang disajikan host; tanpa ini tidak ada fallback frontend. */
  webDir?: string;
  /** Override folder corpus (`source/` + `data/`); hanya untuk pengujian. */
  contentDir?: string;
}

export const APP_OPTIONS = Symbol('APP_OPTIONS');
