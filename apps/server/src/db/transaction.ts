import type { DatabaseSync } from 'node:sqlite';

/**
 * Jalankan `fn` dalam satu transaksi tulis. Sinkron: tidak ada await/I/O jaringan
 * di dalam transaksi. Error apa pun → ROLLBACK lalu dilempar ulang.
 */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) throw new Error('Nested transactions are not supported');
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
