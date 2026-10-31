import { randomInt, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { advanceTurn, freshTurnBudget, initiativeOrder } from '#rules/turns';
import { evaluateFormula, parseFormula } from '#rules/formula';
import { movementCost } from '#rules/movement';
import { cannotAct, cannotMove, normalizeVitals } from '#rules/damage';
import type { Member, Principal } from '#shared/access';
import {
  bindTokenSchema, combatantTargetSchema, correctCombatantSchema, reinforcementSchema, setTurnSchema, spendTurnSchema, startCombatSchema,
  type ActionUsage, type Combat, type Combatant, type CombatView, emptyActionUsage, type Reinforcement, type TurnBudget, type VitalState,
} from '#shared/combat';
import type { Id, JsonValue } from '#shared/contracts';
import type { EncounterTemplate } from '#shared/encounters';
import type { FogState, GridPoint, GridSettings } from '#shared/scenes';
import { CommandsService } from '../../commands/dispatcher.js';
import type { CommandContext } from '../../commands/registry.js';
import { DomainError, forbidden } from '../../common/domain-error.js';
import { ContentService } from '../../content/content.service.js';
import { DatabaseService } from '../../db/database.service.js';
import { ProjectionService } from '../../realtime/projection.js';
import { CampaignsService } from '../campaigns/service.js';
import { CharactersService } from '../characters/service.js';

interface CombatRow {
  id: Id; campaign_id: Id; template_id: Id; scene_id: Id | null; name: string;
  status: Combat['status']; round: number; turn: number; active_id: Id | null;
}
interface CombatantRow {
  id: Id; name: string; character_id: Id | null; monster_id: Id | null; token_id: Id | null; owner_account_id: Id | null;
  initiative: number; tie_order: number; hidden: number; defeated: number; speed_feet: number; diagonals_moved: number; hp: string; budget: string; vitals: string; actions: string;
}
interface MonsterStats { hp?: { average?: number; formula?: string }; speed?: { walk?: number } }
const empty = z.strictObject({});
const MAX_COMBATANTS = 200;

/** One authoritative combat per campaign; mutations share the command transaction and receipts. */
@Injectable()
export class CombatService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly commands: CommandsService,
    private readonly campaigns: CampaignsService,
    private readonly characters: CharactersService,
    private readonly content: ContentService,
    private readonly projection: ProjectionService,
  ) {}

  onModuleInit(): void {
    const dm = { roles: ['dm' as const] };
    this.commands.registerCommand('combat.start', (ctx, payload) => {
      const input = payload as z.infer<typeof startCombatSchema>;
      return { id: this.startCombat(ctx, input.templateId, input.sceneId).id };
    }, { schema: startCombatSchema, ...dm });
    for (const kind of ['begin', 'pause', 'resume', 'end', 'next'] as const) {
      this.commands.registerCommand(`combat.${kind}`, (ctx) => this.transition(ctx, kind), { schema: empty, ...dm });
    }
    this.commands.registerCommand('combat.spend', (ctx, payload) => this.spend(ctx, payload as z.infer<typeof spendTurnSchema>), { schema: spendTurnSchema });
    this.commands.registerCommand('combat.bind-token', (ctx, payload) => this.bindToken(ctx, payload as z.infer<typeof bindTokenSchema>), { schema: bindTokenSchema, ...dm });
    this.commands.registerCommand('combat.update', (ctx, payload) => this.correct(ctx, payload as z.infer<typeof correctCombatantSchema>), { schema: correctCombatantSchema, ...dm });
    this.commands.registerCommand('combat.set-turn', (ctx, payload) => {
      const input = payload as z.infer<typeof setTurnSchema>;
      const combat = this.forCommand(ctx);
      this.requireActive(combat);
      const creature = combat.combatants.find((c) => c.id === input.combatantId && !c.defeated);
      if (!creature) throw new DomainError('NOT_FOUND', 404);
      combat.activeId = creature.id;
      this.save(ctx, combat); // A correction changes the pointer, never refunds budgets.
      return { id: combat.id, correction: input };
    }, { schema: setTurnSchema, ...dm });
    this.commands.registerCommand('combat.remove', (ctx, payload) => {
      let combat = this.forCommand(ctx);
      const { combatantId } = payload as z.infer<typeof combatantTargetSchema>;
      if (!combat.combatants.some((c) => c.id === combatantId)) throw new DomainError('NOT_FOUND', 404);
      if (combat.activeId === combatantId) {
        combat.combatants = combat.combatants.map((c) => c.id === combatantId ? { ...c, defeated: true } : c);
        combat = advanceTurn(combat);
      }
      combat.combatants = combat.combatants.filter((c) => c.id !== combatantId);
      ctx.db.prepare('DELETE FROM combatants WHERE campaign_id = ? AND combat_id = ? AND id = ?').run(ctx.campaignId, combat.id, combatantId);
      this.save(ctx, combat);
      return { id: combat.id, combatantId };
    }, { schema: combatantTargetSchema, ...dm });
    this.commands.registerCommand('combat.reinforce', (ctx, payload) => {
      const combat = this.forCommand(ctx);
      this.add(ctx, combat, payload as Reinforcement);
      // Empty running combat can accept a new first turn without requiring a dummy next command.
      const updated = !combat.activeId && combat.status === 'active' ? advanceTurn(combat) : combat;
      this.save(ctx, updated);
      return { id: combat.id };
    }, { schema: reinforcementSchema, ...dm });
    this.projection.registerSection('combat', (db, member) => {
      const row = db.prepare('SELECT id FROM combats WHERE campaign_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(member.campaignId) as { id: Id } | undefined;
      return { combat: row ? this.project(db, member, this.load(db, member.campaignId, row.id)!) : null };
    });
  }

  startCombat(ctx: CommandContext, templateId: Id, sceneId?: Id): Combat {
    if (ctx.db.prepare("SELECT 1 FROM combats WHERE campaign_id = ? AND (status != 'ended' OR id = ?)").get(ctx.campaignId, ctx.targetId)) throw new DomainError('COMBAT_EXISTS', 409);
    const row = ctx.db.prepare('SELECT template FROM encounter_templates WHERE campaign_id = ? AND id = ?').get(ctx.campaignId, templateId) as { template: string } | undefined;
    if (!row) throw new DomainError('NOT_FOUND', 404);
    if (sceneId && !ctx.db.prepare('SELECT 1 FROM scenes WHERE campaign_id = ? AND id = ?').get(ctx.campaignId, sceneId)) throw new DomainError('NOT_FOUND', 404);
    const template = JSON.parse(row.template) as EncounterTemplate;
    const combat: Combat = { id: ctx.targetId, campaignId: ctx.campaignId, templateId, sceneId: sceneId ?? null, name: template.name, status: 'preparing', round: 0, turn: 0, activeId: null, combatants: [], revision: 0 };
    ctx.db.prepare('INSERT INTO combats (id, campaign_id, template_id, scene_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(combat.id, combat.campaignId, templateId, combat.sceneId, combat.name, combat.status, ctx.now, ctx.now);
    if (template.party.mode === 'characters') {
      for (const characterId of template.party.characterIds) this.add(ctx, combat, { characterId, initiative: 0, hidden: false });
    }
    for (const monster of template.monsters) this.add(ctx, combat, { ...monster, initiative: 0, hidden: false });
    this.save(ctx, combat);
    return combat;
  }

  get(principal: Principal, campaignId: Id, combatId: Id): CombatView {
    const member = this.campaigns.requireMember(principal, campaignId);
    const db = this.database.getHandle();
    const combat = this.load(db, campaignId, combatId);
    if (!combat) throw forbidden();
    return this.project(db, member, combat);
  }

  private readonly turnListeners: Array<(ctx: CommandContext, combat: Combat, creature: Combatant) => void> = [];
  /** Feature services (guided actions) register start-of-turn work; listeners may mutate the creature before it is saved. */
  onTurnStart(listener: (ctx: CommandContext, combat: Combat, creature: Combatant) => void): void { this.turnListeners.push(listener); }

  /** Internal feature API for rolls/effects, always inside the caller's command transaction. */
  readState(db: DatabaseSync, campaignId: Id, combatId: Id): Combat | null { return this.load(db, campaignId, combatId); }
  writeState(ctx: CommandContext, combat: Combat): void {
    this.save(ctx, combat);
    if (ctx.targetId !== combat.id) this.bumpRevision(ctx, combat.id);
  }
  isVisible(db: DatabaseSync, member: Member, creature: Combatant): boolean { return this.visible(db, member, creature); }

  /** Called inside token.move's transaction; dispatcher replays never enter here twice. */
  consumeMovement(ctx: CommandContext, token: { id: Id; character_id: Id | null; scene_id: Id }, path: GridPoint[], grid: GridSettings, override: boolean): number | null {
    const row = ctx.db.prepare(`SELECT c.id FROM combats c JOIN combatants a ON a.campaign_id = c.campaign_id AND a.combat_id = c.id
      WHERE c.campaign_id = ? AND c.status != 'ended' AND (c.scene_id IS NULL OR c.scene_id = ?)
      AND (a.token_id = ? OR (a.character_id IS NOT NULL AND a.character_id = ?)) LIMIT 1`)
      .get(ctx.campaignId, token.scene_id, token.id, token.character_id) as { id: Id } | undefined;
    if (!row) return null;
    const combat = this.load(ctx.db, ctx.campaignId, row.id)!;
    if (combat.status === 'preparing') return null;
    const creature = combat.combatants.find((c) => c.tokenId === token.id || (c.characterId !== null && c.characterId === token.character_id))!;
    this.requireControl(ctx, combat, creature);
    this.requireActive(combat);
    if (!override && cannotMove(creature)) throw new DomainError('COMBAT_CANNOT_ACT', 409);
    const feet = movementCost(path, grid, creature.diagonalsMoved);
    if (!override && (combat.activeId !== creature.id || creature.defeated)) throw new DomainError('COMBAT_NOT_YOUR_TURN', 409);
    if (!override && feet > creature.budget.movement) throw new DomainError('MOVE_OVER_BUDGET', 409, { costFeet: feet, speed: creature.budget.movement });
    creature.budget.movement = Math.max(0, creature.budget.movement - feet);
    creature.diagonalsMoved += path.slice(1).filter((point, index) => point.x !== path[index]!.x && point.y !== path[index]!.y).length;
    this.save(ctx, combat);
    this.bumpRevision(ctx, combat.id);
    return feet;
  }

  /** DM map projection shares the same monster HP pool as its combat instance. */
  tokenHitPoints(db: DatabaseSync, campaignId: Id, tokenId: Id): Combatant['hp'] | undefined {
    const character = db.prepare(`SELECT c.id FROM tokens t JOIN characters c ON c.campaign_id = t.campaign_id AND c.id = t.character_id
      WHERE t.campaign_id = ? AND t.id = ? AND c.status = 'final'`).get(campaignId, tokenId) as { id: Id } | undefined;
    if (character) return this.characters.combatStats(db, campaignId, character.id).hp;
    const row = db.prepare(`SELECT a.hp FROM combatants a JOIN combats c ON c.campaign_id = a.campaign_id AND c.id = a.combat_id
      WHERE a.campaign_id = ? AND a.token_id = ? ORDER BY c.created_at DESC, c.rowid DESC LIMIT 1`).get(campaignId, tokenId) as { hp: string } | undefined;
    return row ? JSON.parse(row.hp) as Combatant['hp'] : undefined;
  }

  private forCommand(ctx: CommandContext): Combat {
    const combat = this.load(ctx.db, ctx.campaignId, ctx.targetId);
    if (!combat) throw forbidden();
    if (ctx.expectedRevision === null) throw new DomainError('REVISION_REQUIRED', 409);
    if (combat.status === 'ended') throw new DomainError('COMBAT_ENDED', 409);
    return combat;
  }

  private requireActive(combat: Combat): void {
    if (combat.status !== 'active') throw new DomainError('COMBAT_NOT_ACTIVE', 409);
  }

  private transition(ctx: CommandContext, kind: 'begin' | 'pause' | 'resume' | 'end' | 'next'): { id: Id } {
    let combat = this.forCommand(ctx);
    if (kind === 'begin') {
      if (combat.status !== 'preparing') throw new DomainError('COMBAT_NOT_ACTIVE', 409);
      combat.status = 'active';
      combat = advanceTurn(combat);
      combat.round = 1;
    } else if (kind === 'end') {
      combat.status = 'ended'; combat.activeId = null;
    } else if (kind === 'resume') {
      if (combat.status !== 'paused') throw new DomainError('COMBAT_NOT_ACTIVE', 409);
      combat.status = 'active';
    } else {
      this.requireActive(combat);
      if (kind === 'pause') combat.status = 'paused';
      else combat = advanceTurn(combat);
    }
    this.save(ctx, combat);
    return { id: combat.id };
  }

  private spend(ctx: CommandContext, input: z.infer<typeof spendTurnSchema>): { id: Id } {
    const combat = this.forCommand(ctx);
    const creature = combat.combatants.find((c) => c.id === input.combatantId);
    this.requireControl(ctx, combat, creature);
    this.requireActive(combat);
    if (input.resource === 'movement' ? cannotMove(creature!) : cannotAct(creature!)) throw new DomainError('COMBAT_CANNOT_ACT', 409);
    if (creature!.defeated || (input.resource !== 'reaction' && combat.activeId !== creature!.id)) throw new DomainError('COMBAT_NOT_YOUR_TURN', 409);
    const amount = input.amount ?? 1;
    if (input.resource !== 'movement' && amount !== 1) throw new DomainError('VALIDATION_FAILED', 400);
    if (creature!.budget[input.resource] < amount) throw new DomainError('COMBAT_BUDGET_EXHAUSTED', 409);
    creature!.budget[input.resource] -= amount;
    this.save(ctx, combat);
    return { id: combat.id };
  }

  private requireControl(ctx: CommandContext, combat: Combat, creature: Combatant | undefined): void {
    if (!creature || (ctx.member.role !== 'dm' && (!this.visible(ctx.db, ctx.member, creature) || creature.ownerAccountId !== ctx.principal.accountId))) throw forbidden();
  }

  private correct(ctx: CommandContext, input: z.infer<typeof correctCombatantSchema>): JsonValue {
    let combat = this.forCommand(ctx);
    const creature = combat.combatants.find((c) => c.id === input.combatantId);
    if (!creature) throw new DomainError('NOT_FOUND', 404);
    const { hpCurrent, ...patch } = input.patch;
    if (hpCurrent !== undefined) {
      if (hpCurrent > creature.hp.max) throw new DomainError('HP_INVALID', 409, { max: creature.hp.max });
      if (creature.characterId) {
        if (input.sourceRevision === undefined) throw new DomainError('REVISION_REQUIRED', 409);
        if (input.sourceRevision !== creature.characterRevision) throw new DomainError('STALE_REVISION', 409, { currentRevision: creature.characterRevision! });
        const character = this.characters.campaignCharacter({ ...ctx, targetId: creature.characterId });
        this.characters.writeResources(ctx, character.id, { ...character.resources, hp: { ...character.resources.hp, damage: creature.hp.max - hpCurrent } });
        this.bumpRevision(ctx, character.id);
      }
      creature.hp.current = hpCurrent;
      creature.vitals = normalizeVitals(creature.vitals, hpCurrent, creature.characterId ? 'saves' : 'instant');
    }
    Object.assign(creature, patch);
    if (creature.defeated && combat.activeId === creature.id) combat = advanceTurn(combat);
    this.save(ctx, combat);
    return { id: combat.id, correction: input };
  }

  /** Explicit mapping also supports tokens placed through the map UI without source IDs. */
  private bindToken(ctx: CommandContext, input: z.infer<typeof bindTokenSchema>): { id: Id } {
    const combat = this.forCommand(ctx);
    const creature = combat.combatants.find((c) => c.id === input.combatantId);
    if (!creature) throw new DomainError('NOT_FOUND', 404);
    if (input.tokenId !== null) {
      const token = ctx.db.prepare('SELECT id, scene_id, character_id, monster_id, owner_account_id FROM tokens WHERE campaign_id = ? AND id = ?')
        .get(ctx.campaignId, input.tokenId) as { id: Id; scene_id: Id; character_id: Id | null; monster_id: Id | null; owner_account_id: Id | null } | undefined;
      if (!token || token.scene_id !== combat.sceneId || combat.combatants.some((c) => c.id !== creature.id && c.tokenId === token.id)
        || (token.character_id !== null && token.character_id !== creature.characterId) || (token.monster_id !== null && token.monster_id !== creature.monsterId)) {
        throw new DomainError('TOKEN_LINK_INVALID', 409);
      }
      const owner = creature.characterId ? creature.ownerAccountId : token.owner_account_id;
      ctx.db.prepare('UPDATE tokens SET character_id = ?, monster_id = ?, kind = ?, owner_account_id = ?, updated_at = ? WHERE campaign_id = ? AND id = ?')
        .run(creature.characterId, creature.monsterId, creature.characterId ? 'character' : 'monster', owner, ctx.now, ctx.campaignId, token.id);
      this.bumpRevision(ctx, token.id);
      creature.ownerAccountId = owner;
    } else if (!creature.characterId) creature.ownerAccountId = null;
    creature.tokenId = input.tokenId;
    this.save(ctx, combat);
    return { id: combat.id };
  }

  private add(ctx: CommandContext, combat: Combat, source: Reinforcement): void {
    const count = 'characterId' in source ? 1 : source.count;
    if (combat.combatants.length + count > MAX_COMBATANTS) throw new DomainError('COMBAT_LIMIT', 409);
    if ('characterId' in source && combat.combatants.some((c) => c.characterId === source.characterId)) throw new DomainError('COMBATANT_EXISTS', 409);
    let name: string, hp: Combatant['hp'], speed: number, owner: Id | null = null;
    if ('characterId' in source) {
      const stats = this.characters.combatStats(ctx.db, ctx.campaignId, source.characterId);
      name = stats.name; hp = stats.hp; speed = stats.speedFeet; owner = stats.ownerAccountId;
    } else {
      const monster = this.monster(ctx.db, ctx.campaignId, source.monsterId);
      name = monster.name;
      const average = monster.stats.hp?.average;
      if (!Number.isInteger(average) || average! < 1) throw new DomainError('MONSTER_UNAVAILABLE', 409);
      speed = monster.stats.speed?.walk ?? 0;
      hp = { current: average!, max: average!, temp: 0 };
    }
    for (let index = 0; index < count; index++) {
      let instanceHp = { ...hp };
      if ('monsterId' in source && source.hp === 'rolled') {
        const formula = this.monster(ctx.db, ctx.campaignId, source.monsterId).stats.hp?.formula;
        if (!formula) throw new DomainError('MONSTER_UNAVAILABLE', 409);
        try {
          const rolled = Math.max(1, evaluateFormula(parseFormula(formula), {}, (sides) => randomInt(1, sides + 1)));
          instanceHp = { current: rolled, max: rolled, temp: 0 };
        } catch { throw new DomainError('MONSTER_UNAVAILABLE', 409); }
      }
      const match = combat.sceneId ? (ctx.db.prepare(`SELECT id, hidden, owner_account_id FROM tokens WHERE campaign_id = ? AND scene_id = ? AND ${'characterId' in source ? 'character_id' : 'monster_id'} = ? ORDER BY created_at, id`)
        .all(ctx.campaignId, combat.sceneId, 'characterId' in source ? source.characterId : source.monsterId) as Array<{ id: Id; hidden: number; owner_account_id: Id | null }>).find((token) => !combat.combatants.some((c) => c.tokenId === token.id)) : undefined;
      const creature: Combatant = {
        id: randomUUID(), name: 'monsterId' in source ? `${name} ${combat.combatants.filter((c) => c.monsterId === source.monsterId).length + 1}` : name,
        characterId: 'characterId' in source ? source.characterId : null, monsterId: 'monsterId' in source ? source.monsterId : null,
        tokenId: match?.id ?? null, ownerAccountId: 'characterId' in source ? owner : match?.owner_account_id ?? null, initiative: source.initiative,
        tieOrder: Math.max(-1, ...combat.combatants.map((c) => c.tieOrder)) + 1,
        hidden: source.hidden || Boolean(match?.hidden), defeated: false, speedFeet: speed, diagonalsMoved: 0, hp: instanceHp, budget: freshTurnBudget(speed),
      };
      combat.combatants.push(creature);
    }
  }

  private monster(db: DatabaseSync, campaignId: Id, monsterId: Id): { name: string; stats: MonsterStats } {
    if (monsterId.startsWith('monster.') && this.content.has(monsterId)) {
      const entry = this.content.getContent(monsterId, 'en');
      return { name: entry.name, stats: entry.mechanics as MonsterStats };
    }
    const row = db.prepare("SELECT name, mechanics FROM homebrew WHERE campaign_id = ? AND id = ? AND kind = 'monster' AND status = 'approved'").get(campaignId, monsterId) as { name: string; mechanics: string } | undefined;
    if (!row) throw new DomainError('MONSTER_UNAVAILABLE', 409);
    return { name: row.name, stats: JSON.parse(row.mechanics) as MonsterStats };
  }

  private load(db: DatabaseSync, campaignId: Id, combatId: Id): Combat | null {
    const row = db.prepare('SELECT * FROM combats WHERE campaign_id = ? AND id = ?').get(campaignId, combatId) as unknown as CombatRow | undefined;
    if (!row) return null;
    const revision = db.prepare('SELECT revision FROM entity_revisions WHERE campaign_id = ? AND target_id = ?').get(campaignId, combatId) as { revision: number } | undefined;
    const rows = db.prepare('SELECT * FROM combatants WHERE campaign_id = ? AND combat_id = ?').all(campaignId, combatId) as unknown as CombatantRow[];
    const combatants = rows.map((c): Combatant => {
      const creature: Combatant = { id: c.id, name: c.name, characterId: c.character_id, monsterId: c.monster_id, tokenId: c.token_id, ownerAccountId: c.owner_account_id, initiative: c.initiative, tieOrder: c.tie_order, hidden: Boolean(c.hidden), defeated: Boolean(c.defeated), speedFeet: c.speed_feet, diagonalsMoved: c.diagonals_moved, hp: JSON.parse(c.hp) as Combatant['hp'], budget: JSON.parse(c.budget) as TurnBudget };
      creature.vitals = normalizeVitals(JSON.parse(c.vitals) as VitalState, creature.hp.current, creature.characterId ? 'saves' : 'instant');
      creature.actions = { ...emptyActionUsage(), ...(JSON.parse(c.actions) as Partial<ActionUsage>) };
      if (creature.characterId) {
        // A deleted character leaves a defeated historical combatant rather than breaking room sync.
        const exists = db.prepare("SELECT 1 FROM characters WHERE campaign_id = ? AND id = ? AND status = 'final'").get(campaignId, creature.characterId);
        if (exists) {
          const stats = this.characters.combatStats(db, campaignId, creature.characterId);
          creature.hp = stats.hp; creature.ownerAccountId = stats.ownerAccountId; creature.name = stats.name; creature.vitals = stats.vitals;
          const sourceRevision = db.prepare('SELECT revision FROM entity_revisions WHERE campaign_id = ? AND target_id = ?').get(campaignId, creature.characterId) as { revision: number } | undefined;
          creature.characterRevision = sourceRevision?.revision ?? 0;
        } else { creature.defeated = true; creature.ownerAccountId = null; }
      } else if (creature.tokenId) {
        const token = db.prepare('SELECT owner_account_id FROM tokens WHERE campaign_id = ? AND id = ?').get(campaignId, creature.tokenId) as { owner_account_id: Id | null } | undefined;
        creature.ownerAccountId = token?.owner_account_id ?? null;
      }
      return creature;
    });
    return { id: row.id, campaignId, templateId: row.template_id, sceneId: row.scene_id, name: row.name, status: row.status, round: row.round, turn: row.turn, activeId: row.active_id, combatants: initiativeOrder(combatants), revision: revision?.revision ?? 0 };
  }

  private save(ctx: CommandContext, combat: Combat): void {
    const previous = ctx.db.prepare('SELECT turn FROM combats WHERE campaign_id = ? AND id = ?').get(ctx.campaignId, combat.id) as { turn: number } | undefined;
    const active = combat.combatants.find((c) => c.id === combat.activeId);
    // Start-of-turn effects (Recharge rolls) run once per new turn, inside the same transaction.
    if (previous && combat.status === 'active' && active && combat.turn !== previous.turn) for (const listener of this.turnListeners) listener(ctx, combat, active);
    ctx.db.prepare('UPDATE combats SET status = ?, round = ?, turn = ?, active_id = ?, updated_at = ? WHERE campaign_id = ? AND id = ?')
      .run(combat.status, combat.round, combat.turn, combat.activeId, ctx.now, ctx.campaignId, combat.id);
    const statement = ctx.db.prepare(`INSERT INTO combatants (id, campaign_id, combat_id, name, character_id, monster_id, token_id, owner_account_id, initiative, tie_order, hidden, defeated, speed_feet, diagonals_moved, hp, budget, vitals, actions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (campaign_id, id) DO UPDATE SET name=excluded.name, token_id=excluded.token_id, owner_account_id=excluded.owner_account_id, initiative=excluded.initiative, tie_order=excluded.tie_order,
        hidden=excluded.hidden, defeated=excluded.defeated, speed_feet=excluded.speed_feet, diagonals_moved=excluded.diagonals_moved, hp=excluded.hp, budget=excluded.budget, vitals=excluded.vitals, actions=excluded.actions`);
    for (const c of combat.combatants) statement.run(c.id, ctx.campaignId, combat.id, c.name, c.characterId, c.monsterId, c.tokenId, c.ownerAccountId, c.initiative, c.tieOrder, +c.hidden, +c.defeated, c.speedFeet, c.diagonalsMoved, JSON.stringify(c.hp), JSON.stringify(c.budget), JSON.stringify(c.vitals ?? {}), JSON.stringify(c.actions ?? emptyActionUsage()));
  }

  private bumpRevision(ctx: CommandContext, targetId: Id): void {
    ctx.db.prepare(`INSERT INTO entity_revisions (campaign_id, target_id, revision) VALUES (?, ?, 1)
      ON CONFLICT (campaign_id, target_id) DO UPDATE SET revision = revision + 1`).run(ctx.campaignId, targetId);
  }

  private visible(db: DatabaseSync, member: Member, creature: Combatant): boolean {
    if (member.role === 'dm') return true;
    if (creature.hidden) return false;
    if (!creature.tokenId) return true;
    const token = db.prepare(`SELECT t.hidden, t.owner_account_id, t.x, t.y, t.size, s.shared, s.fog FROM tokens t
      JOIN scenes s ON s.campaign_id = t.campaign_id AND s.id = t.scene_id WHERE t.campaign_id = ? AND t.id = ?`)
      .get(member.campaignId, creature.tokenId) as { hidden: number; owner_account_id: Id | null; x: number; y: number; size: number; shared: number; fog: string } | undefined;
    if (!token || !token.shared || token.hidden) return false;
    const fog = JSON.parse(token.fog) as FogState;
    return !fog.enabled || token.owner_account_id === member.accountId || fog.revealed.some((a) => token.x < a.x + a.w && token.x + token.size > a.x && token.y < a.y + a.h && token.y + token.size > a.y);
  }

  private project(db: DatabaseSync, member: Member, combat: Combat): CombatView {
    if (member.role === 'dm') return combat;
    const combatants = combat.combatants.filter((c) => this.visible(db, member, c)).map((c) => ({
      id: c.id, name: c.name, characterId: c.characterId, ownerAccountId: c.ownerAccountId, initiative: c.initiative, tieOrder: c.tieOrder, defeated: c.defeated,
      ...(c.ownerAccountId === member.accountId ? { hp: c.hp, budget: c.budget, speedFeet: c.speedFeet, tokenId: c.tokenId, vitals: c.vitals, ...(c.actions ? { actions: c.actions } : {}), ...(c.characterRevision === undefined ? {} : { characterRevision: c.characterRevision }) } : {}),
    }));
    const scene = combat.sceneId ? db.prepare('SELECT shared FROM scenes WHERE campaign_id = ? AND id = ?').get(member.campaignId, combat.sceneId) as { shared: number } | undefined : undefined;
    return { id: combat.id, campaignId: combat.campaignId, name: combat.name, sceneId: scene?.shared ? combat.sceneId : null, status: combat.status, round: combat.round, turn: combat.turn, activeId: combatants.some((c) => c.id === combat.activeId) ? combat.activeId : null, combatants, revision: combat.revision };
  }
}
