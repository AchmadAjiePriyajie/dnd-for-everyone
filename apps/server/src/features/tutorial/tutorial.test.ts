import { afterEach, describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '#shared/room';
import type { TutorialGuide } from '#shared/tutorial';
import { TestClient } from '../../../../../tests/helpers/http.js';
import { makeDataDir, removeDataDir, startTestServer } from '../../../../../tests/helpers/server.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });
const password = 'correct horse battery';

describe('tutorial adventure', () => {
  it('builds_the_first_adventure_with_ordinary_records', async () => {
    const dataDir = await makeDataDir(); cleanup.push(() => removeDataDir(dataDir));
    const server = await startTestServer({ dataDir }); cleanup.push(() => server.close());
    const dm = new TestClient(server.app); await dm.post('/api/auth/bootstrap', { username: 'dungeon_master', password });
    const created = await dm.post('/api/campaigns/tutorial', { locale: 'en' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const campaignId = created.body.id as string;
    const snapshot = (await dm.get<RoomSnapshot>(`/api/campaigns/${campaignId}/snapshot`)).body;
    expect(snapshot.campaign.title).toBe('Trouble at Ashford Mill');
    expect((snapshot.notes ?? []).map((n) => n.title)).toEqual(expect.arrayContaining(['A lantern at dusk', 'Odra, the miller', 'Find Pell before nightfall', 'The old mill']));
    expect((await dm.get(`/api/campaigns/${campaignId}/encounters`)).body.map((e: { template: { name: string } }) => e.template.name)).toEqual(['Trouble at Ashford Mill']);
    expect((await dm.get(`/api/campaigns/${campaignId}/scenes/tutorial-yard`)).body.tokens).toHaveLength(2);
    const code = (await dm.post(`/api/campaigns/${campaignId}/invites`)).body.code;
    const player = new TestClient(server.app); await player.post('/api/auth/register', { username: 'alice_player', password, invite: code });
    const quest = (await player.get(`/api/campaigns/${campaignId}/notes/tutorial-quest`)).body;
    expect(quest.title).toBe('Find Pell before nightfall');
    expect(JSON.stringify(quest)).not.toContain('goblins were paid');
    const playerGuide = (await player.get<TutorialGuide>(`/api/campaigns/${campaignId}/tutorial?locale=id`)).body;
    expect(playerGuide.steps.map((s) => s.title)).toContain('Baca quest');
    expect((await dm.get<TutorialGuide>(`/api/campaigns/${campaignId}/tutorial`)).body.steps.some((s) => s.id === 'combat')).toBe(true);
    const plain = (await dm.post('/api/campaigns', { title: 'Plain' })).body.id;
    expect((await dm.get(`/api/campaigns/${plain}/tutorial`)).status).toBe(403);
  });
});
