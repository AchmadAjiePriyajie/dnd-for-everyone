import { afterEach, describe, expect, it } from 'vitest';
import { type CharacterDraft, emptyDraft } from '#shared/characters';
import type { CommandEnvelope } from '#shared/commands';
import type { JsonValue } from '#shared/contracts';
import type { RoomSnapshot } from '#shared/room';
import { TestClient } from '../../../../../tests/helpers/http.js';
import { makeDataDir, removeDataDir, startTestServer, type TestServer } from '../../../../../tests/helpers/server.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

const PASSWORD = 'correct horse battery';

async function boot(dataDir: string): Promise<TestServer> {
  const server = await startTestServer({ dataDir });
  cleanup.push(() => server.close());
  return server;
}

async function login(server: TestServer, username: string): Promise<TestClient> {
  const client = new TestClient(server.app);
  expect((await client.post('/api/auth/login', { username, password: PASSWORD })).status).toBe(200);
  return client;
}

/** DM + dua player pada campaign yang sama. */
async function seed(server: TestServer) {
  const dm = new TestClient(server.app);
  await dm.post('/api/auth/bootstrap', { username: 'dungeon_master', password: PASSWORD });
  const campaignId = (await dm.post<{ id: string }>('/api/campaigns', { title: 'Lost Mine' })).body.id;
  const join = async (username: string) => {
    const code = (await dm.post<{ code: string }>(`/api/campaigns/${campaignId}/invites`)).body.code;
    const client = new TestClient(server.app);
    await client.post('/api/auth/register', { invite: code, username, password: PASSWORD });
    return { client, accountId: (await client.get<{ accountId: string }>('/api/auth/me')).body.accountId };
  };
  return { dm, campaignId, alice: await join('alice_fighter'), bob: await join('bob_wizard') };
}

let request = 0;
const send = (client: TestClient, campaignId: string, targetId: string, kind: string, payload: JsonValue = {}) =>
  client.post(`/api/campaigns/${campaignId}/commands`, { requestId: `req-${++request}`, campaignId, targetId, kind, payload } satisfies CommandEnvelope);

const complete = (): CharacterDraft => ({
  ...emptyDraft(),
  name: 'Brakka',
  concept: 'Former caravan guard',
  motivation: 'Repay a debt',
  partyBond: 'Owes Bob a life',
  speciesId: 'species.dwarf',
  backgroundId: 'background.soldier',
  backgroundIncrease: { mode: '2-1', plus2: 'str', plus1: 'con' },
  classId: 'class.fighter',
  abilityMethod: 'standard-array',
  baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  classSkills: ['perception', 'survival'],
  languages: ['Dwarvish', 'Giant'],
  toolChoices: [{ group: 'gaming-set', variant: 'dice' }],
  classEquipment: 'A',
  backgroundEquipment: 'B',
  equippedArmorId: 'equipment.chain-mail',
});

describe('character creation', () => {
  it('derives_stats_from_origin_and_equipment', async () => {
    const dataDir = await makeDataDir();
    cleanup.unshift(() => removeDataDir(dataDir));
    let server = await boot(dataDir);
    const { dm, campaignId, alice, bob } = await seed(server);
    const charId = 'char-brakka';
    const path = `/api/campaigns/${campaignId}/characters/${charId}`;

    expect((await send(alice.client, campaignId, charId, 'character.create')).status).toBe(200);
    expect((await send(bob.client, campaignId, charId, 'character.create')).body.code).toBe('CHARACTER_EXISTS');
    const partial = { ...complete(), classId: null, classSkills: [], classEquipment: null };
    expect((await send(alice.client, campaignId, charId, 'character.save-draft', { draft: partial })).status).toBe(200);

    // Wizard tidak final tanpa pilihan wajib.
    const early = await send(alice.client, campaignId, charId, 'character.finalize');
    expect(early.status).toBe(422);
    expect(early.body.code).toBe('CHARACTER_INCOMPLETE');
    const view = await alice.client.get<{ derived: { issues: Array<{ field: string }> } }>(path);
    expect(view.body.derived.issues.map((i) => i.field)).toEqual(expect.arrayContaining(['classId', 'classSkills', 'classEquipment']));

    // Player lain tidak dapat mengedit atau membaca sheet penuh.
    expect((await send(bob.client, campaignId, charId, 'character.save-draft', { draft: complete() })).body.code).toBe('FORBIDDEN');
    expect((await bob.client.get(path)).status).toBe(403);
    // Payload tidak valid ditolak sebelum menyentuh data.
    expect((await send(alice.client, campaignId, charId, 'character.save-draft', { draft: { ...partial, baseScores: { str: 99 } } })).status).toBe(400);

    // Draft pulih setelah server dimulai ulang.
    await server.close();
    cleanup.pop();
    server = await boot(dataDir);
    const aliceAgain = await login(server, 'alice_fighter');
    const restored = await aliceAgain.get<{ character: { draft: CharacterDraft; status: string; ownerAccountId: string } }>(path);
    expect(restored.body.character).toMatchObject({ status: 'draft', ownerAccountId: alice.accountId, draft: { name: 'Brakka', classId: null } });

    expect((await send(aliceAgain, campaignId, charId, 'character.save-draft', { draft: complete() })).status).toBe(200);
    expect((await send(aliceAgain, campaignId, charId, 'character.finalize')).status).toBe(200);
    const final = await aliceAgain.get<{ character: { status: string }; derived: { armorClass: { value: number }; hitPoints: { value: number } } }>(path);
    expect(final.body.character.status).toBe('final');
    expect(final.body.derived.armorClass.value).toBe(16);
    expect(final.body.derived.hitPoints.value).toBe(13);
    // Sheet final tidak diedit lewat wizard (perubahan berikutnya lewat level up/DM).
    expect((await send(aliceAgain, campaignId, charId, 'character.save-draft', { draft: complete() })).body.code).toBe('CHARACTER_FINAL');

    // Override DM: nilai dasar tetap terlihat; player tidak boleh override.
    const dmAgain = await login(server, 'dungeon_master');
    expect((await send(aliceAgain, campaignId, charId, 'character.set-override', { field: 'armorClass', value: 20 })).body.code).toBe('FORBIDDEN');
    expect((await send(dmAgain, campaignId, charId, 'character.set-override', { field: 'armorClass', value: 18 })).status).toBe(200);
    const overridden = await aliceAgain.get<{ derived: { armorClass: { base: number; value: number } } }>(path);
    expect(overridden.body.derived.armorClass).toMatchObject({ base: 16, value: 18 });

    // Snapshot room memuat ringkasan untuk semua anggota, tanpa catatan pribadi.
    const bobAgain = await login(server, 'bob_wizard');
    const snapshot = (await bobAgain.get<RoomSnapshot>(`/api/campaigns/${campaignId}/snapshot`)).body;
    expect(snapshot.characters).toEqual([
      { id: charId, ownerAccountId: alice.accountId, name: 'Brakka', status: 'final', classId: 'class.fighter', speciesId: 'species.dwarf', level: 1 },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('Repay a debt');

    // Transfer eksplisit oleh DM; pemilik lama ditolak, pemilik baru dapat membaca.
    expect((await send(aliceAgain, campaignId, charId, 'character.transfer', { toAccountId: bob.accountId })).body.code).toBe('FORBIDDEN');
    expect((await send(dmAgain, campaignId, charId, 'character.transfer', { toAccountId: 'nobody' })).body.code).toBe('MEMBER_NOT_FOUND');
    expect((await send(dmAgain, campaignId, charId, 'character.transfer', { toAccountId: bob.accountId })).status).toBe(200);
    expect((await aliceAgain.get(path)).status).toBe(403);
    expect((await bobAgain.get(path)).status).toBe(200);
  });

  it('lists_wizard_options_from_corpus', async () => {
    const dataDir = await makeDataDir();
    cleanup.unshift(() => removeDataDir(dataDir));
    const server = await boot(dataDir);
    const { campaignId, alice } = await seed(server);
    const options = (await alice.client.get<any>(`/api/campaigns/${campaignId}/character-options?locale=id`)).body;
    expect(options.classes).toHaveLength(12);
    expect(options.backgrounds.map((b: { id: string }) => b.id)).toEqual(['background.acolyte', 'background.criminal', 'background.sage', 'background.soldier']);
    expect(options.species).toHaveLength(9);
    expect(options.originFeats.map((f: { id: string }) => f.id)).toContain('feat.alert');
    expect(options.originFeats.every((f: { id: string }) => !f.id.startsWith('feat.boon'))).toBe(true);
    expect(options.languages).toContain('Dwarvish');
    expect(options.artisanTools).toHaveLength(17);
    expect(options.allowedMethods).toEqual(['standard-array', 'point-buy', 'roll']);
    // Nama lokal + nama asli EN untuk entri dan item paket awal.
    const fighter = options.classes.find((c: { id: string }) => c.id === 'class.fighter');
    expect(fighter).toMatchObject({ name: 'Fighter', originalName: 'Fighter', mechanics: { hitDie: 10, armorTraining: ['light', 'medium', 'heavy', 'shield'] } });
    expect(fighter.mechanics.progression).toBeUndefined();
    expect(options.names['equipment.chain-mail']).toBe('Chain Mail');
    expect(options.armor).toMatchObject({ 'equipment.chain-mail': 'heavy', 'equipment.leather-armor': 'light' });
    expect(options.armor['equipment.shield']).toBeUndefined();
    expect(options.names['background.soldier']).toBe('Soldier');
    expect((await new TestClient(server.app).get(`/api/campaigns/${campaignId}/character-options?locale=id`)).status).toBe(401);
  });

  it('records_rolls_and_respects_dm_methods', async () => {
    const dataDir = await makeDataDir();
    cleanup.unshift(() => removeDataDir(dataDir));
    const server = await boot(dataDir);
    const { dm, campaignId, alice } = await seed(server);
    const charId = 'char-roller';
    const path = `/api/campaigns/${campaignId}/characters/${charId}`;
    await send(alice.client, campaignId, charId, 'character.create');

    expect((await send(alice.client, campaignId, charId, 'character.roll-abilities')).status).toBe(200);
    const rolled = (await alice.client.get<{ character: { rolls: Array<{ dice: number[]; total: number }> } }>(path)).body.character.rolls;
    expect(rolled).toHaveLength(6);
    for (const roll of rolled) {
      expect(roll.dice).toHaveLength(4);
      expect(roll.total).toBe([...roll.dice].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0));
    }
    // Lemparan tidak dapat diulang oleh player.
    expect((await send(alice.client, campaignId, charId, 'character.roll-abilities')).body.code).toBe('ALREADY_ROLLED');

    // DM membatasi metode: standard array tidak lagi boleh difinalisasi.
    expect((await send(alice.client, campaignId, campaignId, 'campaign.set-ability-methods', { methods: ['point-buy'] })).body.code).toBe('FORBIDDEN');
    expect((await send(dm, campaignId, campaignId, 'campaign.set-ability-methods', { methods: ['point-buy'] })).status).toBe(200);
    await send(alice.client, campaignId, charId, 'character.save-draft', { draft: complete() });
    const blocked = await alice.client.get<{ derived: { issues: Array<{ field: string; code: string }> } }>(path);
    expect(blocked.body.derived.issues).toContainEqual({ field: 'abilityMethod', code: 'NOT_ALLOWED' });
    expect((await send(alice.client, campaignId, charId, 'character.finalize')).body.code).toBe('CHARACTER_INCOMPLETE');
  });
});
