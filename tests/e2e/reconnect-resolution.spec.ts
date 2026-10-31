import { type APIRequestContext, type BrowserContext, expect, type Page, test } from '@playwright/test';

/**
 * Two browsers (DM + player) against the built server. Dice come from the real server random source,
 * so assertions check invariants (one resolution, one cost, HP changed exactly once) for hit and miss.
 */
const password = 'correct horse battery';
let sequence = 0;

async function call(request: APIRequestContext, baseURL: string, method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown) {
  const response = await request.fetch(path, { method, headers: { origin: baseURL }, ...(data === undefined ? {} : { data }) });
  const text = await response.text();
  return { status: response.status(), body: text ? JSON.parse(text) : null };
}

/** Drops the response of the first matching command after the server committed it (lost ACK). */
async function loseFirstAck(page: Page, kind: string): Promise<{ requests: Array<{ requestId: string; body: unknown }> }> {
  const seen = { requests: [] as Array<{ requestId: string; body: unknown }> };
  let dropped = false;
  await page.route('**/api/campaigns/*/commands', async (route) => {
    const body = route.request().postDataJSON() as { kind: string; requestId: string };
    if (body.kind === kind) seen.requests.push({ requestId: body.requestId, body });
    if (body.kind === kind && !dropped) {
      dropped = true;
      await route.fetch();
      await route.abort('connectionreset');
      return;
    }
    await route.continue();
  });
  return seen;
}

test('survives_lost_ack_reconnect_reload_and_locale_switch', async ({ browser, baseURL }) => {
  const origin = baseURL!;
  const dm: BrowserContext = await browser.newContext({ baseURL: origin });
  const player: BrowserContext = await browser.newContext({ baseURL: origin });
  const dmApi = (method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown) => call(dm.request, origin, method, path, data);
  const playerApi = (method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown) => call(player.request, origin, method, path, data);

  // One server per run: the first test bootstraps the DM, repeats log in.
  if ((await dmApi('POST', '/api/auth/bootstrap', { username: 'dungeon_master', password })).status >= 300) {
    expect((await dmApi('POST', '/api/auth/login', { username: 'dungeon_master', password })).status).toBeLessThan(300);
  }
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const campaignId = (await dmApi('POST', '/api/campaigns', { title: 'Lost ACK table' })).body.id as string;
  const invite = (await dmApi('POST', `/api/campaigns/${campaignId}/invites`)).body.code as string;
  expect((await playerApi('POST', '/api/auth/register', { username: `vell_${run}`, password, invite })).status).toBeLessThan(300);
  // Specs share one server: start from English whatever an earlier spec chose.
  for (const api of [dmApi, playerApi]) expect((await api('PUT', '/api/auth/me/locale', { locale: 'en' })).status).toBe(200);
  const command = (as: 'dm' | 'player', targetId: string, kind: string, payload: unknown = {}, expectedRevision?: number) =>
    (as === 'dm' ? dmApi : playerApi)('POST', `/api/campaigns/${campaignId}/commands`, { campaignId, targetId, kind, payload, requestId: `e2e-${++sequence}`, ...(expectedRevision === undefined ? {} : { expectedRevision }) });

  // Player: a level 1 Wizard with Shield prepared.
  await command('player', `char-${run}`, 'character.create');
  await command('player', `char-${run}`, 'character.save-draft', { draft: {
    name: 'Vell', concept: 'Scholar', motivation: 'Learn', partyBond: 'Friend', speciesId: 'species.dwarf', size: null,
    backgroundId: 'background.sage', backgroundIncrease: { mode: '2-1', plus2: 'int', plus1: 'con' }, classId: 'class.wizard', abilityMethod: 'standard-array',
    baseScores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }, classSkills: ['insight', 'investigation'], languages: ['Dwarvish', 'Giant'], toolChoices: [],
    classEquipment: 'A', backgroundEquipment: 'B', equippedArmorId: null, speciesSkills: [], featSkills: [], extraOriginFeatId: null, shieldEquipped: false,
  } });
  const finalized = await command('player', `char-${run}`, 'character.finalize');
  expect(finalized.status, JSON.stringify(finalized.body)).toBe(200);
  const spells = await command('player', `char-${run}`, 'character.set-spells', {
    spells: [{ classId: 'class.wizard', cantrips: ['spell.fire-bolt', 'spell.light', 'spell.mage-hand'], prepared: ['spell.shield', 'spell.magic-missile'] }],
    spellbook: ['spell.shield', 'spell.magic-missile', 'spell.sleep', 'spell.detect-magic', 'spell.mage-armor', 'spell.thunderwave'],
  });
  expect(spells.status, JSON.stringify(spells.body)).toBe(200);

  // DM: goblin vs wizard, goblin first.
  await command('dm', 'enc-1', 'encounter.save', { template: { name: 'Ambush', target: 'low', party: { mode: 'characters', characterIds: [`char-${run}`] },
    monsters: [{ monsterId: 'monster.goblin-warrior', count: 1, hp: 'average' }], difficultTerrain: false, notes: '' } });
  expect((await command('dm', 'combat-1', 'combat.start', { templateId: 'enc-1' })).status).toBe(200);
  const view = async () => (await dmApi('GET', `/api/campaigns/${campaignId}/combats/combat-1`)).body as { revision: number; combatants: Array<{ id: string; characterId: string | null; budget: { action: number; reaction: number }; hp: { current: number } }> };
  for (const creature of (await view()).combatants) {
    expect((await command('dm', 'combat-1', 'combat.update', { combatantId: creature.id, patch: { initiative: creature.characterId ? 10 : 20 }, reason: 'Table roll' }, (await view()).revision)).status).toBe(200);
  }
  expect((await command('dm', 'combat-1', 'combat.begin', {}, (await view()).revision)).status).toBe(200);
  const goblin = (await view()).combatants.find((c) => !c.characterId)!;
  const vell = (await view()).combatants.find((c) => c.characterId)!;
  const snapshot = async (as: 'dm' | 'player' = 'dm') => (await (as === 'dm' ? dmApi : playerApi)('GET', `/api/campaigns/${campaignId}/snapshot`)).body as { resolutions: Array<{ id: string; actorId: string; phase: string; costs: unknown; revision: number; committedEffects: Array<{ after: { current: number } }>; pendingReactions: Array<{ status: string }> }> };

  // DM attacks through the wizard; the first ACK is lost after the server committed.
  const dmPage = await dm.newPage();
  const attackRequests = await loseFirstAck(dmPage, 'combat.act');
  await dmPage.goto(`/campaigns/${campaignId}/combat`);
  const wizard = dmPage.getByRole('region', { name: 'Action bar' });
  await wizard.getByRole('button', { name: /Scimitar/ }).click();
  await wizard.getByRole('group', { name: 'Targets' }).getByRole('checkbox', { name: 'Vell' }).check();
  await wizard.getByRole('combobox', { name: 'Damage' }).selectOption('average');
  await wizard.getByRole('button', { name: 'Take this action' }).click();
  await wizard.getByRole('button', { name: 'Retry same action' }).click();
  await expect(wizard.getByText(/Vell: (hit|miss)/)).toBeVisible();
  expect(attackRequests.requests).toHaveLength(2);
  expect(attackRequests.requests[0]!.requestId).toBe(attackRequests.requests[1]!.requestId);
  expect((await snapshot()).resolutions.filter((r) => r.actorId === goblin.id)).toHaveLength(1);
  expect((await view()).combatants.find((c) => c.id === goblin.id)!.budget.action).toBe(0);
  const attack = (await snapshot()).resolutions.find((r) => r.actorId === goblin.id)!;

  // Player: reaction offered; offline blocks it, online restores it.
  const playerPage = await player.newPage();
  await playerPage.goto(`/campaigns/${campaignId}/combat`);
  const open = playerPage.getByRole('region', { name: 'Notifications' });
  await expect(open.getByText('Reaction available: Shield')).toBeVisible();
  await player.setOffline(true);
  await expect(open.getByRole('button', { name: 'Use Shield' })).toBeDisabled();
  await player.setOffline(false);
  await expect(open.getByRole('button', { name: 'Use Shield' })).toBeEnabled({ timeout: 30_000 });

  // Reaction committed but ACK lost: a reload shows it declared, with exactly one slot and Reaction spent.
  await loseFirstAck(playerPage, 'combat.act');
  await open.getByRole('button', { name: 'Use Shield' }).click();
  await playerPage.reload();
  await playerPage.getByRole('tab', { name: /Resolutions/ }).click();
  await expect(playerPage.getByText('Vell used Shield')).toBeVisible();
  const sheet = (await playerApi('GET', `/api/campaigns/${campaignId}/characters/char-${run}`)).body as { character: { resources: { slotsSpent: number[] } } };
  expect(sheet.character.resources.slotsSpent[0]).toBe(1);
  expect((await view()).combatants.find((c) => c.id === vell.id)!.budget.reaction).toBe(0);

  // Locale switch changes labels, never phase or cost.
  const before = (await snapshot('player')).resolutions.find((r) => r.id === attack.id)!;
  await playerPage.getByRole('combobox', { name: 'Language' }).selectOption('id');
  await expect(playerPage.getByText('Vell memakai Shield')).toBeVisible();
  const after = (await snapshot('player')).resolutions.find((r) => r.id === attack.id)!;
  expect({ phase: after.phase, costs: after.costs }).toEqual({ phase: before.phase, costs: before.costs });

  // DM commits once (hit) or nothing is left to decide (miss); a replayed commit never changes HP again.
  const hpBefore = (await view()).combatants.find((c) => c.id === vell.id)!.hp.current;
  const current = (await snapshot()).resolutions.find((r) => r.id === attack.id)!;
  if (current.phase === 'awaitingDecision') {
    const commits: Array<{ requestId: string; body: unknown }> = [];
    dmPage.on('request', (request) => {
      if (request.url().endsWith('/commands') && request.method() === 'POST') {
        const body = request.postDataJSON() as { kind: string; requestId: string };
        if (body.kind === 'resolution.decide') commits.push({ requestId: body.requestId, body });
      }
    });
    await dmPage.reload();
    await dmPage.getByRole('tab', { name: /Resolutions/ }).click();
    await dmPage.getByRole('region', { name: 'Open resolutions' }).getByRole('button', { name: 'Commit' }).click();
    await expect(dmPage.getByRole('region', { name: 'Recent resolutions' })).toBeVisible();
    const committed = (await snapshot()).resolutions.find((r) => r.id === attack.id)!;
    expect(committed.phase).toBe('resolved');
    const hpAfterFirstCommit = (await view()).combatants.find((c) => c.id === vell.id)!.hp.current;
    expect(hpAfterFirstCommit).toBe(committed.committedEffects.at(-1)?.after.current ?? hpBefore);
    const replay = await dmApi('POST', `/api/campaigns/${campaignId}/commands`, commits[0]!.body);
    expect(replay.status).toBe(200);
    const hpAfterRetry = (await view()).combatants.find((c) => c.id === vell.id)!.hp.current;
    expect(hpAfterRetry).toBe(hpAfterFirstCommit);
  } else {
    expect(current.phase).toBe('resolved');
    expect((await view()).combatants.find((c) => c.id === vell.id)!.hp.current).toBe(hpBefore);
  }
  await dm.close();
  await player.close();
});
