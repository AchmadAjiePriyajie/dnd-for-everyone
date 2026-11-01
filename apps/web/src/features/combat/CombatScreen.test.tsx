import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CombatView, Resolution } from '#shared/combat';
import type { SearchHit } from '#shared/reference';
import type { RoomSnapshot } from '#shared/room';
import type { SceneView } from '#shared/scenes';
import { App } from '../../app/App';
import { setLocale } from '../../app/i18n';
import { configureRoomStore, resetRoomStore } from '../../app/room-store';
import { FakeSocket, installFakeApi } from '../../test/fake-api';

const combat = (over: Partial<CombatView> = {}): CombatView => ({ id: 'combat-1', campaignId: 'camp-1', name: 'Mill', status: 'active', round: 2, turn: 5, revision: 3, activeId: 'gob', sceneId: 'scene-1',
  combatants: [
    { id: 'gob', name: 'Goblin 1', characterId: null, monsterId: 'monster.goblin-warrior', tokenId: 'tok-g', ownerAccountId: null, initiative: 15, tieOrder: 0, defeated: false, hidden: false,
      hp: { current: 4, max: 10, temp: 0 }, budget: { action: 0, bonus: 1, reaction: 1, movement: 30 }, speedFeet: 30,
      vitals: { conditions: ['condition.prone'], exhaustion: 0, deathMode: 'instant', zeroHpUnconscious: false, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } } },
    { id: 'hero', name: 'Vell', characterId: 'char-1', characterRevision: 2, tokenId: 'tok-v', ownerAccountId: 'alice', initiative: 10, tieOrder: 1, defeated: false, hidden: false,
      hp: { current: 9, max: 11, temp: 0 }, budget: { action: 1, bonus: 1, reaction: 1, movement: 30 }, speedFeet: 30 },
  ], ...over,
});
const scene: SceneView = { id: 'scene-1', name: 'Old mill', assetId: null, grid: { columns: 10, rows: 8, cellPixels: 40, offsetX: 0, offsetY: 0, feetPerCell: 5 },
  tokens: [{ id: 'tok-g', sceneId: 'scene-1', label: 'Goblin 1', kind: 'monster', x: 3, y: 2, size: 1, ownerAccountId: null, characterId: null }, { id: 'tok-v', sceneId: 'scene-1', label: 'Vell', kind: 'character', x: 1, y: 1, size: 1, ownerAccountId: 'alice', characterId: 'char-1' }],
  markers: [], fog: { enabled: false, revealed: [] }, revision: 1, shared: true };
const pending = (): Resolution => ({ id: 'res-1', combatId: 'combat-1', actorId: 'gob', phase: 'pending', audience: 'public',
  outcome: { preview: { sourceId: 'monster.goblin-warrior', optionId: 'monster:scimitar', actorId: 'gob', targetIds: ['hero'], name: 'Scimitar', cost: { turn: 'action', slot: null, feature: null, uses: null, legendary: 0 }, automation: 'assisted', rolls: [], effects: [], duration: null, prompts: [], issues: [], trigger: null },
    attacks: [], saves: [], damage: [], heal: null, proposed: [] },
  costs: { turn: 'action', slot: null, feature: null, uses: null, legendary: 0 }, turn: 5, proposed: [], pendingReactions: [{ combatantId: 'hero', optionId: 'spell:class.wizard:spell.shield', name: 'Shield', trigger: 'hit', status: 'offered' }],
  committedEffects: [], concentrationChecks: [], cancellationPolicy: 'no-refund', refund: null, compensation: null, respondsTo: null, revision: 1, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' });
const prone: SearchHit = { entryId: 'condition.prone', entryKind: 'condition', title: 'Prone', originalTitle: 'Prone', summary: null, whenToUse: null, relatedIds: [],
  source: { kind: 'srd', ruleset: 'srd-5.2.1-2024', section: 'Rules Glossary', page: 190, license: 'CC-BY-4.0' }, translation: 'source' } as SearchHit;
const snapshot = (over: Partial<RoomSnapshot> = {}): RoomSnapshot => ({ campaignId: 'camp-1', eventSequence: 1, campaign: { id: 'camp-1', title: 'Table', ruleset: 'srd-5.2.1-2024' },
  you: { accountId: 'dm', role: 'dm' }, members: [], combat: combat(), rolls: [], resolutions: [], dm: { invites: [] }, ...over } as RoomSnapshot);

const width = (px: number) => vi.stubGlobal('matchMedia', (query: string) => {
  const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
  return { matches: px >= min, media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, onchange: null, dispatchEvent: () => false };
});
let fake: ReturnType<typeof installFakeApi>, socket: FakeSocket;
beforeEach(() => { localStorage.clear(); setLocale('en'); width(1400); socket = new FakeSocket(); socket.connected = true; configureRoomStore({ createSocket: () => socket }); window.history.replaceState(null, '', '/campaigns/camp-1/combat'); });
afterEach(() => { fake?.restore(); resetRoomStore(); vi.unstubAllGlobals(); });

describe('unified combat screen', () => {
  it('shows_turn_order_map_and_tools_together_for_the_dm', async () => {
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot() }, scenes: { 'scene-1': scene } });
    const user = userEvent.setup(); render(<App />);
    const order = await screen.findByRole('region', { name: 'Turn order' });
    expect(await screen.findByRole('region', { name: 'Battle map' })).toBeTruthy();
    const tools = screen.getByRole('tablist', { name: 'Combat tools' });
    for (const tab of ['Resolutions', 'Dice', 'Rules']) expect(within(tools).getByRole('tab', { name: new RegExp(tab) })).toBeTruthy();
    const active = within(order).getByRole('listitem', { current: 'step' });
    expect(within(active).getByRole('button', { name: 'Goblin 1' })).toBeTruthy();
    expect(within(active).getByRole('meter', { name: 'Hit Points: 4 of 10' })).toBeTruthy();
    expect(within(active).getByText('Prone', { selector: '.chip' })).toBeTruthy();
    expect(within(active).getByLabelText('Action: spent')).toBeTruthy();
    expect(within(active).getByLabelText('Bonus Action: available')).toBeTruthy();
    // DM correction stays folded until asked for.
    expect(within(active).getByText('Adjust Goblin 1').closest('details')!.open).toBe(false);
    await user.click(within(active).getByText('Adjust Goblin 1'));
    expect(within(active).getByText('Adjust Goblin 1').closest('details')!.open).toBe(true);
  });

  it('opens_resolutions_when_a_reaction_waits_and_reads_rules_in_place', async () => {
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot({ you: { accountId: 'alice', role: 'player' }, dm: undefined, resolutions: [pending()] } as Partial<RoomSnapshot>) }, scenes: { 'scene-1': scene },
      reference: { search: (q) => q.toLowerCase().includes('prone') ? [prone] : [], entries: { 'condition.prone': { ...prone, locale: 'en', body: 'A Prone creature can only crawl.' } }, bookmarks: [] } });
    const user = userEvent.setup(); render(<App />);
    const tools = await screen.findByRole('tablist', { name: 'Combat tools' });
    const resolutions = within(tools).getByRole('tab', { name: /Resolutions/ });
    await waitFor(() => expect(resolutions.getAttribute('aria-selected')).toBe('true'));
    expect(resolutions.textContent).toContain('1');
    await user.click(within(tools).getByRole('tab', { name: 'Rules' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search rules and terms' }), 'prone');
    await user.click(await screen.findByRole('button', { name: /Prone/ }));
    expect(await screen.findByText('A Prone creature can only crawl.')).toBeTruthy();
    expect(window.location.pathname).toBe('/campaigns/camp-1/combat');
  });

  it('keeps_working_without_a_map_and_folds_panels_on_medium_screens', async () => {
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot({ combat: combat({ sceneId: null }) }) } });
    render(<App />);
    expect(await screen.findByText('No map for this combat')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Turn order' })).toBeTruthy();
    cleanup(); fake.restore(); resetRoomStore();
    width(1000);
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot() }, scenes: { 'scene-1': scene } });
    const user = userEvent.setup(); render(<App />);
    const showOrder = await screen.findByRole('button', { name: 'Show turn order' });
    expect(showOrder.getAttribute('aria-expanded')).toBe('false');
    await user.click(showOrder);
    expect(showOrder.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('button', { name: 'Show tools' }).length).toBeGreaterThan(0);
  });

  it('shows_hit_points_and_standing_on_map_tokens', async () => {
    const marked: SceneView = { ...scene, tokens: [{ ...scene.tokens[0]!, standing: 'bloodied' }, { ...scene.tokens[1]!, hp: { current: 9, max: 11 } }] };
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot({ you: { accountId: 'alice', role: 'player' }, dm: undefined } as Partial<RoomSnapshot>) }, scenes: { 'scene-1': marked } });
    render(<App />);
    expect(await screen.findByRole('button', { name: /^Goblin 1, column 4, row 3, Bloodied/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Vell, column 2, row 2, HP 9\/11/ })).toBeTruthy();
  });
});
