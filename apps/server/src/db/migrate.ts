import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations');

const FILE_PATTERN = /^(\d{3})-([a-z0-9-]+)\.sql$/;

export interface Migration {
  version: number;
  name: string;
  file: string;
}

export function listMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const migrations = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => {
      const match = FILE_PATTERN.exec(file);
      if (!match) throw new Error(`Invalid migration file name: ${file}`);
      return { version: Number(match[1]), name: match[2]!, file: join(dir, file) };
    })
    .sort((a, b) => a.version - b.version);
  for (let i = 1; i < migrations.length; i++) {
    if (migrations[i]!.version === migrations[i - 1]!.version) {
      throw new Error(`Duplicate migration version ${migrations[i]!.version}`);
    }
  }
  return migrations;
}

export function appliedVersions(db: DatabaseSync): number[] {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  if (!table) return [];
  return (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]).map(
    (row) => row.version,
  );
}

/** Migrasi yang belum terpasang. Gagal bila database berasal dari versi aplikasi yang lebih baru. */
export function pendingMigrations(db: DatabaseSync, dir: string = MIGRATIONS_DIR): Migration[] {
  const known = listMigrations(dir);
  const applied = new Set(appliedVersions(db));
  const knownVersions = new Set(known.map((m) => m.version));
  const unknown = [...applied].filter((v) => !knownVersions.has(v));
  if (unknown.length) {
    throw new Error(`Database has migrations unknown to this application: ${unknown.join(', ')}`);
  }
  return known.filter((m) => !applied.has(m.version));
}

/** Pasang migrasi bernomor; tiap file atomik bersama catatan versinya. */
export function migrate(db: DatabaseSync, dir: string = MIGRATIONS_DIR): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT;`);
  const record = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
  for (const migration of pendingMigrations(db, dir)) {
    const sql = readFileSync(migration.file, 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      record.run(migration.version, migration.name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${migration.version}-${migration.name} failed`, { cause: error });
    }
  }
}
