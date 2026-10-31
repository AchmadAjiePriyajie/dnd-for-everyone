import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '#shared/room';
import type { SceneView } from '#shared/scenes';
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
  scenes: [{ id: 'scene-road', name: 'Triboar Trail', ...(role === 'dm' ? { shared: true } : {}) }],
  ...(role === 'dm' ? { dm: { invites: [] } } : {}),
});
const grid = { columns: 20, rows: 15, cellPixels: 32, offsetX: 0, offsetY: 0, feetPerCell: 5 };
const scene = (over: Partial<SceneView> = {}): SceneView => ({
  id: 'scene-road',
  name: 'Triboar Trail',
  assetId: null,
  grid,
  markers: [],
  fog: { enabled: false, revealed: [] },
  revision: 2,
  tokens: [
    { id: 'tok-brakka', sceneId: 'scene-road', label: 'Brakka', kind: 'character', x: 2, y: 3, size: 1, ownerAccountId: 'acc-alice', characterId: null },
    { id: 'tok-ogre', sceneId: 'scene-road', label: 'Ogre', kind: 'monster', x: 19, y: 5, size: 1, ownerAccountId: null, characterId: null },
  ],
  ...over,
});

let fake: ReturnType<typeof installFakeApi>;
const commands = () =>
  fake.requests.flatMap((r) => {
    const body = r.body as { kind?: string; targetId?: string; payload?: unknown } | undefined;
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

describe('battle map', () => {
  it('moves_own_token_with_keyboard_only', async () => {
    fake = installFakeApi({
      account: { accountId: 'acc-alice', username: 'alice', locale: null, password: 'correct horse battery' },
      snapshots: { 'camp-1': snapshot('player') },
      scenes: { 'scene-road': scene() },
    });
    window.history.replaceState(null, '', '/campaigns/camp-1/scenes');
    render(<App />);

    const map = await screen.findByRole('group', { name: 'Triboar Trail, 20 by 15 squares' });
    // Posisi diumumkan dalam kolom/baris (mulai 1), disimpan sebagai sel grid (mulai 0).
    const brakka = within(map).getByRole('button', { name: 'Brakka, column 3, row 4' });
    fireEvent.keyDown(brakka, { key: 'ArrowRight' });
    await waitFor(() => expect(commands()).toContainEqual(expect.objectContaining({ kind: 'token.move', targetId: 'tok-brakka', payload: { x: 3, y: 3, path: [{ x: 2, y: 3 }, { x: 3, y: 3 }] } })));
    // Token milik orang lain tidak bergerak.
    fireEvent.keyDown(within(map).getByRole('button', { name: 'Ogre, column 20, row 6' }), { key: 'ArrowLeft' });
    expect(commands().some((c) => c.targetId === 'tok-ogre')).toBe(false);
    // Player tidak melihat alat DM.
    expect(screen.queryByRole('heading', { name: 'Map and tokens' })).toBeNull();
  });

  it('keeps_tokens_inside_the_grid', async () => {
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot('dm') }, scenes: { 'scene-road': scene() } });
    window.history.replaceState(null, '', '/campaigns/camp-1/scenes');
    render(<App />);
    const ogre = await screen.findByRole('button', { name: 'Ogre, column 20, row 6' });
    fireEvent.keyDown(ogre, { key: 'ArrowRight' });
    expect(commands().some((c) => c.kind === 'token.move')).toBe(false);
  });

  it('lets_dm_upload_maps_and_hide_tokens', async () => {
    fake = installFakeApi({
      snapshots: { 'camp-1': snapshot('dm') },
      scenes: { 'scene-road': scene({ shared: true, tokens: [{ id: 'tok-ogre', sceneId: 'scene-road', label: 'Ogre', kind: 'monster', x: 5, y: 5, size: 2, ownerAccountId: null, characterId: null, hidden: false, hp: { current: 59, max: 59 } }] }) },
    });
    window.history.replaceState(null, '', '/campaigns/camp-1/scenes');
    const user = userEvent.setup();
    render(<App />);

    // HP monster terlihat untuk DM di panel token (tidak dikirim ke player).
    expect(await screen.findByText(/HP 59\/59/)).toBeTruthy();
    const panel = screen.getByRole('complementary', { name: 'Map and tokens' });
    await user.upload(within(panel).getByLabelText('Upload map (PNG, JPEG, WebP)'), new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'road.png', { type: 'image/png' }));
    await waitFor(() => expect(fake.requests.some((r) => r.method === 'POST' && r.path === '/api/campaigns/camp-1/assets')).toBe(true));
    expect(fake.requests.find((r) => r.path === '/api/campaigns/camp-1/assets' && r.method === 'POST')?.body).toMatchObject({ binary: true, contentType: 'image/png' });

    await user.click(within(panel).getByRole('button', { name: 'Ogre' }));
    await user.click(within(panel).getByRole('button', { name: 'Hide this token' }));
    await waitFor(() => expect(commands()).toContainEqual(expect.objectContaining({ kind: 'token.update', targetId: 'tok-ogre', payload: { hidden: true } })));

    const add = within(panel).getByRole('form', { name: 'Add token' });
    await user.type(within(add).getByRole('textbox', { name: 'Token name' }), 'Goblin');
    await user.click(within(add).getByRole('checkbox', { name: 'Place hidden' }));
    await user.click(within(add).getByRole('button', { name: 'Add token' }));
    await waitFor(() =>
      expect(commands()).toContainEqual(expect.objectContaining({ kind: 'token.place', payload: expect.objectContaining({ sceneId: 'scene-road', label: 'Goblin', hidden: true, x: 0, y: 0 }) })),
    );
  });
});
