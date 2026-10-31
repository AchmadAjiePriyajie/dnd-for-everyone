import { afterEach, describe, expect, it } from 'vitest';
import { TestClient } from '../../../../../tests/helpers/http.js';
import { makeDataDir, removeDataDir, startTestServer } from '../../../../../tests/helpers/server.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

describe('per-account locale preference', () => {
  it('stores_locale_preference_per_account', async () => {
    const dataDir = await makeDataDir();
    cleanup.unshift(() => removeDataDir(dataDir));
    const first = await startTestServer({ dataDir });
    const dm = new TestClient(first.app);
    await dm.post('/api/auth/bootstrap', { username: 'dungeon_master', password: 'correct horse battery' });
    expect((await dm.get('/api/auth/me')).body.locale).toBeNull();

    const saved = await dm.put('/api/auth/me/locale', { locale: 'id' });
    expect(saved.status).toBe(200);
    expect(saved.body.locale).toBe('id');
    const invalid = await dm.put('/api/auth/me/locale', { locale: 'fr' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe('VALIDATION_FAILED');
    expect((await new TestClient(first.app).put('/api/auth/me/locale', { locale: 'en' })).status).toBe(401);
    await first.close();

    const server = await startTestServer({ dataDir });
    cleanup.push(() => server.close());
    const relogin = new TestClient(server.app);
    await relogin.post('/api/auth/login', { username: 'dungeon_master', password: 'correct horse battery' });
    expect((await relogin.get('/api/auth/me')).body.locale).toBe('id');
  });
});
