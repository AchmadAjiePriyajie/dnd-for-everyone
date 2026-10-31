import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '#shared/room';
import { App } from '../../app/App';
import { setLocale } from '../../app/i18n';
import { configureRoomStore, resetRoomStore } from '../../app/room-store';
import { FakeSocket, installFakeApi } from '../../test/fake-api';

const snapshot = (role: 'dm' | 'player'): RoomSnapshot => ({
  campaignId: 'camp-1',
  eventSequence: 1,
  campaign: { id: 'camp-1', title: 'Lost Mine', ruleset: 'srd-5.2.1-2024' },
  you: { accountId: role === 'dm' ? 'acc-dm' : 'acc-alice', role },
  members: [
    { accountId: 'acc-dm', username: 'dungeon_master', role: 'dm' },
    { accountId: 'acc-alice', username: 'alice', role: 'player' },
  ],
  characters: [],
  notes: [],
  ...(role === 'dm' ? { dm: { invites: [] } } : {}),
});

let fake: ReturnType<typeof installFakeApi>;
const commands = () =>
  fake.requests.flatMap((r) => {
    const body = r.body as { kind?: string; payload?: unknown; expectedRevision?: number } | undefined;
    return body?.kind ? [body] : [];
  });

beforeEach(() => {
  localStorage.clear();
  setLocale('en');
  configureRoomStore({
    createSocket: () => {
      const socket = new FakeSocket();
      socket.connected = true;
      return socket;
    },
  });
});

afterEach(() => {
  fake?.restore();
  resetRoomStore();
});

describe('encounter builder', () => {
  it('estimates_2024_budget_while_building', async () => {
    fake = installFakeApi({
      snapshots: { 'camp-1': snapshot('dm') },
      monsters: [
        { id: 'monster.goblin-warrior', name: 'Goblin Warrior', originalName: 'Goblin Warrior', cr: '1/4', xp: 50, creatureTypes: ['fey'], size: ['small'], homebrew: false },
        { id: 'monster.adult-red-dragon', name: 'Adult Red Dragon', originalName: 'Adult Red Dragon', cr: '17', xp: 18000, creatureTypes: ['dragon'], size: ['huge'], homebrew: false },
      ],
    });
    window.history.replaceState(null, '', '/campaigns/camp-1/encounters');
    const user = userEvent.setup();
    render(<App />);

    const picker = await screen.findByRole('region', { name: 'Monsters' });
    await user.type(within(picker).getByRole('searchbox', { name: 'Search monsters' }), 'gob');
    expect(within(picker).queryByText('Adult Red Dragon')).toBeNull();
    const add = within(picker).getByRole('button', { name: 'Add Goblin Warrior' });
    for (let index = 0; index < 4; index++) await user.click(add);

    // Empat goblin 50 XP untuk empat level 1 = 200 XP → Low, tanpa multiplier.
    const estimate = screen.getByRole('group', { name: 'Difficulty estimate' });
    expect(within(estimate).getByText('Low')).toBeTruthy();
    expect(estimate.textContent).toContain('Total 200 XP');
    expect(estimate.textContent).toContain('Moderate budget 300 XP');
    expect(estimate.textContent).toContain('100 XP left');

    // Level tidak valid: koreksi input, bukan difficulty palsu.
    const levels = screen.getByRole('textbox', { name: 'Character levels (comma separated)' });
    await user.clear(levels);
    await user.type(levels, '0');
    expect(within(estimate).getByText('Levels must be whole numbers from 1 to 20.')).toBeTruthy();
    await user.clear(levels);
    await user.type(levels, '1, 1, 1, 1');

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Road ambush');
    await user.click(screen.getByRole('button', { name: 'Save encounter' }));
    await waitFor(() =>
      expect(commands().find((c) => c.kind === 'encounter.save')?.payload).toMatchObject({
        template: { name: 'Road ambush', target: 'moderate', party: { mode: 'levels', levels: [1, 1, 1, 1] }, monsters: [{ monsterId: 'monster.goblin-warrior', count: 4, hp: 'average' }] },
      }),
    );
  });

  it('filters_by_cr_when_some_stat_blocks_have_no_cr', async () => {
    // Bentuk respons server nyata: stat block summon (mis. Animated Object) tidak punya CR/XP.
    fake = installFakeApi({
      snapshots: { 'camp-1': snapshot('dm') },
      monsters: [
        { id: 'monster.goblin-warrior', name: 'Goblin Warrior', originalName: 'Goblin Warrior', cr: '1/4', xp: 50, creatureTypes: ['fey'], size: ['small'], homebrew: false },
        { id: 'monster.animated-object', name: 'Animated Object', originalName: 'Animated Object', cr: null, xp: null, creatureTypes: ['construct'], size: ['medium'], homebrew: false },
        { id: 'monster.adult-red-dragon', name: 'Adult Red Dragon', originalName: 'Adult Red Dragon', cr: '17', xp: 18000, creatureTypes: ['dragon'], size: ['huge'], homebrew: false },
      ],
    });
    window.history.replaceState(null, '', '/campaigns/camp-1/encounters');
    const user = userEvent.setup();
    render(<App />);

    const picker = await screen.findByRole('region', { name: 'Monsters' });
    await user.selectOptions(within(picker).getByRole('combobox', { name: 'Maximum CR' }), '1');
    expect(within(picker).getByText('Goblin Warrior')).toBeTruthy();
    expect(within(picker).queryByText('Adult Red Dragon')).toBeNull();
    // Tanpa CR tidak bisa dibandingkan dengan batas CR → disembunyikan saat filter CR aktif.
    expect(within(picker).queryByText('Animated Object')).toBeNull();
    await user.selectOptions(within(picker).getByRole('combobox', { name: 'Maximum CR' }), '');
    expect(within(picker).getByText('Animated Object')).toBeTruthy();
    // Monster tanpa XP tidak dihitung sebagai 0 XP: estimasi meminta koreksi.
    await user.click(within(picker).getByRole('button', { name: 'Add Animated Object' }));
    const estimate = screen.getByRole('group', { name: 'Difficulty estimate' });
    expect(within(estimate).getByText('A monster has no valid XP value; fix it before estimating.')).toBeTruthy();
  });

  it('filters_by_type_and_sorts_with_paging', async () => {
    const many = Array.from({ length: 45 }, (_, index) => ({
      id: `monster.rat-${index}`,
      name: `Rat ${String(index).padStart(2, '0')}`,
      originalName: `Rat ${index}`,
      cr: '0',
      xp: 10,
      creatureTypes: ['beast'],
      size: ['tiny'],
      homebrew: false,
    }));
    fake = installFakeApi({
      snapshots: { 'camp-1': snapshot('dm') },
      monsters: [
        ...many,
        { id: 'monster.ogre', name: 'Ogre', originalName: 'Ogre', cr: '2', xp: 450, creatureTypes: ['giant'], size: ['large'], homebrew: false },
        { id: 'monster.hill-giant', name: 'Hill Giant', originalName: 'Hill Giant', cr: '5', xp: 1800, creatureTypes: ['giant'], size: ['huge'], homebrew: false },
        { id: 'hb-mud', name: 'Mudling', originalName: 'Mudling', cr: '1/4', xp: 50, creatureTypes: ['elemental'], size: ['small'], homebrew: true },
      ],
    });
    window.history.replaceState(null, '', '/campaigns/camp-1/encounters');
    const user = userEvent.setup();
    render(<App />);

    const picker = await screen.findByRole('region', { name: 'Monsters' });
    const rows = () => within(picker).getAllByRole('listitem').map((item) => item.textContent ?? '');
    // 48 monster: 40 pertama tampil, sisanya lewat "Tampilkan lagi".
    expect(within(picker).getByText('Showing 40 of 48')).toBeTruthy();
    await user.click(within(picker).getByRole('button', { name: 'Show 8 more' }));
    expect(within(picker).getByText('Showing 48 of 48')).toBeTruthy();

    await user.selectOptions(within(picker).getByRole('combobox', { name: 'Creature type' }), 'giant');
    await user.selectOptions(within(picker).getByRole('combobox', { name: 'Sort by' }), 'cr-desc');
    expect(rows().map((text) => text.split(' ·')[0]!.trim())).toEqual(['Hill Giant', 'Ogre']);
    await user.selectOptions(within(picker).getByRole('combobox', { name: 'Size' }), 'large');
    expect(within(picker).getByText('Showing 1 of 1')).toBeTruthy();

    await user.click(within(picker).getByRole('button', { name: 'Clear filters' }));
    await user.selectOptions(within(picker).getByRole('combobox', { name: 'Source' }), 'homebrew');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('Mudling');
    await user.selectOptions(within(picker).getByRole('combobox', { name: 'Minimum CR' }), '1');
    expect(within(picker).getByText('No monsters match these filters.')).toBeTruthy();
  });

});

describe('homebrew editor', () => {
  it('lets_players_propose_and_dm_approve', async () => {
    fake = installFakeApi({
      account: { accountId: 'acc-alice', username: 'alice', locale: null, password: 'correct horse battery' },
      snapshots: { 'camp-1': snapshot('player') },
    });
    window.history.replaceState(null, '', '/campaigns/camp-1/homebrew');
    const user = userEvent.setup();
    const view = render(<App />);

    await user.click(await screen.findByRole('button', { name: 'New entry' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Mudling');
    const mechanics = screen.getByRole('textbox', { name: 'Rules data (JSON)' });
    await user.clear(mechanics);
    await user.type(mechanics, '{{"xp": ');
    expect(screen.getByText('This is not valid JSON yet.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Propose to DM' }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(mechanics, '50}');
    await user.click(screen.getByRole('button', { name: 'Propose to DM' }));
    await waitFor(() => expect(commands().find((c) => c.kind === 'homebrew.save')?.payload).toMatchObject({ draft: { kind: 'monster', name: 'Mudling', mechanics: { xp: 50 } } }));
    view.unmount();
    fake.restore();
    resetRoomStore();

    // DM melihat usulan menunggu dan menyetujuinya dengan revisi saat ini.
    fake = installFakeApi({
      snapshots: { 'camp-1': snapshot('dm') },
      homebrew: [{ id: 'hb-mud', kind: 'monster', name: 'Mudling', summary: '', body: '', mechanics: { xp: 50 }, status: 'pending', authorAccountId: 'acc-alice', revision: 1 }],
    });
    configureRoomStore({
      createSocket: () => {
        const socket = new FakeSocket();
        socket.connected = true;
        return socket;
      },
    });
    render(<App />);
    expect(await screen.findByText('Waiting for DM')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Approve Mudling' }));
    await waitFor(() => expect(commands()).toContainEqual(expect.objectContaining({ kind: 'homebrew.approve', expectedRevision: 1 })));
  });
});
