import { afterEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ActionOption, Combat, RandomInt } from '#shared/combat';
import type { JsonValue } from '#shared/contracts';
import type { RoomSnapshot } from '#shared/room';
import type { SessionView } from '#shared/sessions';
import { emptyDraft } from '#shared/characters';
import type { CharacterView } from '../characters/service.js';
import { TestClient } from '../../../../../tests/helpers/http.js';
import { makeDataDir, removeDataDir } from '../../../../../tests/helpers/server.js';
import { AppModule } from '../../app.module.js';
import { configureApp } from '../../app.js';
import { DatabaseService } from '../../db/database.service.js';
import { RANDOM_INT } from '../combat/rolls.js';

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
  let values: number[] = [];
  const random: RandomInt = (min, max) => { const value = values.shift() ?? min; if (value < min || value >= max) throw new Error('Fixture out of range'); return value; };
  const state = { app: await boot(dataDir, random) };
  cleanup.push(() => state.app.close());
  const clients = { dm: new TestClient(state.app), player: new TestClient(state.app) };
  await clients.dm.post('/api/auth/bootstrap', { username: 'dungeon_master', password });
  const campaignId = (await clients.dm.post('/api/campaigns', { title: 'Session table' })).body.id as string;
  const code = (await clients.dm.post(`/api/campaigns/${campaignId}/invites`)).body.code;
  await clients.player.post('/api/auth/register', { username: 'alice_wizard', password, invite: code });
  const send = (client: 'dm' | 'player', targetId: string, kind: string, payload: JsonValue = {}, expectedRevision?: number) =>
    clients[client].post(`/api/campaigns/${campaignId}/commands`, { campaignId, targetId, kind, payload, requestId: `ses-${++request}`, ...(expectedRevision === undefined ? {} : { expectedRevision }) });
  await send('player', 'char-mage', 'character.create');
  await send('player', 'char-mage', 'character.save-draft', { draft: {
    ...emptyDraft(), name: 'Vell', concept: 'Scholar', motivation: 'Learn', partyBond: 'Friend', speciesId: 'species.dwarf',
    backgroundId: 'background.sage', backgroundIncrease: { mode: '2-1', plus2: 'int', plus1: 'con' },
    classId: 'class.wizard', abilityMethod: 'standard-array', baseScores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
    classSkills: ['insight', 'investigation'], languages: ['Dwarvish', 'Giant'], toolChoices: [], classEquipment: 'A', backgroundEquipment: 'B', equippedArmorId: null,
  } });
  expect((await send('player', 'char-mage', 'character.finalize')).status).toBe(200);
  const db = state.app.get(DatabaseService).getHandle();
  const row = db.prepare('SELECT resources FROM characters WHERE id = ?').get('char-mage') as { resources: string };
  db.prepare('UPDATE characters SET resources = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(row.resources), spells: [{ classId: 'class.wizard', cantrips: ['spell.fire-bolt', 'spell.light', 'spell.mage-hand'], prepared: ['spell.shield'] }] }), 'char-mage');
  const view = async () => (await clients.dm.get<Combat>(`/api/campaigns/${campaignId}/combats/combat-1`)).body;
  const resume = async (client: 'dm' | 'player', sessionId: string) => clients[client].get<SessionView>(`/api/campaigns/${campaignId}/sessions/${sessionId}/resume`);
  const session = async (sessionId: string) => (await resume('dm', sessionId)).body.session;
  const restart = async () => {
    await state.app.close();
    state.app = await boot(dataDir, random);
    for (const key of ['dm', 'player'] as const) { const next = new TestClient(state.app); next.cookie = clients[key].cookie; clients[key] = next; }
  };
  return { campaignId, clients, send, view, resume, session, restart, rolls: (...next: number[]) => { values = next; } };
}

describe('play sessions', () => {
  it('resumes_committed_state_after_host_restart', async () => {
    const s = await seed();
    // A scene with the wizard's token and a running combat with a pending resolution.
    expect((await s.send('dm', 'scene-1', 'scene.save', { name: 'Old mill', assetId: null, grid: { columns: 20, rows: 20, cellPixels: 40, offsetX: 0, offsetY: 0, feetPerCell: 5 } })).status).toBe(200);
    expect((await s.send('dm', 'scene-1', 'scene.share', { shared: true }, 1)).status).toBe(200);
    expect((await s.send('dm', 'token-1', 'token.place', { sceneId: 'scene-1', label: 'Vell', kind: 'character', characterId: 'char-mage', x: 2, y: 3, size: 1, hidden: false })).status).toBe(200);
    const started = await s.send('dm', 'session-1', 'session.start', { title: 'The old mill', sceneId: 'scene-1' });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect((await s.send('dm', 'session-2', 'session.start', {})).body.code).toBe('SESSION_EXISTS');
    await s.send('dm', 'enc-1', 'encounter.save', { template: { name: 'Mill', target: 'low', party: { mode: 'characters', characterIds: ['char-mage'] }, monsters: [{ monsterId: 'monster.goblin-warrior', count: 1, hp: 'average' }], difficultTerrain: false, notes: '' } });
    expect((await s.send('dm', 'combat-1', 'combat.start', { templateId: 'enc-1', sceneId: 'scene-1' })).status).toBe(200);
    for (const creature of (await s.view()).combatants) {
      await s.send('dm', 'combat-1', 'combat.update', { combatantId: creature.id, patch: { initiative: creature.characterId ? 10 : 20 }, reason: 'Secret ambush roll' }, (await s.view()).revision);
    }
    await s.send('dm', 'combat-1', 'combat.begin', {}, (await s.view()).revision);
    const goblin = (await s.view()).combatants.find((c) => !c.characterId)!;
    const scimitar = (await s.clients.dm.get<ActionOption[]>(`/api/campaigns/${s.campaignId}/combats/combat-1/combatants/${goblin.id}/actions`)).body.find((o) => o.originalName === 'Scimitar')!.id;
    s.rolls(15);
    const mage = (await s.view()).combatants.find((c) => c.characterId)!;
    const attack = await s.send('dm', 'combat-1', 'combat.act', { combatantId: goblin.id, optionId: scimitar, targetIds: [mage.id], damageMode: 'average' }, (await s.view()).revision);
    expect(attack.status, JSON.stringify(attack.body)).toBe(200);

    // Recap (shared + secret), journals and a rule question.
    expect((await s.send('dm', 'session-1', 'session.recap', { shared: 'The party reached the mill.', dm: 'Secret: the miller is a cultist.' }, (await s.session('session-1')).revision)).status).toBe(200);
    expect((await s.send('player', 'session-1', 'session.journal', { text: 'Vell suspects the miller.', visibility: 'party' })).status).toBe(200);
    expect((await s.send('player', 'session-1', 'session.journal', { text: 'Vell owes the miller money.', visibility: 'private' })).status).toBe(200);
    expect((await s.send('dm', 'session-1', 'session.journal', { text: 'DM private aside.', visibility: 'private' })).status).toBe(200);
    expect((await s.send('dm', 'session-1', 'session.rule-note', { text: 'Can Shield stop a goblin bonus damage?', ruleId: 'spell.shield' })).status).toBe(200);

    const saved = (await s.resume('dm', 'session-1')).body;
    expect(saved.turnId).toBe(`combat-1:${(await s.view()).turn}`);
    expect((await s.send('dm', 'session-1', 'session.pause', {})).status).toBe(200);
    expect((await s.view()).status).toBe('paused');
    // A draft that was never acknowledged (stale revision) is not committed.
    expect((await s.send('dm', 'session-1', 'session.recap', { shared: 'Unsaved draft', dm: '' }, 0)).body.code).toBe('STALE_REVISION');
    const sheetBefore = (await s.clients.player.get<CharacterView>(`/api/campaigns/${s.campaignId}/characters/char-mage`)).body.character.resources;

    await s.restart();
    const resumed = (await s.resume('dm', 'session-1')).body;
    expect(resumed.turnId).toBe(saved.turnId);
    expect(resumed.session).toMatchObject({ status: 'paused', sceneId: 'scene-1', combatId: 'combat-1', pausedCombat: true, recap: { shared: 'The party reached the mill.' } });
    expect(resumed.combat!.combatants.map((c) => [c.id, c.hp, c.budget])).toEqual(saved.combat!.combatants.map((c) => [c.id, c.hp, c.budget]));
    expect(resumed.scene!.tokens).toEqual(saved.scene!.tokens);
    expect(resumed.resolutions.map((r) => [r.id, r.phase, r.pendingReactions])).toEqual(saved.resolutions.map((r) => [r.id, r.phase, r.pendingReactions]));
    expect(resumed.resolutions.some((r) => r.id === attack.body.value.id && r.phase === 'pending')).toBe(true);
    expect((await s.clients.player.get<CharacterView>(`/api/campaigns/${s.campaignId}/characters/char-mage`)).body.character.resources).toEqual(sheetBefore);

    // Players get the shared recap, party + own journal, filtered log; never DM secrets.
    const player = (await s.resume('player', 'session-1')).body;
    const text = JSON.stringify(player);
    expect(player.session.recap).toEqual({ shared: 'The party reached the mill.' });
    expect(player.session.ruleNotes).toBeUndefined();
    expect(player.session.journal.map((entry) => entry.text)).toEqual(['Vell suspects the miller.', 'Vell owes the miller money.']);
    for (const secret of ['cultist', 'DM private aside', 'Secret ambush roll', 'Can Shield']) expect(text).not.toContain(secret);
    expect(player.log.map((entry) => entry.kind)).toEqual(expect.arrayContaining(['session.start', 'combat.begin', 'session.pause']));
    expect(player.log.some((entry) => entry.kind === 'combat.update' || entry.kind === 'session.rule-note')).toBe(false);
    expect((await s.resume('dm', 'session-1')).body.log.some((entry) => entry.kind === 'combat.update')).toBe(true);
    expect((await s.clients.player.get<RoomSnapshot>(`/api/campaigns/${s.campaignId}/snapshot`)).body.session).toMatchObject({ id: 'session-1', status: 'paused' });

    // Resume restarts the combat it paused; ending keeps the history readable but not resumable.
    expect((await s.send('dm', 'session-1', 'session.resume', {})).status).toBe(200);
    expect((await s.view()).status).toBe('active');
    expect((await s.session('session-1')).segments).toHaveLength(2);
    expect((await s.send('dm', 'session-1', 'session.end', {})).status).toBe(200);
    expect((await s.send('dm', 'session-1', 'session.resume', {})).body.code).toBe('SESSION_ENDED');
    const ended = (await s.resume('player', 'session-1')).body;
    expect(ended.session).toMatchObject({ status: 'ended', recap: { shared: 'The party reached the mill.' } });
    expect(ended.session.endedAt).not.toBeNull();
    expect((await s.clients.player.get(`/api/campaigns/${s.campaignId}/sessions`)).body).toEqual([expect.objectContaining({ id: 'session-1', number: 1, status: 'ended' })]);

    // A session without an active combat.
    await s.send('dm', 'combat-1', 'combat.end', {}, (await s.view()).revision);
    expect((await s.send('dm', 'session-2', 'session.start', {})).status).toBe(200);
    const quiet = (await s.resume('player', 'session-2')).body;
    expect(quiet).toMatchObject({ turnId: null, combat: null, scene: null, session: { number: 2, status: 'active' } });
  });
});
