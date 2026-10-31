import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../db/database.service.js';
import { TestClient } from '../../../../../tests/helpers/http.js';
import { makeDataDir, removeDataDir, startTestServer, type TestServer } from '../../../../../tests/helpers/server.js';
import { AuthService } from '../auth/service.js';
import { CampaignsService } from './service.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

async function boot(dataDir?: string): Promise<TestServer> {
  const dir = dataDir ?? (await makeDataDir());
  if (!dataDir) cleanup.unshift(() => removeDataDir(dir));
  const server = await startTestServer({ dataDir: dir });
  cleanup.push(() => server.close());
  return server;
}

const PASSWORD = 'correct horse battery';
const FORBIDDEN = { code: 'FORBIDDEN', params: {} };
const INVITE_INVALID = { code: 'INVITE_INVALID', params: {} };

/** DM pemilik server, campaign A, dan satu player A yang bergabung lewat undangan. */
async function seed(server: TestServer) {
  const dm = new TestClient(server.app);
  expect((await dm.post('/api/auth/bootstrap', { username: 'dungeon_master', password: PASSWORD })).status).toBe(201);
  const created = await dm.post<{ id: string }>('/api/campaigns', { title: 'Secret Vault of Varn' });
  expect(created.status).toBe(201);
  const campaignA = created.body.id;
  const invite = await dm.post<{ id: string; code: string }>(`/api/campaigns/${campaignA}/invites`);
  expect(invite.status).toBe(201);

  const player = new TestClient(server.app);
  const registered = await player.post('/api/auth/register', {
    invite: invite.body.code,
    username: 'rogue_player',
    password: PASSWORD,
  });
  expect(registered.status).toBe(201);
  return { dm, player, campaignA, invite: invite.body };
}

describe('campaign identities and access', () => {
  it('rejects_cross_campaign_and_role_escalation', async () => {
    const server = await boot();
    const { dm, player, campaignA, invite } = await seed(server);

    // Undangan hanya memberi role player.
    const mine = await player.get<{ id: string; role: string }>(`/api/campaigns/${campaignA}`);
    expect(mine.status).toBe(200);
    expect(mine.body.role).toBe('player');

    // Field role/owner dari client tidak pernah diterima.
    const escalate = await new TestClient(server.app).post('/api/auth/register', {
      invite: invite.code,
      username: 'sneaky',
      password: PASSWORD,
      role: 'dm',
    });
    expect(escalate.status).toBe(400);
    expect(escalate.body.code).toBe('VALIDATION_FAILED');
    const fakeOwner = await player.post('/api/campaigns', { title: 'Mine', ownerAccountId: 'someone-else' });
    expect(fakeOwner.status).toBe(400);

    // Player membuat campaign B sendiri dan menjadi DM di sana; DM A bukan anggota B.
    const campaignB = (await player.post<{ id: string }>('/api/campaigns', { title: 'Player Homebrew' })).body.id;
    expect((await player.get(`/api/campaigns/${campaignB}`)).body.role).toBe('dm');
    const crossRead = await dm.get(`/api/campaigns/${campaignB}`);
    expect(crossRead.status).toBe(403);
    expect(crossRead.body).toEqual(FORBIDDEN);
    // Campaign yang tidak ada tidak dapat dibedakan dari campaign yang tidak boleh diakses.
    const missing = await dm.get('/api/campaigns/does-not-exist');
    expect(missing.status).toBe(403);
    expect(missing.body).toEqual(FORBIDDEN);
    expect(JSON.stringify(crossRead.body)).not.toContain('Player Homebrew');

    // Player tidak boleh melakukan aksi DM pada campaign A.
    expect((await player.post(`/api/campaigns/${campaignA}/invites`)).body).toEqual(FORBIDDEN);
    const dmId = (await dm.get<{ accountId: string }>('/api/auth/me')).body.accountId;
    const kickDm = await player.delete(`/api/campaigns/${campaignA}/members/${dmId}`);
    expect(kickDm.status).toBe(403);
    expect(kickDm.body).toEqual(FORBIDDEN);
    expect((await player.delete(`/api/campaigns/${campaignA}/invites/${invite.id}`)).body).toEqual(FORBIDDEN);

    // Undangan dicabut / tidak dikenal: kode yang sama, tanpa detail.
    expect((await dm.delete(`/api/campaigns/${campaignA}/invites/${invite.id}`)).status).toBe(200);
    for (const code of [invite.code, 'not-a-real-invite-code']) {
      const res = await new TestClient(server.app).post('/api/auth/register', {
        invite: code,
        username: `late_${code.length}`,
        password: PASSWORD,
      });
      expect(res.status).toBe(400);
      expect(res.body).toEqual(INVITE_INVALID);
    }

    // Anggota yang dikeluarkan kehilangan akses; DM tidak bisa dikeluarkan.
    const playerId = (await player.get<{ accountId: string }>('/api/auth/me')).body.accountId;
    expect((await dm.delete(`/api/campaigns/${campaignA}/members/${dmId}`)).status).toBe(400);
    expect((await dm.delete(`/api/campaigns/${campaignA}/members/${playerId}`)).status).toBe(200);
    expect((await player.get(`/api/campaigns/${campaignA}`)).body).toEqual(FORBIDDEN);
    const list = await player.get<{ id: string }[]>('/api/campaigns');
    expect(list.body.map((c) => c.id)).toEqual([campaignB]);
  });

  it('keeps_membership_and_dm_after_restart_and_relogin', async () => {
    const dataDir = await makeDataDir();
    cleanup.unshift(() => removeDataDir(dataDir));
    const first = await startTestServer({ dataDir });
    const { campaignA, player } = await seed(first);
    const before = (await player.get<{ dmAccountId: string }>(`/api/campaigns/${campaignA}`)).body;
    await first.close();

    const server = await boot(dataDir);
    // Sesi lama tetap valid setelah restart (disimpan di server).
    const stale = new TestClient(server.app);
    stale.cookie = player.cookie;
    expect((await stale.get(`/api/campaigns/${campaignA}`)).status).toBe(200);

    const relogin = new TestClient(server.app);
    expect((await relogin.post('/api/auth/login', { username: 'ROGUE_player', password: PASSWORD })).status).toBe(200);
    const after = await relogin.get<{ role: string; dmAccountId: string }>(`/api/campaigns/${campaignA}`);
    expect(after.body.role).toBe('player');
    expect(after.body.dmAccountId).toBe(before.dmAccountId);
  });

  it('bootstraps_owner_only_once', async () => {
    const server = await boot();
    const anon = new TestClient(server.app);
    expect((await anon.get('/api/auth/state')).body).toEqual({ bootstrapRequired: true, authenticated: false });
    await seed(server);
    expect((await anon.get('/api/auth/state')).body).toEqual({ bootstrapRequired: false, authenticated: false });
    const again = await anon.post('/api/auth/bootstrap', { username: 'usurper', password: PASSWORD });
    expect(again.status).toBe(403);
    expect(again.body).toEqual({ code: 'BOOTSTRAP_CLOSED', params: {} });
  });

  it('uses_revocable_server_sessions_with_safe_cookies', async () => {
    const server = await boot();
    const dm = new TestClient(server.app);
    const res = await dm.post('/api/auth/bootstrap', { username: 'dungeon_master', password: PASSWORD });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Secure/i); // HTTP lokal; Secure hanya saat HTTPS.
    expect(cookie).not.toContain(PASSWORD);

    // Token mentah tidak disimpan di database.
    const token = dm.cookie!.split('=')[1]!;
    const db = server.app.get(DatabaseService).getHandle();
    const dump = JSON.stringify(db.prepare('SELECT * FROM auth_sessions').all());
    expect(dump).not.toContain(token);
    expect(JSON.stringify(db.prepare('SELECT * FROM accounts').all())).not.toContain(PASSWORD);

    const copy = new TestClient(server.app);
    copy.cookie = dm.cookie;
    expect((await dm.post('/api/auth/logout')).status).toBe(200);
    const after = await copy.get('/api/auth/me');
    expect(after.status).toBe(401);
    expect(after.body).toEqual({ code: 'UNAUTHENTICATED', params: {} });
  });

  it('rejects_bad_credentials_uniformly_and_rate_limits_login', async () => {
    const server = await boot();
    await seed(server);
    const anon = new TestClient(server.app);
    const wrongPassword = await anon.post('/api/auth/login', { username: 'rogue_player', password: 'wrong password!' });
    const unknownUser = await anon.post('/api/auth/login', { username: 'nobody_here', password: 'wrong password!' });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body).toEqual({ code: 'INVALID_CREDENTIALS', params: {} });
    expect(unknownUser.body).toEqual(wrongPassword.body);

    let last = wrongPassword;
    for (let i = 0; i < 12; i++) {
      last = await anon.post('/api/auth/login', { username: 'rogue_player', password: 'wrong password!' });
    }
    expect(last.status).toBe(429);
    expect(last.body.code).toBe('RATE_LIMITED');
    expect(typeof last.body.params.retryAfterSeconds).toBe('number');
  });

  it('rejects_cross_origin_and_missing_origin_mutations', async () => {
    const server = await boot();
    const evil = new TestClient(server.app, 'http://evil.example');
    const res = await evil.post('/api/auth/bootstrap', { username: 'dungeon_master', password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ code: 'ORIGIN_REJECTED', params: {} });
    const noOrigin = new TestClient(server.app, null);
    expect((await noOrigin.post('/api/auth/bootstrap', { username: 'dungeon_master', password: PASSWORD })).status).toBe(
      403,
    );
    // GET tanpa Origin tetap boleh (navigasi biasa).
    expect((await noOrigin.get('/api/auth/state')).status).toBe(200);
  });

  it('exposes_service_interfaces_for_other_modules', async () => {
    const server = await boot();
    const { dm, campaignA, invite } = await seed(server);
    const auth = server.app.get(AuthService);
    const campaigns = server.app.get(CampaignsService);
    const dmPrincipal = { accountId: (await dm.get<{ accountId: string }>('/api/auth/me')).body.accountId };

    const newcomer = await auth.registerInvitedAccount(invite.code, 'bard_newcomer', PASSWORD);
    expect(campaigns.requireMember(newcomer, campaignA)).toEqual({
      campaignId: campaignA,
      accountId: newcomer.accountId,
      role: 'player',
    });
    expect(campaigns.requireMember(dmPrincipal, campaignA).role).toBe('dm');
    const solo = campaigns.createCampaign(newcomer, 'Solo Run');
    expect(campaigns.requireMember(newcomer, solo).role).toBe('dm');
    expect(() => campaigns.requireMember(dmPrincipal, solo)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    await expect(auth.registerInvitedAccount(invite.code, 'bard_newcomer', PASSWORD)).rejects.toMatchObject({
      code: 'USERNAME_TAKEN',
    });
  });

  it('lets_existing_account_join_and_member_listing_stays_in_campaign', async () => {
    const server = await boot();
    const { dm, player, campaignA } = await seed(server);
    const campaignB = (await player.post<{ id: string }>('/api/campaigns', { title: 'Player Homebrew' })).body.id;
    const inviteB = (await player.post<{ code: string }>(`/api/campaigns/${campaignB}/invites`)).body;
    // DM A bergabung ke B sebagai player memakai akun yang sama.
    const joined = await dm.post<{ campaignId: string; role: string }>('/api/campaigns/join', { invite: inviteB.code });
    expect(joined.status).toBe(200);
    expect(joined.body).toMatchObject({ campaignId: campaignB, role: 'player' });
    const roles = (await dm.get<{ id: string; role: string }[]>('/api/campaigns')).body
      .map((c) => `${c.id === campaignA ? 'A' : 'B'}:${c.role}`)
      .sort();
    expect(roles).toEqual(['A:dm', 'B:player']);
    const members = await dm.get<{ accountId: string; username: string; role: string }[]>(
      `/api/campaigns/${campaignA}/members`,
    );
    expect(members.body.map((m) => `${m.username}:${m.role}`).sort()).toEqual([
      'dungeon_master:dm',
      'rogue_player:player',
    ]);
  });
});
