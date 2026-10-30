import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { OnApplicationShutdown } from '@nestjs/common';
import type { AppOptions } from '../app-options.js';
import { backupDatabase } from './backup.js';
import { openDatabase } from './database.js';
import { appliedVersions, migrate, MIGRATIONS_DIR, pendingMigrations } from './migrate.js';

/** Pemilik tunggal koneksi SQLite proses ini; dibuat via async factory di DatabaseModule. */
export class DatabaseService implements OnApplicationShutdown {
  private constructor(private readonly db: DatabaseSync) {}

  /**
   * Buka database, backup konsisten bila database lama akan dimigrasi, lalu migrasi.
   * Semua selesai sebelum Nest menyelesaikan init, sehingga server belum menerima koneksi.
   */
  static async open(options: AppOptions): Promise<DatabaseService> {
    const db = openDatabase(options.dataDir);
    try {
      const dir = options.migrationsDir ?? MIGRATIONS_DIR;
      const applied = appliedVersions(db);
      if (applied.length > 0 && pendingMigrations(db, dir).length > 0) {
        const backupsDir = join(options.dataDir, 'backups');
        await mkdir(backupsDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        await backupDatabase(db, join(backupsDir, `pre-migrate-v${Math.max(...applied)}-${stamp}.sqlite`));
      }
      migrate(db, dir);
    } catch (error) {
      db.close();
      throw error;
    }
    return new DatabaseService(db);
  }

  getHandle(): DatabaseSync {
    return this.db;
  }

  onApplicationShutdown(): void {
    if (this.db.isOpen) this.db.close();
  }
}
