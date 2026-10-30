import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandEnvelope, CommandResult } from '#shared/commands';
import type { RoomSnapshot } from '#shared/room';
import { DomainError } from '../common/domain-error.js';
import { DatabaseService } from '../db/database.service.js';
import { TestClient } from '../../../../tests/helpers/http.js';
import { makeDataDir, removeDataDir, startTestServer, type TestServer } from '../../../../tests/helpers/server.js';
import { CommandsService } from './dispatcher.js';

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

const PASSWORD = 'correct horse battery';

async function boot(listen = false): Promise<TestServer & { url: string }> {
  const dataDir = await makeDataDir();
  cleanup.unshift(() => removeDataDir(dataDir));
  const server = await startTestServer({ dataDir });
  cleanup.push(() => server.close());
  let url = '';
  if (listen) {
    await server.app.listen({ port: 0, host: '127.0.0.1' });
    url = `http://127.0.0.1:${(server.app.getHttpServer().address() as AddressInfo).port}`;
  }
  const db = server.app.get(DatabaseService).getHandle();
  db.exec('CREATE TABLE IF NOT EXISTS test_counters (id TEXT PRIMARY KEY, value INTEGER NOT NULL) STRICT');
  const commands = server.app.get(CommandsService);
  // Command uji: menambah counter pada targetId.
  commands.registerCommand('test.counter.add', (ctx, payload) => {
    const by = (payload as { by: number }).by;
    ctx.db
      .prepare(
        'INSERT INTO test_counters (id, value) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET value = value + excluded.value',
      )
      .run(ctx.targetId, by);
    return { added: by, actor: ctx.principal.accountId };
  });
  // Command uji yang menulis lalu gagal: harus rollback seluruhnya.
  commands.registerCommand('test.counter.fail', (ctx) => {
    ctx.db.prepare('INSERT INTO test_counters (id, value) VALUES (?, 999)').run(`${ctx.targetId}-partial`);
    throw new DomainError('VALIDATION_FAILED', 400, { field: 'by' });
  });
  commands.registerCommand('test.dm.only', () => ({ ok: true }), { roles: ['dm'] });
  return { ...server, url };
}

async function seed(server: TestServer) {
  const dm = new TestClient(server.app);
  await dm.post('/api/auth/bootstrap', { username: 'dungeon_master', password: PASSWORD });
  const campaignId = (await dm.post<{ id: string }>('/api/campaigns', { title: 'Lost Mine' })).body.id;
  const invite = (await dm.post<{ code: string }>(`/api/campaigns/${campaignId}/invites`)).body;
  const player = new TestClient(server.app);
  await player.post('/api/auth/register', { invite: invite.code, username: 'rogue_player', password: PASSWORD });
  const outsider = new TestClient(server.app);
  // Outsider: akun valid pada campaign lain.
  const other = (await player.post<{ id: string }>('/api/campaigns', { title: 'Other' })).body.id;
  const otherInvite = (await player.post<{ code: string }>(`/api/campaigns/${other}/invites`)).body;
  await outsider.post('/api/auth/register', { invite: otherInvite.code, username: 'outsider', password: PASSWORD });
  const playerId = (await player.get<{ accountId: string }>('/api/auth/me')).body.accountId;
  return { dm, player, outsider, campaignId, playerId };
}

function command(campaignId: string, overrides: Partial<CommandEnvelope> = {}): CommandEnvelope {
  return {
    requestId: 'req-1',
    campaignId,
    targetId: 'counter-a',
    kind: 'test.counter.add',
    payload: { by: 2 },
    ...overrides,
  };
}

function counter(server: TestServer, id: string): number | undefined {
  const row = server.app
    .get(DatabaseService)
    .getHandle()
    .prepare('SELECT value FROM test_counters WHERE id = ?')
    .get(id) as { value: number } | undefined;
  return row?.value;
}

function eventCount(server: TestServer, campaignId: string, kind: string): number {
  return (
    server.app
      .get(DatabaseService)
      .getHandle()
      .prepare('SELECT COUNT(*) AS n FROM campaign_events WHERE campaign_id = ? AND kind = ?')
      .get(campaignId, kind) as { n: number }
  ).n;
}

const post = (client: TestClient, cmd: CommandEnvelope) =>
  client.post<CommandResult>(`/api/campaigns/${cmd.campaignId}/commands`, cmd);

describe('authoritative room commands', () => {
  it('retries_once_after_lost_ack', async () => {
    const server = await boot();
    const { dm, campaignId } = await seed(server);

    const first = await post(dm, command(campaignId, { expectedRevision: 0 }));
    expect(first.status).toBe(200);
    expect(first.body.entityRevision).toBe(1);
    // Ack hilang → client mengirim ulang command identik.
    const second = await post(dm, command(campaignId, { expectedRevision: 0 }));
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(counter(server, 'counter-a')).toBe(2);
    expect(eventCount(server, campaignId, 'test.counter.add')).toBe(1);

    // requestId sama, payload berbeda: ditolak, state tidak berubah.
    const reused = await post(dm, command(campaignId, { expectedRevision: 0, payload: { by: 50 } }));
    expect(reused.status).toBe(409);
    expect(reused.body).toEqual({ code: 'REQUEST_ID_REUSED', params: {} });

    // Revision usang ditolak dengan revision terkini.
    const stale = await post(dm, command(campaignId, { requestId: 'req-2', expectedRevision: 0 }));
    expect(stale.status).toBe(409);
    expect(stale.body).toEqual({ code: 'STALE_REVISION', params: { currentRevision: 1 } });
    expect(counter(server, 'counter-a')).toBe(2);
    const fresh = await post(dm, command(campaignId, { requestId: 'req-3', expectedRevision: 1 }));
    expect(fresh.body.entityRevision).toBe(2);
    expect(fresh.body.eventSequence).toBeGreaterThan(first.body.eventSequence);

    // Handler gagal setelah menulis: rollback state, event, receipt dan revision.
    const failing = command(campaignId, { requestId: 'req-4', kind: 'test.counter.fail', targetId: 'counter-a' });
    const failed = await post(dm, failing);
    expect(failed.status).toBe(400);
    expect(failed.body).toEqual({ code: 'VALIDATION_FAILED', params: { field: 'by' } });
    expect(counter(server, 'counter-a-partial')).toBeUndefined();
    expect(eventCount(server, campaignId, 'test.counter.fail')).toBe(0);
    const db = server.app.get(DatabaseService).getHandle();
    expect(db.prepare("SELECT COUNT(*) AS n FROM command_receipts WHERE request_id = 'req-4'").get()).toEqual({ n: 0 });
    const next = await post(dm, command(campaignId, { requestId: 'req-5', expectedRevision: 2 }));
    expect(next.status).toBe(200);
  });

  it('checks_access_before_returning_receipts', async () => {
    const server = await boot();
    const { dm, player, outsider, campaignId, playerId } = await seed(server);
    const cmd = command(campaignId, { requestId: 'player-req' });
    expect((await post(player, cmd)).status).toBe(200);

    // Actor lain dengan requestId sama tidak mendapat receipt milik player.
    const otherActor = await post(dm, cmd);
    expect(otherActor.status).toBe(200);
    expect(otherActor.body.value).toMatchObject({ actor: expect.not.stringContaining(playerId) });
    expect(counter(server, 'counter-a')).toBe(4);

    // Bukan anggota: FORBIDDEN tanpa isi receipt.
    const foreign = await post(outsider, cmd);
    expect(foreign.status).toBe(403);
    expect(foreign.body).toEqual({ code: 'FORBIDDEN', params: {} });

    // Player dikeluarkan lalu retry: receipt lama tidak dikembalikan.
    await dm.delete(`/api/campaigns/${campaignId}/members/${playerId}`);
    const retry = await post(player, cmd);
    expect(retry.status).toBe(403);
    expect(retry.body).toEqual({ code: 'FORBIDDEN', params: {} });

    // Role-restricted kind, kind tak dikenal, campaign di body ≠ path.
    const relog = new TestClient(server.app);
    await relog.post('/api/auth/login', { username: 'outsider', password: PASSWORD });
    expect((await post(dm, command(campaignId, { requestId: 'x1', kind: 'nope.unknown' }))).body).toEqual({
      code: 'UNKNOWN_COMMAND',
      params: {},
    });
    const mismatch = await dm.post(`/api/campaigns/${campaignId}/commands`, command('another-campaign'));
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.code).toBe('VALIDATION_FAILED');
  });

  it('restricts_command_roles_and_validates_envelope', async () => {
    const server = await boot();
    const { dm, player, campaignId } = await seed(server);
    await dm.post(`/api/campaigns/${campaignId}/invites`);
    const denied = await post(player, command(campaignId, { requestId: 'p1', kind: 'test.dm.only' }));
    expect(denied.status).toBe(403);
    expect((await post(dm, command(campaignId, { requestId: 'd1', kind: 'test.dm.only' }))).status).toBe(200);
    const bad = await dm.post(`/api/campaigns/${campaignId}/commands`, { requestId: '', kind: 'test.counter.add' });
    expect(bad.status).toBe(400);
    expect(() => server.app.get(CommandsService).registerCommand('test.counter.add', () => null)).toThrow(
      /already registered/,
    );
  });

  it('projects_room_per_participant', async () => {
    const server = await boot();
    const { dm, player, outsider, campaignId } = await seed(server);
    // seed() sudah membuat satu undangan untuk player.
    const result = (await post(dm, command(campaignId))).body;

    const dmView = await dm.get<RoomSnapshot>(`/api/campaigns/${campaignId}/snapshot`);
    const playerView = await player.get<RoomSnapshot>(`/api/campaigns/${campaignId}/snapshot`);
    expect(dmView.body.eventSequence).toBe(result.eventSequence);
    expect(playerView.body.eventSequence).toBe(result.eventSequence);
    expect(dmView.body.you.role).toBe('dm');
    expect(playerView.body.you.role).toBe('player');
    expect(dmView.body.members.map((m) => m.username).sort()).toEqual(['dungeon_master', 'rogue_player']);
    // Data khusus DM tidak ada pada projection player.
    expect(dmView.body.dm?.invites).toHaveLength(1);
    expect(playerView.body).not.toHaveProperty('dm');
    expect(JSON.stringify(playerView.body)).not.toContain('invites');
    expect((await outsider.get(`/api/campaigns/${campaignId}/snapshot`)).body).toEqual({ code: 'FORBIDDEN', params: {} });
  });
});

describe('realtime room notifications', () => {
  function connect(url: string, client: TestClient | undefined, origin = url): Socket {
    const socket = io(url, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { origin, ...(client?.cookie ? { cookie: client.cookie } : {}) },
    });
    cleanup.push(() => void socket.close());
    return socket;
  }

  const connected = (socket: Socket) =>
    new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });

  const subscribe = (socket: Socket, campaignId: string) =>
    socket.timeout(5000).emitWithAck('room:subscribe', { campaignId }) as Promise<
      { ok: true; eventSequence: number } | { ok: false; error: { code: string } }
    >;

  const nextChange = (socket: Socket, ms = 5000) =>
    new Promise<Record<string, unknown> | 'timeout'>((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), ms);
      socket.once('room:changed', (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });

  it('announces_only_after_commit_without_payload', async () => {
    const server = await boot(true);
    const { dm, player, campaignId } = await seed(server);
    const dmSocket = connect(server.url, dm);
    const playerSocket = connect(server.url, player);
    await Promise.all([connected(dmSocket), connected(playerSocket)]);
    expect(await subscribe(dmSocket, campaignId)).toMatchObject({ ok: true });
    expect(await subscribe(playerSocket, campaignId)).toMatchObject({ ok: true });

    // Saat notifikasi diterima, snapshot sudah memuat perubahan (dikirim setelah commit).
    const seen = nextChange(playerSocket).then(async (msg) => ({
      msg,
      snapshot: (await player.get<RoomSnapshot>(`/api/campaigns/${campaignId}/snapshot`)).body,
    }));
    const result = (await post(dm, command(campaignId, { payload: { by: 7 } }))).body;
    const { msg, snapshot } = await seen;
    expect(msg).toEqual({ campaignId, eventSequence: result.eventSequence });
    expect(snapshot.eventSequence).toBe(result.eventSequence);

    // Command gagal tidak diumumkan.
    const none = nextChange(playerSocket, 300);
    await post(dm, command(campaignId, { requestId: 'f', kind: 'test.counter.fail' }));
    expect(await none).toBe('timeout');
  });

  it('secures_handshake_subscription_and_revocation', async () => {
    const server = await boot(true);
    const { dm, player, outsider, campaignId, playerId } = await seed(server);

    // Origin lain ditolak pada handshake.
    await expect(connected(connect(server.url, dm, 'http://evil.example'))).rejects.toBeDefined();
    // Tanpa sesi: koneksi diputus server.
    const anon = connect(server.url, undefined);
    const anonResult = await new Promise((resolve) => {
      anon.once('disconnect', () => resolve('disconnected'));
      anon.once('connect_error', () => resolve('rejected'));
    });
    expect(['disconnected', 'rejected']).toContain(anonResult);

    // Bukan anggota tidak dapat subscribe.
    const outsiderSocket = connect(server.url, outsider);
    await connected(outsiderSocket);
    expect(await subscribe(outsiderSocket, campaignId)).toEqual({ ok: false, error: { code: 'FORBIDDEN', params: {} } });

    // Anggota dikeluarkan: subscription dicabut, tidak menerima notifikasi berikutnya.
    const playerSocket = connect(server.url, player);
    await connected(playerSocket);
    await subscribe(playerSocket, campaignId);
    const revoked = new Promise((resolve) => playerSocket.once('room:access-revoked', resolve));
    await dm.delete(`/api/campaigns/${campaignId}/members/${playerId}`);
    expect(await revoked).toEqual({ campaignId });
    const after = nextChange(playerSocket, 300);
    await post(dm, command(campaignId, { requestId: 'after-removal' }));
    expect(await after).toBe('timeout');

    // Logout memutus socket yang memakai sesi tersebut.
    const dmSocket = connect(server.url, dm);
    await connected(dmSocket);
    const dropped = new Promise((resolve) => dmSocket.once('disconnect', resolve));
    await dm.post('/api/auth/logout');
    await expect(dropped).resolves.toBeDefined();
  });
});
