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
