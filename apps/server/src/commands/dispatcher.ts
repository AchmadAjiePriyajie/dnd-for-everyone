import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Principal } from '#shared/access';
import { type CommandEnvelope, commandEnvelopeSchema, type CommandResult } from '#shared/commands';
import { DomainError, forbidden } from '../common/domain-error.js';
import { DomainEvents } from '../common/domain-events.js';
import { DatabaseService } from '../db/database.service.js';
import { transaction } from '../db/transaction.js';
import { CampaignsService } from '../features/campaigns/service.js';
import { appendEvent } from './events.js';
import { type CommandHandler, type CommandOptions, CommandRegistry } from './registry.js';

/** JSON stabil (key terurut) untuk fingerprint payload. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const fingerprintOf = (command: CommandEnvelope): string =>
  createHash('sha256')
    .update(
      stableStringify({
        targetId: command.targetId,
        kind: command.kind,
        expectedRevision: command.expectedRevision ?? null,
        payload: command.payload,
      }),
    )
    .digest('base64url');

/**
 * Satu-satunya jalur mutasi gameplay. Urutan: validasi envelope → membership/role →
 * validasi payload → transaksi (receipt → revision → handler → revision/event/receipt)
 * → commit → notifikasi.
 */
@Injectable()
export class CommandsService {
  private readonly registry = new CommandRegistry();

  constructor(
    private readonly database: DatabaseService,
    private readonly campaigns: CampaignsService,
    private readonly events: DomainEvents,
  ) {}

  registerCommand(kind: string, handler: CommandHandler, options?: CommandOptions): void {
    this.registry.register(kind, handler, options);
  }

  executeCommand(principal: Principal, input: unknown): CommandResult {
    const parsed = commandEnvelopeSchema.safeParse(input);
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path.join('.') ?? '';
      throw new DomainError('VALIDATION_FAILED', 400, field ? { field } : {});
    }
    const command = parsed.data as CommandEnvelope;

    // Akses diperiksa sebelum receipt apa pun dibaca.
    const member = this.campaigns.requireMember(principal, command.campaignId);
    const registration = this.registry.get(command.kind);
    if (!registration) throw new DomainError('UNKNOWN_COMMAND', 400);
    if (registration.roles && !registration.roles.includes(member.role)) throw forbidden();
    if (registration.schema) {
      const payload = registration.schema.safeParse(command.payload);
      if (!payload.success) {
        const field = payload.error.issues[0]?.path.join('.') ?? '';
        throw new DomainError('VALIDATION_FAILED', 400, field ? { field: `payload.${field}` } : {});
      }
    }

    const db = this.database.getHandle();
    const fingerprint = fingerprintOf(command);
    const now = new Date().toISOString();

    const outcome = transaction(db, () => {
      const receipt = db
        .prepare(
          `SELECT fingerprint, result FROM command_receipts
           WHERE campaign_id = ? AND actor_account_id = ? AND request_id = ?`,
        )
        .get(command.campaignId, principal.accountId, command.requestId) as
        | { fingerprint: string; result: string }
        | undefined;
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new DomainError('REQUEST_ID_REUSED', 409);
        return { result: JSON.parse(receipt.result) as CommandResult, replay: true };
      }

      const revisionRow = db
        .prepare('SELECT revision FROM entity_revisions WHERE campaign_id = ? AND target_id = ?')
        .get(command.campaignId, command.targetId) as { revision: number } | undefined;
      const currentRevision = revisionRow?.revision ?? 0;
      if (command.expectedRevision !== undefined && command.expectedRevision !== currentRevision) {
        throw new DomainError('STALE_REVISION', 409, { currentRevision });
      }

      const value = registration.handler(
        {
          db,
          principal,
          member,
          now,
          campaignId: command.campaignId,
          targetId: command.targetId,
          requestId: command.requestId,
        },
        command.payload,
      );
      const entityRevision = currentRevision + 1;
      db.prepare(
        `INSERT INTO entity_revisions (campaign_id, target_id, revision) VALUES (?, ?, ?)
         ON CONFLICT (campaign_id, target_id) DO UPDATE SET revision = excluded.revision`,
      ).run(command.campaignId, command.targetId, entityRevision);
      const eventSequence = appendEvent(db, {
        campaignId: command.campaignId,
        kind: command.kind,
        targetId: command.targetId,
        actorAccountId: principal.accountId,
        data: value ?? null,
        now,
      });
      const result: CommandResult = JSON.parse(
        JSON.stringify({ targetId: command.targetId, entityRevision, eventSequence, value: value ?? null }),
      ) as CommandResult;
      db.prepare(
        `INSERT INTO command_receipts (campaign_id, actor_account_id, request_id, fingerprint, result, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(command.campaignId, principal.accountId, command.requestId, fingerprint, JSON.stringify(result), now);
      return { result, replay: false };
    });

    // Diumumkan hanya setelah commit; replay tidak membuat notifikasi baru.
    if (!outcome.replay) {
      this.events.publish('room.changed', {
        campaignId: command.campaignId,
        eventSequence: outcome.result.eventSequence,
      });
    }
    return outcome.result;
  }
}
