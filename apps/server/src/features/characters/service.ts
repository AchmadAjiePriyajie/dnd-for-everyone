import { randomInt } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { rollAbilityScores } from '#rules/abilities';
import { deriveCharacter } from '#rules/character-stats';
import type { Member, Principal } from '#shared/access';
import {
  ABILITY_METHODS,
  type AbilityMethod,
  type Character,
  type CharacterDraft,
  characterDraftSchema,
  type CharacterSummary,
  type DerivedCharacter,
  emptyDraft,
  OVERRIDE_FIELDS,
} from '#shared/characters';
import type { Id } from '#shared/contracts';
import type { CommandContext } from '../../commands/registry.js';
import { CommandsService } from '../../commands/dispatcher.js';
import { DomainError, forbidden } from '../../common/domain-error.js';
import { ContentService } from '../../content/content.service.js';
import { DatabaseService } from '../../db/database.service.js';
import { ProjectionService } from '../../realtime/projection.js';
import { findActiveMember } from '../campaigns/access.js';
import { CampaignsService } from '../campaigns/service.js';

interface CharacterRow {
  id: Id;
  campaign_id: Id;
  owner_account_id: Id;
  status: 'draft' | 'final';
  class_levels: string;
  draft: string;
  rolls: string;
  overrides: string;
  updated_at: string;
}

export interface CharacterView {
  character: Character;
  derived: DerivedCharacter;
  allowedMethods: AbilityMethod[];
}

const empty = z.strictObject({});
const saveDraftPayload = z.strictObject({ draft: characterDraftSchema });
const transferPayload = z.strictObject({ toAccountId: z.string().min(1).max(100) });
const overridePayload = z.strictObject({ field: z.enum(OVERRIDE_FIELDS), value: z.number().int().min(-99).max(999).nullable() });
const methodsPayload = z.strictObject({
  methods: z.array(z.enum(ABILITY_METHODS)).min(1).max(ABILITY_METHODS.length).refine((methods) => new Set(methods).size === methods.length),
});

const d6 = () => randomInt(1, 7);

@Injectable()
export class CharactersService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly commands: CommandsService,
    private readonly campaigns: CampaignsService,
    private readonly content: ContentService,
    private readonly projection: ProjectionService,
  ) {}

  onModuleInit(): void {
    this.commands.registerCommand('character.create', (ctx) => this.createCharacter(ctx), { schema: empty });
    this.commands.registerCommand(
      'character.save-draft',
      (ctx, payload) => ({ id: this.saveCharacterDraft(ctx, (payload as z.infer<typeof saveDraftPayload>).draft) }),
      { schema: saveDraftPayload },
    );
    this.commands.registerCommand('character.roll-abilities', (ctx) => this.rollAbilities(ctx), { schema: empty });
    this.commands.registerCommand('character.finalize', (ctx) => this.finalize(ctx), { schema: empty });
    this.commands.registerCommand(
      'character.transfer',
      (ctx, payload) => this.transfer(ctx, (payload as z.infer<typeof transferPayload>).toAccountId),
      { schema: transferPayload, roles: ['dm'] },
    );
    this.commands.registerCommand(
      'character.set-override',
      (ctx, payload) => this.setOverride(ctx, payload as z.infer<typeof overridePayload>),
      { schema: overridePayload, roles: ['dm'] },
    );
    this.commands.registerCommand(
      'campaign.set-ability-methods',
      (ctx, payload) => this.setAbilityMethods(ctx, (payload as z.infer<typeof methodsPayload>).methods),
      { schema: methodsPayload, roles: ['dm'] },
    );
    this.projection.registerSection('characters', (db, member) => ({ characters: this.summaries(db, member.campaignId) }));
  }

  /** Membership pemilik karakter; selain pemilik (termasuk DM) ditolak untuk edit wizard. */
  requireCharacterOwner(principal: Principal, characterId: Id): Member {
    const row = this.row(this.database.getHandle(), characterId);
    const member = row && findActiveMember(this.database.getHandle(), row.campaign_id, principal.accountId);
    if (!row || !member || row.owner_account_id !== principal.accountId) throw forbidden();
    return member;
  }

  /** Simpan isi wizard milik pemilik; karakter final tidak lagi diedit lewat wizard. */
  saveCharacterDraft(ctx: CommandContext, draft: CharacterDraft): Id {
    const row = this.ownedRow(ctx);
    if (row.status === 'final') throw new DomainError('CHARACTER_FINAL', 409);
    const classLevels = draft.classId ? [{ classId: draft.classId, level: 1 }] : [];
    ctx.db
      .prepare('UPDATE characters SET draft = ?, class_levels = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(draft), JSON.stringify(classLevels), ctx.now, row.id);
    return row.id;
  }

  getCharacter(principal: Principal, campaignId: Id, characterId: Id): CharacterView {
    const member = this.campaigns.requireMember(principal, campaignId);
    const db = this.database.getHandle();
    const row = this.row(db, characterId);
    // Karakter orang lain dan ID yang tidak ada tidak dapat dibedakan oleh player.
    if (!row || row.campaign_id !== campaignId || (member.role !== 'dm' && row.owner_account_id !== principal.accountId)) {
      throw forbidden();
    }
    const allowedMethods = this.allowedMethods(db, campaignId);
    const character = this.toCharacter(db, row);
    return { character, derived: this.derive(character, allowedMethods), allowedMethods };
  }

  private createCharacter(ctx: CommandContext): { id: Id } {
    if (this.row(ctx.db, ctx.targetId)) throw new DomainError('CHARACTER_EXISTS', 409);
    ctx.db
      .prepare(
        `INSERT INTO characters (id, campaign_id, owner_account_id, status, draft, created_at, updated_at)
         VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
      )
      .run(ctx.targetId, ctx.campaignId, ctx.principal.accountId, JSON.stringify(emptyDraft()), ctx.now, ctx.now);
    return { id: ctx.targetId };
  }

  private rollAbilities(ctx: CommandContext) {
    const row = this.ownedRow(ctx);
    if (row.status === 'final') throw new DomainError('CHARACTER_FINAL', 409);
    if (!this.allowedMethods(ctx.db, ctx.campaignId).includes('roll')) throw new DomainError('METHOD_NOT_ALLOWED', 409);
    if ((JSON.parse(row.rolls) as unknown[]).length) throw new DomainError('ALREADY_ROLLED', 409);
    // Hasil disimpan dalam transaksi command; retry requestId yang sama mengembalikan lemparan yang sama.
    const rolls = rollAbilityScores(d6);
    ctx.db.prepare('UPDATE characters SET rolls = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(rolls), ctx.now, row.id);
    return { rolls: rolls.map((roll) => ({ dice: [...roll.dice], total: roll.total })) };
  }

  private finalize(ctx: CommandContext): { id: Id } {
    const row = this.ownedRow(ctx);
    if (row.status === 'final') throw new DomainError('CHARACTER_FINAL', 409);
    const derived = this.derive(this.toCharacter(ctx.db, row), this.allowedMethods(ctx.db, ctx.campaignId));
    if (derived.issues.length) throw new DomainError('CHARACTER_INCOMPLETE', 422, { count: derived.issues.length });
    ctx.db.prepare("UPDATE characters SET status = 'final', updated_at = ? WHERE id = ?").run(ctx.now, row.id);
    return { id: row.id };
  }

  private transfer(ctx: CommandContext, toAccountId: Id): { id: Id; ownerAccountId: Id } {
    const row = this.campaignRow(ctx);
    if (!findActiveMember(ctx.db, ctx.campaignId, toAccountId)) throw new DomainError('MEMBER_NOT_FOUND', 404);
    ctx.db.prepare('UPDATE characters SET owner_account_id = ?, updated_at = ? WHERE id = ?').run(toAccountId, ctx.now, row.id);
    return { id: row.id, ownerAccountId: toAccountId };
  }

  private setOverride(ctx: CommandContext, input: z.infer<typeof overridePayload>): { id: Id } {
    const row = this.campaignRow(ctx);
    const overrides = JSON.parse(row.overrides) as Record<string, number>;
    if (input.value === null) delete overrides[input.field];
    else overrides[input.field] = input.value;
    ctx.db.prepare('UPDATE characters SET overrides = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(overrides), ctx.now, row.id);
    return { id: row.id };
  }

  private setAbilityMethods(ctx: CommandContext, methods: AbilityMethod[]): { methods: AbilityMethod[] } {
    if (ctx.targetId !== ctx.campaignId) throw new DomainError('VALIDATION_FAILED', 400, { field: 'targetId' });
    const ordered = ABILITY_METHODS.filter((method) => methods.includes(method));
    ctx.db.prepare('UPDATE campaigns SET ability_methods = ? WHERE id = ?').run(JSON.stringify(ordered), ctx.campaignId);
    return { methods: ordered };
  }

  private derive(character: Character, allowedMethods: AbilityMethod[]): DerivedCharacter {
    const derived = deriveCharacter(character, this.content.catalog());
    const method = character.draft.abilityMethod;
    if (method && !allowedMethods.includes(method)) derived.issues.unshift({ field: 'abilityMethod', code: 'NOT_ALLOWED' });
    return derived;
  }

  private allowedMethods(db: DatabaseSync, campaignId: Id): AbilityMethod[] {
    const row = db.prepare('SELECT ability_methods FROM campaigns WHERE id = ?').get(campaignId) as { ability_methods: string } | undefined;
    return row ? (JSON.parse(row.ability_methods) as AbilityMethod[]) : [];
  }

  private summaries(db: DatabaseSync, campaignId: Id): CharacterSummary[] {
    const rows = db
      .prepare('SELECT * FROM characters WHERE campaign_id = ? ORDER BY created_at, id')
      .all(campaignId) as unknown as CharacterRow[];
    return rows.map((row) => {
      const draft = JSON.parse(row.draft) as CharacterDraft;
      const levels = JSON.parse(row.class_levels) as Character['classLevels'];
      return {
        id: row.id,
        ownerAccountId: row.owner_account_id,
        name: draft.name,
        status: row.status,
        classId: levels[0]?.classId ?? draft.classId,
        speciesId: draft.speciesId,
        level: Math.max(1, levels.reduce((total, entry) => total + entry.level, 0)),
      };
    });
  }

  private row(db: DatabaseSync, id: Id): CharacterRow | undefined {
    return db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as unknown as CharacterRow | undefined;
  }

  /** Karakter target pada campaign command; tidak ada → NOT_FOUND. */
  private campaignRow(ctx: CommandContext): CharacterRow {
    const row = this.row(ctx.db, ctx.targetId);
    if (!row || row.campaign_id !== ctx.campaignId) throw new DomainError('NOT_FOUND', 404);
    return row;
  }

  /** Karakter target yang dimiliki actor; milik orang lain → FORBIDDEN. */
  private ownedRow(ctx: CommandContext): CharacterRow {
    const row = this.row(ctx.db, ctx.targetId);
    if (!row || row.campaign_id !== ctx.campaignId || row.owner_account_id !== ctx.principal.accountId) throw forbidden();
    return row;
  }

  private toCharacter(db: DatabaseSync, row: CharacterRow): Character {
    const revision = db
      .prepare('SELECT revision FROM entity_revisions WHERE campaign_id = ? AND target_id = ?')
      .get(row.campaign_id, row.id) as { revision: number } | undefined;
    // Draft lama yang tidak lengkap tetap terbaca dengan default field baru.
    const draft = { ...emptyDraft(), ...(JSON.parse(row.draft) as Partial<CharacterDraft>) };
    return {
      id: row.id,
      campaignId: row.campaign_id,
      ownerAccountId: row.owner_account_id,
      status: row.status,
      classLevels: JSON.parse(row.class_levels),
      draft,
      rolls: JSON.parse(row.rolls),
      overrides: JSON.parse(row.overrides),
      revision: revision?.revision ?? 0,
      updatedAt: row.updated_at,
    };
  }
}
