import { afterEach, describe, expect, it } from 'vitest';
import { type CharacterDraft, emptyDraft } from '#shared/characters';
import type { CommandEnvelope } from '#shared/commands';
import type { JsonValue } from '#shared/contracts';
import type { NoteDraft } from '#shared/notes';
import type { RoomSnapshot } from '#shared/room';
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
  return { server, dm, campaignId, alice: await join('alice_fighter'), bob: await join('bob_wizard') };
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

const note = (over: Partial<NoteDraft>): NoteDraft => ({
  kind: 'world',
  title: 'Untitled',
  body: '',
  dmNotes: '',
  scene: null,
  quest: null,
  links: [],
  visibility: { mode: 'dm' },
  ...over,
});

const SECRET = 'duke-is-a-vampire';
const TRAP = 'trap-dc-15';
const HANDOUT = 'map-to-cragmaw';

describe('campaign notes', () => {
  it('does_not_leak_unshared_story', async () => {
    const { dm, campaignId, alice, bob } = await seed();
    const notes = `/api/campaigns/${campaignId}/notes`;

    // Persiapan DM default rahasia; scene dibagikan ke party tanpa catatan DM-nya.
    expect((await send(dm, campaignId, 'note-world', 'note.save', { draft: note({ title: 'The Duke', body: `The ${SECRET}.` }) })).status).toBe(200);
    expect(
      (
        await send(dm, campaignId, 'note-scene', 'note.save', {
          draft: note({
            kind: 'scene',
            title: 'Goblin Ambush',
            body: 'The road narrows.',
            dmNotes: `Hidden ${TRAP}.`,
            scene: { readAloud: 'Arrows whistle past you!', triggers: `When ${TRAP} fires`, outcomes: 'Goblins flee', rewards: '50 gp', statBlocks: ['monster.goblin-warrior'] },
            links: ['note-world'],
            visibility: { mode: 'party' },
          }),
        })
      ).status,
    ).toBe(200);
    // Handout hanya untuk Alice.
    await send(dm, campaignId, 'note-handout', 'note.save', {
      draft: note({ kind: 'handout', title: 'Torn map', body: `A ${HANDOUT}.`, visibility: { mode: 'members', accountIds: [alice.accountId] } }),
    });
    // Script/HTML disimpan apa adanya sebagai teks; renderer client tidak mengeksekusinya.
    await send(dm, campaignId, 'note-ruling', 'note.save', {
      draft: note({ kind: 'ruling', title: 'Grapple ruling', body: '<script>alert(1)</script> **Advantage**', visibility: { mode: 'party' } }),
    });

    // Player tidak bisa menulis atau membagikan catatan.
    expect((await send(bob.client, campaignId, 'note-bob', 'note.save', { draft: note({ title: 'Mine' }) })).body.code).toBe('FORBIDDEN');

    const bobList = (await bob.client.get<Array<{ id: string; title: string }>>(notes)).body;
    expect(bobList.map((entry) => entry.id).sort()).toEqual(['note-ruling', 'note-scene']);
    const scene = (await bob.client.get<Record<string, unknown>>(`${notes}/note-scene`)).body;
    expect(scene).toMatchObject({ id: 'note-scene', title: 'Goblin Ambush', body: 'The road narrows.', scene: { readAloud: 'Arrows whistle past you!' } });
    // Tautan ke catatan rahasia tidak terlihat.
    expect(scene.links).toEqual([]);
    expect(JSON.stringify(scene)).not.toContain(TRAP);
    expect(JSON.stringify(scene)).not.toContain('50 gp');
    expect((await bob.client.get<{ body: string }>(`${notes}/note-ruling`)).body.body).toBe('<script>alert(1)</script> **Advantage**');

    // ID ditebak: catatan rahasia dan yang tidak ada sama-sama 403.
    const guessed = await bob.client.get(`${notes}/note-world`);
    const missing = await bob.client.get(`${notes}/note-nope`);
    expect(guessed.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(guessed.body).toEqual(missing.body);
    expect((await bob.client.get(`${notes}/note-handout`)).status).toBe(403);
    expect((await alice.client.get<{ body: string }>(`${notes}/note-handout`)).body.body).toContain(HANDOUT);

    // Snapshot room dan pencarian referensi tidak membawa teks rahasia.
    const bobSnapshot = JSON.stringify((await bob.client.get<RoomSnapshot>(`/api/campaigns/${campaignId}/snapshot`)).body);
    for (const secret of [SECRET, TRAP, HANDOUT, 'The Duke', 'Torn map']) expect(bobSnapshot).not.toContain(secret);
    const search = async (client: TestClient, q: string) =>
      (await client.get<Array<{ entryId: string }>>(`/api/reference/search?q=${encodeURIComponent(q)}&locale=en&campaignId=${campaignId}`)).body.map((hit) => hit.entryId);
    expect(await search(bob.client, 'vampire')).not.toContain('note-world');
    expect(await search(dm, 'vampire')).toContain('note-world');
    expect(await search(bob.client, 'cragmaw')).not.toContain('note-handout');
    expect(await search(alice.client, 'cragmaw')).toContain('note-handout');
    // Teks persiapan scene (trigger/catatan DM) tidak diindeks untuk party.
    expect(await search(bob.client, 'trap dc 15')).not.toContain('note-scene');
    expect(await search(bob.client, 'goblin ambush')).toContain('note-scene');

    // DM melihat semuanya, termasuk catatan DM pada scene.
    const dmScene = (await dm.get<{ dmNotes: string; scene: { rewards: string }; visibility: unknown; revision: number }>(`${notes}/note-scene`)).body;
    expect(dmScene).toMatchObject({ dmNotes: `Hidden ${TRAP}.`, scene: { rewards: '50 gp' }, visibility: { mode: 'party' }, revision: 1 });

    // Berbagi saat bermain: DM membuka catatan dunia untuk party.
    expect((await send(dm, campaignId, 'note-world', 'note.share', { visibility: { mode: 'party' } }, 1)).status).toBe(200);
    expect((await bob.client.get<{ body: string }>(`${notes}/note-world`)).body.body).toContain(SECRET);
    // Anggota yang dipilih harus anggota campaign.
    expect((await send(dm, campaignId, 'note-handout', 'note.share', { visibility: { mode: 'members', accountIds: ['stranger'] } }, 1)).body.code).toBe('MEMBER_NOT_FOUND');
  });

  it('keeps_conflicting_drafts_from_silent_overwrite', async () => {
    const { dm, campaignId } = await seed();
    const path = `/api/campaigns/${campaignId}/notes/note-npc`;
    await send(dm, campaignId, 'note-npc', 'note.save', { draft: note({ kind: 'npc', title: 'Sildar', body: 'v1' }) });
    // Dua tab membuka revisi 1. Tab A menyimpan dulu.
    expect((await send(dm, campaignId, 'note-npc', 'note.save', { draft: note({ kind: 'npc', title: 'Sildar', body: 'tab A' }) }, 1)).status).toBe(200);
    // Tab B masih di revisi 1: ditolak, isi tab A tetap.
    const stale = await send(dm, campaignId, 'note-npc', 'note.save', { draft: note({ kind: 'npc', title: 'Sildar', body: 'tab B' }) }, 1);
    expect(stale.body).toMatchObject({ code: 'STALE_REVISION', params: { currentRevision: 2 } });
    // Menyimpan catatan yang sudah ada tanpa revisi juga ditolak.
    expect((await send(dm, campaignId, 'note-npc', 'note.save', { draft: note({ kind: 'npc', title: 'Sildar', body: 'blind' }) })).body.code).toBe('REVISION_REQUIRED');
    expect((await dm.get<{ body: string; revision: number }>(path)).body).toMatchObject({ body: 'tab A', revision: 2 });
    // Link ke catatan yang tidak ada ditolak; jenis tidak dikenal ditolak schema.
    expect((await send(dm, campaignId, 'note-npc', 'note.save', { draft: note({ kind: 'npc', title: 'Sildar', links: ['note-ghost'] }) }, 2)).body.code).toBe('NOTE_LINK_INVALID');
    expect((await send(dm, campaignId, 'note-x', 'note.save', { draft: { ...note({}), kind: 'diary' } as unknown as JsonValue })).status).toBe(400);
    // Hapus memakai revisi juga.
    expect((await send(dm, campaignId, 'note-npc', 'note.delete', {}, 2)).status).toBe(200);
    expect((await dm.get(path)).status).toBe(403);
  });

  it('projects_party_cheat_sheet_for_dm_only', async () => {
    const { dm, campaignId, alice, bob } = await seed();
    const draft: CharacterDraft = {
      ...emptyDraft(),
      name: 'Brakka',
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
    };
    await send(alice.client, campaignId, 'char-brakka', 'character.create');
    await send(alice.client, campaignId, 'char-brakka', 'character.save-draft', { draft });
    await send(alice.client, campaignId, 'char-brakka', 'character.finalize');
    await send(alice.client, campaignId, 'char-brakka', 'character.set-hp', { current: 9, temp: 2 });

    const dmSnapshot = (await dm.get<RoomSnapshot>(`/api/campaigns/${campaignId}/snapshot`)).body;
    expect(dmSnapshot.dm?.invites).toBeDefined();
    const row = dmSnapshot.dm?.cheatSheet?.find((entry) => entry.characterId === 'char-brakka');
    // AC/HP/Passive Perception dari sheet; HP dipisah dari statistik pasif.
    expect(row).toMatchObject({ name: 'Brakka', armorClass: 16, hitPoints: { current: 9, max: 13, temp: 2 }, passivePerception: 13 });
    expect(row?.resources).toContainEqual({ key: 'class.fighter/second-wind', name: 'Second Wind', remaining: 2, max: 2 });
    const bobSnapshot = (await bob.client.get<RoomSnapshot>(`/api/campaigns/${campaignId}/snapshot`)).body;
    expect(bobSnapshot.dm).toBeUndefined();
    expect(JSON.stringify(bobSnapshot)).not.toContain('cheatSheet');
  });
});
