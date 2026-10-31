import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CombatView } from '#shared/combat';
import type { RoomSnapshot } from '#shared/room';
import { App } from '../../app/App';
import { setLocale } from '../../app/i18n';
import { configureRoomStore, resetRoomStore } from '../../app/room-store';
import { FakeSocket, installFakeApi } from '../../test/fake-api';

const combat = (status: CombatView['status'] = 'active'): CombatView => ({
  id: 'combat-1', campaignId: 'camp-1', name: 'Ambush', templateId: 'enc-1', sceneId: null,
  status, round: status === 'preparing' ? 0 : 1, turn: 1, activeId: 'hero', revision: 7,
  combatants: [{ id: 'hero', name: 'Brakka', characterId: 'char-1', ownerAccountId: 'acc-alice',
    initiative: 18, tieOrder: 0, defeated: false, speedFeet: 30, hp: { current: 13, max: 13, temp: 0 },
    budget: { action: 1, bonus: 1, reaction: 1, movement: 30 } }],
});
const snapshot = (role: 'dm' | 'player', state = combat()): RoomSnapshot => ({
  campaignId: 'camp-1', eventSequence: 4, campaign: { id: 'camp-1', title: 'Lost Mine', ruleset: 'srd-5.2.1-2024' },
  you: { accountId: role === 'dm' ? 'acc-dm' : 'acc-alice', role },
  members: [{ accountId: 'acc-dm', username: 'dm', role: 'dm' }, { accountId: 'acc-alice', username: 'alice', role: 'player' }],
  combat: state, ...(role === 'dm' ? { dm: { invites: [] } } : {}),
});
let fake: ReturnType<typeof installFakeApi>;
let socket: FakeSocket;
const commands = () => fake.requests.map((r) => r.body as { kind?: string; expectedRevision?: number; payload?: unknown } | undefined).filter((b) => b?.kind);
beforeEach(() => {
  localStorage.clear(); setLocale('en');
  socket = new FakeSocket(); socket.connected = true;
  configureRoomStore({ createSocket: () => socket });
  window.history.replaceState(null, '', '/campaigns/camp-1/combat');
});
afterEach(() => { fake?.restore(); resetRoomStore(); });

describe('combat tracker', () => {
  it('lets_the_dm_begin_and_correct_initiative_with_a_reason', async () => {
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot('dm', combat('preparing')) } });
    const user = userEvent.setup(); render(<App />);
    const begin = await screen.findByRole('button', { name: 'Begin combat' });
    expect(screen.getByRole('link', { name: 'Back to the room' })).toBeTruthy();
    await waitFor(() => expect(begin.hasAttribute('disabled')).toBe(false));
    await user.click(begin);
    expect(commands().find((c) => c?.kind === 'combat.begin')).toMatchObject({ expectedRevision: 7 });
    await user.click(screen.getByText('Adjust Brakka'));
    const form = screen.getByRole('form', { name: 'Adjust Brakka' });
    const initiative = within(form).getByRole('spinbutton', { name: 'Initiative' });
    await user.clear(initiative); await user.type(initiative, '21');
    await user.type(within(form).getByRole('textbox', { name: 'Reason' }), 'DM tie break');
    await user.click(within(form).getByRole('button', { name: 'Save correction' }));
    expect(commands().find((c) => c?.kind === 'combat.update')).toMatchObject({
      expectedRevision: 7, payload: { combatantId: 'hero', reason: 'DM tie break', patch: { initiative: 21 } },
    });
  });

  it('tracks_owned_actions_and_keeps_drafts_when_language_changes_or_disconnected', async () => {
    fake = installFakeApi({ account: { accountId: 'acc-alice', username: 'alice', locale: null, password: 'password' }, snapshots: { 'camp-1': snapshot('player') } });
    const user = userEvent.setup(); render(<App />);
    const group = await screen.findByRole('group', { name: 'Actions for Brakka' });
    await waitFor(() => expect(within(group).getByRole('button', { name: 'Use Action' }).hasAttribute('disabled')).toBe(false));
    expect(screen.queryByRole('button', { name: 'Next turn' })).toBeNull();
    const feet = within(group).getByRole('spinbutton', { name: 'Movement to spend (ft)' });
    await user.clear(feet); await user.type(feet, '15');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'id');
    expect((screen.getByRole('spinbutton', { name: 'Gerakan yang dipakai (ft)' }) as HTMLInputElement).value).toBe('15');
    await user.click(screen.getByRole('button', { name: 'Pakai Aksi' }));
    expect(commands().find((c) => c?.kind === 'combat.spend')).toMatchObject({ expectedRevision: 7, payload: { combatantId: 'hero', resource: 'action' } });
    const before = commands().length;
    act(() => socket.serverEmit('disconnect', 'transport close'));
    expect(screen.getByRole('button', { name: 'Pakai Reaksi' }).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Pakai Reaksi' }));
    expect(commands()).toHaveLength(before);
    expect((screen.getByRole('spinbutton', { name: 'Gerakan yang dipakai (ft)' }) as HTMLInputElement).value).toBe('15');
  });

  it('disables_actions_outside_your_turn_except_reactions_and_refreshes_committed_state', async () => {
    const state = combat(); state.activeId = null;
    fake = installFakeApi({ account: { accountId: 'acc-alice', username: 'alice', locale: null, password: 'password' }, snapshots: { 'camp-1': snapshot('player', state) } });
    const user = userEvent.setup(); render(<App />);
    const group = await screen.findByRole('group', { name: 'Actions for Brakka' });
    const reaction = within(group).getByRole('button', { name: 'Use Reaction' });
    await waitFor(() => expect(reaction.hasAttribute('disabled')).toBe(false));
    expect(within(group).getByRole('button', { name: 'Use Action' }).hasAttribute('disabled')).toBe(true);
    fake.state.onCommand = () => {
      fake.state.snapshots['camp-1'] = snapshot('player', { ...state, revision: 8, combatants: state.combatants.map((c) => ({ ...c, budget: { ...c.budget!, reaction: 0 } })) });
      return undefined;
    };
    await user.click(reaction);
    await waitFor(() => expect(reaction.hasAttribute('disabled')).toBe(true));
    expect(commands().at(-1)?.payload).toEqual({ combatantId: 'hero', resource: 'reaction' });
  });

  it('binds_a_token_created_in_the_map_ui_to_a_combatant', async () => {
    const state = combat('preparing'); state.sceneId = 'scene-1';
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot('dm', state) }, scenes: {
      'scene-1': { id: 'scene-1', name: 'Arena', assetId: null, revision: 1, shared: true,
        grid: { columns: 10, rows: 10, cellPixels: 40, offsetX: 0, offsetY: 0, feetPerCell: 5 }, markers: [], fog: { enabled: false, revealed: [] },
        tokens: [{ id: 'tok-ui', sceneId: 'scene-1', label: 'Brakka map token', kind: 'character', characterId: null, ownerAccountId: null, x: 1, y: 1, size: 1 }],
      },
    } });
    const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByText('Adjust Brakka'));
    const form = screen.getByRole('form', { name: 'Adjust Brakka' });
    const tokenSelect = await within(form).findByRole('combobox', { name: 'Map token' });
    await within(form).findByRole('option', { name: 'Brakka map token' });
    await user.selectOptions(tokenSelect, 'tok-ui');
    await user.click(within(form).getByRole('button', { name: 'Link token' }));
    expect(commands().find((c) => c?.kind === 'combat.bind-token')).toMatchObject({ expectedRevision: 7, payload: { combatantId: 'hero', tokenId: 'tok-ui' } });
  });

  it('retains_the_sheet_revision_seen_when_the_dm_started_an_hp_correction', async () => {
    const state = combat(); state.combatants[0]!.characterRevision = 3;
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot('dm', state) } });
    const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByText('Adjust Brakka'));
    const form = screen.getByRole('form', { name: 'Adjust Brakka' });
    const hp = within(form).getByRole('spinbutton', { name: 'Current HP' });
    await user.clear(hp); await user.type(hp, '7');
    await user.type(within(form).getByRole('textbox', { name: 'Reason' }), 'Manual correction');
    // The owner changes HP on the sheet while the DM's draft is open.
    fake.state.snapshots['camp-1'] = { ...snapshot('dm', { ...state, combatants: state.combatants.map((c) => ({ ...c, characterRevision: 4, hp: { current: 4, max: 13, temp: 0 } })) }), eventSequence: 5 };
    act(() => socket.serverEmit('room:changed', { campaignId: 'camp-1', eventSequence: 5 }));
    await screen.findByText('HP 4/13 · Temporary HP 0');
    fake.state.onCommand = () => new Response(JSON.stringify({ code: 'STALE_REVISION', params: { currentRevision: 4 } }), { status: 409, headers: { 'content-type': 'application/json' } });
    await user.click(within(form).getByRole('button', { name: 'Save correction' }));
    expect(commands().at(-1)).toMatchObject({ kind: 'combat.update', payload: { sourceRevision: 3, patch: { hpCurrent: 7 } } });
    expect((hp as HTMLInputElement).value).toBe('7');
    expect((within(form).getByRole('textbox', { name: 'Reason' }) as HTMLInputElement).value).toBe('Manual correction');
  });
});
