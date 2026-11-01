import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CombatView } from '#shared/combat';
import type { RoomSnapshot } from '#shared/room';
import { App } from '../../app/App';
import { setLocale } from '../../app/i18n';
import { configureRoomStore, resetRoomStore } from '../../app/room-store';
import { FakeSocket, installFakeApi } from '../../test/fake-api';

const combat = (): CombatView => ({ id: 'combat-1', campaignId: 'camp-1', name: 'Arena', status: 'active', round: 1, turn: 1, revision: 3, activeId: 'hero', sceneId: null,
  combatants: [{ id: 'hero', name: 'Brakka', characterId: 'char-1', characterRevision: 5, ownerAccountId: 'alice', initiative: 10, tieOrder: 0, defeated: false, hp: { current: 0, max: 13, temp: 0 },
    budget: { action: 1, bonus: 1, reaction: 1, movement: 30 }, vitals: { conditions: [], exhaustion: 0, deathMode: 'saves', zeroHpUnconscious: true, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } } }],
});
const snapshot = (role: 'dm' | 'player'): RoomSnapshot => ({ campaignId: 'camp-1', eventSequence: 1, campaign: { id: 'camp-1', title: 'Table', ruleset: 'srd-5.2.1-2024' },
  you: { accountId: role === 'dm' ? 'dm' : 'alice', role }, members: [], combat: combat(), rolls: [], ...(role === 'dm' ? { dm: { invites: [] } } : {}),
});
let fake: ReturnType<typeof installFakeApi>, socket: FakeSocket;
const commands = () => fake.requests.map((r) => r.body as { kind?: string; requestId: string; expectedRevision?: number; payload?: unknown } | undefined).filter((r) => r?.kind);
beforeEach(() => { localStorage.clear(); setLocale('en'); socket = new FakeSocket(); socket.connected = true; configureRoomStore({ createSocket: () => socket }); window.history.replaceState(null, '', '/campaigns/camp-1/combat'); });
afterEach(() => { fake?.restore(); resetRoomStore(); });

describe('dice and vitals UI', () => {
  it('submits_bounded_rolls_shows_breakdown_and_preserves_locale_drafts', async () => {
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot('dm') }, onCommand: (body) => body.kind === 'roll.dice' ? new Response(JSON.stringify({ targetId: body.targetId, entityRevision: 1, eventSequence: 2, value: { id: body.targetId, result: { expression: '2d6+3', dice: [{ sides: 6, rolls: [1, 1], sign: 1 }], modifier: 3, total: 5, critical: false } } }), { status: 200 }) : undefined });
    const user = userEvent.setup(); render(<App />);
    const tray = await screen.findByRole('region', { name: 'Dice tray' });
    const expression = within(tray).getByRole('textbox', { name: 'Dice expression' });
    await user.clear(expression); await user.type(expression, '2d6+3');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'id');
    expect((within(tray).getByRole('textbox', { name: 'Ekspresi dadu' }) as HTMLInputElement).value).toBe('2d6+3');
    await user.click(within(tray).getByRole('button', { name: 'Lempar dadu' }));
    await waitFor(() => expect(commands().at(-1)).toMatchObject({ kind: 'roll.dice', payload: { expression: '2d6+3', audience: 'public' } }));
    expect(await within(tray).findByText('Total: 5')).toBeTruthy();
    expect(commands().some((r) => r?.kind === 'combat.spend')).toBe(false);
  });

  it('retries_a_lost_ack_with_the_same_request_and_sends_nothing_offline', async () => {
    let attempts = 0;
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot('player') }, onCommand: (body) => {
      if (body.kind !== 'roll.dice') return undefined;
      attempts++; if (attempts === 1) throw new TypeError('lost ACK');
      return new Response(JSON.stringify({ targetId: body.targetId, entityRevision: 1, eventSequence: 2, value: { id: body.targetId, result: { expression: '1d20', dice: [{ sides: 20, rolls: [10], sign: 1 }], modifier: 0, total: 10, critical: false } } }), { status: 200 });
    } });
    const user = userEvent.setup(); render(<App />);
    const tray = await screen.findByRole('region', { name: 'Dice tray' });
    await user.click(within(tray).getByRole('button', { name: 'Roll dice' }));
    const retry = await within(tray).findByRole('button', { name: 'Retry same roll' });
    await user.click(retry);
    expect(commands()[0]!.requestId).toBe(commands()[1]!.requestId);
    expect(attempts).toBe(2);
    act(() => socket.serverEmit('disconnect', 'transport close'));
    expect(within(tray).getByRole('button', { name: 'Roll dice' }).hasAttribute('disabled')).toBe(true);
  });

  it('offers_owner_death_saves_and_dm_only_typed_damage_controls', async () => {
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot('dm') } });
    const user = userEvent.setup(); render(<App />);
    const vitals = await screen.findByRole('region', { name: 'Hit Points and conditions for Brakka' });
    await user.click(within(vitals).getByRole('button', { name: 'Roll death save' }));
    expect(commands().at(-1)).toMatchObject({ kind: 'combat.death-save', expectedRevision: 3, payload: { combatantId: 'hero', sourceRevision: 5, audience: 'public' } });
    await user.click(within(vitals).getByText('Manage Hit Points and conditions'));
    const amount = within(vitals).getByRole('spinbutton', { name: 'Amount' });
    await user.clear(amount); await user.type(amount, '7');
    await user.selectOptions(within(vitals).getByRole('combobox', { name: 'Damage type' }), 'fire');
    await user.click(within(vitals).getByRole('button', { name: 'Apply Hit Point change' }));
    expect(commands().at(-1)).toMatchObject({ kind: 'combat.apply-hp', payload: { combatantId: 'hero', sourceRevision: 5, input: { kind: 'damage', amount: 7, damageType: 'fire' } } });
  });

  it('keeps_unsaved_conditions_when_an_hp_change_is_submitted', async () => {
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot('dm') } });
    const user = userEvent.setup(); render(<App />);
    const vitals = await screen.findByRole('region', { name: 'Hit Points and conditions for Brakka' });
    await user.click(within(vitals).getByText('Manage Hit Points and conditions'));
    const conditions = within(vitals).getByRole('listbox', { name: 'Conditions' });
    await user.selectOptions(conditions, 'condition.prone');
    await user.click(within(vitals).getByRole('button', { name: 'Apply Hit Point change' }));
    expect((within(conditions).getByRole('option', { name: 'Prone' }) as HTMLOptionElement).selected).toBe(true);
    await user.click(within(vitals).getByRole('button', { name: 'Save conditions and defenses' }));
    expect(commands().at(-1)).toMatchObject({ kind: 'combat.conditions', expectedRevision: 3, payload: { conditions: ['condition.prone'] } });
  });

  it('retries_uncertain_hp_commands_with_the_exact_envelope_without_duplicate_damage', async () => {
    const initial = snapshot('dm'); initial.combat!.combatants[0]!.hp!.current = 13;
    let committed = false, changes = 0;
    fake = installFakeApi({ snapshots: { 'camp-1': initial }, onCommand: (body) => {
      if (body.kind !== 'combat.apply-hp') return undefined;
      if (!committed) {
        committed = true; changes++;
        fake.state.snapshots['camp-1'] = { ...initial, eventSequence: 2, combat: { ...initial.combat!, revision: 4, combatants: initial.combat!.combatants.map((c) => ({ ...c, characterRevision: 6, hp: { current: 12, max: 13, temp: 0 } })) } };
        throw new TypeError('Committed but response lost');
      }
      return new Response(JSON.stringify({ targetId: body.targetId, entityRevision: 4, eventSequence: 2, value: { id: body.targetId, combatantId: 'hero' } }), { status: 200 });
    } });
    const user = userEvent.setup(); render(<App />);
    const vitals = await screen.findByRole('region', { name: 'Hit Points and conditions for Brakka' });
    await user.click(within(vitals).getByText('Manage Hit Points and conditions'));
    await user.click(within(vitals).getByRole('button', { name: 'Apply Hit Point change' }));
    const retry = await screen.findByRole('button', { name: 'Retry same command' });
    expect(within(vitals).getByRole('button', { name: 'Apply Hit Point change' }).hasAttribute('disabled')).toBe(true);
    await user.click(retry);
    await waitFor(() => expect(commands()).toHaveLength(2));
    expect(commands()[1]).toEqual(commands()[0]);
    expect(changes).toBe(1);
    expect(await screen.findByText('HP 12/13 · Temporary HP 0')).toBeTruthy();
  });
});
