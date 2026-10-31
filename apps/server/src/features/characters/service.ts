import { randomInt } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { rollAbilityScores, STANDARD_LANGUAGES } from '#rules/abilities';
import { advancementStatus } from '#rules/advancement';
import { availableFeatures } from '#rules/class-features';
import { deriveCharacter } from '#rules/character-stats';
import { cannotAct, normalizeVitals } from '#rules/damage';
import { startingResources } from '#rules/equipment';
import { deriveSpellcasting } from '#rules/spellcasting';
import { masteryGrants } from '#rules/weapon-mastery';
import type { Member, Principal } from '#shared/access';
import {
  ABILITY_METHODS,
  type AbilityMethod,
  type Character,
  type CharacterDraft,
  characterDraftSchema,
  type CharacterOption,
  type CharacterOptions,
  type CharacterSummary,
  type DerivedCharacter,
  emptyDraft,
  emptyFeatureState,
  emptyResources,
  type CharacterResources,
  type FeatureState,
  type FeatureUse,
  type MasteryGrant,
  type AdvancementChoice,
  type AdvancementRecord,
  type AdvancementStatus,
  type SpellcastingState,
  OVERRIDE_FIELDS,
} from '#shared/characters';
import type { Id, Locale } from '#shared/contracts';
import type { CheatSheetRow } from '#shared/notes';
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
  feature_state: string;
  resources: string;
  advancements: string;
  pending_advancement: string | null;
  xp: number;
  levels_granted: number;
  updated_at: string;
}

export interface CharacterView {
  character: Character;
  derived: DerivedCharacter;
  /** Fitur class/subclass dan Heroic Inspiration, teks dalam locale diminta. */
  features: FeatureUse[];
  masteryGrants: MasteryGrant[];
  spellcasting: SpellcastingState;
  advancement: AdvancementStatus;
  allowedMethods: AbilityMethod[];
  restPolicy: RestPolicy;
}

export type RestPolicy = 'dm' | 'players';

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

  /** Angka meja untuk DM: AC, HP (terpisah), Passive Perception dan resource terpakai; hanya karakter final. */
  cheatSheet(db: DatabaseSync, campaignId: Id): CheatSheetRow[] {
    const catalog = this.content.catalog();
    const rows = db
      .prepare("SELECT * FROM characters WHERE campaign_id = ? AND status = 'final' ORDER BY created_at, id")
      .all(campaignId) as unknown as CharacterRow[];
    return rows.map((row) => {
      const character = this.toCharacter(db, row);
      const derived = deriveCharacter(character, catalog);
      return {
        characterId: character.id,
        name: character.draft.name,
        ownerAccountId: character.ownerAccountId,
        armorClass: derived.armorClass.value,
        hitPoints: { current: derived.currentHitPoints, max: derived.hitPoints.value, temp: derived.temporaryHitPoints },
        passivePerception: derived.passivePerception.value,
        resources: availableFeatures(character, catalog).flatMap((feature) =>
          feature.resource ? [{ key: feature.key, name: feature.originalName, remaining: feature.resource.remaining, max: feature.resource.max }] : [],
        ),
        concentration: character.resources.concentration,
      };
    });
  }

  /** Speed berjalan karakter dari sheet (feet), atau null bila karakter tidak ada di campaign. */
  speedFeet(db: DatabaseSync, campaignId: Id, characterId: Id): number | null {
    const row = this.row(db, characterId);
    if (!row || row.campaign_id !== campaignId) return null;
    return deriveCharacter(this.toCharacter(db, row), this.content.catalog()).speed.value;
  }

  /** Shared combat state reads the authoritative sheet, including HP and current ownership. */
  combatStats(db: DatabaseSync, campaignId: Id, characterId: Id) {
    const row = this.row(db, characterId);
    if (!row || row.campaign_id !== campaignId || row.status !== 'final') throw new DomainError('CHARACTER_NOT_FINAL', 409);
    const character = this.toCharacter(db, row);
    const derived = deriveCharacter(character, this.content.catalog());
    return {
      name: character.draft.name, ownerAccountId: character.ownerAccountId,
      speedFeet: derived.speed.value,
      hp: { current: derived.currentHitPoints, max: derived.hitPoints.value, temp: character.resources.hp.temp },
      vitals: normalizeVitals(character.resources.vitals, derived.currentHitPoints),
    };
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

  getCharacter(principal: Principal, campaignId: Id, characterId: Id, locale: Locale = 'en'): CharacterView {
    const member = this.campaigns.requireMember(principal, campaignId);
    const db = this.database.getHandle();
    const row = this.row(db, characterId);
    // Karakter orang lain dan ID yang tidak ada tidak dapat dibedakan oleh player.
    if (!row || row.campaign_id !== campaignId || (member.role !== 'dm' && row.owner_account_id !== principal.accountId)) {
      throw forbidden();
    }
    const allowedMethods = this.allowedMethods(db, campaignId);
    const character = this.toCharacter(db, row);
    const catalog = this.content.catalog();
    return {
      character,
      derived: this.derive(character, allowedMethods),
      features: availableFeatures(character, catalog, locale),
      masteryGrants: masteryGrants(character, catalog),
      spellcasting: deriveSpellcasting(character, catalog),
      advancement: this.advancementStatus(db, row, character),
      allowedMethods,
      restPolicy: this.restPolicy(db, campaignId),
    };
  }

  /** Karakter target command yang dimiliki actor (FORBIDDEN bila bukan). */
  ownedCharacter(ctx: CommandContext): Character {
    return this.toCharacter(ctx.db, this.ownedRow(ctx));
  }

  /** Karakter target pada campaign command, untuk aksi DM (NOT_FOUND bila tidak ada). */
  campaignCharacter(ctx: CommandContext): Character {
    return this.toCharacter(ctx.db, this.campaignRow(ctx));
  }

  writeResources(ctx: CommandContext, characterId: Id, resources: CharacterResources): void {
    const row = this.row(ctx.db, characterId);
    if (row) {
      const character = this.toCharacter(ctx.db, row);
      if (resources.vitals || resources.hp.damage !== character.resources.hp.damage) {
        const current = deriveCharacter({ ...character, resources }, this.content.catalog()).currentHitPoints;
        const vitals = normalizeVitals(resources.vitals, current);
        const incapacitated = cannotAct({ hp: { current }, vitals });
        resources = { ...resources, vitals, concentration: incapacitated ? null : resources.concentration };
      }
    }
    ctx.db.prepare('UPDATE characters SET resources = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(resources), ctx.now, characterId);
  }

  /** Armor/shield yang dipakai tetap di field draft karena deriveCharacter membacanya dari sana. */
  writeEquipment(ctx: CommandContext, character: Character, armorId: Id | null, shield: boolean): void {
    const draft = { ...character.draft, equippedArmorId: armorId, shieldEquipped: shield };
    ctx.db.prepare('UPDATE characters SET draft = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(draft), ctx.now, character.id);
  }

  advancementSettings(db: DatabaseSync, campaignId: Id): { mode: 'milestone' | 'xp'; startingLevel: number } {
    const row = db.prepare('SELECT advancement_mode, starting_level FROM campaigns WHERE id = ?').get(campaignId) as
      | { advancement_mode: 'milestone' | 'xp'; starting_level: number }
      | undefined;
    return { mode: row?.advancement_mode ?? 'milestone', startingLevel: row?.starting_level ?? 1 };
  }

  /** XP dan milestone tersisa karakter (kolom terpisah dari JSON karena diubah DM). */
  progress(db: DatabaseSync, characterId: Id): { xp: number; levelsGranted: number } {
    const row = this.row(db, characterId);
    return { xp: row?.xp ?? 0, levelsGranted: row?.levels_granted ?? 0 };
  }

  private advancementStatus(db: DatabaseSync, row: CharacterRow, character: Character): AdvancementStatus {
    const level = character.classLevels.reduce((total, entry) => total + entry.level, 0);
    return advancementStatus(level, this.advancementSettings(db, row.campaign_id), { xp: row.xp, levelsGranted: row.levels_granted });
  }

  /** Simpan hasil level up: class levels, catatan level, dan kosongkan draft. */
  writeAdvancement(ctx: CommandContext, character: Character): void {
    ctx.db
      .prepare('UPDATE characters SET class_levels = ?, advancements = ?, pending_advancement = ?, updated_at = ? WHERE id = ?')
      .run(
        JSON.stringify(character.classLevels),
        JSON.stringify(character.advancements),
        character.pendingAdvancement ? JSON.stringify(character.pendingAdvancement) : null,
        ctx.now,
        character.id,
      );
  }

  writeProgress(ctx: CommandContext, characterId: Id, progress: { xp: number; levelsGranted: number }): void {
    ctx.db.prepare('UPDATE characters SET xp = ?, levels_granted = ?, updated_at = ? WHERE id = ?').run(progress.xp, progress.levelsGranted, ctx.now, characterId);
  }

  restPolicy(db: DatabaseSync, campaignId: Id): RestPolicy {
    const row = db.prepare('SELECT rest_policy FROM campaigns WHERE id = ?').get(campaignId) as { rest_policy: RestPolicy } | undefined;
    return row?.rest_policy ?? 'dm';
  }

  writeFeatureState(ctx: CommandContext, characterId: Id, state: FeatureState): void {
    ctx.db.prepare('UPDATE characters SET feature_state = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(state), ctx.now, characterId);
  }

  /** Opsi wizard dari corpus untuk anggota campaign; progression/fitur tidak dikirim. */
  characterOptions(principal: Principal, campaignId: Id, locale: Locale): CharacterOptions {
    this.campaigns.requireMember(principal, campaignId);
    const names: Record<Id, string> = {};
    const option = (id: Id, pick?: (mechanics: Record<string, unknown>) => Record<string, unknown>): CharacterOption => {
      const entry = this.content.getContent(id, locale);
      names[id] = entry.name;
      const mechanics = (entry.mechanics ?? {}) as Record<string, unknown>;
      return { id, name: entry.name, originalName: entry.originalName, translation: entry.translation, mechanics: pick ? pick(mechanics) : mechanics };
    };
    const ids = this.content.ids();
    const ofKind = (kind: string) => ids.filter((id) => id.startsWith(`${kind}.`)).sort();
    const withoutProgression = ({ progression: _p, features: _f, ...rest }: Record<string, unknown>) => rest;
    const result: CharacterOptions = {
      species: ofKind('species').map((id) => option(id)),
      backgrounds: ofKind('background').map((id) => option(id)),
      classes: ofKind('class').map((id) => option(id, withoutProgression)),
      originFeats: ofKind('feat').filter((id) => this.content.getContent(id, 'en').mechanics?.category === 'origin').map((id) => option(id)),
      languages: STANDARD_LANGUAGES,
      artisanTools: ofKind('equipment')
        .filter((id) => (this.content.getContent(id, 'en').mechanics?.tool as { artisan?: boolean } | undefined)?.artisan)
        .map((id) => option(id)),
      allowedMethods: this.allowedMethods(this.database.getHandle(), campaignId),
      masteryWeapons: ofKind('equipment')
        .filter((id) => (this.content.getContent(id, 'en').mechanics?.weapon as { mastery?: Id } | undefined)?.mastery)
        .map((id) => option(id, (mechanics) => mechanics.weapon as Record<string, unknown>)),
      items: [...ofKind('equipment'), ...ofKind('magic-item')].map((id) =>
        option(id, (mechanics) => ({ category: mechanics.category, ...(mechanics.attunement ? { attunement: true } : {}) })),
      ),
      spells: ofKind('spell').map((id) =>
        option(id, (mechanics) => ({
          level: mechanics.level,
          classes: mechanics.classes,
          concentration: (mechanics.duration as { concentration?: boolean } | undefined)?.concentration ?? false,
        })),
      ),
      subclasses: ofKind('subclass').map((id) => option(id, ({ class: parent }) => ({ class: parent }))),
      feats: ofKind('feat').map((id) =>
        option(id, ({ category, prerequisiteLevel, repeatable }) => ({ category, ...(prerequisiteLevel ? { prerequisiteLevel } : {}), ...(repeatable ? { repeatable } : {}) })),
      ),
      armor: {},
      names,
    };
    // Judul untuk item/feat yang dirujuk opsi (paket awal, feat background, armor).
    const referenced = new Set<Id>(['equipment.shield', 'equipment.musical-instrument', 'equipment.gaming-set']);
    for (const entry of [...result.classes, ...result.backgrounds]) {
      const mechanics = entry.mechanics as { startingEquipment?: Array<{ items: Array<{ id?: Id }> }>; feat?: Id; toolProficiencies?: { fixed: Id[] } };
      for (const choice of mechanics.startingEquipment ?? []) for (const item of choice.items) if (item.id) referenced.add(item.id);
      if (mechanics.feat) referenced.add(mechanics.feat);
      for (const id of mechanics.toolProficiencies?.fixed ?? []) referenced.add(id);
    }
    for (const weapon of result.masteryWeapons) referenced.add(weapon.mechanics.mastery as Id);
    for (const id of referenced) if (!names[id] && this.content.has(id)) names[id] = this.content.getContent(id, locale).name;
    for (const id of referenced) {
      const armor = this.content.has(id) ? (this.content.getContent(id, 'en').mechanics?.armor as { category?: string } | undefined) : undefined;
      if (armor?.category && armor.category !== 'shield') result.armor[id] = armor.category as 'light' | 'medium' | 'heavy';
    }
    return result;
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
    // Paket awal menjadi inventory/koin yang bisa diubah selama bermain.
    const resources = startingResources(this.toCharacter(ctx.db, row), this.content.catalog());
    ctx.db
      .prepare("UPDATE characters SET status = 'final', resources = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(resources), ctx.now, row.id);
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
    const character: Character = {
      id: row.id,
      campaignId: row.campaign_id,
      ownerAccountId: row.owner_account_id,
      status: row.status,
      classLevels: JSON.parse(row.class_levels),
      draft,
      rolls: JSON.parse(row.rolls),
      overrides: JSON.parse(row.overrides),
      featureState: { ...emptyFeatureState(), ...(JSON.parse(row.feature_state) as Partial<FeatureState>) },
      resources: { ...emptyResources(), ...(JSON.parse(row.resources) as Partial<CharacterResources>) },
      advancements: JSON.parse(row.advancements) as AdvancementRecord[],
      pendingAdvancement: row.pending_advancement ? (JSON.parse(row.pending_advancement) as AdvancementChoice) : null,
      revision: revision?.revision ?? 0,
      updatedAt: row.updated_at,
    };
    // Karakter final dari sebelum migrasi 007: paket awal disalin saat dibaca, ditulis pada command berikutnya.
    if (character.status === 'final' && !character.resources.initialized) character.resources = startingResources(character, this.content.catalog());
    return character;
  }
}
