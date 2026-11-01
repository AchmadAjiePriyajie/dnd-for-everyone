import { randomUUID } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { DatabaseSync } from 'node:sqlite';
import { redactOutcome } from '#rules/actions';
import type { Member } from '#shared/access';
import {
  type ActionOutcome, type ActionPreview, type Combat, type Combatant, type CommittedEffect, emptyActionUsage, type PendingReaction, type Resolution,
  type ResolutionDecision, resolutionDecisionSchema, type RollAudience,
} from '#shared/combat';
import type { Id, JsonValue } from '#shared/contracts';
import { CommandsService } from '../../commands/dispatcher.js';
import type { CommandContext } from '../../commands/registry.js';
import { DomainError, forbidden } from '../../common/domain-error.js';
import { ProjectionService } from '../../realtime/projection.js';
import { CharactersService } from '../characters/service.js';
import { EffectsService } from './effects.js';
import { CombatService } from './service.js';

const OPEN = new Set<Resolution['phase']>(['pending', 'awaitingDecision']);
const CLOSED_IN_SNAPSHOT = 10;

export interface BeginInput {
  combat: Combat;
  actor: Combatant;
  preview: ActionPreview;
  outcome: ActionOutcome;
  audience: RollAudience;
  offers: PendingReaction[];
  respondsTo: Id | null;
}

/**
 * Durable resolutions: pending → awaitingDecision → resolved | cancelled. Costs are paid by the
 * command that creates the resolution; decisions never spend again. Every transition is a command
 * (receipt + event), targeted at the resolution ID so stale decisions fail STALE_REVISION.
 */
@Injectable()
export class ResolutionsService implements OnModuleInit {
  constructor(
    private readonly commands: CommandsService,
    private readonly combat: CombatService,
    private readonly effects: EffectsService,
    private readonly characters: CharactersService,
    private readonly projection: ProjectionService,
  ) {}

  onModuleInit(): void {
    this.commands.registerCommand('resolution.decide', (ctx, payload) => this.decide(ctx, payload as ResolutionDecision), { schema: resolutionDecisionSchema });
    this.projection.registerSection('resolutions', (db, member) => ({ resolutions: this.list(db, member) }));
  }

  /** Called by combat.act after costs are paid, in the same transaction. */
  begin(ctx: CommandContext, input: BeginInput): Resolution {
    const offered = input.offers.length > 0;
    const resolution: Resolution = {
      id: randomUUID(), combatId: input.combat.id, actorId: input.actor.id,
      phase: offered ? 'pending' : input.outcome.proposed.length > 0 ? 'awaitingDecision' : 'resolved',
      audience: input.audience, outcome: input.outcome, costs: input.preview.cost, turn: input.combat.turn,
      proposed: input.outcome.proposed, pendingReactions: input.offers, committedEffects: [], concentrationChecks: [],
      cancellationPolicy: 'no-refund', refund: null, compensation: null, respondsTo: input.respondsTo, revision: 0, createdAt: ctx.now, updatedAt: ctx.now,
    };
    ctx.db.prepare('INSERT INTO resolutions (id, campaign_id, combat_id, actor_id, phase, record, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(resolution.id, ctx.campaignId, resolution.combatId, resolution.actorId, resolution.phase, JSON.stringify(resolution), ctx.now, ctx.now);
    return resolution;
  }

  /** A reaction may only answer an open resolution that offered it to this combatant. */
  requireOffer(db: DatabaseSync, campaignId: Id, resolutionId: Id, combatantId: Id, optionId: string): void {
    const resolution = this.load(db, campaignId, resolutionId);
    if (!resolution) throw forbidden();
    if (!OPEN.has(resolution.phase)) throw new DomainError('RESOLUTION_CLOSED', 409);
    if (!resolution.pendingReactions.some((r) => r.combatantId === combatantId && r.optionId === optionId && r.status === 'offered')) throw new DomainError('REACTION_NOT_OFFERED', 409);
  }

  markDeclared(ctx: CommandContext, resolutionId: Id, combatantId: Id, optionId: string, reactionId: Id): void {
    const resolution = this.load(ctx.db, ctx.campaignId, resolutionId)!;
    resolution.pendingReactions = resolution.pendingReactions.map((r) => r.combatantId === combatantId && r.optionId === optionId && r.status === 'offered' ? { ...r, status: 'declared', resolutionId: reactionId } : r);
    this.settle(resolution);
    this.save(ctx, resolution);
    this.bump(ctx, resolution.id);
  }

  private decide(ctx: CommandContext, input: ResolutionDecision): JsonValue {
    const resolution = this.load(ctx.db, ctx.campaignId, ctx.targetId);
    if (!resolution) throw forbidden();
    if (ctx.expectedRevision === null) throw new DomainError('REVISION_REQUIRED', 409);
    let combat = this.combat.readState(ctx.db, ctx.campaignId, resolution.combatId);
    if (!combat) throw forbidden();
    const dm = ctx.member.role === 'dm';
    if (input.decision === 'decline') {
      const creature = combat.combatants.find((c) => c.id === input.combatantId);
      if (!dm && (!creature || creature.ownerAccountId !== ctx.principal.accountId || !this.combat.isVisible(ctx.db, ctx.member, creature))) throw forbidden();
      if (!OPEN.has(resolution.phase)) throw new DomainError('RESOLUTION_CLOSED', 409);
      if (!resolution.pendingReactions.some((r) => r.combatantId === input.combatantId && r.status === 'offered')) throw new DomainError('REACTION_NOT_OFFERED', 409);
      resolution.pendingReactions = resolution.pendingReactions.map((r) => r.combatantId === input.combatantId && r.status === 'offered' ? { ...r, status: 'declined' } : r);
      this.settle(resolution);
    } else {
      if (!dm) throw forbidden();
      if (input.decision === 'compensate') {
        if (resolution.phase !== 'resolved' || resolution.compensation || resolution.committedEffects.length === 0) throw new DomainError('RESOLUTION_CLOSED', 409);
        // Newest first, so several changes to one creature unwind in order.
        for (const effect of [...resolution.committedEffects].reverse()) {
          const creature = combat.combatants.find((c) => c.id === effect.targetId);
          if (creature) combat = this.effects.restoreHp(ctx, combat, creature, effect);
        }
        resolution.compensation = { reason: input.reason };
      } else {
        if (!OPEN.has(resolution.phase)) throw new DomainError('RESOLUTION_CLOSED', 409);
        if (input.decision === 'commit') this.commit(ctx, resolution, combat, input);
        else this.cancel(ctx, resolution, combat, input);
      }
    }
    this.save(ctx, resolution);
    return { id: resolution.id, phase: resolution.phase };
  }

  private commit(ctx: CommandContext, resolution: Resolution, combat: Combat, input: Extract<ResolutionDecision, { decision: 'commit' }>): void {
    const offered = resolution.pendingReactions.some((r) => r.status === 'offered');
    if (offered && !input.force) throw new DomainError('RESOLUTION_REACTIONS_PENDING', 409);
    resolution.pendingReactions = resolution.pendingReactions.map((r) => r.status === 'offered' ? { ...r, status: 'declined' } : r);
    const committed: CommittedEffect[] = [];
    for (const effect of input.effects ?? resolution.proposed) {
      const creature = combat.combatants.find((c) => c.id === effect.targetId);
      if (!creature) continue; // Removed creatures keep no HP pool; the effect is recorded as skipped by omission.
      if (effect.input.amount === 0) continue;
      const change = this.effects.applyHp(ctx, combat, creature, effect.input);
      combat = change.combat;
      committed.push({ targetId: effect.targetId, input: effect.input, before: change.before, after: change.after });
      const lost = change.before.current + change.before.temp - change.after.current - change.after.temp;
      if (effect.input.kind === 'damage' && lost > 0 && creature.characterId && change.after.current > 0) {
        const sheet = this.characters.campaignCharacter({ ...ctx, targetId: creature.characterId });
        if (sheet.resources.concentration) resolution.concentrationChecks.push({ targetId: creature.id, dc: Math.min(30, Math.max(10, Math.floor(effect.input.amount / 2))) });
      }
    }
    resolution.committedEffects = committed;
    resolution.phase = 'resolved';
  }

  /** Default no refund; an explicit refund needs a reason and only restores what this resolution paid. */
  private cancel(ctx: CommandContext, resolution: Resolution, combat: Combat, input: Extract<ResolutionDecision, { decision: 'cancel' }>): void {
    if (input.refund) {
      if (!input.reason) throw new DomainError('VALIDATION_FAILED', 400, { field: 'payload.reason' });
      const creature = combat.combatants.find((c) => c.id === resolution.actorId);
      if (creature) {
        const costs = resolution.costs;
        const usage = { ...emptyActionUsage(), ...creature.actions, perDay: { ...creature.actions?.perDay } };
        const slug = resolution.outcome.preview.optionId.slice(resolution.outcome.preview.optionId.indexOf(':') + 1);
        if ((costs.turn === 'action' || costs.turn === 'bonus' || costs.turn === 'reaction') && combat.turn === resolution.turn) creature.budget = { ...creature.budget, [costs.turn]: 1 };
        if (costs.turn === 'pool' && usage.pool && usage.pool.remaining !== null && combat.turn === resolution.turn) usage.pool = { ...usage.pool, remaining: usage.pool.remaining + 1 };
        if (costs.turn === 'legendary') usage.legendary = Math.max(0, usage.legendary - costs.legendary);
        if (costs.uses === 'recharge' || costs.uses === 'rest') usage.recharge = usage.recharge.filter((entry) => entry !== slug);
        if (costs.uses === 'per-day') usage.perDay[slug] = Math.max(0, (usage.perDay[slug] ?? 0) - 1);
        if (costs.slot && combat.turn === resolution.turn) delete usage.slotTurn;
        creature.actions = usage;
        if (creature.characterId && (costs.slot || costs.feature)) {
          const sheet = this.characters.campaignCharacter({ ...ctx, targetId: creature.characterId });
          if (costs.slot) {
            const resources = costs.slot.pact
              ? { ...sheet.resources, pactSlotsSpent: Math.max(0, sheet.resources.pactSlotsSpent - 1) }
              : { ...sheet.resources, slotsSpent: sheet.resources.slotsSpent.map((spent, index) => index === costs.slot!.level - 1 ? Math.max(0, spent - 1) : spent) };
            this.characters.writeResources(ctx, sheet.id, resources);
          }
          if (costs.feature) {
            const spent = { ...sheet.featureState.spent };
            const left = Math.max(0, (spent[costs.feature.key] ?? 0) - costs.feature.amount);
            if (left > 0) spent[costs.feature.key] = left; else delete spent[costs.feature.key];
            this.characters.writeFeatureState(ctx, sheet.id, { ...sheet.featureState, spent });
          }
          this.bump(ctx, sheet.id);
        }
        this.combat.writeState(ctx, combat);
      }
      resolution.refund = { reason: input.reason };
    }
    resolution.pendingReactions = resolution.pendingReactions.map((r) => r.status === 'offered' ? { ...r, status: 'declined' } : r);
    resolution.phase = 'cancelled';
  }

  /** Once no reaction is offered, the DM decides (or nothing is left to decide). */
  private settle(resolution: Resolution): void {
    if (resolution.phase !== 'pending' || resolution.pendingReactions.some((r) => r.status === 'offered')) return;
    resolution.phase = resolution.proposed.length > 0 ? 'awaitingDecision' : 'resolved';
  }

  /** Member's filtered view (also used by session resume). */
  list(db: DatabaseSync, member: Member): Resolution[] {
    const rows = db.prepare(`SELECT record FROM resolutions WHERE campaign_id = ? AND (phase IN ('pending', 'awaitingDecision') OR id IN
      (SELECT id FROM resolutions WHERE campaign_id = ? AND phase IN ('resolved', 'cancelled') ORDER BY updated_at DESC, rowid DESC LIMIT ?)) ORDER BY created_at, rowid`)
      .all(member.campaignId, member.campaignId, CLOSED_IN_SNAPSHOT) as Array<{ record: string }>;
    const combats = new Map<Id, Combat | null>();
    const result: Resolution[] = [];
    for (const row of rows) {
      const resolution = this.withRevision(db, member.campaignId, JSON.parse(row.record) as Resolution);
      if (member.role === 'dm') { result.push(resolution); continue; }
      if (!combats.has(resolution.combatId)) combats.set(resolution.combatId, this.combat.readState(db, member.campaignId, resolution.combatId));
      const combat = combats.get(resolution.combatId);
      const actor = combat?.combatants.find((c) => c.id === resolution.actorId);
      if (!combat || resolution.audience !== 'public' || (actor && !this.combat.isVisible(db, member, actor))) continue;
      const own = new Set(combat.combatants.filter((c) => c.ownerAccountId === member.accountId).map((c) => c.id));
      result.push({
        ...resolution, outcome: redactOutcome(resolution.outcome),
        pendingReactions: resolution.pendingReactions.filter((r) => own.has(r.combatantId)),
        committedEffects: resolution.committedEffects.filter((effect) => own.has(effect.targetId)),
      });
    }
    return result;
  }

  private load(db: DatabaseSync, campaignId: Id, id: Id): Resolution | null {
    const row = db.prepare('SELECT record FROM resolutions WHERE campaign_id = ? AND id = ?').get(campaignId, id) as { record: string } | undefined;
    return row ? this.withRevision(db, campaignId, JSON.parse(row.record) as Resolution) : null;
  }

  private withRevision(db: DatabaseSync, campaignId: Id, resolution: Resolution): Resolution {
    const row = db.prepare('SELECT revision FROM entity_revisions WHERE campaign_id = ? AND target_id = ?').get(campaignId, resolution.id) as { revision: number } | undefined;
    return { ...resolution, revision: row?.revision ?? 0 };
  }

  private save(ctx: CommandContext, resolution: Resolution): void {
    resolution.updatedAt = ctx.now;
    const { revision: _revision, ...record } = resolution;
    ctx.db.prepare('UPDATE resolutions SET phase = ?, record = ?, updated_at = ? WHERE campaign_id = ? AND id = ?')
      .run(resolution.phase, JSON.stringify(record), ctx.now, ctx.campaignId, resolution.id);
  }

  private bump(ctx: CommandContext, targetId: Id): void {
    ctx.db.prepare(`INSERT INTO entity_revisions (campaign_id, target_id, revision) VALUES (?, ?, 1)
      ON CONFLICT (campaign_id, target_id) DO UPDATE SET revision = revision + 1`).run(ctx.campaignId, targetId);
  }
}
