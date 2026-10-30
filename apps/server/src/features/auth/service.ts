import { randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Id, Locale } from '#shared/contracts';
import type { AccountView, AuthState, Principal } from '#shared/access';
import { DomainError } from '../../common/domain-error.js';
import { DomainEvents } from '../../common/domain-events.js';
import { DatabaseService } from '../../db/database.service.js';
import { transaction } from '../../db/transaction.js';
import { addPlayerMember, findActiveInvite, hashSecret } from '../campaigns/access.js';
import { recordMemberJoined } from '../campaigns/service.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password.js';
import { RateLimiter } from './rate-limit.js';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const inviteInvalid = () => new DomainError('INVITE_INVALID', 400);
const usernameTaken = () => new DomainError('USERNAME_TAKEN', 409);

export interface SessionResult {
  principal: Principal;
  token: string;
}

@Injectable()
export class AuthService {
  readonly loginLimiter = new RateLimiter(10, 15 * 60 * 1000);
  readonly joinLimiter = new RateLimiter(20, 15 * 60 * 1000);

  constructor(
    private readonly database: DatabaseService,
    private readonly events: DomainEvents,
  ) {}

  private get db() {
    return this.database.getHandle();
  }

  state(principal: Principal | undefined): AuthState {
    const any = this.db.prepare('SELECT 1 FROM accounts LIMIT 1').get();
    return { bootstrapRequired: !any, authenticated: principal !== undefined };
  }

  /** Pemilik server pertama; tertutup permanen setelah ada akun. */
  async bootstrapOwner(username: string, password: string): Promise<Principal> {
    if (!this.state(undefined).bootstrapRequired) throw new DomainError('BOOTSTRAP_CLOSED', 403);
    const passwordHash = await hashPassword(password);
    return transaction(this.db, () => {
      if (this.db.prepare('SELECT 1 FROM accounts LIMIT 1').get()) throw new DomainError('BOOTSTRAP_CLOSED', 403);
      return { accountId: this.insertAccount(username, passwordHash, true) };
    });
  }

  /**
   * Registrasi lewat undangan. Hash dibuat di luar transaksi; undangan divalidasi
   * ulang saat commit karena bisa dicabut selama hashing berlangsung.
   */
  async registerInvitedAccount(invite: string, username: string, password: string): Promise<Principal> {
    if (!findActiveInvite(this.db, invite)) throw inviteInvalid();
    if (this.findAccountByUsername(username)) throw usernameTaken();
    const passwordHash = await hashPassword(password);
    const outcome = transaction(this.db, () => {
      const active = findActiveInvite(this.db, invite);
      if (!active) throw inviteInvalid();
      if (this.findAccountByUsername(username)) throw usernameTaken();
      const accountId = this.insertAccount(username, passwordHash, false);
      const now = new Date().toISOString();
      const { member } = addPlayerMember(this.db, active.campaignId, accountId, now);
      return { principal: { accountId }, campaignId: active.campaignId, sequence: recordMemberJoined(this.db, member, now) };
    });
    this.events.publish('room.changed', { campaignId: outcome.campaignId, eventSequence: outcome.sequence });
    return outcome.principal;
  }

  async login(username: string, password: string, clientKey: string): Promise<Principal> {
    const key = `${clientKey}|${username.trim().toLowerCase()}`;
    this.loginLimiter.assertAllowed(key);
    const account = this.findAccountByUsername(username);
    const ok = await verifyPassword(password, account?.password_hash ?? DUMMY_HASH);
    if (!account || !ok) {
      this.loginLimiter.record(key);
      throw new DomainError('INVALID_CREDENTIALS', 401);
    }
    return { accountId: account.id };
  }

  createSession(principal: Principal, now = new Date()): string {
    const token = randomBytes(32).toString('base64url');
    this.db
      .prepare('INSERT INTO auth_sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(hashSecret(token), principal.accountId, now.toISOString(), new Date(now.getTime() + SESSION_TTL_MS).toISOString());
    return token;
  }

  resolveSession(token: string | undefined, now = new Date()): Principal | undefined {
    if (!token) return undefined;
    const row = this.db
      .prepare(
        `SELECT s.account_id FROM auth_sessions s JOIN accounts a ON a.id = s.account_id
         WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
      )
      .get(hashSecret(token), now.toISOString()) as { account_id: Id } | undefined;
    return row && { accountId: row.account_id };
  }

  revokeSession(token: string): void {
    const tokenHash = hashSecret(token);
    this.db
      .prepare('UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .run(new Date().toISOString(), tokenHash);
    this.events.publish('session.revoked', { tokenHash });
  }

  account(principal: Principal): AccountView {
    const row = this.db.prepare('SELECT id, username, locale FROM accounts WHERE id = ?').get(principal.accountId) as
      | { id: Id; username: string; locale: AccountView['locale'] }
      | undefined;
    if (!row) throw new DomainError('UNAUTHENTICATED', 401);
    return { accountId: row.id, username: row.username, locale: row.locale };
  }

  /** Preferensi bahasa UI per akun; tidak memengaruhi state/rules campaign. */
  setLocale(principal: Principal, locale: Locale): AccountView {
    this.db.prepare('UPDATE accounts SET locale = ? WHERE id = ?').run(locale, principal.accountId);
    return this.account(principal);
  }

  private findAccountByUsername(username: string) {
    return this.db
      .prepare('SELECT id, password_hash FROM accounts WHERE username_key = ?')
      .get(username.trim().toLowerCase()) as { id: Id; password_hash: string } | undefined;
  }

  private insertAccount(username: string, passwordHash: string, owner: boolean): Id {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO accounts (id, username, username_key, password_hash, is_server_owner, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, username.trim(), username.trim().toLowerCase(), passwordHash, owner ? 1 : 0, new Date().toISOString());
    return id;
  }
}
