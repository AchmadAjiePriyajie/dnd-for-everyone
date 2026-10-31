import { Injectable } from '@nestjs/common';
import type { DatabaseSync } from 'node:sqlite';
import { applyDamage, cannotAct, emptyDefenses, normalizeVitals } from '#rules/damage';
import { advanceTurn } from '#rules/turns';
import type { Combat, Combatant, DamageInput, DefenseProfile, HitPointState, VitalState } from '#shared/combat';
import type { Id } from '#shared/contracts';
import type { CommandContext } from '../../commands/registry.js';
import { DomainError } from '../../common/domain-error.js';
import { ContentService } from '../../content/content.service.js';
import { CharactersService } from '../characters/service.js';
import { CombatService } from './service.js';

interface MonsterDefenses { resistances?: DefenseProfile['resistances']; vulnerabilities?: DefenseProfile['vulnerabilities']; immunities?: { damage: DefenseProfile['immunities']; conditions: string[] } }
export interface HpChange { before: { current: number; temp: number }; after: { current: number; temp: number } }

/**
 * Hit Point effects shared by DM HP commands, death saves and resolution commits. Character HP
 * lives on the sheet, monster HP on the combat instance; both are written inside the caller's command.
 */
@Injectable()
export class EffectsService {
  constructor(
    private readonly combat: CombatService,
    private readonly characters: CharactersService,
    private readonly content: ContentService,
  ) {}

  hitPoints(db: DatabaseSync, campaignId: Id, creature: Combatant): HitPointState {
    let profile = emptyDefenses();
    if (creature.monsterId) {
      let stats: MonsterDefenses = {};
      if (creature.monsterId.startsWith('monster.') && this.content.has(creature.monsterId)) stats = this.content.getContent(creature.monsterId, 'en').mechanics as MonsterDefenses;
      else {
        const homebrew = db.prepare("SELECT mechanics FROM homebrew WHERE campaign_id = ? AND id = ? AND kind = 'monster' AND status = 'approved'").get(campaignId, creature.monsterId) as { mechanics: string } | undefined;
        if (homebrew) stats = JSON.parse(homebrew.mechanics) as MonsterDefenses;
      }
      profile = { resistances: stats.resistances ?? [], vulnerabilities: stats.vulnerabilities ?? [], immunities: stats.immunities?.damage ?? [], conditionImmunities: stats.immunities?.conditions ?? [] };
    }
    const vitals = normalizeVitals(creature.vitals, creature.hp.current, creature.characterId ? 'saves' : 'instant');
    return { ...creature.hp, ...vitals, defenses: vitals.defenses ?? profile };
  }

  /** Writes HP/vitals and returns the combat as saved (a death may advance the turn). */
  persist(ctx: CommandContext, combat: Combat, creature: Combatant, state: HitPointState): Combat {
    const { current, max, temp, defenses: _profile, ...metadata } = state;
    const vitals: VitalState = { ...metadata, ...(creature.vitals?.defenses ? { defenses: creature.vitals.defenses } : {}) };
    creature.hp = { current, max, temp }; creature.vitals = vitals;
    if (creature.characterId) {
      const character = this.characters.campaignCharacter({ ...ctx, targetId: creature.characterId });
      const incapacitated = cannotAct({ hp: state, vitals: state });
      this.characters.writeResources(ctx, character.id, { ...character.resources, hp: { damage: max - current, temp }, vitals, concentration: incapacitated ? null : character.resources.concentration });
      ctx.db.prepare('UPDATE entity_revisions SET revision = revision + 1 WHERE campaign_id = ? AND target_id = ?').run(ctx.campaignId, character.id);
    }
    if (state.deathSaves.dead) {
      creature.defeated = true;
      if (combat.activeId === creature.id) combat = advanceTurn(combat);
    }
    this.combat.writeState(ctx, combat);
    return combat;
  }

  /** One typed HP change through the SRD damage rules (resistance, temporary HP, death at 0). */
  applyHp(ctx: CommandContext, combat: Combat, creature: Combatant, input: DamageInput): HpChange & { combat: Combat } {
    const state = this.hitPoints(ctx.db, ctx.campaignId, creature);
    const before = { current: state.current, temp: state.temp };
    let next: HitPointState;
    try { next = applyDamage(state, input); } catch { throw new DomainError('HP_INVALID', 409); }
    const saved = this.persist(ctx, combat, creature, next);
    return { before, after: { current: next.current, temp: next.temp }, combat: saved };
  }

  /** Compensation: restore an earlier HP change without re-applying damage rules. */
  restoreHp(ctx: CommandContext, combat: Combat, creature: Combatant, change: HpChange): Combat {
    const state = this.hitPoints(ctx.db, ctx.campaignId, creature);
    const current = Math.min(state.max, Math.max(0, state.current + change.before.current - change.after.current));
    const temp = Math.max(0, state.temp + change.before.temp - change.after.temp);
    const vitals = normalizeVitals({ ...state, ...(state.deathSaves.dead && current > 0 ? { deathSaves: { ...state.deathSaves, dead: false } } : {}) }, current, state.deathMode);
    if (current > 0 && creature.defeated && !creature.characterId) creature.defeated = false;
    return this.persist(ctx, combat, creature, { ...state, ...vitals, current, temp, defenses: state.defenses });
  }
}
