import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '#shared/room';
import en from '../locales/en/common.json';
import id from '../locales/id/common.json';
import { auditLocales } from '../../../../scripts/audit-locales.ts';
import { FakeSocket, installFakeApi } from '../test/fake-api';
import { ApiClientError } from './api';
import { App } from './App';
import { detectInitialLocale, i18n, setLocale } from './i18n';
import { configureRoomStore, resetRoomStore, roomStore, sendCommand, useConnectionStatus, useRoom } from './room-store';

let fake: ReturnType<typeof installFakeApi>;

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  setLocale('en');
});

afterEach(() => {
  fake?.restore();
  resetRoomStore();
});

describe('bilingual campaign shell', () => {
  it('switches_locale_without_losing_draft', async () => {
    fake = installFakeApi();
    const user = userEvent.setup();
    render(<App />);

    const title = await screen.findByRole('textbox', { name: 'Campaign title' });
    const invite = screen.getByRole('textbox', { name: 'Invite code' });
    await user.type(title, 'Curse of the Crimson Tide');
    await user.type(invite, 'abc123');
    const draftBefore = { title: (title as HTMLInputElement).value, invite: (invite as HTMLInputElement).value };
    expect(screen.getByRole('heading', { name: 'Your campaigns' })).toBeTruthy();

    // Ganti bahasa memakai keyboard pada select bahasa.
    const language = screen.getByRole('combobox', { name: 'Language' });
    await user.selectOptions(language, 'id');

    const titleAfter = screen.getByRole('textbox', { name: 'Judul campaign' });
    const inviteAfter = screen.getByRole('textbox', { name: 'Kode undangan' });
    const draftAfter = {
      title: (titleAfter as HTMLInputElement).value,
      invite: (inviteAfter as HTMLInputElement).value,
    };
    expect(draftAfter).toEqual(draftBefore);
    // Input yang sama (tidak di-remount), fokus tetap pada select.
    expect(titleAfter).toBe(title);
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Bahasa' }));
    expect(screen.getByRole('heading', { name: 'Campaign kamu' })).toBeTruthy();
    // Preferensi tersimpan per akun di server.
    await waitFor(() =>
      expect(fake.requests).toContainEqual({ method: 'PUT', path: '/api/auth/me/locale', body: { locale: 'id' } }),
    );
  });

  it('translates_error_codes_with_same_params', () => {
    const en42 = i18n.t('errors.RATE_LIMITED', { lng: 'en', retryAfterSeconds: 42 });
    const id42 = i18n.t('errors.RATE_LIMITED', { lng: 'id', retryAfterSeconds: 42 });
    expect(en42).toContain('42');
    expect(id42).toContain('42');
    expect(en42).not.toBe(id42);
    expect(i18n.t('errors.FORBIDDEN', { lng: 'id' })).not.toBe(i18n.t('errors.FORBIDDEN', { lng: 'en' }));
  });

  it('shows_translated_api_errors_in_forms', async () => {
    fake = installFakeApi({ authenticated: false });
    const user = userEvent.setup();
    setLocale('id');
    render(<App />);
    await user.type(await screen.findByRole('textbox', { name: 'Nama pengguna' }), 'dungeon_master');
    await user.type(screen.getByLabelText('Kata sandi'), 'wrong password');
    await user.click(screen.getByRole('button', { name: 'Masuk' }));
    expect((await screen.findByRole('alert')).textContent).toBe(i18n.t('errors.INVALID_CREDENTIALS', { lng: 'id' }));
  });

  it('picks_browser_locale_before_login', () => {
    const empty = { getItem: () => null };
    expect(detectInitialLocale(empty, ['id-ID', 'en-US'])).toBe('id');
    expect(detectInitialLocale(empty, ['fr-FR', 'en-US'])).toBe('en');
    expect(detectInitialLocale(empty, ['de-DE'])).toBe('en');
    expect(detectInitialLocale(empty, [])).toBe('en');
    expect(detectInitialLocale({ getItem: () => 'id' }, ['en-US'])).toBe('id');
    expect(detectInitialLocale({ getItem: () => 'xx' }, ['en-US'])).toBe('en');
  });

  it('keeps_secrets_out_of_room_store_and_storage', async () => {
    const secret = 'super secret pass phrase';
    fake = installFakeApi({
      authenticated: false,
      account: { accountId: 'acc-1', username: 'rogue_player', locale: 'id', password: secret },
    });
    const user = userEvent.setup();
    render(<App />);
    await user.type(await screen.findByRole('textbox', { name: 'Username' }), 'rogue_player');
    await user.type(screen.getByLabelText('Password'), secret);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    // Preferensi akun (ID) diterapkan setelah login.
    expect(await screen.findByRole('heading', { name: 'Campaign kamu' })).toBeTruthy();
    expect(screen.queryByLabelText('Kata sandi')).toBeNull();
    expect(JSON.stringify(roomStore.getState())).not.toContain(secret);
    const stored = Object.keys(localStorage).map((k) => `${k}=${localStorage.getItem(k)}`);
    expect(stored.join('\n')).not.toContain(secret);
    expect(stored).toEqual(['dnd.locale=id']);
  });

  it('syncs_room_snapshot_and_rejects_offline_commands', async () => {
    const snapshot = (title: string, eventSequence: number): RoomSnapshot => ({
      campaignId: 'c1',
      eventSequence,
      campaign: { id: 'c1', title, ruleset: 'srd-5.2.1-2024' },
      you: { accountId: 'acc-dm', role: 'dm' },
      members: [],
    });
    fake = installFakeApi({ snapshots: { c1: snapshot('Before', 1) } });
    const socket = new FakeSocket();
    configureRoomStore({ createSocket: () => socket });

    function Probe() {
      const room = useRoom('c1');
      const status = useConnectionStatus();
      return (
        <p>
          {room?.campaign.title ?? 'loading'} / {status}
        </p>
      );
    }
    render(<Probe />);
    expect(await screen.findByText('Before / connecting')).toBeTruthy();

    act(() => socket.serverEmit('connect'));
    expect(socket.emitted).toContainEqual({ event: 'room:subscribe', payload: { campaignId: 'c1' } });
    await screen.findByText('Before / connected');

    // Perubahan committed diumumkan → snapshot diambil ulang.
    fake.state.snapshots.c1 = snapshot('After', 2);
    act(() => socket.serverEmit('room:changed', { campaignId: 'c1', eventSequence: 2 }));
    expect(await screen.findByText('After / connected')).toBeTruthy();

    // Terputus: command ditolak di client dan tidak dikirim/di-buffer.
    act(() => socket.serverEmit('disconnect', 'transport close'));
    await screen.findByText('After / disconnected');
    const before = fake.requests.filter((r) => r.path.endsWith('/commands')).length;
    const envelope = { requestId: 'r1', campaignId: 'c1', targetId: 't', kind: 'test.x', payload: null };
    await expect(sendCommand(envelope)).rejects.toMatchObject({ error: { code: 'OFFLINE' } });
    expect(fake.requests.filter((r) => r.path.endsWith('/commands')).length).toBe(before);
    expect(socket.emitted.filter((e) => e.event !== 'room:subscribe')).toEqual([]);

    // Reconnect: subscribe ulang dan resync snapshot sebelum aksi berikutnya.
    fake.state.snapshots.c1 = snapshot('Resynced', 3);
    act(() => socket.serverEmit('connect'));
    expect(await screen.findByText('Resynced / connected')).toBeTruthy();
    expect(socket.emitted.filter((e) => e.event === 'room:subscribe')).toHaveLength(2);
    await expect(sendCommand(envelope)).resolves.toMatchObject({ entityRevision: 1 });
    expect(ApiClientError).toBeDefined();
  });

  it('keeps_locale_catalogs_complete_and_parameter_safe', () => {
    expect(auditLocales({ en, id })).toEqual([]);
    const broken = auditLocales({
      en: { a: 'Hi {{name}}', b: 'Only EN', c: 'x' },
      id: { a: 'Halo {{nama}}', c: '' },
    });
    expect(broken).toEqual(
      expect.arrayContaining([
        expect.stringContaining('a'),
        expect.stringContaining('b'),
        expect.stringContaining('c'),
      ]),
    );
    expect(broken).toHaveLength(3);
  });
});
