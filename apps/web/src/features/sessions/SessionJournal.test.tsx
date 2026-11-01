import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RoomSnapshot } from '#shared/room';
import type { PlaySession, SessionView } from '#shared/sessions';
import { App } from '../../app/App';
import { setLocale } from '../../app/i18n';
import { configureRoomStore, resetRoomStore } from '../../app/room-store';
import { FakeSocket, installFakeApi } from '../../test/fake-api';

const session = (over: Partial<PlaySession> = {}): PlaySession => ({
  id: 'session-1', campaignId: 'camp-1', number: 1, title: 'The old mill', status: 'active', startedAt: '2026-10-31T10:00:00.000Z', endedAt: null,
  segments: [{ start: '2026-10-31T10:00:00.000Z', end: '2026-10-31T10:45:00.000Z' }],
  sceneId: null, combatId: null, pausedCombat: false, recap: { shared: 'The party reached the mill.', dm: 'Secret: the miller is a cultist.' },
  journal: [{ id: 'j1', accountId: 'alice', text: 'Vell suspects the miller.', visibility: 'party', createdAt: '2026-10-31T10:10:00.000Z' }],
  ruleNotes: [{ id: 'r1', text: 'Can Shield stop bonus damage?', ruleId: 'spell.shield', resolved: false, createdAt: '2026-10-31T10:20:00.000Z' }],
  firstSequence: 1, lastSequence: null, revision: 4, ...over,
});
const view = (s: PlaySession): SessionView => ({ session: s, turnId: null, round: null, combat: null, scene: null, resolutions: [],
  log: [{ sequence: 1, kind: 'session.start', at: '2026-10-31T10:00:00.000Z', actorAccountId: 'dm', targetId: 'session-1' }, { sequence: 5, kind: 'combat.next', at: '2026-10-31T10:30:00.000Z', actorAccountId: 'dm', targetId: 'combat-1' }] });
const snapshot = (role: 'dm' | 'player'): RoomSnapshot => ({ campaignId: 'camp-1', eventSequence: 1, campaign: { id: 'camp-1', title: 'Table', ruleset: 'srd-5.2.1-2024' },
  you: { accountId: role === 'dm' ? 'dm' : 'alice', role }, members: [{ accountId: 'dm', username: 'dungeon_master', role: 'dm' }, { accountId: 'alice', username: 'alice', role: 'player' }],
  session: { id: 'session-1', number: 1, title: 'The old mill', status: 'active', startedAt: '2026-10-31T10:00:00.000Z', endedAt: null }, ...(role === 'dm' ? { dm: { invites: [] } } : {}),
} as RoomSnapshot);
let fake: ReturnType<typeof installFakeApi>, socket: FakeSocket;
const commands = () => fake.requests.map((r) => r.body as { kind?: string; targetId?: string; payload?: unknown; expectedRevision?: number } | undefined).filter((r) => r?.kind);
beforeEach(() => { localStorage.clear(); setLocale('en'); socket = new FakeSocket(); socket.connected = true; configureRoomStore({ createSocket: () => socket }); window.history.replaceState(null, '', '/campaigns/camp-1/session'); });
afterEach(() => { fake?.restore(); resetRoomStore(); });

describe('session journal', () => {
  it('lets_the_dm_run_the_session_and_autosave_the_recap', async () => {
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot('dm') }, sessions: [{ id: 'session-1', number: 1, title: 'The old mill', status: 'active', startedAt: '2026-10-31T10:00:00.000Z', endedAt: null }], sessionViews: { 'session-1': view(session()) } });
    const user = userEvent.setup(); render(<App />);
    const page = await screen.findByRole('region', { name: 'Session 1: The old mill' });
    expect(within(page).getByText('Play time: 45 min')).toBeTruthy();
    await user.click(within(page).getByRole('button', { name: 'Pause session' }));
    await waitFor(() => expect(commands().at(-1)).toMatchObject({ kind: 'session.pause', targetId: 'session-1' }));
    const secret = within(page).getByRole('textbox', { name: 'DM-only notes' });
    expect((secret as HTMLTextAreaElement).value).toBe('Secret: the miller is a cultist.');
    await user.type(within(page).getByRole('textbox', { name: 'Recap for the party' }), ' They found a key.');
    expect(within(page).getByText('Unsaved changes')).toBeTruthy();
    await waitFor(() => expect(commands().at(-1)).toMatchObject({ kind: 'session.recap', targetId: 'session-1', expectedRevision: 4,
      payload: { shared: 'The party reached the mill. They found a key.', dm: 'Secret: the miller is a cultist.' } }), { timeout: 4000 });
    expect(await within(page).findByText('Saved')).toBeTruthy();
    expect(within(page).getByText('Can Shield stop bonus damage?')).toBeTruthy();
    await user.click(within(page).getByRole('checkbox', { name: 'Checked: Can Shield stop bonus damage?' }));
    await waitFor(() => expect(commands().at(-1)).toMatchObject({ kind: 'session.rule-note-resolve', payload: { noteId: 'r1', resolved: true } }));
  });

  it('shows_players_the_shared_recap_journal_and_localized_log', async () => {
    const playerSession = session({ recap: { shared: 'The party reached the mill.' }, ruleNotes: undefined });
    fake = installFakeApi({ snapshots: { 'camp-1': snapshot('player') }, sessions: [], sessionViews: { 'session-1': view(playerSession) } });
    const user = userEvent.setup(); render(<App />);
    const page = await screen.findByRole('region', { name: 'Session 1: The old mill' });
    expect(within(page).getByText('The party reached the mill.')).toBeTruthy();
    expect(within(page).queryByRole('textbox', { name: 'DM-only notes' })).toBeNull();
    expect(within(page).queryByRole('button', { name: 'Pause session' })).toBeNull();
    expect(within(page).getByText('Combat: next turn')).toBeTruthy();
    await user.type(within(page).getByRole('textbox', { name: 'Journal entry' }), 'We should check the cellar.');
    await user.selectOptions(within(page).getByRole('combobox', { name: 'Who can read it' }), 'private');
    await user.click(within(page).getByRole('button', { name: 'Add to journal' }));
    await waitFor(() => expect(commands().at(-1)).toMatchObject({ kind: 'session.journal', targetId: 'session-1', payload: { text: 'We should check the cellar.', visibility: 'private' } }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'id');
    expect(await within(screen.getByRole('region', { name: 'Sesi 1: The old mill' })).findByText('Combat: giliran berikutnya')).toBeTruthy();
  });
});
