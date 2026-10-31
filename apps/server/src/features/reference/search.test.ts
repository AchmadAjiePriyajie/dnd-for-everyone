import { afterEach, describe, expect, it } from 'vitest';
import type { Principal } from '#shared/access';
import type { Locale } from '#shared/contracts';
import { TestClient } from '../../../../../tests/helpers/http.js';
import { makeDataDir, removeDataDir, startTestServer, type TestServer } from '../../../../../tests/helpers/server.js';
import { ReferenceService } from './search.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

const PASSWORD = 'correct horse battery';

async function boot(): Promise<TestServer> {
  const dir = await makeDataDir();
  cleanup.unshift(() => removeDataDir(dir));
  const server = await startTestServer({ dataDir: dir });
  cleanup.push(() => server.close());
  return server;
}

/** DM dengan campaign A, player A yang bergabung, dan campaign B milik akun lain. */
async function seed(server: TestServer) {
  const dm = new TestClient(server.app);
  await dm.post('/api/auth/bootstrap', { username: 'dungeon_master', password: PASSWORD });
  const campaignA = (await dm.post<{ id: string }>('/api/campaigns', { title: 'Vault' })).body.id;
  const invite = (await dm.post<{ code: string }>(`/api/campaigns/${campaignA}/invites`)).body.code;
  const player = new TestClient(server.app);
  await player.post('/api/auth/register', { invite, username: 'rogue_player', password: PASSWORD });
  const campaignB = (await player.post<{ id: string }>('/api/campaigns', { title: 'Other' })).body.id;
  const me = async (client: TestClient): Promise<Principal> =>
    ({ accountId: (await client.get<{ accountId: string }>('/api/auth/me')).body.accountId });
  return { campaignA, campaignB, dm: await me(dm), player: await me(player) };
}

describe('beginner reference search', () => {
  it('finds_beginner_aliases_without_private_notes', async () => {
    const server = await boot();
    const { campaignA, campaignB, dm, player } = await seed(server);
    const reference = server.app.get(ReferenceService);
    const ids = (query: string, locale: Locale = 'id', principal = player, campaignId?: string) =>
      reference.searchReference(principal, query, locale, campaignId).map((hit) => hit.entryId);

    // Istilah pemula ID/EN dan singkatan menuju entri aturan yang sama, di posisi teratas.
    expect(ids('darah')).toContain('rule.hit-points');
    expect(ids('nyawa')[0]).toBe('rule.hit-points');
    expect(ids('HP')[0]).toBe('rule.hit-points');
    expect(ids('hit points', 'en')[0]).toBe('rule.hit-points');
    expect(ids('giliran saya bisa apa')[0]).toBe('guide.your-turn');

    // Hit dalam ID tetap menyertakan judul asli EN dan sumber.
    const [hp] = reference.searchReference(player, 'nyawa', 'id');
    expect(hp).toMatchObject({ entryId: 'rule.hit-points', originalTitle: 'Hit Points', translation: 'translated' });
    expect(hp!.source).toMatchObject({ kind: 'srd', page: expect.any(Number) });
    expect(hp!.whenToUse).toBeTruthy();

    // Typo/prefix terbatas tetap menemukan entri; teks acak tidak menghasilkan apa pun.
    expect(ids('fireba', 'en')).toContain('spell.fireball');
    expect(ids('firebal', 'en')[0]).toBe('spell.fireball');
    expect(ids('')).toEqual([]);
    expect(ids('zzqxjv')).toEqual([]);
    expect(() => ids('nyawa '.repeat(500))).not.toThrow();

    // Entri campaign: catatan DM hanya untuk DM; homebrew tanpa ID berlabel fallback.
    reference.registerSource({
      name: 'test-notes',
      entries: (_db, campaignId) =>
        campaignId === campaignA
          ? [
              { id: 'note.secret-lich', audience: 'dm', title: { en: 'Lich phylactery location' }, summary: null, body: { en: 'Hidden under the chapel.' } },
              { id: 'homebrew.ember-blade', audience: 'members', title: { en: 'Ember Blade' }, summary: null, body: { en: 'A homebrew sword.' } },
            ]
          : [],
    });
    expect(ids('phylactery', 'en', dm, campaignA)).toContain('note.secret-lich');
    expect(ids('phylactery', 'en', player, campaignA)).not.toContain('note.secret-lich');
    expect(JSON.stringify(reference.searchReference(player, 'chapel', 'id', campaignA))).not.toContain('chapel');
    const [ember] = reference.searchReference(player, 'ember blade', 'id', campaignA);
    expect(ember).toMatchObject({ entryId: 'homebrew.ember-blade', translation: 'fallback', source: { kind: 'campaign' } });

    // Campaign yang bukan miliknya ditolak tanpa hasil.
    expect(() => reference.searchReference(dm, 'nyawa', 'id', campaignB)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('serves_reader_and_bookmarks_over_http', async () => {
    const server = await boot();
    const { campaignA, campaignB } = await seed(server);
    const player = new TestClient(server.app);
    await player.post('/api/auth/login', { username: 'rogue_player', password: PASSWORD });
    const dm = new TestClient(server.app);
    await dm.post('/api/auth/login', { username: 'dungeon_master', password: PASSWORD });
    server.app.get(ReferenceService).registerSource({
      name: 'test-notes',
      entries: (_db, campaignId) =>
        campaignId === campaignA
          ? [{ id: 'note.secret-lich', audience: 'dm', title: { en: 'Lich phylactery' }, summary: null, body: { en: 'Under the chapel.' } }]
          : [],
    });

    expect((await new TestClient(server.app).get('/api/reference/search?q=nyawa&locale=id')).status).toBe(401);
    const search = await player.get<Array<{ entryId: string }>>('/api/reference/search?q=nyawa&locale=id');
    expect(search.status).toBe(200);
    expect(search.body[0]!.entryId).toBe('rule.hit-points');
    expect((await player.get('/api/reference/search?locale=xx&q=hp')).status).toBe(400);
    const crossCampaign = await dm.get(`/api/reference/search?q=hp&locale=id&campaignId=${campaignB}`);
    expect(crossCampaign.status).toBe(403);
    expect(crossCampaign.body).toEqual({ code: 'FORBIDDEN', params: {} });

    // Reader: teks lokal + judul asli EN + sumber; panduan aplikasi berlabel guide.
    const reader = await player.get<{ title: string; originalTitle: string; body: string; source: { kind: string } }>(
      '/api/reference/entries/rule.hit-points?locale=id',
    );
    expect(reader.status).toBe(200);
    expect(reader.body).toMatchObject({ originalTitle: 'Hit Points', source: { kind: 'srd' } });
    expect(reader.body.body.length).toBeGreaterThan(100);
    expect((await player.get('/api/reference/entries/guide.your-turn?locale=id')).body).toMatchObject({ source: { kind: 'guide' } });
    expect((await player.get('/api/reference/entries/rule.no-such-thing?locale=id')).status).toBe(404);

    // Catatan DM: DM membaca, player mendapat jawaban yang sama dengan entri tak dikenal.
    const secretPath = `/api/reference/entries/note.secret-lich?locale=en&campaignId=${campaignA}`;
    expect((await dm.get<{ body: string }>(secretPath)).body.body).toContain('chapel');
    const leaked = await player.get(secretPath);
    expect(leaked.status).toBe(404);
    expect(JSON.stringify(leaked.body)).not.toContain('chapel');

    // Bookmark per akun, tersimpan di database, hanya untuk entri yang dikenal.
    expect((await player.put('/api/reference/bookmarks/rule.hit-points')).status).toBe(204);
    expect((await player.put('/api/reference/bookmarks/guide.your-turn')).status).toBe(204);
    expect((await player.put('/api/reference/bookmarks/rule.hit-points')).status).toBe(204);
    expect((await player.put('/api/reference/bookmarks/rule.no-such-thing')).status).toBe(404);
    expect((await player.get('/api/reference/bookmarks')).body).toEqual(['guide.your-turn', 'rule.hit-points']);
    expect((await dm.get('/api/reference/bookmarks')).body).toEqual([]);
    expect((await player.delete('/api/reference/bookmarks/guide.your-turn')).status).toBe(204);
    expect((await player.get('/api/reference/bookmarks')).body).toEqual(['rule.hit-points']);
  });
});
