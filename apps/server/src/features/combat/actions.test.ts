import { afterEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ActionOption, ActionOutcome, ActionPreview, Combat, RandomInt } from '#shared/combat';
import type { JsonValue } from '#shared/contracts';
import type { RoomSnapshot } from '#shared/room';
import type { CharacterView } from '../characters/service.js';
import { emptyDraft } from '#shared/characters';
import { TestClient } from '../../../../../tests/helpers/http.js';
import { makeDataDir, removeDataDir } from '../../../../../tests/helpers/server.js';
import { AppModule } from '../../app.module.js';
import { configureApp } from '../../app.js';
import { DatabaseService } from '../../db/database.service.js';
import { RANDOM_INT } from './rolls.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });
let request = 0;
const password = 'correct horse battery';

async function seed() {
  const dataDir = await makeDataDir(); cleanup.push(() => removeDataDir(dataDir));
  let calls = 0;
  let values: number[] = [];
  const random: RandomInt = (min, max) => { calls++; const value = values.shift() ?? min; if (value < min || value >= max) throw new Error('Fixture out of range'); return value; };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot({ dataDir })] }).overrideProvider(RANDOM_INT).useValue(random).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
  await configureApp(app, { dataDir }); await app.init(); await app.getHttpAdapter().getInstance().ready();
  cleanup.push(() => app.close());
  const dm = new TestClient(app); await dm.post('/api/auth/bootstrap', { username: 'dungeon_master', password });
  const campaignId = (await dm.post('/api/campaigns', { title: 'Action table' })).body.id as string;
  const code = (await dm.post(`/api/campaigns/${campaignId}/invites`)).body.code;
  const player = new TestClient(app); await player.post('/api/auth/register', { username: 'alice_cleric', password, invite: code });
  const send = (client: TestClient, targetId: string, kind: string, payload: JsonValue = {}, expectedRevision?: number, requestId = `act-${++request}`) =>
    client.post(`/api/campaigns/${campaignId}/commands`, { campaignId, targetId, kind, payload, requestId, ...(expectedRevision === undefined ? {} : { expectedRevision }) });
  await send(player, 'char-cleric', 'character.create');
  await send(player, 'char-cleric', 'character.save-draft', { draft: {
    ...emptyDraft(), name: 'Ilse', concept: 'Healer', motivation: 'Help', partyBond: 'Friend', speciesId: 'species.dwarf',
    backgroundId: 'background.soldier', backgroundIncrease: { mode: '2-1', plus2: 'con', plus1: 'str' },
    classId: 'class.cleric', abilityMethod: 'standard-array', baseScores: { str: 13, dex: 10, con: 14, int: 8, wis: 15, cha: 12 },
    classSkills: ['history', 'medicine'], languages: ['Dwarvish', 'Giant'], toolChoices: [{ group: 'gaming-set', variant: 'dice' }],
    classEquipment: 'A', backgroundEquipment: 'B', equippedArmorId: null,
  } });
  const finalized = await send(player, 'char-cleric', 'character.finalize');
  expect(finalized.status, JSON.stringify(finalized.body)).toBe(200);
  const db = app.get(DatabaseService).getHandle();
  const row = db.prepare('SELECT resources FROM characters WHERE id = ?').get('char-cleric') as { resources: string };
  const resources = { ...JSON.parse(row.resources), spells: [{ classId: 'class.cleric', cantrips: ['spell.sacred-flame', 'spell.guidance', 'spell.thaumaturgy'], prepared: ['spell.cure-wounds', 'spell.bless'] }] };
  db.prepare('UPDATE characters SET resources = ? WHERE id = ?').run(JSON.stringify(resources), 'char-cleric');
  await send(dm, 'enc-1', 'encounter.save', { template: {
    name: 'Lair', target: 'high', party: { mode: 'characters', characterIds: ['char-cleric'] },
    monsters: [{ monsterId: 'monster.goblin-warrior', count: 1, hp: 'average' }, { monsterId: 'monster.adult-red-dragon', count: 1, hp: 'average' }], difficultTerrain: false, notes: '',
  } });
  const view = async (client = dm) => (await client.get<Combat>(`/api/campaigns/${campaignId}/combats/combat-1`)).body;
  const command = async (kind: string, payload: JsonValue = {}, client = dm, requestId?: string) => send(client, 'combat-1', kind, payload, (await view()).revision, requestId);
  expect((await send(dm, 'combat-1', 'combat.start', { templateId: 'enc-1' })).status).toBe(200);
  const ids = Object.fromEntries((await view()).combatants.map((c) => [c.characterId ? 'cleric' : c.monsterId === 'monster.goblin-warrior' ? 'goblin' : 'dragon', c.id])) as Record<'cleric' | 'goblin' | 'dragon', string>;
  for (const [key, initiative] of [['cleric', 20], ['goblin', 15], ['dragon', 10]] as const) {
    expect((await command('combat.update', { combatantId: ids[key], patch: { initiative }, reason: 'Rolled at the table' })).status).toBe(200);
  }
  expect((await command('combat.begin')).status).toBe(200);
  const options = (client: TestClient, combatantId: string) => client.get<ActionOption[]>(`/api/campaigns/${campaignId}/combats/combat-1/combatants/${combatantId}/actions`);
  const preview = (client: TestClient, input: JsonValue) => client.get<ActionPreview>(`/api/campaigns/${campaignId}/combats/combat-1/actions/preview?input=${encodeURIComponent(JSON.stringify(input))}`);
  const optionId = async (client: TestClient, combatantId: string, name: string) => (await options(client, combatantId)).body.find((o) => o.originalName === name)!.id;
  const sheet = async () => (await player.get<CharacterView>(`/api/campaigns/${campaignId}/characters/char-cleric`)).body;
  return { app, dataDir, db, dm, player, campaignId, ids, send, view, command, options, preview, optionId, sheet, rolls: (...next: number[]) => { values = next; }, calls: () => calls };
}

describe('guided gameplay actions', () => {
  it('spends_costs_once_and_revalidates_targets_on_the_server', async () => {
    const s = await seed();
    // Players read only their own options; monster AC/saves never reach their preview.
    expect((await s.options(s.player, s.ids.goblin)).status).toBe(403);
    const cure = await s.optionId(s.player, s.ids.cleric, 'Cure Wounds');
    const bless = await s.optionId(s.player, s.ids.cleric, 'Bless');
    const blessPreview = (await s.preview(s.player, { combatantId: s.ids.cleric, optionId: bless, targetIds: [s.ids.goblin], slotLevel: 1 })).body;
    expect(blessPreview).toMatchObject({ issues: [], automation: 'manual', rolls: [] });
    const sacred = await s.optionId(s.player, s.ids.cleric, 'Sacred Flame');
    const flame = (await s.preview(s.player, { combatantId: s.ids.cleric, optionId: sacred, targetIds: [s.ids.goblin] })).body;
    expect(flame.rolls).toEqual([{ kind: 'save', targetId: s.ids.goblin, ability: 'dex', dc: 12, modifier: null }]);

    // Hidden creatures are not valid targets, even with a guessed ID.
    expect((await s.command('combat.update', { combatantId: s.ids.dragon, patch: { hidden: true }, reason: 'Lurking' })).status).toBe(200);
    const hidden = await s.command('combat.act', { combatantId: s.ids.cleric, optionId: sacred, targetIds: [s.ids.dragon] }, s.player);
    expect(hidden.body).toMatchObject({ code: 'ACTION_INVALID', params: { issues: 'TARGET_INVALID' } });

    // Cure Wounds: one slot, one Action, heal proposed (not applied); a retry replays the receipt.
    const hpBefore = (await s.view()).combatants.find((c) => c.id === s.ids.cleric)!.hp;
    s.rolls(4, 5);
    const revision = (await s.view()).revision;
    const payload = { combatantId: s.ids.cleric, optionId: cure, targetIds: [s.ids.cleric], slotLevel: 1 };
    const cast = await s.send(s.player, 'combat-1', 'combat.act', payload, revision, 'cast-1');
    expect(cast.status, JSON.stringify(cast.body)).toBe(200);
    const outcome = cast.body.value.outcome as ActionOutcome;
    expect(outcome.heal!.total).toBe(11);
    expect(outcome.proposed).toEqual([{ targetId: s.ids.cleric, input: { kind: 'heal', amount: 11 }, decision: false }]);
    expect(s.calls()).toBe(2);
    expect((await s.send(s.player, 'combat-1', 'combat.act', payload, revision, 'cast-1')).body).toEqual(cast.body);
    expect(s.calls()).toBe(2);
    expect((await s.sheet()).character.resources.slotsSpent[0]).toBe(1);
    const after = (await s.view()).combatants.find((c) => c.id === s.ids.cleric)!;
    expect(after.hp).toEqual(hpBefore);
    expect(after.budget.action).toBe(0);
    expect(after.actions!.slotTurn).toBe((await s.view()).turn);
    const again = await s.command('combat.act', { combatantId: s.ids.cleric, optionId: sacred, targetIds: [s.ids.goblin] }, s.player);
    expect(again.body).toMatchObject({ code: 'ACTION_INVALID', params: { issues: 'BUDGET_EXHAUSTED' } });

    // Legendary Action on another creature's turn, DM-only audience for a hidden actor.
    const presence = await s.optionId(s.dm, s.ids.dragon, 'Commanding Presence');
    const legendary = { combatantId: s.ids.dragon, optionId: presence, targetIds: [s.ids.cleric] };
    expect((await s.command('combat.act', legendary)).body.code).toBe('ROLL_PRIVATE_REQUIRED');
    expect((await s.command('combat.act', { ...legendary, audience: 'dm' })).status).toBe(200);
    expect((await s.view()).combatants.find((c) => c.id === s.ids.dragon)!.actions).toMatchObject({ legendary: 1, legendaryUsed: ['commanding-presence'] });
    expect(JSON.stringify((await s.player.get<RoomSnapshot>(`/api/campaigns/${s.campaignId}/snapshot`)).body.rolls)).not.toContain('Commanding Presence');

    // Goblin turn: average damage proposal against the cleric, HP unchanged until the DM applies it.
    await s.command('combat.next');
    const scimitar = await s.optionId(s.dm, s.ids.goblin, 'Scimitar');
    s.rolls(18);
    const swing = await s.command('combat.act', { combatantId: s.ids.goblin, optionId: scimitar, targetIds: [s.ids.cleric], damageMode: 'average' });
    expect(swing.status, JSON.stringify(swing.body)).toBe(200);
    expect((swing.body.value.outcome as ActionOutcome).proposed).toEqual([{ targetId: s.ids.cleric, input: { kind: 'damage', amount: 5, damageType: 'slashing' }, decision: false }]);
    expect((await s.view()).combatants.find((c) => c.id === s.ids.cleric)!.hp).toEqual(hpBefore);

    // Dragon turn: Fire Breath spends its Recharge; the next own turn rolls Recharge on the server.
    await s.command('combat.next');
    expect((await s.view()).combatants.find((c) => c.id === s.ids.dragon)!.actions!.legendary).toBe(0);
    const breath = await s.optionId(s.dm, s.ids.dragon, 'Fire Breath');
    expect((await s.command('combat.act', { combatantId: s.ids.dragon, optionId: breath, targetIds: [s.ids.cleric, s.ids.goblin], audience: 'dm' })).status).toBe(200);
    expect((await s.view()).combatants.find((c) => c.id === s.ids.dragon)!.actions!.recharge).toEqual(['fire-breath']);
    expect((await s.command('combat.act', { combatantId: s.ids.dragon, optionId: breath, targetIds: [s.ids.cleric], audience: 'dm' })).body.params.issues).toContain('RECHARGE_SPENT');
    await s.command('combat.next');
    await s.command('combat.next');
    const beforeRecharge = s.calls();
    s.rolls(5);
    await s.command('combat.next');
    expect(s.calls()).toBe(beforeRecharge + 1);
    expect((await s.view()).combatants.find((c) => c.id === s.ids.dragon)!.actions!.recharge).toEqual([]);
    const history = (await s.dm.get<RoomSnapshot>(`/api/campaigns/${s.campaignId}/snapshot`)).body.rolls!;
    expect(history.some((r) => r.kind === 'dice' && r.audience === 'dm' && 'expression' in r.result && r.result.expression === '1d6')).toBe(true);

    // Player copies (command response and history) never carry monster AC or save numbers.
    await s.command('combat.next');
    const flameCast = await s.command('combat.act', { combatantId: s.ids.cleric, optionId: sacred, targetIds: [s.ids.goblin] }, s.player);
    expect(flameCast.status, JSON.stringify(flameCast.body)).toBe(200);
    const seen = flameCast.body.value.outcome as ActionOutcome;
    expect(seen.preview.rolls).toEqual([{ kind: 'save', targetId: s.ids.goblin, ability: 'dex', dc: 12, modifier: null }]);
    expect(seen.saves).toEqual([{ targetId: s.ids.goblin, roll: null, success: expect.any(Boolean) }]);
    const playerHistory = (await s.player.get<RoomSnapshot>(`/api/campaigns/${s.campaignId}/snapshot`)).body.rolls!;
    const stored = playerHistory.find((r) => r.kind === 'action' && (r.result as ActionOutcome).preview.optionId === sacred)!.result as ActionOutcome;
    expect(stored.saves[0]!.roll).toBeNull();
    const dmCopy = (await s.dm.get<RoomSnapshot>(`/api/campaigns/${s.campaignId}/snapshot`)).body.rolls!.find((r) => r.kind === 'action' && (r.result as ActionOutcome).preview.optionId === sacred)!.result as ActionOutcome;
    expect(dmCopy.preview.rolls[0]).toMatchObject({ modifier: 2 });
  });
});
