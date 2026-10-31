import { afterEach, describe, expect, it } from 'vitest';
import type { CommandEnvelope } from '#shared/commands';
import type { JsonValue } from '#shared/contracts';
import type { RoomSnapshot } from '#shared/room';
import type { SceneView } from '#shared/scenes';
import { TestClient } from '../../../../../tests/helpers/http.js';
import { makeDataDir, removeDataDir, startTestServer } from '../../../../../tests/helpers/server.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

const PASSWORD = 'correct horse battery';
const MiB = 1024 * 1024;

/** PNG minimal: signature + IHDR (dimensi dibaca dari header, pixel tidak didekode). */
function png(width: number, height: number, totalBytes = 0): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'ascii');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  header[24] = 8;
  header[25] = 6;
  return totalBytes > header.length ? Buffer.concat([header, Buffer.alloc(totalBytes - header.length)]) : header;
}
/** JPEG minimal: SOI + SOF0 dengan tinggi/lebar. */
function jpeg(width: number, height: number): Buffer {
  const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  buffer.writeUInt16BE(height, 7);
  buffer.writeUInt16BE(width, 9);
  return buffer;
}
/** WebP VP8X: lebar−1 dan tinggi−1 dalam 24 bit little-endian. */
function webp(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(22, 4);
  buffer.write('WEBP', 8, 'ascii');
  buffer.write('VP8X', 12, 'ascii');
  buffer.writeUInt32LE(10, 16);
  buffer.writeUIntLE(width - 1, 24, 3);
  buffer.writeUIntLE(height - 1, 27, 3);
  return buffer;
}

async function seed() {
  const dataDir = await makeDataDir();
  cleanup.push(() => removeDataDir(dataDir));
  const server = await startTestServer({ dataDir });
  cleanup.push(() => server.close());
  const dm = new TestClient(server.app);
  await dm.post('/api/auth/bootstrap', { username: 'dungeon_master', password: PASSWORD });
  const create = async (title: string) => (await dm.post<{ id: string }>('/api/campaigns', { title })).body.id;
  const campaignId = await create('Lost Mine');
  const otherCampaignId = await create('Other table');
  const join = async (username: string) => {
    const code = (await dm.post<{ code: string }>(`/api/campaigns/${campaignId}/invites`)).body.code;
    const client = new TestClient(server.app);
    await client.post('/api/auth/register', { invite: code, username, password: PASSWORD });
    return { client, accountId: (await client.get<{ accountId: string }>('/api/auth/me')).body.accountId };
  };
  return { dm, campaignId, otherCampaignId, alice: await join('alice_fighter'), bob: await join('bob_wizard') };
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

describe('scenes and assets', () => {
  it('hides_tokens_and_rejects_hostile_uploads', async () => {
    const { dm, campaignId, otherCampaignId, alice, bob } = await seed();
    const assets = (campaign: string, query = 'visibility=party&name=Map') => `/api/campaigns/${campaign}/assets?${query}`;

    // ---------------------------------------------------------------- upload valid
    const map = await dm.raw('POST', assets(campaignId), png(640, 480), 'image/png');
    expect(map.status).toBe(201);
    const mapAsset = JSON.parse(map.body.toString()) as { id: string; width: number; height: number; mime: string };
    expect(mapAsset).toMatchObject({ width: 640, height: 480, mime: 'image/png' });
    expect((await dm.raw('POST', assets(campaignId), jpeg(300, 200), 'image/jpeg')).status).toBe(201);
    expect((await dm.raw('POST', assets(campaignId), webp(1024, 768), 'image/webp')).status).toBe(201);

    // ---------------------------------------------------------------- upload jahat
    const code = (result: { body: Buffer }) => (JSON.parse(result.body.toString()) as { code: string }).code;
    // Tipe palsu: deklarasi PNG tapi isinya JPEG / GIF / HTML.
    expect(code(await dm.raw('POST', assets(campaignId), jpeg(10, 10), 'image/png'))).toBe('ASSET_INVALID');
    expect(code(await dm.raw('POST', assets(campaignId), Buffer.from('GIF89a\x01\x00\x01\x00'), 'image/png'))).toBe('ASSET_INVALID');
    expect(code(await dm.raw('POST', assets(campaignId), Buffer.from('<svg onload="alert(1)"/>'), 'image/png'))).toBe('ASSET_INVALID');
    expect((await dm.raw('POST', assets(campaignId), Buffer.from('<html>'), 'text/html')).status).toBe(415);
    expect((await dm.raw('POST', assets(campaignId), Buffer.from('<svg/>'), 'image/svg+xml')).status).toBe(415);
    // Batas 20 MiB tepat di boundary.
    expect((await dm.raw('POST', assets(campaignId), png(100, 100, 20 * MiB), 'image/png')).status).toBe(201);
    expect((await dm.raw('POST', assets(campaignId), png(100, 100, 20 * MiB + 1), 'image/png')).status).toBe(413);
    // Batas 40 megapixel tepat di boundary.
    expect((await dm.raw('POST', assets(campaignId), png(8000, 5000), 'image/png')).status).toBe(201);
    expect(code(await dm.raw('POST', assets(campaignId), png(8001, 5000), 'image/png'))).toBe('ASSET_TOO_LARGE');
    expect(code(await dm.raw('POST', assets(campaignId), png(0, 10), 'image/png'))).toBe('ASSET_INVALID');
    // Player tidak mengunggah peta; visibilitas tidak dikenal ditolak.
    expect((await alice.client.raw('POST', assets(campaignId), png(10, 10), 'image/png')).status).toBe(403);
    expect((await dm.raw('POST', assets(campaignId, 'visibility=everyone&name=x'), png(10, 10), 'image/png')).status).toBe(400);

    // ---------------------------------------------------------------- unduh dengan pemeriksaan akses
    const secret = JSON.parse((await dm.raw('POST', assets(campaignId, 'visibility=dm&name=Secret'), png(32, 32), 'image/png')).body.toString()) as { id: string };
    const downloaded = await alice.client.raw('GET', `/api/campaigns/${campaignId}/assets/${mapAsset.id}`);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers['content-type']).toBe('image/png');
    expect(downloaded.headers['x-content-type-options']).toBe('nosniff');
    expect(downloaded.body.equals(png(640, 480))).toBe(true);
    expect((await alice.client.raw('GET', `/api/campaigns/${campaignId}/assets/${secret.id}`)).status).toBe(403);
    expect((await dm.raw('GET', `/api/campaigns/${campaignId}/assets/${secret.id}`)).status).toBe(200);
    // Path traversal dan asset campaign lain.
    // Path traversal tidak pernah menyajikan file: ditolak (403) atau URL-nya dinormalisasi ke rute lain (404).
    for (const evil of ['..%2F..%2Fdnd.sqlite', '..', '%2e%2e', 'nope', '..%5C..%5Cdnd.sqlite']) {
      const result = await alice.client.raw('GET', `/api/campaigns/${campaignId}/assets/${evil}`);
      expect([403, 404], evil).toContain(result.status);
      expect(String(result.headers['content-type']), evil).toContain('application/json');
    }
    expect((await dm.raw('GET', `/api/campaigns/${otherCampaignId}/assets/${mapAsset.id}`)).status).toBe(403);
    expect((await bob.client.raw('GET', `/api/campaigns/${otherCampaignId}/assets/${mapAsset.id}`)).status).toBe(403);

    // ---------------------------------------------------------------- scene dan token
    const grid = { columns: 20, rows: 15, cellPixels: 32, offsetX: 0, offsetY: 0, feetPerCell: 5 };
    expect((await send(dm, campaignId, 'scene-road', 'scene.save', { name: 'Triboar Trail', assetId: mapAsset.id, grid })).status).toBe(200);
    // Asset DM-only tidak boleh menjadi latar scene yang dibagikan.
    expect((await send(dm, campaignId, 'scene-x', 'scene.save', { name: 'Bad', assetId: secret.id, grid })).body.code).toBe('ASSET_NOT_SHAREABLE');
    await send(dm, campaignId, 'tok-brakka', 'token.place', { sceneId: 'scene-road', label: 'Brakka', kind: 'character', ownerAccountId: alice.accountId, x: 2, y: 3, size: 1, hidden: false });
    await send(dm, campaignId, 'tok-ogre', 'token.place', {
      sceneId: 'scene-road',
      label: 'Ogre',
      kind: 'monster',
      monsterId: 'monster.ogre',
      x: 10,
      y: 5,
      size: 2,
      hidden: false,
      hp: { current: 59, max: 59 },
    });
    await send(dm, campaignId, 'tok-ambush', 'token.place', {
      sceneId: 'scene-road',
      label: 'Hidden Goblin',
      kind: 'monster',
      monsterId: 'monster.goblin-warrior',
      x: 15,
      y: 14,
      size: 1,
      hidden: true,
      hp: { current: 9137, max: 9137 },
    });

    // Scene belum dibagikan: player tidak melihatnya sama sekali.
    const scenePath = `/api/campaigns/${campaignId}/scenes/scene-road`;
    expect((await alice.client.get(scenePath)).status).toBe(403);
    expect((await send(dm, campaignId, 'scene-road', 'scene.share', { shared: true }, 1)).status).toBe(200);

    const playerView = (await alice.client.get<SceneView>(scenePath)).body;
    expect(playerView.tokens.some((token) => token.id === 'tok-ambush')).toBe(false);
    expect(playerView.grid).toEqual(grid);
    const ogre = playerView.tokens.find((token) => token.id === 'tok-ogre')!;
    expect(ogre).toMatchObject({ x: 10, y: 5, size: 2, kind: 'monster' });
    // HP monster dan stat rahasia tidak ikut ke player.
    expect(ogre.hp).toBeUndefined();
    for (const field of ['"hp"', '"hidden"', '"monsterId"', 'monster.ogre']) expect(JSON.stringify(playerView)).not.toContain(field);
    const snapshot = JSON.stringify((await alice.client.get<RoomSnapshot>(`/api/campaigns/${campaignId}/snapshot`)).body);
    expect(snapshot).not.toContain('tok-ambush');
    expect(snapshot).not.toContain('9137');
    expect(snapshot).not.toContain('Hidden Goblin');
    const dmView = (await dm.get<SceneView>(scenePath)).body;
    expect(dmView.tokens.find((token) => token.id === 'tok-ambush')).toMatchObject({ hidden: true, hp: { current: 9137 } });

    // ---------------------------------------------------------------- gerak token: owner atau DM, koordinat grid
    expect((await send(alice.client, campaignId, 'tok-brakka', 'token.move', { x: 4, y: 3 })).status).toBe(200);
    expect((await alice.client.get<SceneView>(scenePath)).body.tokens.find((token) => token.id === 'tok-brakka')).toMatchObject({ x: 4, y: 3 });
    expect((await send(alice.client, campaignId, 'tok-brakka', 'token.move', { x: 20, y: 3 })).body.code).toBe('TOKEN_OUT_OF_BOUNDS');
    expect((await send(bob.client, campaignId, 'tok-brakka', 'token.move', { x: 5, y: 3 })).body.code).toBe('FORBIDDEN');
    // Token tersembunyi dan token yang tidak ada memberi error yang sama (tidak membocorkan keberadaan).
    const hidden = await send(bob.client, campaignId, 'tok-ambush', 'token.move', { x: 1, y: 1 });
    const missing = await send(bob.client, campaignId, 'tok-nope', 'token.move', { x: 1, y: 1 });
    expect(hidden.body).toEqual(missing.body);
    expect(JSON.stringify(hidden.body)).not.toContain('9137');
    expect((await send(alice.client, campaignId, 'tok-ogre', 'token.update', { hidden: true })).body.code).toBe('FORBIDDEN');
    // DM mengungkap token tersembunyi saat bermain.
    expect((await send(dm, campaignId, 'tok-ambush', 'token.update', { hidden: false })).status).toBe(200);
    expect((await alice.client.get<SceneView>(scenePath)).body.tokens.map((token) => token.id)).toContain('tok-ambush');
  });
});
