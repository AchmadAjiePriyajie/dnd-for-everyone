import { Injectable } from '@nestjs/common';
import type { Id } from '#shared/contracts';
import type { Principal } from '#shared/access';
import type { RoomSnapshot } from '#shared/room';
import { currentSequence } from '../commands/events.js';
import { DatabaseService } from '../db/database.service.js';
import { CampaignsService } from '../features/campaigns/service.js';

/** Snapshot sesuai hak akses peserta; data DM dibangun hanya untuk DM. */
@Injectable()
export class ProjectionService {
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
      return snapshot;
    } finally {
      db.exec('COMMIT');
    }
  }
}
