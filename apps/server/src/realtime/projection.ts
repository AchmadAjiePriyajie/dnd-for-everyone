import { Injectable } from '@nestjs/common';
import type { Id } from '#shared/contracts';
import type { DatabaseSync } from 'node:sqlite';
import type { Member, Principal } from '#shared/access';
import type { RoomSnapshot } from '#shared/room';
import { currentSequence } from '../commands/events.js';
import { DatabaseService } from '../db/database.service.js';
import { CampaignsService } from '../features/campaigns/service.js';

/** Bagian snapshot dari fitur lain; menerima member agar dapat memfilter sesuai role. */
export type RoomSection = (db: DatabaseSync, member: Member) => Partial<RoomSnapshot>;

/** Snapshot sesuai hak akses peserta; data DM dibangun hanya untuk DM. */
@Injectable()
export class ProjectionService {
  private readonly sections = new Map<string, RoomSection>();

  /** Fitur mendaftarkan bagian snapshot-nya saat module init; nama ganda gagal. */
  registerSection(name: string, section: RoomSection): void {
    if (this.sections.has(name)) throw new Error(`duplicate room section ${name}`);
    this.sections.set(name, section);
  }

  constructor(
    private readonly database: DatabaseService,
    private readonly campaigns: CampaignsService,
  ) {}

  projectRoom(principal: Principal, campaignId: Id): RoomSnapshot {
    const db = this.database.getHandle();
    // Satu read transaction agar sequence dan isi snapshot konsisten.
    db.exec('BEGIN');
    try {
      const summary = this.campaigns.get(principal, campaignId);
      const snapshot: RoomSnapshot = {
        campaignId,
        eventSequence: currentSequence(db, campaignId),
        campaign: { id: summary.id, title: summary.title, ruleset: summary.ruleset },
        you: { accountId: principal.accountId, role: summary.role },
        members: this.campaigns.members(principal, campaignId),
      };
      if (summary.role === 'dm') snapshot.dm = { invites: this.campaigns.invites(principal, campaignId) };
      const member: Member = { campaignId, accountId: principal.accountId, role: summary.role };
      for (const section of this.sections.values()) Object.assign(snapshot, section(db, member));
      return snapshot;
    } finally {
      db.exec('COMMIT');
    }
  }
}
