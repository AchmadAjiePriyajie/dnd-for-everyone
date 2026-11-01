import { expect, test } from '@playwright/test';
import { call } from './seed';

/**
 * First adventure for beginners: the DM creates the original tutorial campaign from the lobby,
 * two players join (one in Indonesian), and the table goes hook → check → tutorial combat →
 * progression → recap. Every guide link must lead to a working page.
 */
const password = 'correct horse battery';
let sequence = 0;

const fighter = (name: string, motivation: string, partyBond: string) => ({
  name, concept: 'Guard', motivation, partyBond, speciesId: 'species.dwarf', size: null,
  backgroundId: 'background.soldier', backgroundIncrease: { mode: '2-1', plus2: 'str', plus1: 'con' }, classId: 'class.fighter', abilityMethod: 'standard-array',
  baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, classSkills: ['perception', 'survival'], languages: ['Dwarvish', 'Giant'],
  toolChoices: [{ group: 'gaming-set', variant: 'dice' }], classEquipment: 'A', backgroundEquipment: 'B', equippedArmorId: 'equipment.chain-mail',
  speciesSkills: [], featSkills: [], extraOriginFeatId: null, shieldEquipped: false,
});

test('runs_the_first_adventure_in_en_and_id', async ({ browser, baseURL }) => {
  const origin = baseURL!;
  const dm = await browser.newContext({ baseURL: origin });
  const dmApi = (method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown) => call(dm.request, origin, method, path, data);
  if ((await dmApi('POST', '/api/auth/bootstrap', { username: 'dungeon_master', password })).status >= 300) {
    expect((await dmApi('POST', '/api/auth/login', { username: 'dungeon_master', password })).status).toBeLessThan(300);
  }
  expect((await dmApi('PUT', '/api/auth/me/locale', { locale: 'en' })).status).toBe(200);
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

  // DM: one button creates the original adventure with its hook, NPC, quest, scene and encounter.
  const dmPage = await dm.newPage();
  await dmPage.goto('/');
  await dmPage.getByRole('button', { name: 'Start the tutorial adventure' }).click();
  await expect(dmPage).toHaveURL(/\/campaigns\/[^/]+$/);
  const campaignId = new URL(dmPage.url()).pathname.split('/')[2]!;
  const guide = dmPage.getByRole('region', { name: 'Tutorial guide' });
  await expect(guide).toBeVisible();
  // No decorative core buttons: every guide link opens a working page.
  const links = await guide.getByRole('link').evaluateAll((anchors) => anchors.map((a) => (a as HTMLAnchorElement).getAttribute('href')!));
  expect(links.length).toBeGreaterThanOrEqual(5);
  for (const href of links) {
    await dmPage.goto(href);
    await expect(dmPage.getByRole('heading', { name: 'Page not found' })).toHaveCount(0);
    await expect(dmPage.locator('main')).not.toBeEmpty();
  }
  // Rules links carry the SRD attribution.
  const ruleLink = links.find((href) => href.includes('entry='))!;
  await dmPage.goto(ruleLink);
  await expect(dmPage.getByText(/SRD 5\.2\.1 · .* · CC-BY-4\.0/)).toBeVisible();

  // Two players join and make characters with a motivation and a bond to the party.
  const players = [];
  for (const [index, locale] of (['en', 'id'] as const).entries()) {
    const context = await browser.newContext({ baseURL: origin });
    const api = (method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown) => call(context.request, origin, method, path, data);
    const invite = (await dmApi('POST', `/api/campaigns/${campaignId}/invites`)).body.code as string;
    expect((await api('POST', '/api/auth/register', { username: `hero${index}_${run}`, password, invite })).status).toBeLessThan(300);
    expect((await api('PUT', '/api/auth/me/locale', { locale })).status).toBe(200);
    const characterId = `char-${index}-${run}`;
    const send = (kind: string, payload: unknown = {}) => api('POST', `/api/campaigns/${campaignId}/commands`, { campaignId, targetId: characterId, kind, payload, requestId: `fa-${++sequence}-${run}` });
    await send('character.create');
    await send('character.save-draft', { draft: fighter(index ? 'Ilse' : 'Brakka', 'Find the missing child', 'Owes the miller a favour') });
    const finalized = await send('character.finalize');
    expect(finalized.status, JSON.stringify(finalized.body)).toBe(200);
    players.push({ context, api, characterId, locale });
  }
  const [alice, bram] = players as [typeof players[number], typeof players[number]];

  // The quest is shared with the party; the DM-only twist is not.
  const alicePage = await alice.context.newPage();
  await alicePage.goto(`/campaigns/${campaignId}/notes`);
  await expect(alicePage.getByRole('button', { name: 'Find Pell before nightfall' })).toBeVisible();
  await expect(alicePage.getByText('The goblins were paid by')).toHaveCount(0);
  const bramPage = await bram.context.newPage();
  // DM writing is never machine-translated: the same notes, with the guide in the player's language.
  await bramPage.goto(`/campaigns/${campaignId}/notes`);
  await expect(bramPage.getByRole('button', { name: 'Find Pell before nightfall' })).toBeVisible();
  await bramPage.goto(`/campaigns/${campaignId}`);
  await expect(bramPage.getByRole('region', { name: 'Panduan tutorial' }).getByText('Baca quest')).toBeVisible();

  // A Wisdom (Perception) check before any combat: dice work on the combat page without a combat.
  await alicePage.goto(`/campaigns/${campaignId}/combat`);
  const tray = alicePage.getByRole('region', { name: 'Dice tray' });
  await tray.getByRole('spinbutton', { name: 'Modifier (manual)' }).fill('3');
  await tray.getByRole('button', { name: 'Roll d20' }).click();
  await expect(tray.getByText(/Total: \d+/).first()).toBeVisible();

  // Tutorial combat from the prepared encounter and scene.
  await dmPage.goto(`/campaigns/${campaignId}/combat`);
  await dmPage.getByRole('combobox', { name: 'Encounter template' }).selectOption({ label: 'Trouble at Ashford Mill' });
  await dmPage.getByRole('combobox', { name: 'Battle map' }).selectOption({ label: 'Ashford Mill yard' });
  await dmPage.getByRole('button', { name: 'Prepare combat' }).click();
  await expect(dmPage.getByRole('button', { name: 'Begin combat' })).toBeVisible();
  const combat = (await dmApi('GET', `/api/campaigns/${campaignId}/snapshot`)).body.combat as { id: string; revision: number; combatants: Array<{ id: string; characterId: string | null }> };
  for (const player of players) {
    const view = (await dmApi('GET', `/api/campaigns/${campaignId}/combats/${combat.id}`)).body as { revision: number };
    expect((await dmApi('POST', `/api/campaigns/${campaignId}/commands`, { campaignId, targetId: combat.id, kind: 'combat.reinforce', payload: { characterId: player.characterId, initiative: 20, hidden: false }, requestId: `fa-${++sequence}-${run}`, expectedRevision: view.revision })).status).toBe(200);
  }
  await dmPage.getByRole('button', { name: 'Begin combat' }).click();
  await expect(dmPage.getByRole('region', { name: 'Turn order' })).toBeVisible();
  await alicePage.goto(`/campaigns/${campaignId}/combat`);
  const bar = alicePage.getByRole('region', { name: 'Action bar' });
  await bar.getByRole('button', { name: /Greataxe|Longsword|Greatsword|Flail|Javelin/ }).first().click();
  const goblin = bar.getByRole('group', { name: 'Targets' }).getByRole('checkbox', { name: /Goblin/ }).first();
  await goblin.check();
  await bar.getByRole('button', { name: 'Take this action' }).click();
  await expect(bar.getByText(/: (hit|miss) \(/)).toBeVisible();
  await dmPage.getByRole('button', { name: 'End combat' }).click();
  await expect(dmPage.getByRole('button', { name: 'Prepare combat' })).toBeVisible();

  // Progression: a milestone level from the DM.
  const grant = await dmApi('POST', `/api/campaigns/${campaignId}/commands`, { campaignId, targetId: alice.characterId, kind: 'character.grant-level', payload: { count: 1 }, requestId: `fa-${++sequence}-${run}` });
  expect(grant.status, JSON.stringify(grant.body)).toBe(200);
  expect((await alice.api('GET', `/api/campaigns/${campaignId}/characters/${alice.characterId}`)).body.advancement.levelsGranted).toBe(1);

  // Recap, saved by the DM and read by both players in their own language.
  await dmPage.goto(`/campaigns/${campaignId}/session`);
  await dmPage.getByRole('button', { name: 'Start session' }).click();
  await dmPage.getByRole('textbox', { name: 'Recap for the party' }).fill('The party found Pell at the mill.');
  await expect(dmPage.getByText('Saved')).toBeVisible({ timeout: 10_000 });
  await bramPage.goto(`/campaigns/${campaignId}/session`);
  await expect(bramPage.getByText('The party found Pell at the mill.')).toBeVisible();
  await expect(bramPage.getByRole('heading', { level: 2, name: /Sesi 1/ })).toBeVisible();
  // The DM can always skip the guide.
  await dmPage.goto(`/campaigns/${campaignId}`);
  await dmPage.getByRole('button', { name: 'Hide tutorial guide' }).click();
  await expect(dmPage.getByRole('region', { name: 'Tutorial guide' })).toHaveCount(0);
  for (const context of [dm, alice.context, bram.context]) await context.close();
});
