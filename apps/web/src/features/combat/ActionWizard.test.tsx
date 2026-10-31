import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActionInput, ActionOption, ActionOutcome, ActionPreview, CombatView } from '#shared/combat';
import type { RoomSnapshot } from '#shared/room';
import { App } from '../../app/App';
import { setLocale } from '../../app/i18n';
import { configureRoomStore, resetRoomStore } from '../../app/room-store';
import { FakeSocket, installFakeApi } from '../../test/fake-api';

const combat = (): CombatView => ({ id: 'combat-1', campaignId: 'camp-1', name: 'Arena', status: 'active', round: 1, turn: 1, revision: 3, activeId: 'hero', sceneId: null,
  combatants: [
    { id: 'hero', name: 'Ilse', characterId: 'char-1', characterRevision: 5, ownerAccountId: 'alice', initiative: 10, tieOrder: 0, defeated: false, hp: { current: 7, max: 10, temp: 0 }, budget: { action: 1, bonus: 1, reaction: 1, movement: 30 } },
    { id: 'gob', name: 'Goblin 1', characterId: null, ownerAccountId: null, initiative: 5, tieOrder: 1, defeated: false },
  ],
});
const snapshot = (role: 'dm' | 'player'): RoomSnapshot => ({ campaignId: 'camp-1', eventSequence: 1, campaign: { id: 'camp-1', title: 'Table', ruleset: 'srd-5.2.1-2024' },
  you: { accountId: role === 'dm' ? 'dm' : 'alice', role }, members: [], combat: combat(), rolls: [], ...(role === 'dm' ? { dm: { invites: [] } } : {}),
});
const cure: ActionOption = { id: 'spell:class.cleric:spell.cure-wounds', kind: 'spell', name: 'Cure Wounds', originalName: 'Cure Wounds', sourceId: 'spell.cure-wounds', cost: 'action', damage: [],
  heal: { dice: '2d8', bonus: 2 }, rangeFeet: 5, spell: { level: 1, concentration: false, duration: 'Instantaneous', upcastDice: '2d8', upcastTarget: 'heal', upcastManual: false },
  automation: 'assisted', notes: ['SPELL_EFFECT_REVIEW'], text: 'A creature you touch regains Hit Points.' };
const preview = (input: ActionInput, issues: string[] = []): ActionPreview => ({ sourceId: 'spell.cure-wounds', optionId: input.optionId, actorId: 'hero', targetIds: input.targetIds, name: 'Cure Wounds',
  cost: { turn: 'action', slot: { level: input.slotLevel ?? 1, pact: false }, feature: null, uses: null, legendary: 0 }, automation: 'assisted', rolls: [],
  effects: [{ kind: 'heal', dice: input.slotLevel === 2 ? '4d8' : '2d8', bonus: 2 }], duration: 'Instantaneous', prompts: ['SPELL_EFFECT_REVIEW'], issues, trigger: null, text: 'A creature you touch regains Hit Points.' });
let fake: ReturnType<typeof installFakeApi>, socket: FakeSocket;
const commands = () => fake.requests.map((r) => r.body as { kind?: string; payload?: unknown; expectedRevision?: number } | undefined).filter((r) => r?.kind);
beforeEach(() => { localStorage.clear(); setLocale('en'); socket = new FakeSocket(); socket.connected = true; configureRoomStore({ createSocket: () => socket }); window.history.replaceState(null, '', '/campaigns/camp-1/combat'); });
afterEach(() => { fake?.restore(); resetRoomStore(); });

describe('guided action wizard', () => {
  it('previews_on_the_server_labels_automation_and_sends_one_action', async () => {
    const outcome: ActionOutcome = { preview: { ...preview({ combatantId: 'hero', optionId: cure.id, targetIds: ['hero'], slotLevel: 2 }), text: undefined } as never, attacks: [], saves: [], damage: [],
      heal: { expression: '4d8+2', dice: [{ sides: 8, rolls: [1, 2, 3, 4], sign: 1 }], modifier: 2, total: 12, critical: false }, proposed: [{ targetId: 'hero', input: { kind: 'heal', amount: 12 }, decision: false }] };
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot('player') }, actions: { hero: [cure] }, previewAction: (input) => preview(input, input.targetIds.length ? [] : ['TARGET_REQUIRED']),
      onCommand: (body) => body.kind === 'combat.act' ? new Response(JSON.stringify({ targetId: 'combat-1', entityRevision: 4, eventSequence: 2, value: { id: 'rec-1', outcome } }), { status: 200 }) : undefined });
    const user = userEvent.setup(); render(<App />);
    const wizard = await screen.findByRole('region', { name: 'Guided action for Ilse' });
    await within(wizard).findByRole('option', { name: 'Cure Wounds (1)' });
    await user.selectOptions(within(wizard).getByRole('combobox', { name: 'What to do' }), cure.id);
    expect(await within(wizard).findByText('Choose a target.')).toBeTruthy();
    expect((within(wizard).getByRole('button', { name: 'Take this action' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(wizard).queryByRole('checkbox', { name: 'Goblin 1' })).toBeTruthy();
    await user.click(within(wizard).getByRole('checkbox', { name: 'Ilse' }));
    await user.selectOptions(within(wizard).getByRole('combobox', { name: 'Spell slot level' }), '2');
    expect(await within(wizard).findByText('Healing 4d8 + 2')).toBeTruthy();
    expect(within(wizard).getByText('Assisted: some effects need the DM')).toBeTruthy();
    expect(within(wizard).getByText('Rolls come from the spell text; check its other effects.')).toBeTruthy();
    await user.click(within(wizard).getByRole('button', { name: 'Take this action' }));
    await waitFor(() => expect(commands().filter((c) => c?.kind === 'combat.act')).toHaveLength(1));
    expect(commands().at(-1)).toMatchObject({ kind: 'combat.act', expectedRevision: 3, payload: { combatantId: 'hero', optionId: cure.id, targetIds: ['hero'], slotLevel: 2, audience: 'public' } });
    expect(await within(wizard).findByText('12 Hit Points regained')).toBeTruthy();
    // Players never apply HP; the DM does.
    expect(within(wizard).queryByRole('button', { name: /Apply to/ })).toBeNull();
    expect(fake.requests.some((r) => r.path.includes('/actions/preview'))).toBe(true);
  });

  it('lets_the_dm_apply_proposed_hit_point_changes', async () => {
    const swing: ActionOption = { id: 'monster:scimitar', kind: 'monster', name: 'Scimitar', originalName: 'Scimitar', sourceId: 'monster.goblin-warrior', cost: 'action',
      attack: { bonus: 4, reach: 5 }, damage: [{ dice: '1d6+2', average: 5, type: 'slashing' }], automation: 'assisted', notes: ['CONDITIONAL_DAMAGE'], text: 'Scimitar text' };
    const dmCombat = { ...combat(), activeId: 'gob', combatants: combat().combatants.map((c) => c.id === 'gob' ? { ...c, hp: { current: 10, max: 10, temp: 0 }, budget: { action: 1, bonus: 1, reaction: 1, movement: 30 }, hidden: false, monsterId: 'monster.goblin-warrior' } : c) };
    const scimitar: ActionPreview = { sourceId: swing.sourceId, optionId: swing.id, actorId: 'gob', targetIds: ['hero'], name: 'Scimitar', cost: { turn: 'action', slot: null, feature: null, uses: null, legendary: 0 },
      automation: 'assisted', rolls: [{ kind: 'attack', targetId: 'hero', modifier: 4, ac: 16 }], effects: [{ kind: 'damage', dice: '1d6+2', average: 5, type: 'slashing', onSave: null }], duration: null, prompts: ['CONDITIONAL_DAMAGE'], issues: [], trigger: null, text: 'Scimitar text' };
    const outcome: ActionOutcome = { preview: scimitar, attacks: [{ targetId: 'hero', roll: { kind: 'attack', rolls: [18], kept: 18, modifier: 4, total: 22, critical: false, fumble: false }, hit: true }], saves: [],
      damage: [{ targetId: 'hero', type: 'slashing', roll: null, total: 5 }], heal: null, proposed: [{ targetId: 'hero', input: { kind: 'damage', amount: 5, damageType: 'slashing' }, decision: false }] };
    fake = installFakeApi({ snapshots: { 'camp-1': { ...snapshot('dm'), combat: dmCombat } }, actions: { gob: [swing], hero: [] }, previewAction: () => scimitar,
      onCommand: (body) => body.kind === 'combat.act' ? new Response(JSON.stringify({ targetId: 'combat-1', entityRevision: 4, eventSequence: 2, value: { id: 'rec-2', outcome } }), { status: 200 }) : undefined });
    const user = userEvent.setup(); render(<App />);
    const wizard = await screen.findByRole('region', { name: 'Guided action for Goblin 1' });
    await within(wizard).findByRole('option', { name: 'Scimitar' });
    await user.selectOptions(within(wizard).getByRole('combobox', { name: 'What to do' }), swing.id);
    await user.click(within(wizard).getByRole('checkbox', { name: 'Ilse' }));
    await user.selectOptions(within(wizard).getByRole('combobox', { name: 'Damage' }), 'average');
    expect(await within(wizard).findByText('Attack roll +4 against Ilse (AC 16)')).toBeTruthy();
    await user.click(within(wizard).getByRole('button', { name: 'Take this action' }));
    expect(await within(wizard).findByText('Ilse: hit (22)')).toBeTruthy();
    expect(commands().at(-1)).toMatchObject({ kind: 'combat.act', payload: { damageMode: 'average' } });
    await user.click(within(wizard).getByRole('button', { name: 'Apply to Ilse' }));
    await waitFor(() => expect(commands().at(-1)).toMatchObject({ kind: 'combat.apply-hp', payload: { combatantId: 'hero', input: { kind: 'damage', amount: 5, damageType: 'slashing' }, sourceRevision: 5 } }));
  });
});
