import { type APIRequestContext, type Browser, type BrowserContext, expect } from '@playwright/test';

/** API seeding shared by browser specs: one DM, one player with a Wizard, a goblin encounter and a running combat. */
const password = 'correct horse battery';
let sequence = 0;

export async function call(request: APIRequestContext, origin: string, method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown) {
  const response = await request.fetch(path, { method, headers: { origin }, ...(data === undefined ? {} : { data }) });
  const text = await response.text();
  return { status: response.status(), body: text ? JSON.parse(text) : null };
}

export interface Table {
  dm: BrowserContext; player: BrowserContext; campaignId: string; characterId: string; run: string;
  dmApi(method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown): ReturnType<typeof call>;
  playerApi(method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown): ReturnType<typeof call>;
  command(as: 'dm' | 'player', targetId: string, kind: string, payload?: unknown, expectedRevision?: number): ReturnType<typeof call>;
  view(): Promise<{ revision: number; combatants: Array<{ id: string; characterId: string | null; budget: { action: number; reaction: number }; hp: { current: number } }> }>;
}

export async function seedTable(browser: Browser, origin: string, options: { characterName?: string; scene?: boolean } = {}): Promise<Table> {
  const dm = await browser.newContext({ baseURL: origin });
  const player = await browser.newContext({ baseURL: origin });
  const dmApi = (method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown) => call(dm.request, origin, method, path, data);
  const playerApi = (method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown) => call(player.request, origin, method, path, data);
  // One server per run: the first spec bootstraps the DM, later ones log in.
  if ((await dmApi('POST', '/api/auth/bootstrap', { username: 'dungeon_master', password })).status >= 300) {
    expect((await dmApi('POST', '/api/auth/login', { username: 'dungeon_master', password })).status).toBeLessThan(300);
  }
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const campaignId = (await dmApi('POST', '/api/campaigns', { title: 'Browser table' })).body.id as string;
  const invite = (await dmApi('POST', `/api/campaigns/${campaignId}/invites`)).body.code as string;
  expect((await playerApi('POST', '/api/auth/register', { username: `vell_${run}`, password, invite })).status).toBeLessThan(300);
  const command = (as: 'dm' | 'player', targetId: string, kind: string, payload: unknown = {}, expectedRevision?: number) =>
    (as === 'dm' ? dmApi : playerApi)('POST', `/api/campaigns/${campaignId}/commands`, { campaignId, targetId, kind, payload, requestId: `e2e-${++sequence}-${run}`, ...(expectedRevision === undefined ? {} : { expectedRevision }) });
  const characterId = `char-${run}`;
  await command('player', characterId, 'character.create');
  await command('player', characterId, 'character.save-draft', { draft: {
    name: options.characterName ?? 'Vell', concept: 'Scholar', motivation: 'Learn', partyBond: 'Friend', speciesId: 'species.dwarf', size: null,
    backgroundId: 'background.sage', backgroundIncrease: { mode: '2-1', plus2: 'int', plus1: 'con' }, classId: 'class.wizard', abilityMethod: 'standard-array',
    baseScores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }, classSkills: ['insight', 'investigation'], languages: ['Dwarvish', 'Giant'], toolChoices: [],
    classEquipment: 'A', backgroundEquipment: 'B', equippedArmorId: null, speciesSkills: [], featSkills: [], extraOriginFeatId: null, shieldEquipped: false,
  } });
  const finalized = await command('player', characterId, 'character.finalize');
  expect(finalized.status, JSON.stringify(finalized.body)).toBe(200);
  const spells = await command('player', characterId, 'character.set-spells', {
    spells: [{ classId: 'class.wizard', cantrips: ['spell.fire-bolt', 'spell.light', 'spell.mage-hand'], prepared: ['spell.shield', 'spell.magic-missile'] }],
    spellbook: ['spell.shield', 'spell.magic-missile', 'spell.sleep', 'spell.detect-magic', 'spell.mage-armor', 'spell.thunderwave'],
  });
  expect(spells.status, JSON.stringify(spells.body)).toBe(200);
  let sceneId: string | undefined;
  if (options.scene) {
    sceneId = `scene-${run}`;
    await command('dm', sceneId, 'scene.save', { name: 'Old mill', assetId: null, grid: { columns: 12, rows: 8, cellPixels: 40, offsetX: 0, offsetY: 0, feetPerCell: 5 } });
    await command('dm', sceneId, 'scene.share', { shared: true }, 1);
    await command('dm', `tok-v-${run}`, 'token.place', { sceneId, label: 'Vell', kind: 'character', characterId, x: 1, y: 1, size: 1, hidden: false });
    await command('dm', `tok-g-${run}`, 'token.place', { sceneId, label: 'Goblin', kind: 'monster', monsterId: 'monster.goblin-warrior', x: 2, y: 1, size: 1, hidden: false });
  }
  await command('dm', 'enc-1', 'encounter.save', { template: { name: 'Ambush', target: 'low', party: { mode: 'characters', characterIds: [characterId] },
    monsters: [{ monsterId: 'monster.goblin-warrior', count: 1, hp: 'average' }], difficultTerrain: false, notes: '' } });
  expect((await command('dm', 'combat-1', 'combat.start', { templateId: 'enc-1', ...(sceneId ? { sceneId } : {}) })).status).toBe(200);
  const view = async () => (await dmApi('GET', `/api/campaigns/${campaignId}/combats/combat-1`)).body;
  for (const creature of (await view()).combatants) {
    expect((await command('dm', 'combat-1', 'combat.update', { combatantId: creature.id, patch: { initiative: creature.characterId ? 10 : 20 }, reason: 'Table roll' }, (await view()).revision)).status).toBe(200);
  }
  expect((await command('dm', 'combat-1', 'combat.begin', {}, (await view()).revision)).status).toBe(200);
  return { dm, player, campaignId, characterId, run, dmApi, playerApi, command, view };
}
