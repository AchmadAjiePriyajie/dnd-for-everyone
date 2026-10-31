import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActionInput, ActionOption, ActionOutcome, ActionPreview, CombatView } from '#shared/combat';
import type { RoomSnapshot } from '#shared/room';
import type { SceneView } from '#shared/scenes';
import { App } from '../../app/App';
import { setLocale } from '../../app/i18n';
import { configureRoomStore, resetRoomStore } from '../../app/room-store';
import { FakeSocket, installFakeApi } from '../../test/fake-api';

const combat = (over: Partial<CombatView> = {}): CombatView => ({ id: 'combat-1', campaignId: 'camp-1', name: 'Arena', status: 'active', round: 1, turn: 1, revision: 3, activeId: 'hero', sceneId: 'scene-1',
  combatants: [
    { id: 'hero', name: 'Ilse', characterId: 'char-1', characterRevision: 5, tokenId: 'tok-h', ownerAccountId: 'alice', initiative: 10, tieOrder: 0, defeated: false, hp: { current: 7, max: 10, temp: 0 }, budget: { action: 1, bonus: 0, reaction: 1, movement: 20 }, speedFeet: 30 },
    { id: 'gob', name: 'Goblin 1', characterId: null, tokenId: 'tok-g', ownerAccountId: null, initiative: 5, tieOrder: 1, defeated: false, standing: 'healthy' },
  ], ...over,
});
const scene: SceneView = { id: 'scene-1', name: 'Arena', assetId: null, grid: { columns: 8, rows: 6, cellPixels: 40, offsetX: 0, offsetY: 0, feetPerCell: 5 },
  tokens: [{ id: 'tok-h', sceneId: 'scene-1', label: 'Ilse', kind: 'character', x: 1, y: 1, size: 1, ownerAccountId: 'alice', characterId: 'char-1' }, { id: 'tok-g', sceneId: 'scene-1', label: 'Goblin 1', kind: 'monster', x: 2, y: 1, size: 1, ownerAccountId: null, characterId: null }],
  markers: [], fog: { enabled: false, revealed: [] }, revision: 1 };
const cure: ActionOption = { id: 'spell:class.cleric:spell.cure-wounds', kind: 'spell', name: 'Cure Wounds', originalName: 'Cure Wounds', sourceId: 'spell.cure-wounds', cost: 'action', damage: [],
  heal: { dice: '2d8', bonus: 2 }, rangeFeet: 5, spell: { level: 1, school: 'abjuration', concentration: false, duration: 'Instantaneous', upcastDice: '2d8', upcastTarget: 'heal', upcastManual: false },
  automation: 'assisted', notes: ['SPELL_EFFECT_REVIEW'], text: 'A creature you touch regains Hit Points.' };
const flame: ActionOption = { id: 'spell:class.cleric:spell.sacred-flame', kind: 'spell', name: 'Sacred Flame', originalName: 'Sacred Flame', sourceId: 'spell.sacred-flame', cost: 'action', damage: [{ dice: '1d8', average: null, type: 'radiant' }],
  save: { ability: 'dex', dc: 12, onSuccess: 'none' }, rangeFeet: 60, automation: 'assisted', notes: [], text: 'Flame.' };
const healingWord: ActionOption = { ...cure, id: 'spell:class.cleric:spell.healing-word', name: 'Healing Word', originalName: 'Healing Word', sourceId: 'spell.healing-word', cost: 'bonus' };
const preview = (input: ActionInput): ActionPreview => ({ sourceId: 'spell.cure-wounds', optionId: input.optionId, actorId: input.combatantId, targetIds: input.targetIds, name: 'Cure Wounds',
  cost: { turn: 'action', slot: input.slotLevel ? { level: input.slotLevel, pact: false } : null, feature: null, uses: null, legendary: 0 }, automation: 'assisted', rolls: [],
  effects: [{ kind: 'heal', dice: input.slotLevel === 2 ? '4d8' : '2d8', bonus: 2 }], duration: 'Instantaneous', prompts: ['SPELL_EFFECT_REVIEW'], issues: input.targetIds.length ? [] : ['TARGET_REQUIRED'], trigger: null, text: 'A creature you touch regains Hit Points.' });
const outcome = (targetIds: string[]): ActionOutcome => ({ preview: { ...preview({ combatantId: 'hero', optionId: cure.id, targetIds, slotLevel: 1 }) }, attacks: [], saves: [], damage: [],
  heal: { expression: '2d8+2', dice: [{ sides: 8, rolls: [4, 6], sign: 1 }], modifier: 2, total: 12, critical: false }, proposed: targetIds.map((targetId) => ({ targetId, input: { kind: 'heal' as const, amount: 12 }, decision: false })) });
const snapshot = (role: 'dm' | 'player', over: Partial<RoomSnapshot> = {}): RoomSnapshot => ({ campaignId: 'camp-1', eventSequence: 1, campaign: { id: 'camp-1', title: 'Table', ruleset: 'srd-5.2.1-2024' },
  you: { accountId: role === 'dm' ? 'dm' : 'alice', role }, members: [], combat: combat(), rolls: [], resolutions: [], ...(role === 'dm' ? { dm: { invites: [] } } : {}), ...over } as RoomSnapshot);
let fake: ReturnType<typeof installFakeApi>, socket: FakeSocket;
const commands = () => fake.requests.map((r) => r.body as { kind?: string; requestId: string; payload?: ActionInput; expectedRevision?: number } | undefined).filter((r) => r?.kind);
beforeEach(() => { localStorage.clear(); setLocale('en'); socket = new FakeSocket(); socket.connected = true; configureRoomStore({ createSocket: () => socket }); window.history.replaceState(null, '', '/campaigns/camp-1/combat'); });
afterEach(() => { fake?.restore(); resetRoomStore(); });

describe('action hotbar', () => {
  it('shows_resources_and_grouped_tiles_and_targets_from_the_map', async () => {
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot('player') }, scenes: { 'scene-1': scene }, actions: { hero: [cure, flame, healingWord] }, previewAction: preview,
      onCommand: (body) => body.kind === 'combat.act' ? new Response(JSON.stringify({ targetId: 'combat-1', entityRevision: 4, eventSequence: 2, value: { id: 'res-1', outcome: outcome((body.payload as ActionInput).targetIds) } }), { status: 200 }) : undefined });
    const user = userEvent.setup(); render(<App />);
    const bar = await screen.findByRole('region', { name: 'Action bar' });
    expect(within(bar).getByLabelText('Action: available')).toBeTruthy();
    expect(within(bar).getByLabelText('Bonus Action: spent')).toBeTruthy();
    expect(within(bar).getByText('20 / 30 ft')).toBeTruthy();
    const actionGroup = await within(bar).findByRole('group', { name: 'Action' });
    expect(within(actionGroup).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Cure Wounds'), expect.stringContaining('Sacred Flame')]));
    const bonus = within(bar).getByRole('group', { name: 'Bonus Action' });
    expect(within(bonus).getByRole('button', { name: /Healing Word/ }).getAttribute('aria-disabled')).toBe('true');
    await user.click(within(actionGroup).getByRole('button', { name: /Cure Wounds/ }));
    expect(await within(bar).findByText('Choose a target.')).toBeTruthy();
    expect((within(bar).getByRole('button', { name: 'Take this action' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: /^Ilse, column/ }));
    expect(await within(bar).findByText('Healing 2d8 + 2')).toBeTruthy();
    await user.selectOptions(within(bar).getByRole('combobox', { name: 'Spell slot level' }), '2');
    expect(await within(bar).findByText('Healing 4d8 + 2')).toBeTruthy();
    expect(within(bar).getByText('Assisted: some effects need the DM')).toBeTruthy();
    await user.click(within(bar).getByRole('button', { name: 'Take this action' }));
    await waitFor(() => expect(commands().filter((c) => c?.kind === 'combat.act')).toHaveLength(1));
    expect(commands().at(-1)).toMatchObject({ kind: 'combat.act', expectedRevision: 3, payload: { combatantId: 'hero', optionId: cure.id, targetIds: ['hero'], slotLevel: 2, audience: 'public' } });
    expect(await within(bar).findByText('12 Hit Points regained')).toBeTruthy();
    expect(within(bar).queryByRole('button', { name: /Apply to/ })).toBeNull();
    // Only the player's own combatant can act: no actor picker.
    expect(within(bar).queryByRole('combobox', { name: 'Act as' })).toBeNull();
  });

  it('drops_targets_that_become_hidden_and_blocks_offline_actions', async () => {
    let attempts = 0;
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot('dm', { combat: combat({ combatants: combat().combatants.map((c) => c.id === 'gob' ? { ...c, hidden: false, hp: { current: 7, max: 7, temp: 0 }, budget: { action: 1, bonus: 1, reaction: 1, movement: 30 } } : c) }) }) },
      scenes: { 'scene-1': scene }, actions: { hero: [cure], gob: [] }, previewAction: preview,
      onCommand: (body) => {
        if (body.kind !== 'combat.act') return undefined;
        attempts++; if (attempts === 1) throw new TypeError('lost ACK');
        return new Response(JSON.stringify({ targetId: 'combat-1', entityRevision: 4, eventSequence: 2, value: { id: 'res-1', outcome: outcome((body.payload as ActionInput).targetIds) } }), { status: 200 });
      } });
    const user = userEvent.setup(); render(<App />);
    const bar = await screen.findByRole('region', { name: 'Action bar' });
    expect(within(bar).getByRole('combobox', { name: 'Act as' })).toBeTruthy();
    await user.click(await within(bar).findByRole('button', { name: /Cure Wounds/ }));
    const targets = within(bar).getByRole('group', { name: 'Targets' });
    await user.click(within(targets).getByRole('checkbox', { name: 'Goblin 1' }));
    await user.click(within(targets).getByRole('checkbox', { name: 'Ilse' }));
    // The DM hides the goblin: the next snapshot drops it from the selection.
    fake.state.snapshots['camp-1'] = snapshot('dm', { eventSequence: 2, combat: combat({ revision: 4, combatants: combat().combatants.filter((c) => c.id !== 'gob') }) });
    act(() => socket.serverEmit('room:changed', { campaignId: 'camp-1', eventSequence: 2 }));
    await waitFor(() => expect(within(targets).queryByRole('checkbox', { name: 'Goblin 1' })).toBeNull());
    await user.click(within(bar).getByRole('button', { name: 'Take this action' }));
    const retry = await within(bar).findByRole('button', { name: 'Retry same action' });
    expect(commands()[0]!.payload!.targetIds).toEqual(['hero']);
    await user.click(retry);
    await waitFor(() => expect(attempts).toBe(2));
    expect(commands()[0]!.requestId).toBe(commands()[1]!.requestId);
    act(() => socket.serverEmit('disconnect', 'transport close'));
    expect(within(bar).getByRole('button', { name: /Cure Wounds/ }).getAttribute('aria-disabled')).toBe('true');
    expect((within(bar).getByRole('button', { name: 'Take this action' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends_average_damage_and_leaves_hit_points_to_the_resolution', async () => {
    const swing: ActionOption = { id: 'monster:scimitar', kind: 'monster', name: 'Scimitar', originalName: 'Scimitar', sourceId: 'monster.goblin-warrior', cost: 'action',
      attack: { bonus: 4, reach: 5 }, damage: [{ dice: '1d6+2', average: 5, type: 'slashing' }], automation: 'assisted', notes: ['CONDITIONAL_DAMAGE'], text: 'Scimitar text' };
    const scimitar: ActionPreview = { sourceId: swing.sourceId, optionId: swing.id, actorId: 'gob', targetIds: ['hero'], name: 'Scimitar', cost: { turn: 'action', slot: null, feature: null, uses: null, legendary: 0 },
      automation: 'assisted', rolls: [{ kind: 'attack', targetId: 'hero', modifier: 4, ac: 16 }], effects: [{ kind: 'damage', dice: '1d6+2', average: 5, type: 'slashing', onSave: null }], duration: null, prompts: ['CONDITIONAL_DAMAGE'], issues: [], trigger: null, text: 'Scimitar text' };
    const result: ActionOutcome = { preview: scimitar, attacks: [{ targetId: 'hero', roll: { kind: 'attack', rolls: [18], kept: 18, modifier: 4, total: 22, critical: false, fumble: false }, hit: true }], saves: [],
      damage: [{ targetId: 'hero', type: 'slashing', roll: null, total: 5 }], heal: null, proposed: [{ targetId: 'hero', input: { kind: 'damage', amount: 5, damageType: 'slashing' }, decision: false }] };
    const dmCombat = combat({ activeId: 'gob', combatants: combat().combatants.map((c) => c.id === 'gob' ? { ...c, hp: { current: 7, max: 7, temp: 0 }, budget: { action: 1, bonus: 1, reaction: 1, movement: 30 }, hidden: false } : c) });
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot('dm', { combat: dmCombat }) }, scenes: { 'scene-1': scene }, actions: { gob: [swing], hero: [] }, previewAction: () => scimitar,
      onCommand: (body) => body.kind === 'combat.act' ? new Response(JSON.stringify({ targetId: 'combat-1', entityRevision: 4, eventSequence: 2, value: { id: 'res-2', outcome: result } }), { status: 200 }) : undefined });
    const user = userEvent.setup(); render(<App />);
    const bar = await screen.findByRole('region', { name: 'Action bar' });
    await user.click(await within(bar).findByRole('button', { name: /Scimitar/ }));
    await user.click(within(within(bar).getByRole('group', { name: 'Targets' })).getByRole('checkbox', { name: 'Ilse' }));
    await user.selectOptions(within(bar).getByRole('combobox', { name: 'Damage' }), 'average');
    expect(await within(bar).findByText('Attack roll +4 against Ilse (AC 16)')).toBeTruthy();
    await user.click(within(bar).getByRole('button', { name: 'Take this action' }));
    expect(await within(bar).findByText('Ilse: hit (22)')).toBeTruthy();
    expect(commands().at(-1)).toMatchObject({ kind: 'combat.act', payload: { damageMode: 'average' } });
    expect(within(bar).queryByRole('button', { name: /Apply to/ })).toBeNull();
    expect(within(bar).getByText('Hit Point changes are decided in Open resolutions.')).toBeTruthy();
  });
});
