import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NoteView } from '#shared/notes';
import type { RoomSnapshot } from '#shared/room';
import { App } from '../../app/App';
import { setLocale } from '../../app/i18n';
import { configureRoomStore, resetRoomStore } from '../../app/room-store';
import { FakeSocket, installFakeApi } from '../../test/fake-api';
import { generateNpcName } from './names';

const members: RoomSnapshot['members'] = [
  { accountId: 'acc-dm', username: 'dungeon_master', role: 'dm' },
  { accountId: 'acc-alice', username: 'alice', role: 'player' },
];
const dmSnapshot = (over: Partial<RoomSnapshot> = {}): RoomSnapshot => ({
  campaignId: 'camp-1',
  eventSequence: 1,
  campaign: { id: 'camp-1', title: 'Lost Mine', ruleset: 'srd-5.2.1-2024' },
  you: { accountId: 'acc-dm', role: 'dm' },
  members,
  characters: [],
  notes: [{ id: 'note-1', kind: 'npc', title: 'Sildar', revision: 1, updatedAt: '', visibility: { mode: 'dm' } }],
  dm: { invites: [] },
  ...over,
});
const sildar: NoteView = {
  id: 'note-1',
  kind: 'npc',
  title: 'Sildar',
  body: 'A loyal knight.',
  scene: null,
  quest: null,
  links: [],
  revision: 1,
  updatedAt: '',
  dmNotes: 'Secretly hunting the Black Spider.',
  visibility: { mode: 'dm' },
};

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

describe('campaign notes', () => {
  it('keeps_draft_when_autosave_conflicts', async () => {
    fake = installFakeApi({
      snapshots: { 'camp-1': dmSnapshot() },
      notes: { 'note-1': sildar },
      onCommand: (body) => (body.kind === 'note.save' ? new Response(JSON.stringify({ code: 'STALE_REVISION', params: { currentRevision: 2 } }), { status: 409, headers: { 'content-type': 'application/json' } }) : undefined),
    });
    window.history.replaceState(null, '', '/campaigns/camp-1/notes?note=note-1');
    const user = userEvent.setup();
    render(<App />);

    // DM melihat catatan DM; lalu mengedit.
    expect(await screen.findByText('Secretly hunting the Black Spider.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Edit note' }));
    const body = screen.getByRole('textbox', { name: 'Text (Markdown)' });
    await user.type(body, ' He owes the party.');

    // Autosave membawa revisi yang dibuka; konflik tidak membuang ketikan.
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Not saved: changed elsewhere')).toBeTruthy();
    expect((body as HTMLTextAreaElement).value).toBe('A loyal knight. He owes the party.');
    expect(commands().find((c) => c.kind === 'note.save')).toMatchObject({ expectedRevision: 1 });
  });

  it('shares_a_handout_with_one_player', async () => {
    fake = installFakeApi({ snapshots: { 'camp-1': dmSnapshot({ notes: [] }) } });
    window.history.replaceState(null, '', '/campaigns/camp-1/notes');
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kind' }), 'handout');
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Torn map');
    await user.click(screen.getByRole('checkbox', { name: 'alice' }));
    await waitFor(() => {
      const save = commands().filter((c) => c.kind === 'note.save').at(-1);
      expect(save?.payload).toMatchObject({ draft: { kind: 'handout', title: 'Torn map', visibility: { mode: 'members', accountIds: ['acc-alice'] } } });
      // Catatan baru tidak membawa revisi.
      expect(save?.expectedRevision).toBeUndefined();
    });
    expect(await screen.findByText('All changes saved')).toBeTruthy();
  });

  it('renders_shared_markdown_without_running_html', async () => {
    fake = installFakeApi({
      account: { accountId: 'acc-alice', username: 'alice', locale: null, password: 'correct horse battery' },
      snapshots: {
        'camp-1': dmSnapshot({ you: { accountId: 'acc-alice', role: 'player' }, dm: undefined, notes: [{ id: 'note-2', kind: 'ruling', title: 'Grapple', revision: 1, updatedAt: '' }] }),
      },
      notes: { 'note-2': { ...sildar, id: 'note-2', kind: 'ruling', title: 'Grapple', body: '<script>alert(1)</script> **Advantage**', dmNotes: undefined, visibility: undefined } },
    });
    window.history.replaceState(null, '', '/campaigns/camp-1/notes?note=note-2');
    render(<App />);

    const article = await screen.findByRole('article', { name: 'Grapple' });
    expect(within(article).getByText('Advantage').tagName).toBe('STRONG');
    expect(article.textContent).toContain('<script>alert(1)</script>');
    expect(article.querySelector('script')).toBeNull();
    // Player tidak melihat tombol tulis DM.
    expect(screen.queryByRole('button', { name: 'New note' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Party journal' })).toBeTruthy();
  });

  it('shows_party_cheat_sheet_to_dm', async () => {
    fake = installFakeApi({
      snapshots: {
        'camp-1': dmSnapshot({
          dm: {
            invites: [],
            cheatSheet: [
              {
                characterId: 'char-1',
                name: 'Brakka',
                ownerAccountId: 'acc-alice',
                armorClass: 16,
                hitPoints: { current: 9, max: 13, temp: 2 },
                passivePerception: 13,
                resources: [{ key: 'class.fighter/second-wind', name: 'Second Wind', remaining: 2, max: 2 }],
                concentration: null,
              },
            ],
          },
        }),
      },
    });
    window.history.replaceState(null, '', '/campaigns/camp-1');
    render(<App />);
    const sheet = await screen.findByRole('region', { name: 'Party cheat sheet' });
    const row = within(sheet).getByRole('row', { name: /Brakka/ });
    expect(within(row).getByText('9/13 (+2)')).toBeTruthy();
    expect(within(row).getByText('Second Wind 2/2')).toBeTruthy();
  });

  it('generates_local_npc_names', () => {
    const sequence = [0, 0, 0, 0, 0];
    expect(generateNpcName(() => sequence.shift() ?? 0)).toBe('Albric Ashbrook');
    expect(generateNpcName(() => 0.999)).toBe('Zanunwyn Wolfwood');
  });
});
