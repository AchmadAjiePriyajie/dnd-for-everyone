import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CombatView, Resolution } from '#shared/combat';
import type { RoomSnapshot } from '#shared/room';
import { App } from '../../app/App';
import { setLocale } from '../../app/i18n';
import { configureRoomStore, resetRoomStore } from '../../app/room-store';
import { FakeSocket, installFakeApi } from '../../test/fake-api';

const combat = (): CombatView => ({ id: 'combat-1', campaignId: 'camp-1', name: 'Mill', status: 'active', round: 1, turn: 2, revision: 7, activeId: 'gob', sceneId: null,
  combatants: [
    { id: 'gob', name: 'Goblin 1', characterId: null, ownerAccountId: null, initiative: 15, tieOrder: 0, defeated: false, standing: 'bloodied', conditions: ['condition.grappled'] },
    { id: 'hero', name: 'Vell', characterId: 'char-1', characterRevision: 2, ownerAccountId: 'alice', initiative: 12, tieOrder: 1, defeated: false, hp: { current: 6, max: 11, temp: 2 },
      budget: { action: 1, bonus: 1, reaction: 1, movement: 25 }, speedFeet: 25, concentration: 'spell.bless',
      vitals: { conditions: [], exhaustion: 0, deathMode: 'saves', zeroHpUnconscious: false, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } } },
    { id: 'ally', name: 'Ilse', characterId: 'char-2', ownerAccountId: 'bram', initiative: 8, tieOrder: 2, defeated: false, hp: { current: 9, max: 9, temp: 0 }, conditions: ['condition.prone'], concentration: null },
  ],
});
const offer = (): Resolution => ({ id: 'res-1', combatId: 'combat-1', actorId: 'gob', phase: 'pending', audience: 'public',
  outcome: { preview: { sourceId: 'm', optionId: 'monster:scimitar', actorId: 'gob', targetIds: ['hero'], name: 'Scimitar', cost: { turn: 'action', slot: null, feature: null, uses: null, legendary: 0 }, automation: 'assisted', rolls: [], effects: [], duration: null, prompts: [], issues: [], trigger: null },
    attacks: [], saves: [], damage: [], heal: null, proposed: [] },
  costs: { turn: 'action', slot: null, feature: null, uses: null, legendary: 0 }, turn: 2, proposed: [], pendingReactions: [{ combatantId: 'hero', optionId: 'spell:class.wizard:spell.shield', name: 'Shield', trigger: 'you are hit', status: 'offered' }],
  committedEffects: [], concentrationChecks: [], cancellationPolicy: 'no-refund', refund: null, compensation: null, respondsTo: null, revision: 2, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' });
const snapshot = (): RoomSnapshot => ({ campaignId: 'camp-1', eventSequence: 1, campaign: { id: 'camp-1', title: 'Table', ruleset: 'srd-5.2.1-2024' },
  you: { accountId: 'alice', role: 'player' }, members: [], combat: combat(), rolls: [], resolutions: [offer()] } as RoomSnapshot);
const width = (px: number) => vi.stubGlobal('matchMedia', (query: string) => {
  const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
  return { matches: px >= min, media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, onchange: null, dispatchEvent: () => false };
});
let fake: ReturnType<typeof installFakeApi>, socket: FakeSocket;
const commands = () => fake.requests.map((r) => r.body as { kind?: string; targetId?: string; payload?: unknown } | undefined).filter((r) => r?.kind);
beforeEach(() => { localStorage.clear(); setLocale('en'); socket = new FakeSocket(); socket.connected = true; configureRoomStore({ createSocket: () => socket }); window.history.replaceState(null, '', '/campaigns/camp-1/combat'); });
afterEach(() => { fake?.restore(); resetRoomStore(); vi.unstubAllGlobals(); });

describe('player combat screen', () => {
  it('shows_own_card_party_status_and_reaction_notice_on_laptop', async () => {
    width(1400);
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot() }, actions: { hero: [] } });
    const user = userEvent.setup(); render(<App />);
    const card = await screen.findByRole('region', { name: 'Your character: Vell' });
    expect(within(card).getByRole('meter', { name: 'Hit Points: 6 of 11' })).toBeTruthy();
    expect(within(card).getByText('Concentration')).toBeTruthy();
    expect(within(card).getByLabelText('Reaction: available')).toBeTruthy();
    const order = screen.getByRole('region', { name: 'Turn order' });
    const ally = within(order).getAllByRole('listitem').find((row) => row.textContent?.includes('Ilse'))!;
    expect(within(ally).getByRole('meter', { name: 'Hit Points: 9 of 9' })).toBeTruthy();
    expect(within(ally).getByText('Prone', { selector: '.chip' })).toBeTruthy();
    const goblin = within(order).getAllByRole('listitem').find((row) => row.textContent?.includes('Goblin 1'))!;
    expect(within(goblin).getByText('Bloodied')).toBeTruthy();
    expect(within(goblin).queryByRole('meter')).toBeNull();
    const notices = screen.getByRole('region', { name: 'Notifications' });
    expect(within(notices).getByText('Reaction available: Shield')).toBeTruthy();
    await user.click(within(notices).getByRole('button', { name: 'Use Shield' }));
    await waitFor(() => expect(commands().at(-1)).toMatchObject({ kind: 'combat.act', targetId: 'combat-1', payload: { combatantId: 'hero', optionId: 'spell:class.wizard:spell.shield', respondsTo: 'res-1' } }));
    await user.click(within(notices).getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(commands().at(-1)).toMatchObject({ kind: 'resolution.decide', targetId: 'res-1', payload: { decision: 'decline', combatantId: 'hero' } }));
  });

  it('uses_bottom_tabs_on_phones_and_keeps_targets_between_tabs', async () => {
    width(390);
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot() }, actions: { hero: [{ id: 'spell:class.wizard:spell.fire-bolt', kind: 'spell', name: 'Fire Bolt', originalName: 'Fire Bolt', sourceId: 'spell.fire-bolt', cost: 'action',
      attack: { bonus: 5 }, damage: [{ dice: '1d10', average: null, type: 'fire' }], rangeFeet: 120, spell: { level: 0, school: 'evocation', concentration: false, duration: 'Instantaneous', upcastDice: null, upcastTarget: null, upcastManual: false }, automation: 'assisted', notes: [], text: 'Fire.' }] } });
    const user = userEvent.setup(); render(<App />);
    const tabs = await screen.findByRole('tablist', { name: 'Combat sections' });
    expect(within(tabs).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Map', 'Character', 'Actions', 'Turn', 'More']);
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeTruthy();
    await user.click(within(tabs).getByRole('tab', { name: 'Turn' }));
    await user.click(within(screen.getByRole('region', { name: 'Turn order' })).getByRole('button', { name: 'Goblin 1' }));
    await user.click(within(tabs).getByRole('tab', { name: 'Actions' }));
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeTruthy();
    const bar = screen.getByRole('region', { name: 'Action bar' });
    await user.click(await within(bar).findByRole('button', { name: /Fire Bolt/ }));
    expect((within(within(bar).getByRole('group', { name: 'Targets' })).getByRole('checkbox', { name: 'Goblin 1' }) as HTMLInputElement).checked).toBe(true);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'id');
    expect(within(await screen.findByRole('tablist', { name: 'Bagian combat' })).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Peta', 'Karakter', 'Aksi', 'Giliran', 'Lainnya']);
  });
});
