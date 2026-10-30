import { randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Id } from '#shared/contracts';
import type { CampaignSummary, CreatedInvite, InviteView, Member, MemberView, Principal, Role } from '#shared/access';
import { DomainError, forbidden } from '../../common/domain-error.js';
import { DatabaseService } from '../../db/database.service.js';
import { transaction } from '../../db/transaction.js';
import { addPlayerMember, findActiveInvite, findActiveMember, hashSecret } from './access.js';

interface CampaignRow {
  id: Id;
  title: string;
  ruleset: string;
  dm_account_id: Id;
  role: Role;
}

const toSummary = (row: CampaignRow): CampaignSummary => ({
  id: row.id,
  title: row.title,
  ruleset: row.ruleset,
  role: row.role,
  dmAccountId: row.dm_account_id,
});

@Injectable()
export class CampaignsService {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.getHandle();
  }

  /**
   * Anggota aktif campaign. Campaign tak dikenal dan bukan-anggota menghasilkan
   * error yang sama agar keberadaan campaign tidak bocor.
   */
  requireMember(principal: Principal, campaignId: Id): Member {
    const member = findActiveMember(this.db, campaignId, principal.accountId);
    if (!member) throw forbidden();
    return member;
  }

  requireDm(principal: Principal, campaignId: Id): Member {
    const member = this.requireMember(principal, campaignId);
    if (member.role !== 'dm') throw forbidden();
    return member;
  }

  /** Pembuat selalu menjadi DM; owner tidak pernah diambil dari input client. */
  createCampaign(principal: Principal, title: string): Id {
    const id = randomUUID();
    const now = new Date().toISOString();
    transaction(this.db, () => {
      this.db
        .prepare('INSERT INTO campaigns (id, title, dm_account_id, created_at) VALUES (?, ?, ?, ?)')
        .run(id, title.trim(), principal.accountId, now);
      this.db
        .prepare(`INSERT INTO campaign_members (campaign_id, account_id, role, joined_at) VALUES (?, ?, 'dm', ?)`)
        .run(id, principal.accountId, now);
    });
    return id;
  }

  list(principal: Principal): CampaignSummary[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.title, c.ruleset, c.dm_account_id, m.role
         FROM campaign_members m JOIN campaigns c ON c.id = m.campaign_id
         WHERE m.account_id = ? AND m.removed_at IS NULL
         ORDER BY c.created_at, c.id`,
      )
      .all(principal.accountId) as unknown as CampaignRow[];
    return rows.map(toSummary);
  }

  get(principal: Principal, campaignId: Id): CampaignSummary {
    const member = this.requireMember(principal, campaignId);
    const row = this.db
      .prepare('SELECT id, title, ruleset, dm_account_id FROM campaigns WHERE id = ?')
      .get(campaignId) as Omit<CampaignRow, 'role'>;
    return toSummary({ ...row, role: member.role });
  }

  members(principal: Principal, campaignId: Id): MemberView[] {
    this.requireMember(principal, campaignId);
    return (
      this.db
        .prepare(
          `SELECT a.id, a.username, m.role FROM campaign_members m JOIN accounts a ON a.id = m.account_id
           WHERE m.campaign_id = ? AND m.removed_at IS NULL ORDER BY m.role, a.username_key`,
        )
        .all(campaignId) as { id: Id; username: string; role: Role }[]
    ).map((r) => ({ accountId: r.id, username: r.username, role: r.role }));
  }

  createInvite(principal: Principal, campaignId: Id): CreatedInvite {
    this.requireDm(principal, campaignId);
    const id = randomUUID();
    const code = randomBytes(18).toString('base64url');
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO campaign_invites (id, campaign_id, code_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, campaignId, hashSecret(code), principal.accountId, createdAt);
    return { id, code, createdAt, revoked: false };
  }

  invites(principal: Principal, campaignId: Id): InviteView[] {
    this.requireDm(principal, campaignId);
    return (
      this.db
        .prepare('SELECT id, created_at, revoked_at FROM campaign_invites WHERE campaign_id = ? ORDER BY created_at')
        .all(campaignId) as { id: Id; created_at: string; revoked_at: string | null }[]
    ).map((r) => ({ id: r.id, createdAt: r.created_at, revoked: r.revoked_at !== null }));
  }

  revokeInvite(principal: Principal, campaignId: Id, inviteId: Id): void {
    this.requireDm(principal, campaignId);
    const result = this.db
      .prepare('UPDATE campaign_invites SET revoked_at = ? WHERE id = ? AND campaign_id = ? AND revoked_at IS NULL')
      .run(new Date().toISOString(), inviteId, campaignId);
    if (result.changes === 0) throw new DomainError('NOT_FOUND', 404);
  }

  /** Akun yang sudah ada bergabung lewat undangan; role yang ada tidak berubah. */
  joinWithInvite(principal: Principal, code: string): Member {
    return transaction(this.db, () => {
      const invite = findActiveInvite(this.db, code);
      if (!invite) throw new DomainError('INVITE_INVALID', 400);
      return addPlayerMember(this.db, invite.campaignId, principal.accountId, new Date().toISOString());
    });
  }

  removeMember(principal: Principal, campaignId: Id, accountId: Id): void {
    this.requireDm(principal, campaignId);
    const target = findActiveMember(this.db, campaignId, accountId);
    if (!target) throw new DomainError('MEMBER_NOT_FOUND', 404);
    if (target.role === 'dm') throw new DomainError('CANNOT_REMOVE_DM', 400);
    this.db
      .prepare('UPDATE campaign_members SET removed_at = ? WHERE campaign_id = ? AND account_id = ?')
      .run(new Date().toISOString(), campaignId, accountId);
  }
}
