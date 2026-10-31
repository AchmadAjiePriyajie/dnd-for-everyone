import { afterEach, describe, expect, it } from 'vitest';
import type { CommandEnvelope } from '#shared/commands';
import type { JsonValue } from '#shared/contracts';
import type { EncounterTemplate, HomebrewDraft } from '#shared/encounters';
import { TestClient } from '../../../../../tests/helpers/http.js';
import { makeDataDir, removeDataDir, startTestServer } from '../../../../../tests/helpers/server.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

const PASSWORD = 'correct horse battery';

async function seed() {
  const dataDir = await makeDataDir();
  cleanup.push(() => removeDataDir(dataDir));
  const server = await startTestServer({ dataDir });
  cleanup.push(() => server.close());
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
const send = (client: TestClient, campaignId: string, targetId: string, kind: string, payload: JsonValue = {}, expectedRevision?: number) =>
  client.post(`/api/campaigns/${campaignId}/commands`, {
    requestId: `req-${++request}`,
    campaignId,
    targetId,
    kind,
    payload,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
  } satisfies CommandEnvelope);

/** Monster homebrew dengan bentuk mekanik yang sama seperti stat block SRD. */
const mudling = (over: Record<string, unknown> = {}): HomebrewDraft => ({
  kind: 'monster',
  name: 'Mudling',
  summary: 'A small swamp creature.',
  body: '**AC** 12 **HP** 9 (2d8)',
  mechanics: {
    alignment: 'neutral',
    size: ['small'],
    creatureTypes: ['elemental'],
    ac: 12,
    initiative: 1,
    hp: { average: 9, formula: '2d8' },
    speed: { walk: 20 },
    abilities: { str: 10, dex: 12, con: 12, int: 4, wis: 10, cha: 5 },
    saves: { str: 0, dex: 1, con: 1, int: -3, wis: 0, cha: -3 },
    senses: {},
    passivePerception: 10,
    cr: '1/4',
    xp: 50,
    proficiencyBonus: 2,
    ...over,
  },
});

describe('homebrew and encounters', () => {
  it('approves_safe_homebrew_and_estimates_encounters', async () => {
    const { dm, campaignId, alice, bob } = await seed();
    const search = async (client: TestClient, q: string) =>
      (await client.get<Array<{ entryId: string; entryKind: string }>>(`/api/reference/search?q=${encodeURIComponent(q)}&locale=en&campaignId=${campaignId}`)).body;

    // Player mengusulkan; mekanik divalidasi dengan skema kind yang sama seperti corpus.
    expect((await send(alice.client, campaignId, 'hb-mud', 'homebrew.save', { draft: mudling({ xp: 'lots' }) as unknown as JsonValue })).body).toMatchObject({ code: 'HOMEBREW_INVALID' });
    // Formula/kode tidak aman ditolak, tidak dievaluasi.
    expect(
      (await send(alice.client, campaignId, 'hb-mud', 'homebrew.save', { draft: mudling({ hp: { average: 9, formula: 'process.exit()' } }) as unknown as JsonValue })).body,
    ).toMatchObject({ code: 'HOMEBREW_FORMULA', params: { path: 'hp.formula' } });
    expect((await send(alice.client, campaignId, 'hb-mud', 'homebrew.save', { draft: mudling() as unknown as JsonValue })).status).toBe(200);

    // Belum disetujui: hanya pengusul dan DM yang melihat; tidak muncul di pencarian player lain.
    const list = async (client: TestClient) => (await client.get<Array<{ id: string; status: string }>>(`/api/campaigns/${campaignId}/homebrew`)).body;
    expect(await list(alice.client)).toEqual([expect.objectContaining({ id: 'hb-mud', status: 'pending' })]);
    expect(await list(bob.client)).toEqual([]);
    expect(await list(dm)).toEqual([expect.objectContaining({ id: 'hb-mud', status: 'pending' })]);
    expect((await search(bob.client, 'mudling')).map((hit) => hit.entryId)).not.toContain('hb-mud');
    // Pengusul lain tidak bisa mengubah usulan orang lain; player tidak bisa menyetujui.
    expect((await send(bob.client, campaignId, 'hb-mud', 'homebrew.save', { draft: mudling() as unknown as JsonValue }, 1)).body.code).toBe('FORBIDDEN');
    expect((await send(alice.client, campaignId, 'hb-mud', 'homebrew.approve', {}, 1)).body.code).toBe('FORBIDDEN');

    // Encounter belum boleh memakai homebrew yang belum disetujui.
    const template = (monsters: EncounterTemplate['monsters'], party: EncounterTemplate['party'] = { mode: 'levels', levels: [1, 1, 1, 1] }): EncounterTemplate => ({
      name: 'Swamp ambush',
      target: 'low',
      party,
      monsters,
      difficultTerrain: true,
      notes: 'Mud slows movement.',
    });
    expect((await send(dm, campaignId, 'enc-1', 'encounter.save', { template: template([{ monsterId: 'hb-mud', count: 2, hp: 'average' }]) })).body.code).toBe('MONSTER_UNAVAILABLE');

    expect((await send(dm, campaignId, 'hb-mud', 'homebrew.approve', {}, 1)).status).toBe(200);
    expect((await list(bob.client)).map((entry) => entry.status)).toEqual(['approved']);
    const hit = (await search(bob.client, 'mudling')).find((entry) => entry.entryId === 'hb-mud');
    expect(hit?.entryKind).toBe('homebrew.monster');

    // Monster picker: SRD + homebrew disetujui, ditandai homebrew.
    const monsters = (await dm.get<Array<{ id: string; xp: number; homebrew: boolean }>>(`/api/campaigns/${campaignId}/monsters?locale=en`)).body;
    expect(monsters.find((monster) => monster.id === 'monster.goblin-warrior')).toMatchObject({ xp: 50, homebrew: false });
    expect(monsters.find((monster) => monster.id === 'hb-mud')).toMatchObject({ xp: 50, homebrew: true });
    expect((await bob.client.get(`/api/campaigns/${campaignId}/monsters?locale=en`)).status).toBe(403);

    // Template: 2 Goblin Warrior + 2 Mudling = 200 XP untuk empat level 1 → Low, tanpa multiplier.
    expect(
      (
        await send(dm, campaignId, 'enc-1', 'encounter.save', {
          template: template([
            { monsterId: 'monster.goblin-warrior', count: 2, hp: 'average' },
            { monsterId: 'hb-mud', count: 2, hp: 'rolled' },
          ]),
        })
      ).status,
    ).toBe(200);
    const encounters = (await dm.get<Array<{ id: string; estimate: { totalXp: number; label: string; risks: string[] } }>>(`/api/campaigns/${campaignId}/encounters`)).body;
    expect(encounters[0]).toMatchObject({ id: 'enc-1', estimate: { totalXp: 200, label: 'low', risks: ['TERRAIN'] } });
    // Persiapan encounter rahasia untuk player.
    expect((await bob.client.get(`/api/campaigns/${campaignId}/encounters`)).status).toBe(403);
    expect((await send(alice.client, campaignId, 'enc-2', 'encounter.save', { template: template([]) })).body.code).toBe('FORBIDDEN');
    // Party dari karakter yang belum ada tidak menghasilkan difficulty palsu.
    await send(dm, campaignId, 'enc-2', 'encounter.save', { template: template([{ monsterId: 'monster.goblin-warrior', count: 1, hp: 'average' }], { mode: 'characters', characterIds: ['char-nope'] }) });
    const second = (await dm.get<Array<{ id: string; estimate: unknown; issues: string[] }>>(`/api/campaigns/${campaignId}/encounters`)).body.find((entry) => entry.id === 'enc-2');
    expect(second).toMatchObject({ estimate: null, issues: ['PARTY_EMPTY'] });
    // Jumlah tidak valid ditolak schema.
    expect((await send(dm, campaignId, 'enc-3', 'encounter.save', { template: template([{ monsterId: 'monster.goblin-warrior', count: 0, hp: 'average' }]) })).status).toBe(400);

    // Duplikasi monster SRD menjadi homebrew DM yang bisa diubah.
    expect((await send(dm, campaignId, 'hb-boss', 'homebrew.duplicate', { sourceId: 'monster.goblin-boss' })).status).toBe(200);
    const copy = (await dm.get<{ name: string; kind: string; status: string; mechanics: { xp: number } }>(`/api/campaigns/${campaignId}/homebrew/hb-boss`)).body;
    expect(copy).toMatchObject({ kind: 'monster', name: 'Goblin Boss (copy)', status: 'approved' });
    expect(copy.mechanics.xp).toBeGreaterThan(0);
    expect((await send(dm, campaignId, 'hb-x', 'homebrew.duplicate', { sourceId: 'rule.hit-points' })).body.code).toBe('HOMEBREW_INVALID');
  });
});
