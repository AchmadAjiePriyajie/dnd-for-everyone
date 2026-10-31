import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReferenceEntryView, SearchHit } from '#shared/reference';
import { App } from '../../app/App';
import { setLocale } from '../../app/i18n';
import { resetRoomStore } from '../../app/room-store';
import { installFakeApi } from '../../test/fake-api';

const srd = { kind: 'srd', ruleset: 'srd-5.2.1-2024', section: 'Rules Glossary', page: 186, license: 'CC-BY-4.0' } as const;

const hit = (over: Partial<SearchHit> & Pick<SearchHit, 'entryId' | 'title'>): SearchHit => ({
  entryKind: 'rule',
  originalTitle: over.title,
  summary: null,
  whenToUse: null,
  relatedIds: [],
  source: srd,
  translation: 'translated',
  ...over,
});

const hp = hit({
  entryId: 'rule.hit-points',
  title: 'Hit Points',
  whenToUse: 'Lihat saat karaktermu menerima damage atau disembuhkan.',
  relatedIds: ['rule.healing'],
});
const guide = hit({ entryId: 'guide.your-turn', entryKind: 'guide', title: 'Apa yang bisa saya lakukan?', originalTitle: 'What can I do on my turn?', source: { kind: 'guide' } });
const homebrew = hit({
  entryId: 'homebrew.ember-blade',
  entryKind: 'campaign',
  title: 'Ember Blade',
  translation: 'fallback',
  source: { kind: 'campaign', campaignId: 'camp-1', provider: 'homebrew' },
});

const entries: Record<string, ReferenceEntryView> = {
  'rule.hit-points': {
    ...hp,
    locale: 'id',
    body: 'Hit Points mengukur daya tahan. Lihat [penyembuhan](ref:rule.healing).\n\n<script>window.pwned = true</script>\n\n- **0 HP:** kamu jatuh.',
  },
  'rule.healing': { ...hit({ entryId: 'rule.healing', title: 'Penyembuhan', originalTitle: 'Healing' }), locale: 'id', body: 'Memulihkan Hit Points.' },
};

let fake: ReturnType<typeof installFakeApi>;

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/reference');
  setLocale('en');
});

afterEach(() => {
  fake?.restore();
  resetRoomStore();
});

describe('reference reader', () => {
  it('searches_reads_and_bookmarks_without_spending_anything', async () => {
    fake = installFakeApi({
      reference: {
        search: (q) => (q === 'nyawa' ? [hp, guide, homebrew] : []),
        entries,
        bookmarks: [],
      },
    });
    const user = userEvent.setup();
    render(<App />);

    const box = await screen.findByRole('searchbox', { name: 'Search rules and terms' });
    await user.type(box, 'zzqxjv');
    expect(await screen.findByText('No results. Try another word, or the English term.')).toBeTruthy();

    await user.clear(box);
    await user.type(box, 'nyawa');
    const results = await screen.findByRole('list', { name: 'Search results' });
    await waitFor(() => expect(within(results).getAllByRole('listitem')).toHaveLength(3));
    // Panduan aplikasi dan teks EN fallback diberi label yang jelas.
    expect(within(results).getByText('App guide (not SRD)')).toBeTruthy();
    expect(within(results).getByText('English text')).toBeTruthy();

    // Ganti bahasa tidak menghapus query.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'id');
    const boxId = screen.getByRole('searchbox', { name: 'Cari aturan dan istilah' });
    expect((boxId as HTMLInputElement).value).toBe('nyawa');

    await user.click(within(screen.getByRole('list', { name: 'Hasil pencarian' })).getByRole('button', { name: /Hit Points/ }));
    const reader = await screen.findByRole('article', { name: 'Hit Points' });
    expect(within(reader).getByText('Lihat saat karaktermu menerima damage atau disembuhkan.')).toBeTruthy();
    expect(within(reader).getByText(/SRD 5\.2\.1 · Rules Glossary · hlm\. 186/)).toBeTruthy();
    // Markdown ditampilkan sebagai teks: tidak ada elemen script/HTML mentah.
    expect(reader.querySelector('script')).toBeNull();
    expect(within(reader).getByText('<script>window.pwned = true</script>')).toBeTruthy();
    expect(within(reader).getByText('0 HP:').tagName).toBe('STRONG');

    // Tautan ref membuka entri terkait di reader, bukan aksi permainan.
    await user.click(within(reader).getByRole('link', { name: 'penyembuhan' }));
    expect(await screen.findByRole('article', { name: 'Penyembuhan' })).toBeTruthy();
    expect(fake.requests.some((r) => r.path.includes('/commands'))).toBe(false);

    // Bookmark tersimpan di server dan muncul di daftar bookmark.
    await user.click(screen.getByRole('button', { name: 'Simpan bookmark' }));
    await waitFor(() => expect(fake.requests).toContainEqual({ method: 'PUT', path: '/api/reference/bookmarks/rule.healing', body: undefined }));
    expect(await within(screen.getByRole('list', { name: 'Bookmark' })).findByRole('button', { name: 'Penyembuhan' })).toBeTruthy();
  });
});
