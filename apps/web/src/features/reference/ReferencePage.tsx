import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiError } from '#shared/access';
import type { Id } from '#shared/contracts';
import { api } from '../../app/api';
import { Icon } from '../../app/icons';
import { Link, routePath } from '../../app/router';
import { ErrorMessage, toApiError, useSession } from '../../app/ui';
import { EntryTitle, ReferenceReader } from './ReferenceReader';
import { SearchPanel } from './SearchPanel';

/** Bantuan cepat untuk pemula sebelum mencari apa pun. */
const QUICK_HELP: Id[] = ['guide.your-turn', 'rule.combat', 'rule.actions', 'rule.hit-points', 'rule.d20-test'];

const entryFromLocation = (): Id | null => new URLSearchParams(window.location.search).get('entry');

/** Halaman referensi: cari, baca, bookmark. Membaca aturan tidak pernah menjalankan aksi permainan. */
export function ReferencePage({ campaignId }: { campaignId?: Id }) {
  const { t } = useTranslation();
  const session = useSession();
  const [query, setQuery] = useState('');
  const [entryId, setEntryId] = useState<Id | null>(entryFromLocation);
  const [bookmarks, setBookmarks] = useState<Id[]>([]);
  const [error, setError] = useState<ApiError | null>(null);

  const base = routePath.reference(campaignId);
  const refHref = useCallback((id: Id) => `${base}?entry=${encodeURIComponent(id)}`, [base]);

  const fail = useCallback(
    (cause: unknown) => {
      const apiError = toApiError(cause);
      if (apiError.code === 'UNAUTHENTICATED') session.expire();
      setError(apiError);
    },
    [session],
  );

  useEffect(() => {
    api.bookmarks().then(setBookmarks, fail);
  }, [fail]);

  const open = useCallback(
    (id: Id) => {
      setEntryId(id);
      window.history.replaceState(null, '', refHref(id));
    },
    [refHref],
  );

  const toggleBookmark = async (id: Id, add: boolean) => {
    setError(null);
    try {
      await (add ? api.addBookmark(id) : api.removeBookmark(id));
      setBookmarks(await api.bookmarks());
    } catch (cause) {
      fail(cause);
    }
  };

  return (
    <div className="reference-page">
      {campaignId && (
        <Link href={routePath.campaign(campaignId)} className="back-link">
          <Icon name="arrowLeft" />
          {t('reference.backToRoom')}
        </Link>
      )}
      <ErrorMessage error={error} />
      <div className="reference-layout">
        <aside className="reference-side">
          <SearchPanel query={query} onQueryChange={setQuery} campaignId={campaignId} onOpen={open} />
          <section className="card" aria-labelledby="reference-bookmarks">
            <h2 id="reference-bookmarks">
              <Icon name="check" />
              {t('reference.bookmarks')}
            </h2>
            {bookmarks.length === 0 ? (
              <p className="hint">{t('reference.noBookmarks')}</p>
            ) : (
              <ul className="reference-links" aria-label={t('reference.bookmarks')}>
                {bookmarks.map((id) => (
                  <li key={id}>
                    <button type="button" className="link-button" onClick={() => open(id)}>
                      <EntryTitle id={id} campaignId={campaignId} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
        <div className="reference-main">
          {entryId ? (
            <ReferenceReader
              entryId={entryId}
              campaignId={campaignId}
              bookmarked={bookmarks.includes(entryId)}
              onToggleBookmark={(id, add) => void toggleBookmark(id, add)}
              onOpen={open}
              refHref={refHref}
            />
          ) : (
            <section className="card" aria-labelledby="reference-help">
              <h2 id="reference-help">
                <Icon name="d20" />
                {t('reference.quickHelp')}
              </h2>
              <p className="muted">{t('reference.intro')}</p>
              <ul className="reference-links">
                {QUICK_HELP.map((id) => (
                  <li key={id}>
                    <a
                      href={refHref(id)}
                      onClick={(event) => {
                        event.preventDefault();
                        open(id);
                      }}
                    >
                      <EntryTitle id={id} campaignId={campaignId} />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
