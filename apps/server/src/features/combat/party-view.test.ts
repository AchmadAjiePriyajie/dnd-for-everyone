import { afterEach, describe, expect, it } from 'vitest';
import type { Combat, CombatView } from '#shared/combat';
import type { JsonValue } from '#shared/contracts';
import type { RoomSnapshot } from '#shared/room';
import type { SceneView } from '#shared/scenes';
import { emptyDraft } from '#shared/characters';
import { TestClient } from '../../../../../tests/helpers/http.js';
import { makeDataDir, removeDataDir, startTestServer } from '../../../../../tests/helpers/server.js';
import { DatabaseService } from '../../db/database.service.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });
let request = 0;
const password = 'correct horse battery';
const fighter = (name: string) => ({
  ...emptyDraft(), name, concept: 'Guard', motivation: 'Help', partyBond: 'Friend', speciesId: 'species.dwarf',
  backgroundId: 'background.soldier', backgroundIncrease: { mode: '2-1', plus2: 'str', plus1: 'con' },
  classId: 'class.fighter', abilityMethod: 'standard-array', baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  classSkills: ['perception', 'survival'], languages: ['Dwarvish', 'Giant'], toolChoices: [{ group: 'gaming-set', variant: 'dice' }],
  classEquipment: 'A', backgroundEquipment: 'B', equippedArmorId: 'equipment.chain-mail',
});

describe('party view', () => {
  it('party_members_share_vitals_but_monsters_stay_coarse', async () => {
    const dataDir = await makeDataDir(); cleanup.push(() => removeDataDir(dataDir));
    const server = await startTestServer({ dataDir }); cleanup.push(() => server.close());
    const dm = new TestClient(server.app); await dm.post('/api/auth/bootstrap', { username: 'dungeon_master', password });
    const campaignId = (await dm.post('/api/campaigns', { title: 'Party table' })).body.id as string;
    const players: TestClient[] = [];
    for (const name of ['alice_player', 'bram_player']) {
      const code = (await dm.post(`/api/campaigns/${campaignId}/invites`)).body.code;
      const client = new TestClient(server.app); await client.post('/api/auth/register', { username: name, password, invite: code }); players.push(client);
    }
    const [alice, bram] = players as [TestClient, TestClient];
    const send = (client: TestClient, targetId: string, kind: string, payload: JsonValue = {}, expectedRevision?: number) =>
      client.post(`/api/campaigns/${campaignId}/commands`, { campaignId, targetId, kind, payload, requestId: `party-${++request}`, ...(expectedRevision === undefined ? {} : { expectedRevision }) });
    for (const [client, id, name] of [[alice, 'char-a', 'Asha'], [bram, 'char-b', 'Bram']] as const) {
      await send(client, id, 'character.create');
      await send(client, id, 'character.save-draft', { draft: fighter(name) });
      expect((await send(client, id, 'character.finalize')).status).toBe(200);
    }
    const db = server.app.get(DatabaseService).getHandle();
    const row = db.prepare('SELECT resources FROM characters WHERE id = ?').get('char-a') as { resources: string };
    db.prepare('UPDATE characters SET resources = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(row.resources), concentration: 'spell.bless' }), 'char-a');

    await send(dm, 'scene-1', 'scene.save', { name: 'Field', assetId: null, grid: { columns: 10, rows: 10, cellPixels: 40, offsetX: 0, offsetY: 0, feetPerCell: 5 } });
    await send(dm, 'scene-1', 'scene.share', { shared: true }, 1);
    await send(dm, 'token-a', 'token.place', { sceneId: 'scene-1', label: 'Asha', kind: 'character', characterId: 'char-a', x: 1, y: 1, size: 1, hidden: false });
    await send(dm, 'token-g', 'token.place', { sceneId: 'scene-1', label: 'Goblin', kind: 'monster', monsterId: 'monster.goblin-warrior', x: 3, y: 1, size: 1, hidden: false, hp: { current: 10, max: 10 } });
    await send(dm, 'enc-1', 'encounter.save', { template: { name: 'Field', target: 'low', party: { mode: 'characters', characterIds: ['char-a', 'char-b'] }, monsters: [{ monsterId: 'monster.goblin-warrior', count: 1, hp: 'average' }], difficultTerrain: false, notes: '' } });
    expect((await send(dm, 'combat-1', 'combat.start', { templateId: 'enc-1', sceneId: 'scene-1' })).status).toBe(200);
    const dmView = async () => (await dm.get<Combat>(`/api/campaigns/${campaignId}/combats/combat-1`)).body;
    const asha = (await dmView()).combatants.find((c) => c.characterId === 'char-a')!;
    const goblin = (await dmView()).combatants.find((c) => !c.characterId)!;
    expect((await send(dm, 'combat-1', 'combat.conditions', { combatantId: asha.id, conditions: ['condition.prone'], exhaustion: 0, sourceRevision: asha.characterRevision! }, (await dmView()).revision)).status).toBe(200);
    expect((await send(dm, 'combat-1', 'combat.apply-hp', { combatantId: goblin.id, input: { kind: 'damage', amount: 7, damageType: 'slashing' } }, (await dmView()).revision)).status).toBe(200);
    expect((await send(dm, 'combat-1', 'combat.conditions', { combatantId: goblin.id, conditions: ['condition.grappled'], exhaustion: 0 }, (await dmView()).revision)).status).toBe(200);
    expect((await send(dm, 'combat-1', 'combat.bind-token', { combatantId: goblin.id, tokenId: 'token-g' }, (await dmView()).revision)).status).toBe(200);

    const seen = (await bram.get<CombatView>(`/api/campaigns/${campaignId}/combats/combat-1`)).body;
    const ashaSeen = seen.combatants.find((c) => c.id === asha.id)!;
    expect(ashaSeen.hp).toEqual((await dmView()).combatants.find((c) => c.id === asha.id)!.hp);
    expect(ashaSeen).toMatchObject({ conditions: ['condition.prone'], concentration: 'spell.bless', deathSaves: { successes: 0, failures: 0 } });
    for (const secret of ['budget', 'actions', 'characterRevision', 'vitals', 'speedFeet']) expect(ashaSeen).not.toHaveProperty(secret);
    const goblinSeen = seen.combatants.find((c) => c.id === goblin.id)!;
    expect(goblinSeen).toMatchObject({ standing: 'bloodied', conditions: ['condition.grappled'] });
    for (const secret of ['hp', 'monsterId', 'budget', 'vitals']) expect(goblinSeen).not.toHaveProperty(secret);
    // The owner sees their own Concentration too.
    expect((await alice.get<CombatView>(`/api/campaigns/${campaignId}/combats/combat-1`)).body.combatants.find((c) => c.id === asha.id)!.concentration).toBe('spell.bless');
    const snapshot = JSON.stringify((await bram.get<RoomSnapshot>(`/api/campaigns/${campaignId}/snapshot`)).body);
    expect(snapshot).not.toMatch(/"current":3,/);

    // Scene tokens follow the same rules.
    const scene = (await bram.get<SceneView>(`/api/campaigns/${campaignId}/scenes/scene-1`)).body;
    expect(scene.tokens.find((t) => t.id === 'token-a')!.hp).toBeDefined();
    const goblinToken = scene.tokens.find((t) => t.id === 'token-g')!;
    expect(goblinToken).toMatchObject({ standing: 'bloodied' });
    expect(goblinToken.hp).toBeUndefined();

    // Defeated, hidden and private sheets.
    expect((await send(dm, 'combat-1', 'combat.apply-hp', { combatantId: goblin.id, input: { kind: 'damage', amount: 3, damageType: 'slashing' } }, (await dmView()).revision)).status).toBe(200);
    expect((await bram.get<CombatView>(`/api/campaigns/${campaignId}/combats/combat-1`)).body.combatants.find((c) => c.id === goblin.id)!.standing).toBe('defeated');
    expect((await send(dm, 'combat-1', 'combat.update', { combatantId: goblin.id, patch: { hidden: true }, reason: 'Vanishes' }, (await dmView()).revision)).status).toBe(200);
    expect((await bram.get<CombatView>(`/api/campaigns/${campaignId}/combats/combat-1`)).body.combatants.some((c) => c.id === goblin.id)).toBe(false);
    expect((await bram.get(`/api/campaigns/${campaignId}/characters/char-a`)).status).toBe(403);
  });
});
