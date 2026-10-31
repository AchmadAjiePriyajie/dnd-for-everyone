import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { DatabaseSync } from 'node:sqlite';
import type { z } from 'zod';
import { rollDice, resolveD20, sampleDie } from '#rules/dice';
import { applyDamage, applyDeathSave } from '#rules/damage';
import { redactOutcome } from '#rules/actions';
import {
  type ActionOutcome, conditionsCommandSchema, d20CommandSchema, deathSaveCommandSchema, diceCommandSchema, hpCommandSchema, stabilizeCommandSchema,
  type D20Result, type RandomInt, type RollAudience, type RollRecord,
} from '#shared/combat';
import type { Member } from '#shared/access';
import type { Id, JsonValue } from '#shared/contracts';
import { CommandsService } from '../../commands/dispatcher.js';
import type { CommandContext } from '../../commands/registry.js';
import { DomainError, forbidden } from '../../common/domain-error.js';
import { ProjectionService } from '../../realtime/projection.js';
import { EffectsService } from './effects.js';
import { CombatService } from './service.js';

/** Production provider is crypto.randomInt; tests replace this token with deterministic draws. */
export const RANDOM_INT = Symbol('RANDOM_INT');

@Injectable()
export class RollsService implements OnModuleInit {
  constructor(
    private readonly commands: CommandsService,
    private readonly combat: CombatService,
    private readonly effects: EffectsService,
    private readonly projection: ProjectionService,
    @Inject(RANDOM_INT) private readonly random: RandomInt,
  ) {}

  onModuleInit(): void {
    this.commands.registerCommand('roll.dice', (ctx, payload) => {
      const input = payload as z.infer<typeof diceCommandSchema>;
      this.newRoll(ctx);
      this.authorizeActor(ctx, input.actor, input.audience);
      return this.record(ctx, { audience: input.audience, kind: 'dice', ...(input.actor ? { actor: input.actor } : {}), result: this.rules(() => rollDice(input.expression, this.random, input.critical)) });
    }, { schema: diceCommandSchema });
    this.commands.registerCommand('roll.d20', (ctx, payload) => {
      const input = payload as z.infer<typeof d20CommandSchema>;
      this.newRoll(ctx);
      const actor = this.authorizeActor(ctx, input.actor, input.audience);
      if (input.input.kind === 'initiative' && actor && actor.combat.status !== 'preparing') throw new DomainError('COMBAT_NOT_ACTIVE', 409);
      if (input.input.kind === 'initiative' && actor) {
        if (input.actor?.expectedRevision === undefined) throw new DomainError('REVISION_REQUIRED', 409);
        if (input.actor.expectedRevision !== actor.combat.revision) throw new DomainError('STALE_REVISION', 409, { currentRevision: actor.combat.revision });
      }
      const result = this.rules(() => resolveD20(input.input, this.random));
      if (input.input.kind === 'initiative' && actor) {
        actor.creature.initiative = result.total;
        this.combat.writeState(ctx, actor.combat);
      }
      return this.record(ctx, { audience: input.audience, kind: input.input.kind, ...(input.actor ? { actor: input.actor } : {}), result });
    }, { schema: d20CommandSchema });
    this.commands.registerCommand('combat.apply-hp', (ctx, payload) => {
      const input = payload as z.infer<typeof hpCommandSchema>;
      const { combat, creature } = this.mutable(ctx, input.combatantId, input.sourceRevision);
      const state = this.rules(() => applyDamage(this.effects.hitPoints(ctx.db, ctx.campaignId, creature), input.input));
      this.effects.persist(ctx, combat, creature, state);
      return { id: combat.id, combatantId: creature.id };
    }, { schema: hpCommandSchema, roles: ['dm'] });
    this.commands.registerCommand('combat.conditions', (ctx, payload) => {
      const input = payload as z.infer<typeof conditionsCommandSchema>;
      const { combat, creature } = this.mutable(ctx, input.combatantId, input.sourceRevision);
      const state = this.effects.hitPoints(ctx.db, ctx.campaignId, creature);
      const defenses = input.defenses ?? state.defenses;
      state.defenses = defenses;
      state.unconsciousImmune = defenses.conditionImmunities.includes('condition.unconscious');
      if (state.current === 0) state.zeroHpUnconscious = !state.unconsciousImmune;
      state.conditions = [...new Set(input.conditions)];
      state.exhaustion = input.exhaustion;
      if (state.exhaustion > 0 && !state.conditions.includes('condition.exhaustion')) state.conditions.push('condition.exhaustion');
      if (state.exhaustion === 0) state.conditions = state.conditions.filter((c) => c !== 'condition.exhaustion');
      if (state.conditions.some((condition) => defenses.conditionImmunities.includes(condition))) throw new DomainError('CONDITION_IMMUNE', 409);
      if (input.deathMode && !creature.characterId) state.deathMode = input.deathMode;
      if (state.exhaustion === 6) state.deathSaves.dead = true;
      if (input.defenses) creature.vitals = { ...creature.vitals!, defenses: input.defenses };
      this.effects.persist(ctx, combat, creature, state);
      return { id: combat.id, combatantId: creature.id };
    }, { schema: conditionsCommandSchema, roles: ['dm'] });
    this.commands.registerCommand('combat.stabilize', (ctx, payload) => {
      const input = payload as z.infer<typeof stabilizeCommandSchema>;
      const { combat, creature } = this.mutable(ctx, input.combatantId, input.sourceRevision);
      const state = this.effects.hitPoints(ctx.db, ctx.campaignId, creature);
      if (state.current !== 0 || state.deathSaves.dead || state.deathMode !== 'saves') throw new DomainError('DEATH_SAVE_INVALID', 409);
      state.deathSaves = { successes: 0, failures: 0, stable: true, dead: false };
      this.effects.persist(ctx, combat, creature, state);
      return { id: combat.id, combatantId: creature.id };
    }, { schema: stabilizeCommandSchema, roles: ['dm'] });
    this.commands.registerCommand('combat.death-save', (ctx, payload) => {
      const input = payload as z.infer<typeof deathSaveCommandSchema>;
      const { combat, creature } = this.mutable(ctx, input.combatantId, input.sourceRevision);
      this.authorizeActor(ctx, { combatId: combat.id, combatantId: creature.id }, input.audience);
      if (combat.status !== 'active' || combat.activeId !== creature.id || (creature.vitals?.lastDeathSaveCombatId === combat.id && creature.vitals.lastDeathSaveTurn === combat.turn)) throw new DomainError('DEATH_SAVE_INVALID', 409);
      const state = this.effects.hitPoints(ctx.db, ctx.campaignId, creature);
      // Validate before drawing randomness, so rejected requests never consume a roll.
      this.rules(() => applyDeathSave(state, 10));
      const kept = sampleDie(20, this.random);
      const updated = this.rules(() => applyDeathSave(state, kept));
      updated.lastDeathSaveTurn = combat.turn;
      updated.lastDeathSaveCombatId = combat.id;
      this.effects.persist(ctx, combat, creature, updated);
      const result: D20Result = { kind: 'death', rolls: [kept], kept, modifier: 0, total: kept, critical: false, fumble: false, success: kept >= 10 };
      return this.record(ctx, { audience: input.audience, kind: 'death', actor: { combatId: combat.id, combatantId: creature.id }, result }, randomUUID());
    }, { schema: deathSaveCommandSchema });
    this.projection.registerSection('rolls', (db, member) => ({ rolls: this.history(db, member) }));
  }

  private newRoll(ctx: CommandContext): void {
    if (ctx.db.prepare('SELECT 1 FROM entity_revisions WHERE campaign_id = ? AND target_id = ?').get(ctx.campaignId, ctx.targetId)) throw new DomainError('ROLL_EXISTS', 409);
  }

  private authorizeActor(ctx: CommandContext, actor: RollRecord['actor'], audience: RollAudience) {
    if (!actor) return null;
    const combat = this.combat.readState(ctx.db, ctx.campaignId, actor.combatId);
    const creature = combat?.combatants.find((c) => c.id === actor.combatantId);
    if (!combat || !creature || (ctx.member.role !== 'dm' && (creature.ownerAccountId !== ctx.principal.accountId || !this.combat.isVisible(ctx.db, ctx.member, creature)))) throw forbidden();
    const playerMember: Member = { ...ctx.member, role: 'player' };
    if (audience === 'public' && !this.combat.isVisible(ctx.db, playerMember, creature)) throw new DomainError('ROLL_PRIVATE_REQUIRED', 409);
    return { combat, creature };
  }

  private mutable(ctx: CommandContext, combatantId: Id, sourceRevision?: number) {
    const combat = this.combat.readState(ctx.db, ctx.campaignId, ctx.targetId);
    const creature = combat?.combatants.find((c) => c.id === combatantId);
    if (!combat || !creature || (ctx.member.role !== 'dm' && (!this.combat.isVisible(ctx.db, ctx.member, creature) || creature.ownerAccountId !== ctx.principal.accountId))) throw forbidden();
    if (ctx.expectedRevision === null) throw new DomainError('REVISION_REQUIRED', 409);
    if (combat.status === 'ended') throw new DomainError('COMBAT_ENDED', 409);
    if (creature.characterId) {
      if (sourceRevision === undefined) throw new DomainError('REVISION_REQUIRED', 409);
      if (sourceRevision !== creature.characterRevision) throw new DomainError('STALE_REVISION', 409, { currentRevision: creature.characterRevision! });
    }
    return { combat, creature };
  }

  private record(ctx: CommandContext, input: Omit<RollRecord, 'id' | 'accountId' | 'createdAt'>, id = ctx.targetId): JsonValue {
    const record: RollRecord = { ...input, id, accountId: ctx.principal.accountId, createdAt: ctx.now };
    ctx.db.prepare('INSERT INTO roll_history (id, campaign_id, actor_account_id, audience, record, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, ctx.campaignId, ctx.principal.accountId, record.audience, JSON.stringify(record), ctx.now);
    return { id, result: input.result } as unknown as JsonValue;
  }

  private history(db: DatabaseSync, member: Member): RollRecord[] {
    const rows = db.prepare(`SELECT record FROM roll_history WHERE campaign_id = ? AND (audience = 'public' OR actor_account_id = ? OR ? = 'dm')
      ORDER BY created_at DESC, rowid DESC LIMIT 100`).all(member.campaignId, member.accountId, member.role) as Array<{ record: string }>;
    return rows.map((row) => JSON.parse(row.record) as RollRecord).filter((record) => {
      if (member.role === 'dm' || !record.actor) return true;
      const combat = this.combat.readState(db, member.campaignId, record.actor.combatId);
      const actor = combat?.combatants.find((c) => c.id === record.actor!.combatantId);
      return actor ? this.combat.isVisible(db, member, actor) : false;
    }).slice(0, 50).reverse().map((record) => member.role !== 'dm' && record.kind === 'action' ? { ...record, result: redactOutcome(record.result as ActionOutcome) } : record);
  }

  private rules<T>(run: () => T): T {
    try { return run(); } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'DICE_INVALID' || code === 'D20_INVALID' || code === 'HP_INVALID' || code === 'DEATH_SAVE_INVALID') throw new DomainError(code, 409);
      throw error;
    }
  }
}
