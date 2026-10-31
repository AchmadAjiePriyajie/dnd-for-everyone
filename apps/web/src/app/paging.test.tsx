import { act, cleanup, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MonsterInstance } from '#shared/encounters';
import type { RoomSnapshot } from '#shared/room';
import { installFakeApi } from '../test/fake-api';
import { App } from './App';
import { setLocale } from './i18n';
import { Pager, usePaged } from './Pager';
import { resetRoomStore } from './room-store';
import { Tabs } from './Tabs';

let fake: ReturnType<typeof installFakeApi> | undefined;
beforeEach(() => { localStorage.clear(); setLocale('en'); });
afterEach(() => { fake?.restore(); fake = undefined; resetRoomStore(); });

describe('paging and sections', () => {
  it('pages_lists_of_twenty_and_resets_when_the_list_shrinks', () => {
    const many = Array.from({ length: 45 }, (_, index) => index);
    const { result, rerender } = renderHook(({ items }) => usePaged(items), { initialProps: { items: many } });
    expect(result.current.pages).toBe(3);
    act(() => result.current.setPage(3));
    expect(result.current.items).toEqual([40, 41, 42, 43, 44]);
    rerender({ items: many.slice(0, 10) });
    expect(result.current.page).toBe(1);
    expect(result.current.items).toHaveLength(10);
  });

  it('renders_pager_buttons_only_when_needed', async () => {
    const user = userEvent.setup();
    const pages: number[] = [];
    const { rerender } = render(<Pager label="Monsters" page={1} pages={3} onPage={(page) => pages.push(page)} />);
    const nav = screen.getByRole('navigation', { name: 'Monsters pagination' });
    expect((within(nav).getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(nav).getByText('Page 1 of 3')).toBeTruthy();
    await user.click(within(nav).getByRole('button', { name: 'Next' }));
    expect(pages).toEqual([2]);
    rerender(<Pager label="Monsters" page={3} pages={3} onPage={() => undefined} />);
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<Pager label="Monsters" page={1} pages={1} onPage={() => undefined} />);
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('remembers_the_chosen_tab_and_supports_arrow_keys', async () => {
    const user = userEvent.setup();
    const tabs = [{ id: 'a', label: 'Alpha', content: <p>First</p> }, { id: 'b', label: 'Beta', content: <p>Second</p> }];
    render(<Tabs label="Sheet" tabs={tabs} />);
    expect(screen.getByRole('tab', { name: 'Alpha' }).getAttribute('aria-selected')).toBe('true');
    screen.getByRole('tab', { name: 'Alpha' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Beta' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Second')).toBeTruthy();
    cleanup();
    render(<Tabs label="Sheet" tabs={tabs} />);
    expect(screen.getByRole('tab', { name: 'Beta' }).getAttribute('aria-selected')).toBe('true');
  });

  it('splits_the_room_into_sections_with_status_markers', async () => {
    const snapshot = { campaignId: 'camp-1', eventSequence: 1, campaign: { id: 'camp-1', title: 'Table', ruleset: 'srd-5.2.1-2024' }, you: { accountId: 'dm', role: 'dm' },
      members: [{ accountId: 'dm', username: 'dungeon_master', role: 'dm' }], dm: { invites: [] }, characters: [],
      combat: { id: 'combat-1', campaignId: 'camp-1', name: 'Mill', status: 'active', round: 1, turn: 1, revision: 1, activeId: null, sceneId: null, combatants: [] },
      session: { id: 's1', number: 1, title: 'Mill', status: 'active', startedAt: '2026-11-01T00:00:00.000Z', endedAt: null } } as unknown as RoomSnapshot;
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot } });
    window.history.replaceState(null, '', '/campaigns/camp-1');
    const user = userEvent.setup(); render(<App />);
    const sections = await screen.findByRole('tablist', { name: 'Campaign sections' });
    expect(within(sections).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Party', 'Session', 'DM prep', 'Invites']);
    expect(screen.getByText('Combat active')).toBeTruthy();
    expect(screen.getByText('Session active')).toBeTruthy();
    await user.click(within(sections).getByRole('tab', { name: 'Invites' }));
    expect(screen.getByRole('button', { name: 'Create invite code' })).toBeTruthy();
  });

  it('pages_the_monster_picker', async () => {
    const monsters: MonsterInstance[] = Array.from({ length: 45 }, (_, index) => ({ id: `monster.m-${index}`, name: `Monster ${String(index).padStart(2, '0')}`, originalName: `Monster ${index}`, cr: '1', xp: 200, creatureTypes: ['beast'], size: ['medium'], homebrew: false }));
    const snapshot = { campaignId: 'camp-1', eventSequence: 1, campaign: { id: 'camp-1', title: 'Table', ruleset: 'srd-5.2.1-2024' }, you: { accountId: 'dm', role: 'dm' }, members: [], dm: { invites: [] }, characters: [] } as unknown as RoomSnapshot;
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot }, monsters });
    window.history.replaceState(null, '', '/campaigns/camp-1/encounters');
    render(<App />);
    expect(await screen.findByText('Page 1 of 3')).toBeTruthy();
  });
});
