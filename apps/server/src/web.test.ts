import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeDataDir, removeDataDir, startTestServer, type TestServer } from '../../../tests/helpers/server.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

async function boot(withWeb: boolean): Promise<TestServer> {
  const dataDir = await makeDataDir();
  cleanup.unshift(() => removeDataDir(dataDir));
  let webDir: string | undefined;
  if (withWeb) {
    webDir = await mkdtemp(join(tmpdir(), 'dnd-web-'));
    cleanup.unshift(() => removeDataDir(webDir!));
    await mkdir(join(webDir, 'assets'));
    await writeFile(join(webDir, 'index.html'), '<!doctype html><div id="root">SPA shell</div>');
    await writeFile(join(webDir, 'assets', 'app.js'), 'console.log("app")');
  }
  const server = await startTestServer({ dataDir, ...(webDir ? { webDir } : {}) });
  cleanup.push(() => server.close());
  return server;
}

const html = { accept: 'text/html,application/xhtml+xml' };

describe('frontend serving from the host', () => {
  it('serves_spa_without_swallowing_api', async () => {
    const { app } = await boot(true);
    const get = (url: string, headers: Record<string, string> = html) => app.inject({ method: 'GET', url, headers });

    const root = await get('/');
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain('SPA shell');
    const deep = await get('/campaigns/abc');
    expect(deep.statusCode).toBe(200);
    expect(deep.headers['content-type']).toMatch(/text\/html/);
    expect(deep.body).toContain('SPA shell');
    expect((await get('/assets/app.js', {})).body).toContain('console.log');

    // Asset yang tidak ada, API dan socket path tidak pernah jatuh ke index.html.
    for (const url of ['/assets/missing.js', '/api/unknown', '/api/campaigns/x/nope', '/socket.io/nope']) {
      const res = await get(url);
      expect(res.statusCode, url).toBe(404);
      expect(res.headers['content-type'], url).toMatch(/application\/json/);
      expect(res.json(), url).toEqual({ code: 'NOT_FOUND', params: {} });
    }
    // POST ke path frontend bukan navigasi.
    const post = await app.inject({ method: 'POST', url: '/campaigns/abc', headers: { ...html, origin: 'http://localhost', host: 'localhost' } });
    expect(post.statusCode).toBe(404);
    // Traversal keluar dari direktori frontend ditolak.
    const traversal = await get('/..%2f..%2fpackage.json', {});
    expect(traversal.statusCode).not.toBe(200);
    expect(traversal.body).not.toContain('dnd-platform');
  });

  it('has_no_fake_fallback_without_frontend_build', async () => {
    const { app } = await boot(false);
    const res = await app.inject({ method: 'GET', url: '/', headers: html });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: 'NOT_FOUND', params: {} });
  });
});
