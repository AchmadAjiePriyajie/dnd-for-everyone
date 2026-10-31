import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DATABASE_FILE = 'dnd.sqlite';

/**
 * Buka database host di data directory eksplisit. Satu koneksi per proses;
 * foreign keys aktif dan WAL agar pembaca tidak memblokir penulis.
 */
export function openDatabase(dataDir: string): DatabaseSync {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, DATABASE_FILE), { enableForeignKeyConstraints: true });
  try {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec('PRAGMA foreign_keys = ON;');
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
