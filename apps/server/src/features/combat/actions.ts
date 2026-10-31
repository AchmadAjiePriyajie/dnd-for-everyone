import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { DatabaseSync } from 'node:sqlite';
import type { z } from 'zod';
import { applyActionCost, characterActor, monsterActor, previewAction, redactOutcome, resolveAction } from '#rules/actions';
import { deriveCharacter } from '#rules/character-stats';
import { spendFeature } from '#rules/class-features';
import { cannotAct } from '#rules/damage';
import { rollDice } from '#rules/dice';
import { parseStatBlock } from '#rules/monster-actions';
import { setConcentration, spendSlot } from '#rules/spellcasting';
import type { Member, Principal } from '#shared/access';
import {
  type ActionActor, type ActionInput, actionInputSchema, type ActionOption, type ActionPreview, type ActionTarget, type ActionView,
  type Combat, type Combatant, emptyActionUsage, type RandomInt, type RollRecord,
} from '#shared/combat';
import type { Id, JsonValue, Locale } from '#shared/contracts';
import type { GridSettings } from '#shared/scenes';
import { CommandsService } from '../../commands/dispatcher.js';
import type { CommandContext } from '../../commands/registry.js';
import { DomainError, forbidden } from '../../common/domain-error.js';
import { ContentService } from '../../content/content.service.js';
import { DatabaseService } from '../../db/database.service.js';
import { CampaignsService } from '../campaigns/service.js';
import { CharactersService } from '../characters/service.js';
import { RANDOM_INT } from './rolls.js';
import { CombatService } from './service.js';

interface MonsterSource { name: string; body: string; mechanics: { ac?: number; saves?: Record<string, number> } }
const RULE_CODES = new Set(['NO_SLOT_LEFT', 'NO_USES_LEFT', 'FEATURE_NOT_OWNED', 'SPELL_NOT_PREPARED', 'NOT_CONCENTRATION', 'AMOUNT_NOT_ALLOWED', 'FEATURE_NOT_TRACKED']);

/**
 * Guided actions: the server rebuilds actor, targets and preview from its own state on every
 * command, spends costs in the command transaction, rolls with the server random source and
 * records the outcome. HP changes stay proposals for the DM (combat.apply-hp).
 */
@Injectable()
export class ActionsService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly commands: CommandsService,
    private readonly campaigns: CampaignsService,
    private readonly combat: CombatService,
    private readonly characters: CharactersService,
    private readonly content: ContentService,
    @Inject(RANDOM_INT) private readonly random: RandomInt,
  ) {}

  onModuleInit(): void {
    this.commands.registerCommand('combat.act', (ctx, payload) => this.act(ctx, payload as z.infer<typeof actionInputSchema>), { schema: actionInputSchema });
    this.combat.onTurnStart((ctx, combat, creature) => this.rollRecharge(ctx, combat, creature));
  }

  options(principal: Principal, campaignId: Id, combatId: Id, combatantId: Id, locale: Locale): ActionOption[] {
    const { db, member, combat, creature } = this.readable(principal, campaignId, combatId, combatantId);
    return this.actor(db, member.campaignId, combat, creature, locale).options;
  }

  preview(principal: Principal, campaignId: Id, combatId: Id, input: ActionInput, locale: Locale): ActionPreview {
    const { db, member, combat, creature } = this.readable(principal, campaignId, combatId, input.combatantId);
    return previewAction(this.actor(db, campaignId, combat, creature, locale), input, this.view(db, member, combat, true));
  }

  private readable(principal: Principal, campaignId: Id, combatId: Id, combatantId: Id) {
    const member = this.campaigns.requireMember(principal, campaignId);
    const db = this.database.getHandle();
    const combat = this.combat.readState(db, campaignId, combatId);
    const creature = combat?.combatants.find((c) => c.id === combatantId);
    if (!combat || !creature || !this.controls(db, member, creature)) throw forbidden();
    return { db, member, combat, creature };
  }

  private controls(db: DatabaseSync, member: Member, creature: Combatant): boolean {
    return member.role === 'dm' || (creature.ownerAccountId === member.accountId && this.combat.isVisible(db, member, creature));
  }

  private act(ctx: CommandContext, input: ActionInput): JsonValue {
    const combat = this.combat.readState(ctx.db, ctx.campaignId, ctx.targetId);
    const creature = combat?.combatants.find((c) => c.id === input.combatantId);
    if (!combat || !creature || !this.controls(ctx.db, ctx.member, creature)) throw forbidden();
    if (ctx.expectedRevision === null) throw new DomainError('REVISION_REQUIRED', 409);
    if (combat.status !== 'active') throw new DomainError('COMBAT_NOT_ACTIVE', 409);
    const actor = this.actor(ctx.db, ctx.campaignId, combat, creature, 'en');
    const preview = previewAction(actor, input, this.view(ctx.db, ctx.member, combat, false));
    if (preview.issues.length > 0) throw new DomainError('ACTION_INVALID', 409, { issue: preview.issues[0]!, issues: preview.issues.join(',') });
    const audience = input.audience ?? 'public';
    const players: Member = { ...ctx.member, role: 'player', accountId: '' };
    const targets = combat.combatants.filter((c) => preview.targetIds.includes(c.id));
    if (audience === 'public' && ![creature, ...targets].every((c) => this.combat.isVisible(ctx.db, players, c))) throw new DomainError('ROLL_PRIVATE_REQUIRED', 409);

    const paid = applyActionCost(actor, preview);
    creature.budget = paid.budget;
    creature.actions = paid.usage;
    if (creature.characterId) this.spendSheet(ctx, creature.characterId, preview);
    const outcome = resolveAction(preview, input, this.random);
    this.combat.writeState(ctx, combat);
    const id = randomUUID();
    this.record(ctx, id, audience, { combatId: combat.id, combatantId: creature.id }, 'action', outcome);
    // The receipt stores this value, so a player's replay never sees the DM numbers either.
    return { id, outcome: ctx.member.role === 'dm' ? outcome : redactOutcome(outcome) } as unknown as JsonValue;
  }

  /** Slots, Concentration and feature uses live on the sheet, so rests and the sheet stay authoritative. */
  private spendSheet(ctx: CommandContext, characterId: Id, preview: ActionPreview): void {
    const catalog = this.content.catalog();
    let character = this.characters.campaignCharacter({ ...ctx, targetId: characterId });
    try {
      if (preview.cost.slot) character = { ...character, resources: spendSlot(character, catalog, preview.cost.slot.level, preview.cost.slot.pact) };
      const concentration = preview.effects.find((effect) => effect.kind === 'concentration');
      if (concentration) character = { ...character, resources: setConcentration(character, catalog, concentration.spellId) };
      if (preview.cost.slot || concentration) this.characters.writeResources(ctx, characterId, character.resources);
      if (preview.cost.feature) this.characters.writeFeatureState(ctx, characterId, spendFeature(character, preview.cost.feature.key, catalog));
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (RULE_CODES.has(code)) throw new DomainError('ACTION_INVALID', 409, { issue: code, issues: code });
      throw error;
    }
    ctx.db.prepare(`INSERT INTO entity_revisions (campaign_id, target_id, revision) VALUES (?, ?, 1)
      ON CONFLICT (campaign_id, target_id) DO UPDATE SET revision = revision + 1`).run(ctx.campaignId, characterId);
  }

  /** SRD "Recharge X–6": roll a d6 at the start of the creature's turn for each spent Recharge ability. */
  private rollRecharge(ctx: CommandContext, combat: Combat, creature: Combatant): void {
    if (!creature.monsterId || !creature.actions?.recharge.length) return;
    const source = this.monster(ctx.db, ctx.campaignId, creature.monsterId);
    if (!source) return;
    const block = parseStatBlock(source.body);
    const spent: string[] = [];
    for (const slug of creature.actions.recharge) {
      const entry = block.actions.find((action) => action.slug === slug);
      if (!entry || entry.recharge === 'rest' || !entry.recharge) { spent.push(slug); continue; }
      const roll = rollDice('1d6', this.random);
      if (roll.total < entry.recharge.min) spent.push(slug);
      this.record(ctx, randomUUID(), 'dm', { combatId: combat.id, combatantId: creature.id }, 'dice', roll);
    }
    creature.actions = { ...creature.actions, recharge: spent };
  }

  private record(ctx: CommandContext, id: Id, audience: RollRecord['audience'], actor: NonNullable<RollRecord['actor']>, kind: RollRecord['kind'], result: RollRecord['result']): void {
    const record: RollRecord = { id, accountId: ctx.principal.accountId, audience, kind, actor, result, createdAt: ctx.now };
    ctx.db.prepare('INSERT INTO roll_history (id, campaign_id, actor_account_id, audience, record, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, ctx.campaignId, ctx.principal.accountId, audience, JSON.stringify(record), ctx.now);
  }

  private actor(db: DatabaseSync, campaignId: Id, combat: Combat, creature: Combatant, locale: Locale): ActionActor {
    const state = {
      combatantId: creature.id, budget: creature.budget, usage: creature.actions ?? emptyActionUsage(),
      activeTurn: combat.status === 'active' && combat.activeId === creature.id, turn: combat.turn,
      canAct: !creature.defeated && !cannotAct(creature), position: this.position(db, campaignId, combat, creature),
    };
    if (creature.characterId) {
      const character = this.characters.finalCharacter(db, campaignId, creature.characterId);
      if (!character) throw new DomainError('CHARACTER_NOT_FINAL', 409);
      return characterActor(character, this.content.catalog(), state, locale);
    }
    const source = creature.monsterId ? this.monster(db, campaignId, creature.monsterId) : null;
    if (!source) throw new DomainError('MONSTER_UNAVAILABLE', 409);
    return monsterActor({ ...state, monsterId: creature.monsterId!, name: creature.name, body: source.body });
  }

  /** Targets are the creatures this member can see; players never receive monster AC or saves. */
  private view(db: DatabaseSync, member: Member, combat: Combat, redact: boolean): ActionView {
    const grid = combat.sceneId ? db.prepare('SELECT grid FROM scenes WHERE campaign_id = ? AND id = ?').get(combat.campaignId, combat.sceneId) as { grid: string } | undefined : undefined;
    const settings = grid ? JSON.parse(grid.grid) as GridSettings : null;
    const targets: ActionTarget[] = combat.combatants.filter((c) => this.combat.isVisible(db, member, c)).map((c) => {
      const stats = this.defenses(db, combat.campaignId, c);
      const secret = redact && member.role !== 'dm' && c.ownerAccountId !== member.accountId;
      return { id: c.id, name: c.name, position: this.position(db, combat.campaignId, combat, c), ac: secret ? null : stats.ac, saves: secret ? null : stats.saves };
    });
    return { grid: settings ? { feetPerCell: settings.feetPerCell, diagonal: settings.diagonal ?? 'standard' } : null, targets };
  }

  private defenses(db: DatabaseSync, campaignId: Id, creature: Combatant): Pick<ActionTarget, 'ac' | 'saves'> {
    if (creature.characterId) {
      const character = this.characters.finalCharacter(db, campaignId, creature.characterId);
      if (!character) return { ac: null, saves: null };
      const derived = deriveCharacter(character, this.content.catalog());
      return { ac: derived.armorClass.value, saves: Object.fromEntries(Object.entries(derived.savingThrows).map(([key, save]) => [key, save.bonus.value])) };
    }
    const source = creature.monsterId ? this.monster(db, campaignId, creature.monsterId) : null;
    return { ac: source?.mechanics.ac ?? null, saves: source?.mechanics.saves ?? null };
  }

  private position(db: DatabaseSync, campaignId: Id, combat: Combat, creature: Combatant): ActionActor['position'] {
    if (!combat.sceneId) return null;
    const token = db.prepare(`SELECT x, y, size FROM tokens WHERE campaign_id = ? AND scene_id = ? AND (id = ? OR (character_id IS NOT NULL AND character_id = ?)) ORDER BY id = ? DESC LIMIT 1`)
      .get(campaignId, combat.sceneId, creature.tokenId, creature.characterId, creature.tokenId) as { x: number; y: number; size: number } | undefined;
    return token ? { x: token.x, y: token.y, size: token.size } : null;
  }

  /** Stat block source: SRD entries use the EN body (fixed stat block wording); homebrew uses its own body. */
  private monster(db: DatabaseSync, campaignId: Id, monsterId: Id): MonsterSource | null {
    if (monsterId.startsWith('monster.') && this.content.has(monsterId)) {
      const entry = this.content.getContent(monsterId, 'en');
      return { name: entry.name, body: entry.body, mechanics: entry.mechanics as MonsterSource['mechanics'] };
    }
    const row = db.prepare("SELECT name, body, mechanics FROM homebrew WHERE campaign_id = ? AND id = ? AND kind = 'monster' AND status = 'approved'").get(campaignId, monsterId) as { name: string; body: string; mechanics: string } | undefined;
    return row ? { name: row.name, body: row.body, mechanics: JSON.parse(row.mechanics) as MonsterSource['mechanics'] } : null;
  }
}
