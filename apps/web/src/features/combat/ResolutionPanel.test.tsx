import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActionOutcome, CombatView, Resolution } from '#shared/combat';
import type { RoomSnapshot } from '#shared/room';
import { App } from '../../app/App';
import { setLocale } from '../../app/i18n';
import { configureRoomStore, resetRoomStore } from '../../app/room-store';
import { FakeSocket, installFakeApi } from '../../test/fake-api';

const combat = (): CombatView => ({ id: 'combat-1', campaignId: 'camp-1', name: 'Arena', status: 'active', round: 1, turn: 2, revision: 7, activeId: 'gob', sceneId: null,
  combatants: [
    { id: 'hero', name: 'Vell', characterId: 'char-1', characterRevision: 5, ownerAccountId: 'alice', initiative: 10, tieOrder: 0, defeated: false, hp: { current: 7, max: 10, temp: 0 }, budget: { action: 1, bonus: 1, reaction: 1, movement: 30 } },
    { id: 'gob', name: 'Goblin 1', characterId: null, ownerAccountId: null, initiative: 15, tieOrder: 1, defeated: false },
  ],
});
const outcome: ActionOutcome = {
  preview: { sourceId: 'monster.goblin-warrior', optionId: 'monster:scimitar', actorId: 'gob', targetIds: ['hero'], name: 'Scimitar', cost: { turn: 'action', slot: null, feature: null, uses: null, legendary: 0 },
    automation: 'assisted', rolls: [{ kind: 'attack', targetId: 'hero', modifier: 4, ac: null }], effects: [], duration: null, prompts: [], issues: [], trigger: null },
  attacks: [{ targetId: 'hero', roll: { kind: 'attack', rolls: [15], kept: 15, modifier: 4, total: 19, critical: false, fumble: false }, hit: true }], saves: [],
  damage: [{ targetId: 'hero', type: 'slashing', roll: null, total: 5 }], heal: null, proposed: [{ targetId: 'hero', input: { kind: 'damage', amount: 5, damageType: 'slashing' }, decision: false }],
};
const resolution = (over: Partial<Resolution> = {}): Resolution => ({ id: 'res-1', combatId: 'combat-1', actorId: 'gob', phase: 'pending', audience: 'public', outcome, costs: outcome.preview.cost, turn: 2,
  proposed: outcome.proposed, pendingReactions: [{ combatantId: 'hero', optionId: 'spell:class.wizard:spell.shield', name: 'Shield', trigger: 'you are hit by an attack roll', status: 'offered' }],
  committedEffects: [], concentrationChecks: [], cancellationPolicy: 'no-refund', refund: null, compensation: null, respondsTo: null, revision: 2, createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T00:00:00.000Z', ...over });
const snapshot = (role: 'dm' | 'player', resolutions: Resolution[]): RoomSnapshot => ({ campaignId: 'camp-1', eventSequence: 1, campaign: { id: 'camp-1', title: 'Table', ruleset: 'srd-5.2.1-2024' },
  you: { accountId: role === 'dm' ? 'dm' : 'alice', role }, members: [], combat: combat(), rolls: [], resolutions, ...(role === 'dm' ? { dm: { invites: [] } } : {}),
});
let fake: ReturnType<typeof installFakeApi>, socket: FakeSocket;
const commands = () => fake.requests.map((r) => r.body as { kind?: string; targetId?: string; payload?: unknown; expectedRevision?: number } | undefined).filter((r) => r?.kind);
beforeEach(() => { localStorage.clear(); setLocale('en'); socket = new FakeSocket(); socket.connected = true; configureRoomStore({ createSocket: () => socket }); window.history.replaceState(null, '', '/campaigns/camp-1/combat'); });
afterEach(() => { fake?.restore(); resetRoomStore(); });

describe('resolution panel', () => {
  it('offers_owner_reactions_and_blocks_commands_while_disconnected', async () => {
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot('player', [resolution()]) } });
    const user = userEvent.setup(); render(<App />);
    const panel = await screen.findByRole('region', { name: 'Open resolutions' });
    expect(within(panel).getByText('Goblin 1: Scimitar')).toBeTruthy();
    expect(within(panel).getByText('Waiting for reactions')).toBeTruthy();
    expect(within(panel).getByText('Vell can use Shield: you are hit by an attack roll')).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'Commit' })).toBeNull();
    await user.click(within(panel).getByRole('button', { name: 'Use Shield' }));
    await waitFor(() => expect(commands().at(-1)).toMatchObject({ kind: 'combat.act', targetId: 'combat-1', expectedRevision: 7,
      payload: { combatantId: 'hero', optionId: 'spell:class.wizard:spell.shield', targetIds: [], respondsTo: 'res-1' } }));
    await user.click(within(panel).getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(commands().at(-1)).toMatchObject({ kind: 'resolution.decide', targetId: 'res-1', expectedRevision: 2, payload: { decision: 'decline', combatantId: 'hero' } }));
    // The browser going offline blocks commands before the socket notices; back online resyncs first.
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect((within(panel).getByRole('button', { name: 'Use Shield' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect((within(panel).getByRole('button', { name: 'Use Shield' }) as HTMLButtonElement).disabled).toBe(false));
    act(() => socket.serverEmit('disconnect', 'transport close'));
    expect((within(panel).getByRole('button', { name: 'Use Shield' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(panel).getByRole('button', { name: 'Decline' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('lets_the_dm_edit_commit_cancel_and_compensate', async () => {
    const closed = resolution({ id: 'res-0', phase: 'resolved', pendingReactions: [{ combatantId: 'hero', optionId: 'spell:class.wizard:spell.shield', name: 'Shield', trigger: null, status: 'declared' }], committedEffects: [{ targetId: 'hero', input: { kind: 'damage', amount: 4, damageType: 'fire' }, before: { current: 10, temp: 0 }, after: { current: 6, temp: 0 } }],
      concentrationChecks: [{ targetId: 'hero', dc: 10 }], revision: 3 });
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot('dm', [closed, resolution({ phase: 'awaitingDecision', pendingReactions: [] })]) } });
    const user = userEvent.setup(); render(<App />);
    const panel = await screen.findByRole('region', { name: 'Open resolutions' });
    const amount = within(panel).getByRole('spinbutton', { name: 'Vell: Slashing damage' });
    await user.clear(amount); await user.type(amount, '3');
    await user.click(within(panel).getByRole('button', { name: 'Commit' }));
    await waitFor(() => expect(commands().at(-1)).toMatchObject({ kind: 'resolution.decide', targetId: 'res-1', expectedRevision: 2,
      payload: { decision: 'commit', effects: [{ targetId: 'hero', input: { kind: 'damage', amount: 3, damageType: 'slashing' }, decision: false }] } }));
    await user.click(within(panel).getByRole('checkbox', { name: 'Refund the costs (DM correction)' }));
    expect((within(panel).getByRole('button', { name: 'Cancel action' }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(within(panel).getByRole('textbox', { name: 'Reason' }), 'Wrong target');
    await user.click(within(panel).getByRole('button', { name: 'Cancel action' }));
    await waitFor(() => expect(commands().at(-1)).toMatchObject({ kind: 'resolution.decide', payload: { decision: 'cancel', refund: true, reason: 'Wrong target' } }));
    const history = screen.getByRole('region', { name: 'Recent resolutions' });
    expect(within(history).getByText('Vell: Concentration save DC 10')).toBeTruthy();
    expect(within(history).getByText('Vell used Shield')).toBeTruthy();
    await user.type(within(history).getByRole('textbox', { name: 'Correction reason' }), 'Resisted');
    await user.click(within(history).getByRole('button', { name: 'Undo Hit Point changes' }));
    await waitFor(() => expect(commands().at(-1)).toMatchObject({ kind: 'resolution.decide', targetId: 'res-0', expectedRevision: 3, payload: { decision: 'compensate', reason: 'Resisted' } }));
  });
});
