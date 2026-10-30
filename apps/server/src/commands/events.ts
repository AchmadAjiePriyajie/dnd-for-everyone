import type { DatabaseSync } from 'node:sqlite';
import type { Id, JsonValue } from '#shared/contracts';

export function currentSequence(db: DatabaseSync, campaignId: Id): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(sequence), 0) AS seq FROM campaign_events WHERE campaign_id = ?')
    .get(campaignId) as { seq: number };
  return row.seq;
}

export interface NewEvent {
  campaignId: Id;
  kind: string;
  targetId: Id;
  actorAccountId: Id | null;
  data: JsonValue;
  now: string;
}

/** Tambah event dalam transaksi pemanggil; mengembalikan sequence baru. */
export function appendEvent(db: DatabaseSync, event: NewEvent): number {
  if (!db.isTransaction) throw new Error('appendEvent must run inside a transaction');
  const sequence = currentSequence(db, event.campaignId) + 1;
  db.prepare(
    `INSERT INTO campaign_events (campaign_id, sequence, kind, target_id, actor_account_id, data, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(event.campaignId, sequence, event.kind, event.targetId, event.actorAccountId, JSON.stringify(event.data), event.now);
  return sequence;
}
