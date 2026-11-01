import { afterEach, describe, expect, it } from 'vitest';
import type { Combat } from '#shared/combat';
import { emptyDraft } from '#shared/characters';
import type { JsonValue } from '#shared/contracts';
import type { EncounterTemplate } from '#shared/encounters';
import type { RoomSnapshot } from '#shared/room';
import type { SceneView } from '#shared/scenes';
import { TestClient } from '../../../../../tests/helpers/http.js';
import { makeDataDir, removeDataDir, startTestServer } from '../../../../../tests/helpers/server.js';
import { DatabaseService } from '../../db/database.service.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });
let request = 0;
const password = 'correct horse battery';

async function seed(monsterCount = 2) {
  const dataDir = await makeDataDir();
  cleanup.push(() => removeDataDir(dataDir));
  const server = await startTestServer({ dataDir });
  cleanup.push(() => server.close());
  const dm = new TestClient(server.app);
  await dm.post('/api/auth/bootstrap', { username: 'dungeon_master', password });
  const campaignId = (await dm.post('/api/campaigns', { title: 'Combat table' })).body.id as string;
  const invite = (await dm.post(`/api/campaigns/${campaignId}/invites`)).body.code;
  const alice = new TestClient(server.app);
  await alice.post('/api/auth/register', { username: 'alice_fighter', password, invite });
  const accountId = (await alice.get('/api/auth/me')).body.accountId as string;
  const send = (client: TestClient, targetId: string, kind: string, payload: JsonValue = {}, expectedRevision?: number, requestId = `combat-${++request}`) =>
    client.post(`/api/campaigns/${campaignId}/commands`, { requestId, campaignId, targetId, kind, payload, ...(expectedRevision === undefined ? {} : { expectedRevision }) });
  await send(alice, 'char-alice', 'character.create');
  await send(alice, 'char-alice', 'character.save-draft', { draft: {
    ...emptyDraft(), name: 'Brakka', concept: 'Guard', motivation: 'Help', partyBond: 'Friend', speciesId: 'species.dwarf',
    backgroundId: 'background.soldier', backgroundIncrease: { mode: '2-1', plus2: 'str', plus1: 'con' },
    classId: 'class.fighter', abilityMethod: 'standard-array', baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
    classSkills: ['perception', 'survival'], languages: ['Dwarvish', 'Giant'], toolChoices: [{ group: 'gaming-set', variant: 'dice' }],
    classEquipment: 'A', backgroundEquipment: 'B', equippedArmorId: 'equipment.chain-mail',
  } });
  expect((await send(alice, 'char-alice', 'character.finalize')).status).toBe(200);
  const template: EncounterTemplate = {
    name: 'Ambush', target: 'moderate', party: { mode: 'characters', characterIds: ['char-alice'] },
    monsters: monsterCount ? [{ monsterId: 'monster.goblin-warrior', count: monsterCount, hp: 'average' }] : [], difficultTerrain: false, notes: 'Secret ambush plan',
  };
  expect((await send(dm, 'enc-ambush', 'encounter.save', { template })).status).toBe(200);
  const view = async (client = dm) => (await client.get<Combat>(`/api/campaigns/${campaignId}/combats/combat-1`)).body;
  const command = async (kind: string, payload: JsonValue = {}, client = dm, requestId?: string) => {
    const before = await view();
    if (kind === 'combat.update') {
      const input = payload as { combatantId: string; patch?: { hpCurrent?: number } };
      const creature = before.combatants.find((c) => c.id === input.combatantId);
      if (input.patch?.hpCurrent !== undefined && creature?.characterId) payload = { ...input, sourceRevision: creature.characterRevision! };
    }
    return send(client, 'combat-1', kind, payload, before.revision, requestId);
  };
  const start = async (sceneId?: string) => {
    const result = await send(dm, 'combat-1', 'combat.start', { templateId: 'enc-ambush', ...(sceneId ? { sceneId } : {}) });
    expect(result.status).toBe(200);
    return view();
  };
  const begin = () => command('combat.begin');
  return { dataDir, server, dm, alice, accountId, campaignId, send, view, command, start, begin, template };
}

describe('combat turns', () => {
  it('starts_instance_and_preserves_template', async () => {
    const s = await seed();
    let combat = await s.start();
    expect(combat).toMatchObject({ templateId: 'enc-ambush', status: 'preparing', round: 0, activeId: null });
    expect(combat.combatants).toHaveLength(3);
    const hero = combat.combatants.find((c) => c.characterId === 'char-alice')!;
    const goblins = combat.combatants.filter((c) => c.monsterId);
    expect(new Set(goblins.map((c) => c.id)).size).toBe(2);
    const originalHp = goblins[0]!.hp!.current;
    await s.command('combat.update', { combatantId: goblins[0]!.id, patch: { hpCurrent: originalHp - 3 }, reason: 'Manual damage' });
    combat = await s.view();
    expect(combat.combatants.find((c) => c.id === goblins[0]!.id)!.hp!.current).toBe(originalHp - 3);
    expect(combat.combatants.find((c) => c.id === goblins[1]!.id)!.hp!.current).toBe(originalHp);
    expect((await s.dm.get(`/api/campaigns/${s.campaignId}/encounters`)).body[0].template).toEqual(s.template);

    // The DM resolves equal initiative explicitly; stable tie order survives reloads.
    await s.command('combat.update', { combatantId: hero.id, patch: { initiative: 20, tieOrder: 2 }, reason: 'Initiative' });
    await s.command('combat.update', { combatantId: goblins[0]!.id, patch: { initiative: 20, tieOrder: 1 }, reason: 'DM tie break' });
    await s.begin();
    expect((await s.view()).activeId).toBe(goblins[0]!.id);
    await s.command('combat.next');
    expect((await s.view()).activeId).toBe(hero.id);

    const db = s.server.app.get(DatabaseService).getHandle();
    const resources = JSON.parse((db.prepare('SELECT resources FROM characters WHERE id = ?').get('char-alice') as { resources: string }).resources);
    resources.slotsSpent[0] = 1;
    resources.hitDiceSpent['class.fighter'] = 1;
    db.prepare('UPDATE characters SET resources = ?, feature_state = ? WHERE id = ?').run(JSON.stringify(resources), JSON.stringify({ spent: { 'class-feature.fighter-second-wind': 1 }, weaponMasteries: [], heroicInspiration: true }), 'char-alice');
    const before = db.prepare('SELECT resources, feature_state FROM characters WHERE id = ?').get('char-alice');
    expect((await s.command('combat.spend', { combatantId: hero.id, resource: 'action' }, s.alice)).status).toBe(200);
    await s.command('combat.spend', { combatantId: hero.id, resource: 'bonus' }, s.alice);
    await s.command('combat.spend', { combatantId: hero.id, resource: 'reaction' }, s.alice);
    await s.command('combat.spend', { combatantId: hero.id, resource: 'movement', amount: 10 }, s.alice);
    expect((await s.command('combat.spend', { combatantId: hero.id, resource: 'action' }, s.alice)).body.code).toBe('COMBAT_BUDGET_EXHAUSTED');
    await s.command('combat.next');
    expect((await s.view()).combatants.find((c) => c.id === hero.id)!.budget).toEqual({ action: 0, bonus: 0, reaction: 0, movement: 20 });
    await s.command('combat.next');
    await s.command('combat.next');
    combat = await s.view();
    expect(combat).toMatchObject({ round: 2, activeId: hero.id });
    expect(combat.combatants.find((c) => c.id === hero.id)!.budget).toEqual({ action: 1, bonus: 1, reaction: 1, movement: 30 });
    expect(db.prepare('SELECT resources, feature_state FROM characters WHERE id = ?').get('char-alice')).toEqual(before);
  });

  it('filters_hidden_combatants_and_checks_ownership_before_receipts', async () => {
    const s = await seed();
    const combat = await s.start();
    const hero = combat.combatants.find((c) => c.characterId)!;
    const secret = combat.combatants.find((c) => c.monsterId)!;
    await s.command('combat.update', { combatantId: secret.id, patch: { hidden: true, initiative: 99 }, reason: 'Ambush' });
    await s.begin();
    const player = await s.view(s.alice);
    expect(player.activeId).toBeNull();
    expect(player.combatants.some((c) => c.id === secret.id)).toBe(false);
    const publicMonster = player.combatants.find((c) => c.id !== hero.id)!;
    expect(publicMonster.hp).toBeUndefined();
    expect(publicMonster.monsterId).toBeUndefined();
    expect(publicMonster.budget).toBeUndefined();
    expect(player.templateId).toBeUndefined();
    const snapshot = (await s.alice.get<RoomSnapshot>(`/api/campaigns/${s.campaignId}/snapshot`)).body;
    expect(JSON.stringify(snapshot)).not.toContain(secret.id);
    expect(JSON.stringify(snapshot)).not.toContain('Secret ambush plan');
    const hidden = await s.command('combat.spend', { combatantId: secret.id, resource: 'reaction' }, s.alice);
    const missing = await s.command('combat.spend', { combatantId: 'missing', resource: 'reaction' }, s.alice);
    expect(hidden.body).toEqual(missing.body);
    expect((await s.command('combat.next', {}, s.alice)).status).toBe(403);
    expect((await s.command('combat.update', { combatantId: hero.id, patch: { initiative: 30 }, reason: 'Cheat' }, s.alice)).status).toBe(403);
    expect((await s.command('combat.spend', { combatantId: hero.id, resource: 'action' }, s.alice)).body.code).toBe('COMBAT_NOT_YOUR_TURN');
    expect((await s.command('combat.spend', { combatantId: hero.id, resource: 'reaction' }, s.alice)).status).toBe(200);
    expect((await s.dm.get(`/api/campaigns/not-your-table/combats/combat-1`)).status).toBe(403);
  });

  it('handles_pause_reinforcement_defeat_removal_and_empty_order', async () => {
    const s = await seed(0);
    const first = await s.start();
    const hero = first.combatants[0]!;
    await s.command('combat.update', { combatantId: hero.id, patch: { initiative: 10 }, reason: 'Initiative' });
    await s.begin();
    await s.command('combat.pause');
    const paused = await s.view();
    expect((await s.command('combat.next')).body.code).toBe('COMBAT_NOT_ACTIVE');
    expect((await s.command('combat.spend', { combatantId: hero.id, resource: 'reaction' }, s.alice)).body.code).toBe('COMBAT_NOT_ACTIVE');
    await s.command('combat.resume');
    expect((await s.view()).activeId).toBe(paused.activeId);
    await s.command('combat.reinforce', { monsterId: 'monster.goblin-warrior', count: 1, hp: 'average', initiative: 5, hidden: false });
    const goblin = (await s.view()).combatants.find((c) => c.monsterId)!;
    expect((await s.view()).activeId).toBe(hero.id);
    await s.command('combat.update', { combatantId: hero.id, patch: { defeated: true }, reason: 'Removed from battle' });
    expect((await s.view()).activeId).toBe(goblin.id);
    await s.command('combat.remove', { combatantId: goblin.id });
    expect((await s.view()).activeId).toBeNull();
    await s.command('combat.next');
    expect((await s.view()).activeId).toBeNull();
    await s.command('combat.remove', { combatantId: hero.id });
    expect((await s.view()).combatants).toEqual([]);
    await s.command('combat.end');
    expect((await s.view()).status).toBe('ended');
    expect((await s.command('combat.resume')).body.code).toBe('COMBAT_ENDED');
  });

  it('requires_revisions_logs_corrections_and_persists_after_restart', async () => {
    const s = await seed(0);
    const combat = await s.start();
    const hero = combat.combatants[0]!;
    expect((await s.send(s.dm, 'combat-1', 'combat.begin')).body.code).toBe('REVISION_REQUIRED');
    expect((await s.send(s.dm, 'combat-1', 'combat.begin', {}, 0)).body.code).toBe('STALE_REVISION');
    expect((await s.command('combat.update', { combatantId: hero.id, patch: { hpCurrent: 999 }, reason: 'Invalid' })).body.code).toBe('HP_INVALID');
    expect((await s.command('combat.update', { combatantId: hero.id, patch: { hpCurrent: 4 }, reason: '' })).status).toBe(400);
    await s.command('combat.update', { combatantId: hero.id, patch: { hpCurrent: 4 }, reason: 'Correct sheet HP' });
    expect((await s.alice.get(`/api/campaigns/${s.campaignId}/characters/char-alice`)).body.derived.currentHitPoints).toBe(4);
    await s.begin();
    await s.command('combat.spend', { combatantId: hero.id, resource: 'action' }, s.alice);
    await s.command('combat.set-turn', { combatantId: hero.id, reason: 'Correct active turn' });
    expect((await s.view()).combatants[0]!.budget!.action).toBe(0); // Correction never grants free actions.
    const events = s.server.app.get(DatabaseService).getHandle().prepare("SELECT data FROM campaign_events WHERE campaign_id = ? AND kind = 'combat.update'").all(s.campaignId);
    expect(JSON.stringify(events)).toContain('Correct sheet HP');
    const before = await s.view();
    await s.server.close();
    cleanup.pop();
    const again = await startTestServer({ dataDir: s.dataDir });
    cleanup.push(() => again.close());
    const client = new TestClient(again.app);
    await client.post('/api/auth/login', { username: 'dungeon_master', password });
    expect((await client.get(`/api/campaigns/${s.campaignId}/combats/combat-1`)).body).toEqual(before);
  });

  it('accounts_for_committed_map_movement_once_and_rolls_back_over_budget', async () => {
    const s = await seed(0);
    await s.send(s.dm, 'scene-1', 'scene.save', { name: 'Arena', assetId: null, grid: { columns: 20, rows: 10, cellPixels: 40, offsetX: 0, offsetY: 0, feetPerCell: 5 } });
    await s.send(s.dm, 'scene-1', 'scene.share', { shared: true }, 1);
    await s.send(s.dm, 'tok-alice', 'token.place', { sceneId: 'scene-1', characterId: 'char-alice', ownerAccountId: s.accountId, label: 'Brakka', kind: 'character', x: 0, y: 0, size: 1, hidden: false });
    const hero = (await s.start('scene-1')).combatants[0]!;
    expect(hero.tokenId).toBe('tok-alice');
    await s.begin();
    const move = { x: 4, y: 0 };
    const first = await s.send(s.alice, 'tok-alice', 'token.move', move, undefined, 'same-move');
    expect(first.status).toBe(200);
    expect((await s.send(s.alice, 'tok-alice', 'token.move', move, undefined, 'same-move')).body).toEqual(first.body);
    expect((await s.view()).combatants[0]!.budget!.movement).toBe(10);
    expect((await s.send(s.alice, 'tok-alice', 'token.move', { x: 7, y: 0 })).body.code).toBe('MOVE_OVER_BUDGET');
    const scene = (await s.alice.get<SceneView>(`/api/campaigns/${s.campaignId}/scenes/scene-1`)).body;
    expect(scene.tokens[0]!.x).toBe(4);
    expect((await s.view()).combatants[0]!.budget!.movement).toBe(10);
    expect((await s.send(s.alice, 'combat-1', 'combat.next', {}, (await s.view()).revision - 1)).body.code).toBe('FORBIDDEN');
    await s.command('combat.next');
    expect((await s.view()).round).toBe(2);
    expect((await s.view()).combatants[0]!.budget!.movement).toBe(30);
  });

  it('keeps_alternate_diagonal_cost_across_moves_and_resets_it_on_the_next_turn', async () => {
    const s = await seed(0);
    await s.send(s.dm, 'scene-1', 'scene.save', { name: 'Arena', assetId: null, grid: { columns: 20, rows: 20, cellPixels: 40, offsetX: 0, offsetY: 0, feetPerCell: 5, diagonal: 'alternate', enforceSpeed: true } });
    await s.send(s.dm, 'scene-1', 'scene.share', { shared: true }, 1);
    await s.send(s.dm, 'tok-alice', 'token.place', { sceneId: 'scene-1', characterId: 'char-alice', ownerAccountId: s.accountId, label: 'Brakka', kind: 'character', x: 0, y: 0, size: 1, hidden: false });
    const hero = (await s.start('scene-1')).combatants[0]!;
    await s.begin();
    expect((await s.send(s.alice, 'tok-alice', 'token.move', { x: 1, y: 1 })).body.value.costFeet).toBe(5);
    expect((await s.send(s.alice, 'tok-alice', 'token.move', { x: 2, y: 2 })).body.value.costFeet).toBe(10);
    expect((await s.view()).combatants[0]!.budget!.movement).toBe(15);
    await s.command('combat.next');
    expect((await s.send(s.alice, 'tok-alice', 'token.move', { x: 3, y: 3 })).body.value.costFeet).toBe(5);
    // A DM-granted movement budget supersedes the optional exploration speed cap.
    await s.command('combat.update', { combatantId: hero.id, patch: { budget: { action: 0, bonus: 1, reaction: 1, movement: 60 } }, reason: 'Dash adjudication' });
    expect((await s.send(s.alice, 'tok-alice', 'token.move', { x: 11, y: 3 })).status).toBe(200);
    expect((await s.view()).combatants[0]!.budget!.movement).toBe(20);
  });

  it('shares_hp_with_map_tokens_without_breaking_draft_tokens', async () => {
    const s = await seed(1);
    await s.send(s.dm, 'scene-1', 'scene.save', { name: 'Arena', assetId: null, grid: { columns: 10, rows: 10, cellPixels: 40, offsetX: 0, offsetY: 0, feetPerCell: 5 } });
    await s.send(s.alice, 'char-draft', 'character.create');
    await s.send(s.dm, 'tok-draft', 'token.place', { sceneId: 'scene-1', characterId: 'char-draft', label: 'Draft', kind: 'character', x: 0, y: 0, size: 1, hidden: false });
    await s.send(s.dm, 'tok-goblin', 'token.place', { sceneId: 'scene-1', monsterId: 'monster.goblin-warrior', label: 'Goblin', kind: 'monster', x: 5, y: 5, size: 1, hidden: false, hp: { current: 999, max: 999 } });
    const path = `/api/campaigns/${s.campaignId}/scenes/scene-1`;
    expect((await s.dm.get(path)).status).toBe(200);
    const goblin = (await s.start('scene-1')).combatants.find((c) => c.monsterId)!;
    await s.command('combat.update', { combatantId: goblin.id, patch: { hpCurrent: 2 }, reason: 'Manual damage' });
    expect((await s.dm.get<SceneView>(path)).body.tokens.find((c) => c.id === 'tok-goblin')!.hp!.current).toBe(2);
    await s.command('combat.end');
    expect((await s.dm.get<SceneView>(path)).body.tokens.find((c) => c.id === 'tok-goblin')!.hp!.current).toBe(2);
  });

  it('binds_ui_created_tokens_and_respects_current_monster_token_ownership', async () => {
    const s = await seed(1);
    await s.send(s.dm, 'scene-1', 'scene.save', { name: 'Arena', assetId: null, grid: { columns: 20, rows: 10, cellPixels: 40, offsetX: 0, offsetY: 0, feetPerCell: 5 } });
    await s.send(s.dm, 'scene-1', 'scene.share', { shared: true }, 1);
    // Exact TokenPanel payload shape: no characterId or monsterId.
    await s.send(s.dm, 'tok-hero', 'token.place', { sceneId: 'scene-1', label: 'Brakka', kind: 'character', x: 0, y: 0, size: 1, hidden: false });
    await s.send(s.dm, 'tok-pet', 'token.place', { sceneId: 'scene-1', label: 'Pet goblin', kind: 'monster', ownerAccountId: s.accountId, x: 0, y: 2, size: 1, hidden: false });
    let combat = await s.start('scene-1');
    const hero = combat.combatants.find((c) => c.characterId)!;
    const goblin = combat.combatants.find((c) => c.monsterId)!;
    expect(hero.tokenId).toBeNull();
    expect((await s.command('combat.bind-token', { combatantId: hero.id, tokenId: 'tok-hero' })).status).toBe(200);
    expect((await s.command('combat.bind-token', { combatantId: goblin.id, tokenId: 'tok-hero' })).body.code).toBe('TOKEN_LINK_INVALID');
    expect((await s.command('combat.bind-token', { combatantId: goblin.id, tokenId: 'missing' })).body.code).toBe('TOKEN_LINK_INVALID');
    expect((await s.command('combat.bind-token', { combatantId: goblin.id, tokenId: 'tok-pet' }, s.alice)).status).toBe(403);
    expect((await s.command('combat.bind-token', { combatantId: goblin.id, tokenId: 'tok-pet' })).status).toBe(200);
    await s.begin();
    expect((await s.send(s.alice, 'tok-hero', 'token.move', { x: 3, y: 0 })).status).toBe(200);
    expect((await s.view()).combatants.find((c) => c.id === hero.id)!.budget!.movement).toBe(15);
    await s.command('combat.set-turn', { combatantId: goblin.id, reason: 'Pet turn' });
    expect((await s.send(s.alice, 'tok-pet', 'token.move', { x: 3, y: 2 })).status).toBe(200);
    combat = await s.view(s.alice);
    expect(combat.combatants.find((c) => c.id === goblin.id)!.budget!.movement).toBe(15);
    await s.send(s.dm, 'tok-pet', 'token.update', { ownerAccountId: null });
    expect((await s.command('combat.spend', { combatantId: goblin.id, resource: 'reaction' }, s.alice)).status).toBe(403);
    expect((await s.command('combat.bind-token', { combatantId: goblin.id, tokenId: null })).status).toBe(200);
    expect((await s.view()).combatants.find((c) => c.id === goblin.id)!.tokenId).toBeNull();
  });

  it('rejects_token_hp_edits_that_would_be_ignored_by_the_canonical_pool', async () => {
    const s = await seed(1);
    await s.send(s.dm, 'scene-1', 'scene.save', { name: 'Arena', assetId: null, grid: { columns: 10, rows: 10, cellPixels: 40, offsetX: 0, offsetY: 0, feetPerCell: 5 } });
    await s.send(s.dm, 'tok-hero', 'token.place', { sceneId: 'scene-1', characterId: 'char-alice', label: 'Brakka', kind: 'character', x: 0, y: 0, size: 1, hidden: false });
    await s.send(s.dm, 'tok-goblin', 'token.place', { sceneId: 'scene-1', monsterId: 'monster.goblin-warrior', label: 'Goblin', kind: 'monster', x: 5, y: 5, size: 1, hidden: false });
    const combat = await s.start('scene-1');
    for (const token of ['tok-hero', 'tok-goblin']) {
      expect((await s.send(s.dm, token, 'token.update', { hp: { current: 1, max: 99 } })).body.code).toBe('HP_LINKED');
      expect((await s.send(s.dm, token, 'token.update', { hp: null })).body.code).toBe('HP_LINKED');
    }
    expect((await s.view()).combatants.map((c) => c.hp)).toEqual(combat.combatants.map((c) => c.hp));
    await s.command('combat.end');
    expect((await s.send(s.dm, 'tok-goblin', 'token.update', { hp: { current: 1, max: 99 } })).body.code).toBe('HP_LINKED');
  });

  it('rejects_hp_corrections_based_on_an_older_character_sheet', async () => {
    const s = await seed(0);
    const combat = await s.start();
    const hero = combat.combatants[0]!;
    expect(typeof hero.characterRevision).toBe('number');
    expect((await s.send(s.alice, 'char-alice', 'character.set-hp', { current: 4, temp: 0 })).status).toBe(200);
    const before = await s.view();
    expect(before.combatants[0]!.hp!.current).toBe(4);
    const stale = await s.send(s.dm, combat.id, 'combat.update', { combatantId: hero.id, patch: { hpCurrent: 7 }, sourceRevision: hero.characterRevision!, reason: 'Old view' }, before.revision);
    expect(stale.body.code).toBe('STALE_REVISION');
    expect((await s.view()).combatants[0]!.hp!.current).toBe(4);
    expect((await s.send(s.dm, combat.id, 'combat.update', { combatantId: hero.id, patch: { hpCurrent: 7 }, reason: 'Missing source version' }, before.revision)).body.code).toBe('REVISION_REQUIRED');
    expect((await s.command('combat.update', { combatantId: hero.id, patch: { hpCurrent: 7 }, reason: 'Current view' })).status).toBe(200);
  });
});
