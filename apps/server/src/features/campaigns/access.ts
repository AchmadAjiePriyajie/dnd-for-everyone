import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Id } from '#shared/contracts';
import type { Member, Role } from '#shared/access';

/**
 * Helper SQL akses campaign tanpa dependency Nest, dipakai AuthService
 * (registrasi via undangan) dan CampaignsService tanpa siklus module.
 */

export const hashSecret = (secret: string): string => createHash('sha256').update(secret).digest('base64url');

export function findActiveMember(db: DatabaseSync, campaignId: Id, accountId: Id): Member | undefined {
  const row = db
    .prepare(
      `SELECT campaign_id, account_id, role FROM campaign_members
       WHERE campaign_id = ? AND account_id = ? AND removed_at IS NULL`,
    )
    .get(campaignId, accountId) as { campaign_id: Id; account_id: Id; role: Role } | undefined;
  return row && { campaignId: row.campaign_id, accountId: row.account_id, role: row.role };
}

/** Undangan aktif berdasarkan kode mentah; undefined bila tidak dikenal atau dicabut. */
export function findActiveInvite(db: DatabaseSync, code: string): { id: Id; campaignId: Id } | undefined {
  const row = db
    .prepare('SELECT id, campaign_id FROM campaign_invites WHERE code_hash = ? AND revoked_at IS NULL')
    .get(hashSecret(code)) as { id: Id; campaign_id: Id } | undefined;
  return row && { id: row.id, campaignId: row.campaign_id };
}

/**
 * Tambah/aktifkan ulang keanggotaan player. Role yang sudah ada (misal DM yang
 * memakai undangan campaign-nya sendiri) tidak pernah diubah oleh undangan.
 */
export function addPlayerMember(db: DatabaseSync, campaignId: Id, accountId: Id, now: string): Member {
  const existing = db
    .prepare('SELECT role, removed_at FROM campaign_members WHERE campaign_id = ? AND account_id = ?')
    .get(campaignId, accountId) as { role: Role; removed_at: string | null } | undefined;
  if (!existing) {
    db.prepare(
      `INSERT INTO campaign_members (campaign_id, account_id, role, joined_at) VALUES (?, ?, 'player', ?)`,
    ).run(campaignId, accountId, now);
    return { campaignId, accountId, role: 'player' };
  }
  if (existing.removed_at !== null) {
    db.prepare(
      `UPDATE campaign_members SET removed_at = NULL, joined_at = ? WHERE campaign_id = ? AND account_id = ?`,
    ).run(now, campaignId, accountId);
  }
  return { campaignId, accountId, role: existing.role };
}
