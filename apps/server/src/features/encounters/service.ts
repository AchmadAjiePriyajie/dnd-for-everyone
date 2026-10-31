import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { evaluateEncounter } from '#rules/encounter-budget';
import type { Principal } from '#shared/access';
import type { Character } from '#shared/characters';
import type { Id, Locale } from '#shared/contracts';
import { type EncounterTemplate, encounterTemplateSchema, type EncounterView, type MonsterInstance } from '#shared/encounters';
import type { CommandContext } from '../../commands/registry.js';
import { CommandsService } from '../../commands/dispatcher.js';
import { DomainError } from '../../common/domain-error.js';
import { ContentService } from '../../content/content.service.js';
import { DatabaseService } from '../../db/database.service.js';
import { CampaignsService } from '../campaigns/service.js';
import { HomebrewService } from './homebrew.js';

const savePayload = z.strictObject({ template: encounterTemplateSchema });
const empty = z.strictObject({});

interface MonsterMechanics {
  cr: string;
  xp?: number;
  creatureTypes?: string[];
  size?: string[];
}

/** "1/4" → 0.25; CR tidak dikenal → undefined (tidak memicu risiko palsu). */
function crNumber(cr: string): number | undefined {
  const [top, bottom] = cr.split('/');
  const value = bottom ? Number(top) / Number(bottom) : Number(top);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Template encounter DM dengan estimasi difficulty 2024 dari server. Template tidak berubah oleh
 * HP saat bermain; combat (Task 15) membuat instance terpisah dari template ini.
 */
@Injectable()
export class EncountersService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly commands: CommandsService,
    private readonly campaigns: CampaignsService,
    private readonly content: ContentService,
    private readonly homebrew: HomebrewService,
  ) {}

  onModuleInit(): void {
    this.commands.registerCommand('encounter.save', (ctx, payload) => this.save(ctx, (payload as z.infer<typeof savePayload>).template), {
      schema: savePayload,
      roles: ['dm'],
    });
    this.commands.registerCommand('encounter.delete', (ctx) => this.remove(ctx), { schema: empty, roles: ['dm'] });
  }

  /** Monster SRD dan homebrew yang disetujui untuk picker DM. */
  monsters(principal: Principal, campaignId: Id, locale: Locale): MonsterInstance[] {
    this.campaigns.requireDm(principal, campaignId);
    const db = this.database.getHandle();
    const srd = this.content
      .ids()
      .filter((id) => id.startsWith('monster.'))
      .map((id) => {
        const entry = this.content.getContent(id, locale);
        const mechanics = entry.mechanics as unknown as MonsterMechanics;
        return { id, name: entry.name, originalName: entry.originalName, cr: mechanics.cr, xp: mechanics.xp ?? 0, creatureTypes: mechanics.creatureTypes ?? [], size: mechanics.size ?? [], homebrew: false };
      });
    const own = this.homebrew.approvedMonsters(db, campaignId).map((row) => {
      const mechanics = JSON.parse(row.mechanics) as MonsterMechanics;
      return { id: row.id, name: row.name, originalName: row.name, cr: mechanics.cr, xp: mechanics.xp ?? 0, creatureTypes: mechanics.creatureTypes ?? [], size: mechanics.size ?? [], homebrew: true };
    });
    return [...srd, ...own];
  }

  list(principal: Principal, campaignId: Id): EncounterView[] {
    this.campaigns.requireDm(principal, campaignId);
    const db = this.database.getHandle();
    const rows = db.prepare('SELECT id, template FROM encounter_templates WHERE campaign_id = ? ORDER BY created_at, id').all(campaignId) as Array<{ id: Id; template: string }>;
    return rows.map((row) => this.view(db, campaignId, row.id, JSON.parse(row.template) as EncounterTemplate));
  }

  private save(ctx: CommandContext, template: EncounterTemplate): { id: Id } {
    const existing = ctx.db.prepare('SELECT id FROM encounter_templates WHERE campaign_id = ? AND id = ?').get(ctx.campaignId, ctx.targetId);
    if (existing && ctx.expectedRevision === null) throw new DomainError('REVISION_REQUIRED', 409);
    for (const monster of template.monsters) {
      if (!this.monster(ctx.db, ctx.campaignId, monster.monsterId)) throw new DomainError('MONSTER_UNAVAILABLE', 409, { monster: monster.monsterId });
    }
    if (existing) {
      ctx.db.prepare('UPDATE encounter_templates SET template = ?, updated_at = ? WHERE campaign_id = ? AND id = ?').run(JSON.stringify(template), ctx.now, ctx.campaignId, ctx.targetId);
    } else {
      ctx.db
        .prepare('INSERT INTO encounter_templates (id, campaign_id, template, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(ctx.targetId, ctx.campaignId, JSON.stringify(template), ctx.now, ctx.now);
    }
    return { id: ctx.targetId };
  }

  private remove(ctx: CommandContext): { id: Id } {
    const result = ctx.db.prepare('DELETE FROM encounter_templates WHERE campaign_id = ? AND id = ?').run(ctx.campaignId, ctx.targetId);
    if (!result.changes) throw new DomainError('NOT_FOUND', 404);
    return { id: ctx.targetId };
  }

  private monster(db: DatabaseSync, campaignId: Id, id: Id): MonsterMechanics | null {
    if (id.startsWith('monster.')) return this.content.has(id) ? (this.content.getContent(id, 'en').mechanics as unknown as MonsterMechanics) : null;
    const row = this.homebrew.approvedMonsters(db, campaignId).find((candidate) => candidate.id === id);
    return row ? (JSON.parse(row.mechanics) as MonsterMechanics) : null;
  }

  private partyLevels(db: DatabaseSync, campaignId: Id, party: EncounterTemplate['party']): number[] {
    if (party.mode === 'levels') return party.levels;
    const rows = db.prepare("SELECT id, class_levels FROM characters WHERE campaign_id = ? AND status = 'final'").all(campaignId) as Array<{ id: Id; class_levels: string }>;
    return rows
      .filter((row) => party.characterIds.includes(row.id))
      .map((row) => (JSON.parse(row.class_levels) as Character['classLevels']).reduce((total, entry) => total + entry.level, 0));
  }

  /** Estimasi; input yang belum valid menghasilkan issue, bukan difficulty palsu. */
  private view(db: DatabaseSync, campaignId: Id, id: Id, template: EncounterTemplate): EncounterView {
    const revision = db.prepare('SELECT revision FROM entity_revisions WHERE campaign_id = ? AND target_id = ?').get(campaignId, id) as { revision: number } | undefined;
    const issues: string[] = [];
    const monsters = template.monsters.flatMap((entry) => {
      const mechanics = this.monster(db, campaignId, entry.monsterId);
      if (!mechanics) {
        issues.push(`MONSTER_UNAVAILABLE:${entry.monsterId}`);
        return [];
      }
      if (mechanics.xp === undefined) issues.push(`XP_INVALID:${entry.monsterId}`);
      const cr = crNumber(mechanics.cr);
      return [{ xp: mechanics.xp ?? Number.NaN, count: entry.count, ...(cr === undefined ? {} : { cr }) }];
    });
    let estimate: EncounterView['estimate'] = null;
    if (!issues.length) {
      try {
        estimate = evaluateEncounter(this.partyLevels(db, campaignId, template.party), monsters, { difficultTerrain: template.difficultTerrain });
      } catch (error) {
        issues.push(error instanceof Error ? error.message : 'INVALID');
      }
    }
    return { id, template, estimate, issues, revision: revision?.revision ?? 0 };
  }
}
