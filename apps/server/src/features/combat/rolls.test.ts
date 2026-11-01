import { afterEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Combat, RandomInt, RollResult } from '#shared/combat';
import type { JsonValue } from '#shared/contracts';
import type { RoomSnapshot } from '#shared/room';
import { emptyDraft } from '#shared/characters';
import { TestClient } from '../../../../../tests/helpers/http.js';
import { makeDataDir, removeDataDir } from '../../../../../tests/helpers/server.js';
import { AppModule } from '../../app.module.js';
import { configureApp } from '../../app.js';
import { DatabaseService } from '../../db/database.service.js';
import { RANDOM_INT } from './rolls.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });
let request = 0;
async function boot(dataDir: string, random: RandomInt) {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot({ dataDir })] }).overrideProvider(RANDOM_INT).useValue(random).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
  await configureApp(app, { dataDir }); await app.init(); await app.getHttpAdapter().getInstance().ready();
  return app;
}
async function seed() {
  const dataDir = await makeDataDir(); cleanup.push(() => removeDataDir(dataDir));
  let calls = 0;
  let values: number[] = [];
  const random: RandomInt = (min, max) => { calls++; const value = values.shift() ?? min; if (value < min || value >= max) throw new Error('Fixture out of range'); return value; };
  const app = await boot(dataDir, random); cleanup.push(() => app.close());
  const dm = new TestClient(app); await dm.post('/api/auth/bootstrap', { username: 'dungeon_master', password: 'correct horse battery' });
  const campaignId = (await dm.post('/api/campaigns', { title: 'Dice table' })).body.id as string;
  const code = (await dm.post(`/api/campaigns/${campaignId}/invites`)).body.code;
  const player = new TestClient(app); await player.post('/api/auth/register', { username: 'alice_player', password: 'correct horse battery', invite: code });
  const send = (client: TestClient, targetId: string, kind: string, payload: JsonValue = {}, expectedRevision?: number, requestId = `roll-${++request}`) =>
    client.post(`/api/campaigns/${campaignId}/commands`, { campaignId, targetId, kind, payload, requestId, ...(expectedRevision === undefined ? {} : { expectedRevision }) });
  const view = async (client = dm) => (await client.get<Combat>(`/api/campaigns/${campaignId}/combats/combat-1`)).body;
  const command = async (kind: string, payload: JsonValue = {}, client = dm, requestId?: string, revision?: number) => send(client, 'combat-1', kind, payload, revision ?? (await view()).revision, requestId);
  const start = async () => {
    await send(dm, 'enc-1', 'encounter.save', { template: { name: 'Undead', target: 'low', party: { mode: 'levels', levels: [1] }, monsters: [{ monsterId: 'monster.skeleton', count: 1, hp: 'average' }], difficultTerrain: false, notes: '' } });
    expect((await send(dm, 'combat-1', 'combat.start', { templateId: 'enc-1' })).status).toBe(200);
    await command('combat.begin');
    return (await view()).combatants[0]!;
  };
  return { app, dataDir, dm, player, campaignId, send, command, view, start, rolls: (...next: number[]) => { values = next; }, calls: () => calls };
}

describe('server rolls and hit points', () => {
  it('uses_server_random_and_replays_receipts_without_rolling_again', async () => {
    const s = await seed(); s.rolls(1, 1);
    const payload = { expression: '2d6+3', audience: 'public' };
    const first = await s.send(s.player, 'dice-1', 'roll.dice', payload, undefined, 'retry-1');
    expect(first.status).toBe(200);
    expect(first.body.value.result.total).toBe(5);
    expect((await s.send(s.player, 'dice-1', 'roll.dice', payload, undefined, 'retry-1')).body).toEqual(first.body);
    expect(s.calls()).toBe(2);
    expect((await s.send(s.player, 'dice-2', 'roll.d20', { input: { kind: 'check', modifier: 101 }, audience: 'public' })).status).toBe(400);
    expect((await s.send(s.player, 'dice-2', 'roll.dice', { expression: 'process.exit()', audience: 'public' })).body.code).toBe('DICE_INVALID');
    expect(s.calls()).toBe(2);
    await s.app.close(); cleanup.pop();
    const again = await boot(s.dataDir, () => { throw new Error('Replay must not draw randomness'); }); cleanup.push(() => again.close());
    const restored = new TestClient(again); restored.cookie = s.player.cookie;
    const replay = await restored.post(`/api/campaigns/${s.campaignId}/commands`, { campaignId: s.campaignId, targetId: 'dice-1', kind: 'roll.dice', payload, requestId: 'retry-1' });
    expect(replay.body).toEqual(first.body);
    expect(((await restored.get<RoomSnapshot>(`/api/campaigns/${s.campaignId}/snapshot`)).body.rolls!.find((r) => r.id === 'dice-1')!.result as RollResult).total).toBe(5);
  });

  it('projects_private_rolls_only_to_dm_and_author_and_keeps_hidden_actors_private', async () => {
    const s = await seed();
    await s.send(s.dm, 'secret-roll', 'roll.dice', { expression: '1d20+37', audience: 'dm' });
    await s.send(s.player, 'public-roll', 'roll.dice', { expression: '1d4', audience: 'public' });
    const snapshot = async (client: TestClient) => (await client.get<RoomSnapshot>(`/api/campaigns/${s.campaignId}/snapshot`)).body;
    expect((await snapshot(s.dm)).rolls!.map((r) => r.id)).toContain('secret-roll');
    expect(JSON.stringify(await snapshot(s.player))).not.toContain('secret-roll');
    expect(JSON.stringify(await snapshot(s.player))).not.toContain('1d20+37');
    const monster = await s.start();
    await s.command('combat.update', { combatantId: monster.id, patch: { hidden: true }, reason: 'Secret' });
    const actor = { combatId: 'combat-1', combatantId: monster.id };
    expect((await s.send(s.player, 'actor-1', 'roll.d20', { actor, input: { kind: 'attack', modifier: 3 }, audience: 'public' })).status).toBe(403);
    expect((await s.send(s.dm, 'actor-2', 'roll.d20', { actor, input: { kind: 'attack', modifier: 3 }, audience: 'public' })).body.code).toBe('ROLL_PRIVATE_REQUIRED');
    expect((await s.send(s.dm, 'actor-3', 'roll.d20', { actor, input: { kind: 'attack', modifier: 3 }, audience: 'dm' })).status).toBe(200);
    expect(JSON.stringify(await snapshot(s.player))).not.toContain(monster.id);
  });

  it('applies_srd_defenses_hp_and_conditions_atomically_without_changing_template', async () => {
    const s = await seed(); const skeleton = await s.start();
    const before = skeleton.hp.current;
    expect((await s.command('combat.apply-hp', { combatantId: skeleton.id, input: { kind: 'damage', amount: 3, damageType: 'bludgeoning' } })).status).toBe(200);
    expect((await s.view()).combatants[0]!.hp.current).toBe(before - 6);
    await s.command('combat.apply-hp', { combatantId: skeleton.id, input: { kind: 'damage', amount: 100, damageType: 'poison' } });
    expect((await s.view()).combatants[0]!.hp.current).toBe(before - 6);
    expect((await s.command('combat.conditions', { combatantId: skeleton.id, conditions: ['condition.poisoned'], exhaustion: 0 })).body.code).toBe('CONDITION_IMMUNE');
    expect((await s.command('combat.conditions', { combatantId: skeleton.id, conditions: [], exhaustion: 1 })).body.code).toBe('CONDITION_IMMUNE');
    expect((await s.command('combat.apply-hp', { combatantId: skeleton.id, input: { kind: 'heal', amount: 4 } }, s.player)).status).toBe(403);
    const revision = (await s.view()).revision;
    const payload = { combatantId: skeleton.id, input: { kind: 'damage', amount: 1, damageType: 'fire' } };
    const first = await s.command('combat.apply-hp', payload, s.dm, 'same-damage', revision);
    expect((await s.command('combat.apply-hp', payload, s.dm, 'same-damage', revision)).body).toEqual(first.body);
    expect((await s.view()).combatants[0]!.hp.current).toBe(before - 7);
    expect((await s.dm.get(`/api/campaigns/${s.campaignId}/encounters`)).body[0].template.monsters[0].hp).toBe('average');
  });

  it('handles_death_saves_and_keeps_raw_rolls_free_of_action_costs', async () => {
    const s = await seed(); const skeleton = await s.start();
    // DM can opt an important monster into character-style death saves.
    expect((await s.command('combat.conditions', { combatantId: skeleton.id, conditions: [], exhaustion: 0, deathMode: 'saves' })).status).toBe(200);
    await s.command('combat.apply-hp', { combatantId: skeleton.id, input: { kind: 'damage', amount: 13, damageType: 'fire' } });
    expect((await s.view()).combatants[0]!.vitals!.zeroHpUnconscious).toBe(true);
    expect((await s.command('combat.spend', { combatantId: skeleton.id, resource: 'reaction' })).body.code).toBe('COMBAT_CANNOT_ACT');
    s.rolls(20);
    const save = await s.command('combat.death-save', { combatantId: skeleton.id, audience: 'public' });
    expect(save.status).toBe(200);
    expect(save.body.value.result.kept).toBe(20);
    expect((await s.view()).combatants[0]!.hp.current).toBe(1);
    const budget = (await s.view()).combatants[0]!.budget;
    s.rolls(20, 1, 1);
    await s.send(s.dm, 'attack-roll', 'roll.d20', { input: { kind: 'attack', modifier: 4, dc: 30 }, audience: 'public' });
    await s.send(s.dm, 'damage-roll', 'roll.dice', { expression: '1d6+3', critical: true, audience: 'public' });
    expect((await s.view()).combatants[0]!.budget).toEqual(budget);
    expect(s.app.get(DatabaseService).getHandle().prepare('SELECT COUNT(*) AS n FROM roll_history').get()).toMatchObject({ n: 3 });
  });

  it('shares_character_vitals_and_replays_death_saves_without_extra_randomness', async () => {
    const s = await seed(); await s.start();
    await s.send(s.player, 'char-alice', 'character.create');
    await s.send(s.player, 'char-alice', 'character.save-draft', { draft: {
      ...emptyDraft(), name: 'Brakka', concept: 'Guard', motivation: 'Help', partyBond: 'Friend', speciesId: 'species.dwarf',
      backgroundId: 'background.soldier', backgroundIncrease: { mode: '2-1', plus2: 'str', plus1: 'con' }, classId: 'class.fighter',
      abilityMethod: 'standard-array', baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, classSkills: ['perception', 'survival'],
      languages: ['Dwarvish', 'Giant'], toolChoices: [{ group: 'gaming-set', variant: 'dice' }], classEquipment: 'A', backgroundEquipment: 'B', equippedArmorId: 'equipment.chain-mail',
    } });
    expect((await s.send(s.player, 'char-alice', 'character.finalize')).status).toBe(200);
    await s.command('combat.reinforce', { characterId: 'char-alice', initiative: 99, hidden: false });
    let combat = await s.view(); let hero = combat.combatants.find((c) => c.characterId)!;
    await s.command('combat.set-turn', { combatantId: hero.id, reason: 'Hero turn' });
    expect((await s.command('combat.apply-hp', { combatantId: hero.id, sourceRevision: hero.characterRevision!, input: { kind: 'damage', amount: hero.hp.max, damageType: 'fire' } })).status).toBe(200);
    combat = await s.view(); hero = combat.combatants.find((c) => c.id === hero.id)!;
    expect(hero.hp.current).toBe(0);
    s.rolls(10);
    const payload = { combatantId: hero.id, sourceRevision: hero.characterRevision!, audience: 'public' };
    const result = await s.command('combat.death-save', payload, s.player, 'death-retry', combat.revision);
    expect(result.status).toBe(200);
    expect((await s.command('combat.death-save', payload, s.player, 'death-retry', combat.revision)).body).toEqual(result.body);
    expect(s.calls()).toBe(1);
    hero = (await s.view()).combatants.find((c) => c.id === hero.id)!;
    expect((await s.command('combat.death-save', { ...payload, sourceRevision: hero.characterRevision! }, s.player)).body.code).toBe('DEATH_SAVE_INVALID');
    expect(s.calls()).toBe(1);
    const sheetPath = `/api/campaigns/${s.campaignId}/characters/char-alice`;
    expect((await s.player.get(sheetPath)).body.character.resources.vitals.deathSaves.successes).toBe(1);
    await s.send(s.player, 'char-alice', 'character.set-hp', { current: 4, temp: 0 });
    expect((await s.player.get(sheetPath)).body.character.resources.vitals.deathSaves.successes).toBe(0);
    expect((await s.player.get(sheetPath)).body.character.resources.vitals.zeroHpUnconscious).toBe(false);
    const before = (await s.view()).revision;
    hero = (await s.view()).combatants.find((c) => c.id === hero.id)!;
    await s.send(s.player, 'char-alice', 'character.set-hp', { current: 7, temp: 0 });
    expect((await s.send(s.dm, 'combat-1', 'combat.apply-hp', { combatantId: hero.id, sourceRevision: hero.characterRevision!, input: { kind: 'damage', amount: 1, damageType: 'fire' } }, before)).body.code).toBe('STALE_REVISION');
    await s.command('combat.end');
    await s.send(s.dm, 'combat-2', 'combat.start', { templateId: 'enc-1' });
    const view2 = async () => (await s.dm.get<Combat>(`/api/campaigns/${s.campaignId}/combats/combat-2`)).body;
    await s.send(s.dm, 'combat-2', 'combat.reinforce', { characterId: 'char-alice', initiative: 99, hidden: false }, (await view2()).revision);
    await s.send(s.dm, 'combat-2', 'combat.begin', {}, (await view2()).revision);
    hero = (await view2()).combatants.find((c) => c.characterId)!;
    expect((await view2()).turn).toBe(1);
    await s.send(s.dm, 'combat-2', 'combat.apply-hp', { combatantId: hero.id, sourceRevision: hero.characterRevision!, input: { kind: 'damage', amount: hero.hp.current, damageType: 'fire' } }, (await view2()).revision);
    hero = (await view2()).combatants.find((c) => c.characterId)!;
    s.rolls(10);
    expect((await s.send(s.player, 'combat-2', 'combat.death-save', { combatantId: hero.id, sourceRevision: hero.characterRevision!, audience: 'public' }, (await view2()).revision)).status).toBe(200);
  });

  it('requires_combat_revision_before_committing_an_initiative_roll', async () => {
    const s = await seed(); await s.start();
    // Create another preparation phase after ending the first instance.
    await s.command('combat.end');
    await s.send(s.dm, 'combat-2', 'combat.start', { templateId: 'enc-1' });
    const combat = (await s.dm.get<Combat>(`/api/campaigns/${s.campaignId}/combats/combat-2`)).body;
    const actor = { combatId: combat.id, combatantId: combat.combatants[0]!.id, expectedRevision: combat.revision - 1 };
    expect((await s.send(s.dm, 'init-stale', 'roll.d20', { actor, input: { kind: 'initiative', modifier: 3 }, audience: 'public' })).body.code).toBe('STALE_REVISION');
    s.rolls(15);
    expect((await s.send(s.dm, 'init-good', 'roll.d20', { actor: { ...actor, expectedRevision: combat.revision }, input: { kind: 'initiative', modifier: 3 }, audience: 'public' })).status).toBe(200);
    expect((await s.dm.get<Combat>(`/api/campaigns/${s.campaignId}/combats/combat-2`)).body.combatants[0]!.initiative).toBe(18);
    expect(s.calls()).toBe(1);
  });

  it('allows_movement_but_not_actions_while_stunned_and_blocks_grappled_movement', async () => {
    const s = await seed(); const creature = await s.start();
    for (const condition of ['condition.incapacitated', 'condition.stunned']) {
      await s.command('combat.conditions', { combatantId: creature.id, conditions: [condition], exhaustion: 0 });
      expect((await s.command('combat.spend', { combatantId: creature.id, resource: 'movement', amount: 5 })).status).toBe(200);
      expect((await s.command('combat.spend', { combatantId: creature.id, resource: 'action' })).body.code).toBe('COMBAT_CANNOT_ACT');
    }
    await s.command('combat.conditions', { combatantId: creature.id, conditions: ['condition.grappled'], exhaustion: 0 });
    expect((await s.command('combat.spend', { combatantId: creature.id, resource: 'movement', amount: 5 })).body.code).toBe('COMBAT_CANNOT_ACT');
  });
});
