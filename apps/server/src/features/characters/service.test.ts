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
    // Pilihan Weapon Mastery: hanya senjata yang punya properti mastery, beserta nama properti.
    expect(options.masteryWeapons.find((w: { id: string }) => w.id === 'equipment.longsword')).toMatchObject({ mechanics: { mastery: 'rule.mastery-sap', type: 'melee' } });
    expect(options.masteryWeapons).toHaveLength(38);
    expect(options.names['rule.mastery-sap']).toBeTruthy();
    expect(options.items).toHaveLength(182 + 258);
    expect(options.spells.find((s: { id: string }) => s.id === 'spell.bless')).toMatchObject({ mechanics: { level: 1, concentration: true } });
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
  it('tracks_feature_uses_and_inspiration', async () => {
    const dataDir = await makeDataDir();
    cleanup.unshift(() => removeDataDir(dataDir));
    const server = await boot(dataDir);
    const { dm, campaignId, alice, bob } = await seed(server);
    const charId = 'char-features';
    const path = `/api/campaigns/${campaignId}/characters/${charId}`;
    type View = { features: Array<{ key: string; name: string; resource: { remaining: number; spent: number } | null }>; character: { featureState: { weaponMasteries: string[]; heroicInspiration: boolean } } };
    const view = async (client: TestClient, locale = 'en') => (await client.get<View>(`${path}?locale=${locale}`)).body;
    const secondWind = (body: View) => body.features.find((f) => f.key === 'class.fighter/second-wind');
    await send(alice.client, campaignId, charId, 'character.create');
    await send(alice.client, campaignId, charId, 'character.save-draft', { draft: complete() });

    // Fitur hanya dipakai setelah karakter final.
    expect((await send(alice.client, campaignId, charId, 'character.use-feature', { featureKey: 'class.fighter/second-wind' })).body.code).toBe('CHARACTER_NOT_FINAL');
    // Mastery boleh diisi saat draft.
    expect((await send(alice.client, campaignId, charId, 'character.set-weapon-masteries', { weapons: ['equipment.greatsword', 'equipment.flail', 'equipment.javelin'] })).status).toBe(200);
    expect((await send(alice.client, campaignId, charId, 'character.set-weapon-masteries', { weapons: ['equipment.rope'] })).body).toMatchObject({ code: 'MASTERY_INVALID', params: { issue: 'MASTERY_INVALID:equipment.rope' } });
    await send(alice.client, campaignId, charId, 'character.finalize');

    expect(secondWind(await view(alice.client))?.resource).toMatchObject({ remaining: 2 });
    // Second Wind dua kali, lalu habis; retry requestId sama tidak memakai lagi.
    const envelope = { requestId: 'sw-1', campaignId, targetId: charId, kind: 'character.use-feature', payload: { featureKey: 'class.fighter/second-wind' } };
    expect((await alice.client.post(`/api/campaigns/${campaignId}/commands`, envelope)).status).toBe(200);
    expect((await alice.client.post(`/api/campaigns/${campaignId}/commands`, envelope)).status).toBe(200);
    expect(secondWind(await view(alice.client))?.resource).toMatchObject({ remaining: 1 });
    expect((await send(alice.client, campaignId, charId, 'character.use-feature', { featureKey: 'class.fighter/second-wind' })).status).toBe(200);
    expect((await send(alice.client, campaignId, charId, 'character.use-feature', { featureKey: 'class.fighter/second-wind' })).body.code).toBe('NO_USES_LEFT');
    expect((await send(alice.client, campaignId, charId, 'character.use-feature', { featureKey: 'class.barbarian/rage' })).body.code).toBe('FEATURE_NOT_OWNED');
    // Player lain tidak bisa memakai fitur karakter ini.
    expect((await send(bob.client, campaignId, charId, 'character.use-feature', { featureKey: 'class.fighter/second-wind' })).body.code).toBe('FORBIDDEN');

    // Mengganti mastery yang sudah dipilih butuh Long Rest; DM boleh mengoreksi.
    const swap = { weapons: ['equipment.longsword', 'equipment.flail', 'equipment.javelin'] };
    expect((await send(alice.client, campaignId, charId, 'character.set-weapon-masteries', swap)).body.code).toBe('MASTERY_CHANGE_NEEDS_REST');
    expect((await send(dm, campaignId, charId, 'character.set-weapon-masteries', swap)).status).toBe(200);
    expect((await view(alice.client)).character.featureState.weaponMasteries).toEqual(swap.weapons);

    // Koreksi DM atas pemakaian; player tidak boleh.
    expect((await send(alice.client, campaignId, charId, 'character.set-feature-spent', { featureKey: 'class.fighter/second-wind', spent: 0 })).body.code).toBe('FORBIDDEN');
    expect((await send(dm, campaignId, charId, 'character.set-feature-spent', { featureKey: 'class.fighter/second-wind', spent: 3 })).body.code).toBe('AMOUNT_NOT_ALLOWED');
    expect((await send(dm, campaignId, charId, 'character.set-feature-spent', { featureKey: 'class.fighter/second-wind', spent: 1 })).status).toBe(200);
    expect(secondWind(await view(alice.client))?.resource).toMatchObject({ remaining: 1, spent: 1 });

    // Heroic Inspiration: diberi DM, dipakai pemilik satu kali.
    expect((await send(alice.client, campaignId, charId, 'character.grant-inspiration')).body.code).toBe('FORBIDDEN');
    expect((await send(alice.client, campaignId, charId, 'character.use-feature', { featureKey: 'rule.heroic-inspiration' })).body.code).toBe('NO_USES_LEFT');
    expect((await send(dm, campaignId, charId, 'character.grant-inspiration')).status).toBe(200);
    expect((await send(dm, campaignId, charId, 'character.grant-inspiration')).body.code).toBe('ALREADY_INSPIRED');
    expect((await send(alice.client, campaignId, charId, 'character.use-feature', { featureKey: 'rule.heroic-inspiration' })).status).toBe(200);
    expect((await send(alice.client, campaignId, charId, 'character.use-feature', { featureKey: 'rule.heroic-inspiration' })).body.code).toBe('NO_USES_LEFT');

    // Teks referensi mengikuti locale; nama fitur dari sumber.
    const id = await view(alice.client, 'id');
    expect(secondWind(id)?.name).toBe('Second Wind');
    expect(id.features.find((f) => f.key === 'rule.heroic-inspiration')?.name).not.toBe('');
  });

  it('manages_resources_and_rests_by_dm_policy', async () => {
    const dataDir = await makeDataDir();
    cleanup.unshift(() => removeDataDir(dataDir));
    const server = await boot(dataDir);
    const { dm, campaignId, alice, bob } = await seed(server);
    const charId = 'char-resources';
    const path = `/api/campaigns/${campaignId}/characters/${charId}`;
    type Entry = { entryId: string; itemId: string | null; quantity: number };
    type View = {
      character: { draft: { equippedArmorId: string | null }; resources: { inventory: Entry[]; coins: { gp: number } } };
      derived: { armorClass: { base: number; value: number }; currentHitPoints: number; hitPoints: { value: number }; attacks: Array<{ itemId: string }> };
      restPolicy: string;
    };
    const view = async () => (await alice.client.get<View>(path)).body;
    await send(alice.client, campaignId, charId, 'character.create');
    await send(alice.client, campaignId, charId, 'character.save-draft', { draft: complete() });
    // Belum final: resource belum bisa diubah.
    expect((await send(alice.client, campaignId, charId, 'character.adjust-coins', { coin: 'gp', delta: 1 })).body.code).toBe('CHARACTER_NOT_FINAL');
    await send(alice.client, campaignId, charId, 'character.finalize');

    // Finalisasi menyalin paket awal: Chain Mail, Greatsword, 8 Javelin, 54 gp.
    let body = await view();
    const entry = (id: string) => body.character.resources.inventory.find((item) => item.itemId === id)!;
    expect(entry('equipment.javelin').quantity).toBe(8);
    expect(body.character.resources.coins.gp).toBe(54);
    expect(body.derived.attacks.map((attack) => attack.itemId)).toContain('equipment.greatsword');

    expect((await send(alice.client, campaignId, charId, 'character.adjust-item', { entryId: entry('equipment.javelin').entryId, delta: -9 })).body.code).toBe('INVENTORY_NEGATIVE');
    expect((await send(alice.client, campaignId, charId, 'character.adjust-coins', { coin: 'gp', delta: -55 })).body.code).toBe('COINS_NEGATIVE');
    expect((await send(bob.client, campaignId, charId, 'character.adjust-coins', { coin: 'gp', delta: 1 })).body.code).toBe('FORBIDDEN');
    // DM memberi loot; pemain tidak bisa attune item yang tidak butuh attunement.
    expect((await send(dm, campaignId, charId, 'character.add-item', { itemId: 'magic-item.adamantine-armor', quantity: 1 })).status).toBe(200);
    body = await view();
    expect((await send(alice.client, campaignId, charId, 'character.set-attunement', { entryId: entry('magic-item.adamantine-armor').entryId, attuned: true })).body.code).toBe('ATTUNEMENT_NOT_REQUIRED');

    // Koreksi DM atas AC tetap ada saat armor dilepas; nilai aturan dihitung ulang.
    await send(dm, campaignId, charId, 'character.set-override', { field: 'armorClass', value: 18 });
    expect((await send(alice.client, campaignId, charId, 'character.equip', { armorId: null, shield: false })).status).toBe(200);
    expect((await view()).derived.armorClass).toMatchObject({ base: 11, value: 18 });
    expect((await send(alice.client, campaignId, charId, 'character.equip', { armorId: 'equipment.plate-armor', shield: false })).body).toMatchObject({ code: 'LOADOUT_INVALID', params: { issue: 'ARMOR_NOT_CARRIED' } });
    await send(alice.client, campaignId, charId, 'character.equip', { armorId: 'equipment.chain-mail', shield: false });
    // Membuang armor yang dipakai sekaligus melepasnya.
    body = await view();
    expect((await send(alice.client, campaignId, charId, 'character.adjust-item', { entryId: entry('equipment.chain-mail').entryId, delta: -1 })).status).toBe(200);
    expect((await view()).character.draft.equippedArmorId).toBeNull();

    // Fighter tidak punya spellcasting: pilihan spell ditolak.
    expect((await send(alice.client, campaignId, charId, 'character.set-spells', { spells: [{ classId: 'class.fighter', cantrips: [], prepared: ['spell.bless'] }] })).body).toMatchObject({
      code: 'SPELLS_INVALID',
      params: { issue: 'NOT_A_CASTER:class.fighter' },
    });
    expect((await send(alice.client, campaignId, charId, 'character.spend-slot', { level: 1 })).body.code).toBe('NO_SLOT_LEFT');

    // HP: luka 5, lalu rest. Kebijakan default: hanya DM yang menyelesaikan rest.
    expect((await send(alice.client, campaignId, charId, 'character.set-hp', { current: 99, temp: 0 })).body.code).toBe('HP_INVALID');
    expect((await send(alice.client, campaignId, charId, 'character.set-hp', { current: 8, temp: 0 })).status).toBe(200);
    expect((await view()).restPolicy).toBe('dm');
    const preview = (await alice.client.get<{ changes: Array<{ key: string; before: number; after: number }> }>(`${path}/rest-preview?rest=long`)).body;
    expect(preview.changes).toContainEqual({ key: 'hitPoints', before: 8, after: 13 });
    expect((await view()).derived.currentHitPoints).toBe(8);
    expect((await send(alice.client, campaignId, charId, 'character.rest', { rest: 'short', hitDice: { 'class.fighter': 1 } })).body.code).toBe('REST_NEEDS_DM');
    expect((await send(alice.client, campaignId, campaignId, 'campaign.set-rest-policy', { policy: 'players' })).body.code).toBe('FORBIDDEN');
    expect((await send(dm, campaignId, campaignId, 'campaign.set-rest-policy', { policy: 'players' })).status).toBe(200);

    // Short Rest dengan satu Hit Die: lemparan server tersimpan; retry requestId sama tidak melempar ulang.
    const envelope = { requestId: 'rest-1', campaignId, targetId: charId, kind: 'character.rest', payload: { rest: 'short', hitDice: { 'class.fighter': 1 } } };
    const first = await alice.client.post<{ value: { rolls: Array<{ roll: number }>; hitPoints: number } }>(`/api/campaigns/${campaignId}/commands`, envelope);
    expect(first.status).toBe(200);
    const roll = first.body.value.rolls[0]!.roll;
    expect(roll).toBeGreaterThanOrEqual(1);
    expect(roll).toBeLessThanOrEqual(10);
    const healed = Math.min(13, 8 + Math.max(1, roll + 2));
    expect(first.body.value.hitPoints).toBe(healed);
    const again = await alice.client.post<{ value: unknown }>(`/api/campaigns/${campaignId}/commands`, envelope);
    expect(again.body.value).toEqual(first.body.value);
    expect((await view()).derived.currentHitPoints).toBe(healed);
    // Level 1: hanya satu Hit Point Die.
    expect((await send(alice.client, campaignId, charId, 'character.rest', { rest: 'short', hitDice: { 'class.fighter': 1 } })).body.code).toBe('NO_HIT_DICE');
    expect((await send(alice.client, campaignId, charId, 'character.rest', { rest: 'long' })).status).toBe(200);
    expect((await view()).derived.currentHitPoints).toBe(13);
    // Setelah Long Rest, Fighter boleh mengganti satu pilihan mastery, sekali.
    await send(dm, campaignId, charId, 'character.set-weapon-masteries', { weapons: ['equipment.greatsword', 'equipment.flail', 'equipment.javelin'] });
    expect((await send(alice.client, campaignId, charId, 'character.set-weapon-masteries', { weapons: ['equipment.longsword', 'equipment.dagger', 'equipment.javelin'] })).body.code).toBe('MASTERY_CHANGE_NEEDS_REST');
    await send(alice.client, campaignId, charId, 'character.rest', { rest: 'long' });
    expect((await send(alice.client, campaignId, charId, 'character.set-weapon-masteries', { weapons: ['equipment.longsword', 'equipment.dagger', 'equipment.javelin'] })).body.code).toBe('MASTERY_CHANGE_NEEDS_REST');
    expect((await send(alice.client, campaignId, charId, 'character.set-weapon-masteries', { weapons: ['equipment.longsword', 'equipment.flail', 'equipment.javelin'] })).status).toBe(200);
    expect((await send(alice.client, campaignId, charId, 'character.set-weapon-masteries', { weapons: ['equipment.dagger', 'equipment.flail', 'equipment.javelin'] })).body.code).toBe('MASTERY_CHANGE_NEEDS_REST');
  });
});
