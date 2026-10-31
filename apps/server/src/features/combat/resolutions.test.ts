import { afterEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ActionOption, Combat, RandomInt, Resolution } from '#shared/combat';
import type { JsonValue } from '#shared/contracts';
import type { RoomSnapshot } from '#shared/room';
import { emptyDraft } from '#shared/characters';
import type { CharacterView } from '../characters/service.js';
import { TestClient } from '../../../../../tests/helpers/http.js';
import { makeDataDir, removeDataDir } from '../../../../../tests/helpers/server.js';
import { AppModule } from '../../app.module.js';
import { configureApp } from '../../app.js';
import { DatabaseService } from '../../db/database.service.js';
import { RANDOM_INT } from './rolls.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });
let request = 0;
const password = 'correct horse battery';

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
  const state = { app: await boot(dataDir, random) };
  let closeCurrent = () => state.app.close();
  cleanup.push(() => closeCurrent());
  const dm = new TestClient(state.app); await dm.post('/api/auth/bootstrap', { username: 'dungeon_master', password });
  const campaignId = (await dm.post('/api/campaigns', { title: 'Resolution table' })).body.id as string;
  const code = (await dm.post(`/api/campaigns/${campaignId}/invites`)).body.code;
  const player = new TestClient(state.app); await player.post('/api/auth/register', { username: 'alice_wizard', password, invite: code });
  const clients = { dm, player };
  const send = (client: 'dm' | 'player', targetId: string, kind: string, payload: JsonValue = {}, expectedRevision?: number, requestId = `res-${++request}`) =>
    clients[client].post(`/api/campaigns/${campaignId}/commands`, { campaignId, targetId, kind, payload, requestId, ...(expectedRevision === undefined ? {} : { expectedRevision }) });
  await send('player', 'char-mage', 'character.create');
  await send('player', 'char-mage', 'character.save-draft', { draft: {
    ...emptyDraft(), name: 'Vell', concept: 'Scholar', motivation: 'Learn', partyBond: 'Friend', speciesId: 'species.dwarf',
    backgroundId: 'background.sage', backgroundIncrease: { mode: '2-1', plus2: 'int', plus1: 'con' },
    classId: 'class.wizard', abilityMethod: 'standard-array', baseScores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
    classSkills: ['insight', 'investigation'], languages: ['Dwarvish', 'Giant'], toolChoices: [],
    classEquipment: 'A', backgroundEquipment: 'B', equippedArmorId: null,
  } });
  const finalized = await send('player', 'char-mage', 'character.finalize');
  expect(finalized.status, JSON.stringify(finalized.body)).toBe(200);
  const db = state.app.get(DatabaseService).getHandle();
  const row = db.prepare('SELECT resources FROM characters WHERE id = ?').get('char-mage') as { resources: string };
  db.prepare('UPDATE characters SET resources = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(row.resources), spells: [{ classId: 'class.wizard', cantrips: ['spell.fire-bolt', 'spell.light', 'spell.mage-hand'], prepared: ['spell.shield', 'spell.magic-missile'] }] }), 'char-mage');
  await send('dm', 'enc-1', 'encounter.save', { template: {
    name: 'Lair', target: 'high', party: { mode: 'characters', characterIds: ['char-mage'] },
    monsters: [{ monsterId: 'monster.goblin-warrior', count: 1, hp: 'average' }, { monsterId: 'monster.adult-red-dragon', count: 1, hp: 'average' }], difficultTerrain: false, notes: '',
  } });
  const view = async () => (await clients.dm.get<Combat>(`/api/campaigns/${campaignId}/combats/combat-1`)).body;
  const command = async (kind: string, payload: JsonValue = {}, client: 'dm' | 'player' = 'dm', requestId?: string) => send(client, 'combat-1', kind, payload, (await view()).revision, requestId);
  expect((await send('dm', 'combat-1', 'combat.start', { templateId: 'enc-1' })).status).toBe(200);
  const ids = Object.fromEntries((await view()).combatants.map((c) => [c.characterId ? 'mage' : c.monsterId === 'monster.goblin-warrior' ? 'goblin' : 'dragon', c.id])) as Record<'mage' | 'goblin' | 'dragon', string>;
  for (const [key, initiative] of [['goblin', 20], ['mage', 15], ['dragon', 10]] as const) {
    expect((await command('combat.update', { combatantId: ids[key], patch: { initiative }, reason: 'Rolled at the table' })).status).toBe(200);
  }
  expect((await command('combat.begin')).status).toBe(200);
  const optionId = async (client: 'dm' | 'player', combatantId: string, name: string) =>
    (await clients[client].get<ActionOption[]>(`/api/campaigns/${campaignId}/combats/combat-1/combatants/${combatantId}/actions`)).body.find((o) => o.originalName === name)!.id;
  const snapshot = async (client: 'dm' | 'player' = 'dm') => (await clients[client].get<RoomSnapshot>(`/api/campaigns/${campaignId}/snapshot`)).body;
  const resolution = async (id: string, client: 'dm' | 'player' = 'dm') => (await snapshot(client)).resolutions!.find((r) => r.id === id)!;
  const decide = async (id: string, decision: JsonValue, requestId?: string, revision?: number) => send('dm', id, 'resolution.decide', decision, revision ?? (await resolution(id)).revision, requestId);
  const mage = async () => (await clients.player.get<CharacterView>(`/api/campaigns/${campaignId}/characters/char-mage`)).body;
  const hp = async () => (await view()).combatants.find((c) => c.id === ids.mage)!.hp;
  const restart = async () => {
    await state.app.close();
    state.app = await boot(dataDir, random);
    closeCurrent = () => state.app.close();
    for (const key of ['dm', 'player'] as const) {
      const next = new TestClient(state.app); next.cookie = clients[key].cookie; clients[key] = next;
    }
  };
  return { campaignId, ids, clients, send, view, command, optionId, snapshot, resolution, decide, mage, hp, restart, rolls: (...next: number[]) => { values = next; }, calls: () => calls };
}

describe('durable action resolutions', () => {
  it('survives_lost_ack_restart_and_locale_switch', async () => {
    const s = await seed();
    // Goblin hits the wizard: costs are paid when the resolution is created, the Shield reaction is offered.
    const scimitar = await s.optionId('dm', s.ids.goblin, 'Scimitar');
    s.rolls(15);
    const revision = (await s.view()).revision;
    const payload = { combatantId: s.ids.goblin, optionId: scimitar, targetIds: [s.ids.mage], damageMode: 'average' };
    const first = await s.send('dm', 'combat-1', 'combat.act', payload, revision, 'swing-1');
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    // Lost ACK: the retry replays the receipt without a second resolution, roll or Action.
    expect((await s.send('dm', 'combat-1', 'combat.act', payload, revision, 'swing-1')).body).toEqual(first.body);
    expect(s.calls()).toBe(1);
    const swingId = first.body.value.id as string;
    let swing = await s.resolution(swingId);
    expect(swing).toMatchObject({ phase: 'pending', actorId: s.ids.goblin, costs: { turn: 'action' }, cancellationPolicy: 'no-refund' });
    expect(swing.pendingReactions).toEqual([expect.objectContaining({ combatantId: s.ids.mage, name: 'Shield', status: 'offered', trigger: expect.stringContaining('hit by an attack roll') })]);
    expect(swing.proposed).toEqual([{ targetId: s.ids.mage, input: { kind: 'damage', amount: 5, damageType: 'slashing' }, decision: false }]);
    expect((await s.snapshot()).resolutions!.filter((r) => r.actorId === s.ids.goblin)).toHaveLength(1);
    expect((await s.view()).combatants.find((c) => c.id === s.ids.goblin)!.budget.action).toBe(0);

    // Restart keeps the pending reaction; locale switch changes neither phase nor cost.
    await s.restart();
    const before = await s.resolution(swingId, 'player');
    expect(before).toMatchObject({ phase: 'pending', pendingReactions: [expect.objectContaining({ status: 'offered' })] });
    expect((await s.clients.player.put('/api/auth/me/locale', { locale: 'id' })).status).toBe(200);
    const after = await s.resolution(swingId, 'player');
    expect({ phase: after.phase, costs: after.costs, revision: after.revision }).toEqual({ phase: before.phase, costs: before.costs, revision: before.revision });
    // Players never receive the goblin's view of the wizard's AC in their copy.
    expect(after.outcome.preview.rolls[0]).toMatchObject({ ac: null });

    // Commit is blocked while a reaction is offered; stale decisions are rejected.
    expect((await s.decide(swingId, { decision: 'commit' })).body.code).toBe('RESOLUTION_REACTIONS_PENDING');
    expect((await s.decide(swingId, { decision: 'commit', force: true }, undefined, swing.revision + 5)).body.code).toBe('STALE_REVISION');

    // The wizard casts Shield against the attack: Reaction and one slot, once, even on retry.
    const shield = await s.optionId('player', s.ids.mage, 'Shield');
    const reaction = { combatantId: s.ids.mage, optionId: shield, targetIds: [], slotLevel: 1, respondsTo: swingId };
    const combatRevision = (await s.view()).revision;
    const declared = await s.send('player', 'combat-1', 'combat.act', reaction, combatRevision, 'shield-1');
    expect(declared.status, JSON.stringify(declared.body)).toBe(200);
    expect((await s.send('player', 'combat-1', 'combat.act', reaction, combatRevision, 'shield-1')).body).toEqual(declared.body);
    expect((await s.mage()).character.resources.slotsSpent[0]).toBe(1);
    expect((await s.view()).combatants.find((c) => c.id === s.ids.mage)!.budget.reaction).toBe(0);
    swing = await s.resolution(swingId);
    expect(swing).toMatchObject({ phase: 'awaitingDecision', pendingReactions: [expect.objectContaining({ status: 'declared', resolutionId: declared.body.value.id })] });
    expect((await s.send('player', 'combat-1', 'combat.act', { ...reaction, slotLevel: 1 }, (await s.view()).revision)).body).toMatchObject({ code: 'ACTION_INVALID' });

    // DM commits once; a retry of the same request does not damage twice; a new commit is rejected.
    const hpBefore = await s.hp();
    const commit = await s.decide(swingId, { decision: 'commit' }, 'commit-1');
    expect(commit.status, JSON.stringify(commit.body)).toBe(200);
    const hpAfterFirstCommit = await s.hp();
    expect(hpAfterFirstCommit.current).toBe(hpBefore.current - 5);
    expect((await s.decide(swingId, { decision: 'commit' }, 'commit-1', swing.revision)).body).toEqual(commit.body);
    const hpAfterRetry = await s.hp();
    expect(hpAfterRetry).toEqual(hpAfterFirstCommit);
    expect((await s.decide(swingId, { decision: 'commit' })).body.code).toBe('RESOLUTION_CLOSED');
    swing = await s.resolution(swingId);
    expect(swing).toMatchObject({ phase: 'resolved', committedEffects: [{ targetId: s.ids.mage, input: { kind: 'damage', amount: 5 }, before: { current: hpBefore.current }, after: { current: hpBefore.current - 5 } }] });

    // DM correction is a compensating event: HP is restored, the history stays.
    expect((await s.decide(swingId, { decision: 'compensate', reason: 'Shield made it miss' })).status).toBe(200);
    expect(await s.hp()).toEqual(hpBefore);
    expect(await s.resolution(swingId)).toMatchObject({ phase: 'resolved', compensation: { reason: 'Shield made it miss' } });

    // Mage turn: Fire Bolt resolution; the DM cancels without refund, so the Action stays spent.
    await s.command('combat.next');
    const bolt = await s.optionId('player', s.ids.mage, 'Fire Bolt');
    s.rolls(15, 4);
    const cast = await s.command('combat.act', { combatantId: s.ids.mage, optionId: bolt, targetIds: [s.ids.goblin] }, 'player');
    expect(cast.status, JSON.stringify(cast.body)).toBe(200);
    expect((await s.decide(cast.body.value.id, { decision: 'cancel' })).status).toBe(200);
    expect(await s.resolution(cast.body.value.id)).toMatchObject({ phase: 'cancelled', refund: null, committedEffects: [] });
    expect((await s.view()).combatants.find((c) => c.id === s.ids.mage)!.budget.action).toBe(0);
    expect((await s.decide(cast.body.value.id, { decision: 'commit' })).body.code).toBe('RESOLUTION_CLOSED');

    // Dragon turn: the actor leaves combat before the DM decides; the resolution is still resolved by the DM.
    await s.command('combat.next');
    const rend = await s.optionId('dm', s.ids.dragon, 'Rend');
    s.rolls(15);
    const bite = await s.command('combat.act', { combatantId: s.ids.dragon, optionId: rend, targetIds: [s.ids.goblin], damageMode: 'average' });
    expect(bite.status, JSON.stringify(bite.body)).toBe(200);
    expect((await s.command('combat.remove', { combatantId: s.ids.dragon })).status).toBe(200);
    const goblinHp = (await s.view()).combatants.find((c) => c.id === s.ids.goblin)!.hp.current;
    expect((await s.decide(bite.body.value.id, { decision: 'commit' })).status).toBe(200);
    expect((await s.view()).combatants.find((c) => c.id === s.ids.goblin)!.hp.current).toBe(Math.max(0, goblinHp - 18));
    // Refunds are explicit DM corrections with a reason.
    expect((await s.decide(cast.body.value.id, { decision: 'cancel', refund: true })).body.code).toBe('RESOLUTION_CLOSED');
  });
});
