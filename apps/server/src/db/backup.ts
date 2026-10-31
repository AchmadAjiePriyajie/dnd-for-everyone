import { rm } from 'node:fs/promises';
import { backup, type DatabaseSync } from 'node:sqlite';

/**
 * Salinan konsisten memakai SQLite online backup API, bukan menyalin file
 * database saat transaksi/WAL mungkin aktif. File parsial dihapus bila gagal.
 */
export async function backupDatabase(db: DatabaseSync, targetPath: string): Promise<void> {
  try {
    await backup(db, targetPath);
  } catch (error) {
    await rm(targetPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
