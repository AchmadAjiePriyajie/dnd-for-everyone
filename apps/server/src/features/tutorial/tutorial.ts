import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { loadTutorial, type TutorialContent } from '#content/tutorial';
import type { Principal } from '#shared/access';
import type { Id, JsonValue, Locale } from '#shared/contracts';
import type { TutorialGuide } from '#shared/tutorial';
import { CommandsService } from '../../commands/dispatcher.js';
import { forbidden } from '../../common/domain-error.js';
import { DatabaseService } from '../../db/database.service.js';
import { CampaignsService } from '../campaigns/service.js';

/**
 * The original first adventure. It is built with the ordinary commands (notes, scene, tokens,
 * encounter) under stable `tutorial-*` IDs, so the DM can edit, skip or improvise like any campaign.
 */
@Injectable()
export class TutorialService {
  private readonly content = new Map<Locale, TutorialContent>();

  constructor(
    private readonly database: DatabaseService,
    private readonly campaigns: CampaignsService,
    private readonly commands: CommandsService,
  ) {}

  createTutorialCampaign(principal: Principal, locale: Locale): Id {
    const tutorial = this.tutorial(locale);
    const campaignId = this.campaigns.createCampaign(principal, tutorial.title);
    const send = (targetId: Id, kind: string, payload: unknown, expectedRevision?: number) =>
      this.commands.executeCommand(principal, { requestId: randomUUID(), campaignId, targetId, kind, payload: payload as JsonValue, ...(expectedRevision === undefined ? {} : { expectedRevision }) });
    const draft = (note: TutorialContent['notes'][number], links: Id[]) => ({
      kind: note.kind, title: note.title, body: note.body, dmNotes: note.dmNotes, scene: note.scene ?? null, quest: note.quest ?? null, links,
      visibility: { mode: note.visibility },
    });
    // Links point at notes that must exist first: create all, then add links.
    for (const note of tutorial.notes) send(note.id, 'note.save', { draft: draft(note, []) });
    for (const note of tutorial.notes) if (note.links.length) send(note.id, 'note.save', { draft: draft(note, note.links) }, 1);
    send(tutorial.scene.id, 'scene.save', { name: tutorial.scene.name, assetId: null, grid: { columns: 12, rows: 8, cellPixels: 48, offsetX: 0, offsetY: 0, feetPerCell: 5 } });
    send(tutorial.scene.id, 'scene.share', { shared: true }, 1);
    for (const token of tutorial.scene.tokens) {
      send(token.id, 'token.place', { sceneId: tutorial.scene.id, label: token.label, kind: 'monster', monsterId: 'monster.goblin-warrior', x: token.x, y: token.y, size: 1, hidden: false });
    }
    send(tutorial.encounter.id, 'encounter.save', { template: {
      name: tutorial.encounter.name, target: 'low', party: { mode: 'levels', levels: [1, 1] },
      monsters: [{ monsterId: 'monster.goblin-warrior', count: 2, hp: 'average' }], difficultTerrain: false, notes: tutorial.encounter.notes,
    } });
    this.database.getHandle().prepare('INSERT INTO tutorial_campaigns (campaign_id, locale, created_at) VALUES (?, ?, ?)').run(campaignId, locale, new Date().toISOString());
    return campaignId;
  }

  /** Help pointers for this member's role, in the viewer's own language. */
  guide(principal: Principal, campaignId: Id, locale: Locale): TutorialGuide {
    const member = this.campaigns.requireMember(principal, campaignId);
    if (!this.database.getHandle().prepare('SELECT 1 FROM tutorial_campaigns WHERE campaign_id = ?').get(campaignId)) throw forbidden();
    const tutorial = this.tutorial(locale);
    return { campaignId, steps: member.role === 'dm' ? tutorial.guide.dm : tutorial.guide.player };
  }

  private tutorial(locale: Locale): TutorialContent {
    if (!this.content.has(locale)) this.content.set(locale, loadTutorial(locale));
    return this.content.get(locale)!;
  }
}
