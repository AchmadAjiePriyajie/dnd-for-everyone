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
  scenes: [{ id: 'scene-cave', name: 'Cragmaw Cave', ...(role === 'dm' ? { shared: true } : {}) }],
  ...(role === 'dm' ? { dm: { invites: [] } } : {}),
});
const scene = (over: Partial<SceneView> = {}): SceneView => ({
  id: 'scene-cave',
  name: 'Cragmaw Cave',
  assetId: null,
  grid: { columns: 12, rows: 10, cellPixels: 50, offsetX: 0, offsetY: 0, feetPerCell: 5, diagonal: 'alternate' },
  tokens: [{ id: 'tok-brakka', sceneId: 'scene-cave', label: 'Brakka', kind: 'character', x: 1, y: 1, size: 1, ownerAccountId: 'acc-alice', characterId: null }],
  markers: [],
  fog: { enabled: true, revealed: [{ x: 0, y: 0, w: 6, h: 4 }] },
  revision: 3,
  ...over,
});

let fake: ReturnType<typeof installFakeApi>;
const commands = () =>
  fake.requests.flatMap((r) => {
    const body = r.body as { kind?: string; targetId?: string; payload?: unknown } | undefined;
    return body?.kind ? [{ kind: body.kind, targetId: body.targetId, payload: body.payload }] : [];
  });
const player = () =>
  installFakeApi({
    account: { accountId: 'acc-alice', username: 'alice', locale: null, password: 'correct horse battery' },
    snapshots: { 'camp-1': snapshot('player') },
    scenes: { 'scene-cave': scene() },
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

describe('map controls', () => {
  it('validates_paths_and_supports_touch', async () => {
    fake = player();
    window.history.replaceState(null, '', '/campaigns/camp-1/scenes');
    const user = userEvent.setup();
    render(<App />);

    const map = await screen.findByRole('group', { name: 'Cragmaw Cave, 12 by 10 squares' });
    const brakka = within(map).getByRole('button', { name: 'Brakka, column 2, row 2' });
    // Tap-to-move (form kolom/baris, sama dengan tap di peta) membuat path yang sama dengan drag.
    await user.click(brakka);
    const tools = screen.getByRole('region', { name: 'Map tools' });
    const move = within(tools).getByRole('form', { name: 'Move Brakka to a square' });
    await user.clear(within(move).getByRole('spinbutton', { name: 'Column' }));
    await user.type(within(move).getByRole('spinbutton', { name: 'Column' }), '5');
    await user.clear(within(move).getByRole('spinbutton', { name: 'Row' }));
    await user.type(within(move).getByRole('spinbutton', { name: 'Row' }), '3');
    await user.click(within(move).getByRole('button', { name: 'Move Brakka' }));
    await waitFor(() =>
      expect(commands()).toContainEqual({
        kind: 'token.move',
        targetId: 'tok-brakka',
        payload: { x: 4, y: 2, path: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }] },
      }),
    );
    // Keyboard memakai bentuk perintah yang sama (satu langkah).
    fireEvent.keyDown(brakka, { key: 'ArrowDown' });
    await waitFor(() => expect(commands()).toContainEqual({ kind: 'token.move', targetId: 'tok-brakka', payload: { x: 1, y: 2, path: [{ x: 1, y: 1 }, { x: 1, y: 2 }] } }));

    // Penggaris mengikuti aturan diagonal scene (alternate: 3×2 → 20 feet).
    await user.click(within(tools).getByRole('radio', { name: 'Measure' }));
    const measure = within(tools).getByRole('form', { name: 'Measure' });
    await user.clear(within(measure).getByRole('spinbutton', { name: 'Column' }));
    await user.type(within(measure).getByRole('spinbutton', { name: 'Column' }), '5');
    await user.clear(within(measure).getByRole('spinbutton', { name: 'Row' }));
    await user.type(within(measure).getByRole('spinbutton', { name: 'Row' }), '4');
    await user.click(within(measure).getByRole('button', { name: 'Measure to this square' }));
    expect(within(measure).getByRole('status').textContent).toBe('20 feet from 2,2 to 5,4');

    // Ping lewat endpoint sementara, bukan command (tidak masuk log permanen).
    await user.click(within(tools).getByRole('radio', { name: 'Ping' }));
    await user.click(within(tools).getByRole('button', { name: 'Ping this square' }));
    await waitFor(() => expect(fake.requests.some((r) => r.method === 'POST' && r.path === '/api/campaigns/camp-1/scenes/scene-cave/ping')).toBe(true));
    expect(commands().some((c) => c.kind.includes('ping'))).toBe(false);

    // Kabut tampil sebagai overlay; player tidak punya alat Reveal.
    expect(screen.getByTestId('fog')).toBeTruthy();
    expect(within(tools).queryByRole('radio', { name: 'Reveal (fog)' })).toBeNull();

    // Zoom mengubah viewBox (ukuran kotak tetap dalam satuan grid).
    const before = map.getAttribute('viewBox');
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(map.getAttribute('viewBox')).not.toBe(before);
  });

  it('places_area_markers_and_reveals_fog_as_dm', async () => {
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot('dm') }, scenes: { 'scene-cave': scene({ shared: true, markers: [{ id: 'aoe-1', sceneId: 'scene-cave', shape: 'sphere', origin: { x: 5, y: 5 }, sizeFeet: 10, direction: 'E', label: 'Fireball', ownerAccountId: 'acc-alice' }] }) } });
    window.history.replaceState(null, '', '/campaigns/camp-1/scenes');
    const user = userEvent.setup();
    const view = render(<App />);

    const tools = await screen.findByRole('region', { name: 'Map tools' });
    // Penanda yang ada digambar sebagai kotak tercakup (Sphere 10 ft = 12 kotak).
    expect(view.container.querySelectorAll('.aoe-cell')).toHaveLength(12);
    await user.click(within(tools).getByRole('radio', { name: 'Area of effect' }));
    const area = within(tools).getByRole('form', { name: 'Area of effect' });
    await user.selectOptions(within(area).getByRole('combobox', { name: 'Shape' }), 'cone');
    await user.clear(within(area).getByRole('spinbutton', { name: 'Size (feet)' }));
    await user.type(within(area).getByRole('spinbutton', { name: 'Size (feet)' }), '15');
    await user.click(within(area).getByRole('button', { name: 'Place area' }));
    await waitFor(() =>
      expect(commands()).toContainEqual(expect.objectContaining({ kind: 'marker.place', payload: expect.objectContaining({ sceneId: 'scene-cave', shape: 'cone', sizeFeet: 15, direction: 'E' }) })),
    );
    // DM boleh menghapus penanda pemain.
    await user.click(within(tools).getByRole('button', { name: 'Remove Fireball' }));
    await waitFor(() => expect(commands()).toContainEqual({ kind: 'marker.remove', targetId: 'aoe-1', payload: {} }));

    await user.click(within(tools).getByRole('radio', { name: 'Reveal (fog)' }));
    const reveal = within(tools).getByRole('form', { name: 'Reveal (fog)' });
    await user.click(within(reveal).getByRole('button', { name: 'Reveal this area' }));
    await waitFor(() =>
      expect(commands()).toContainEqual({
        kind: 'scene.fog',
        targetId: 'scene-cave',
        payload: { enabled: true, revealed: [{ x: 0, y: 0, w: 6, h: 4 }, { x: 0, y: 0, w: 4, h: 4 }] },
      }),
    );
  });
});
