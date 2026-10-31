import { useEffect, useId, useState } from 'react';
import { Pager, usePaged } from '../../app/Pager';
import { useTranslation } from 'react-i18next';
import type { ApiError } from '#shared/access';
import type { Id, Locale } from '#shared/contracts';
import type { SearchHit } from '#shared/reference';
import { api } from '../../app/api';
import { Icon } from '../../app/icons';
import { ErrorMessage, toApiError } from '../../app/ui';
import { HitBadges } from './ReferenceReader';

const DEBOUNCE_MS = 200;

/** Kotak cari istilah EN/ID; query dipegang parent agar tetap ada saat bahasa diganti. */
export function SearchPanel({
  query,
  onQueryChange,
  campaignId,
  onOpen,
}: {
  query: string;
  onQueryChange(query: string): void;
  campaignId?: Id;
  onOpen(entryId: Id): void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as Locale;
  const inputId = useId();
  const [state, setState] = useState<{ hits: SearchHit[]; query: string; error: ApiError | null }>({ hits: [], query: '', error: null });

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setState({ hits: [], query: '', error: null });
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      api.referenceSearch(trimmed, locale, campaignId).then(
        (hits) => active && setState({ hits, query: trimmed, error: null }),
        (error) => active && setState({ hits: [], query: trimmed, error: toApiError(error) }),
      );
    }, DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, locale, campaignId]);

  const settled = state.query === query.trim();
  const hits = usePaged(state.hits);
  return (
    <section className="card reference-search" aria-labelledby={`${inputId}-heading`}>
      <h2 id={`${inputId}-heading`}>
        <Icon name="scroll" />
        {t('reference.title')}
      </h2>
      <div className="field">
        <label htmlFor={inputId}>{t('reference.searchLabel')}</label>
        <input
        id={inputId}
        type="search"
        value={query}
        autoComplete="off"
        placeholder={t('reference.searchPlaceholder')}
        aria-describedby={`${inputId}-hint`}
        onChange={(event) => onQueryChange(event.target.value)}
      />
        <p id={`${inputId}-hint`} className="hint">
          {t('reference.searchHint')}
        </p>
      </div>
      <ErrorMessage error={state.error} />
      {settled && state.query && !state.error && state.hits.length === 0 && (
        <p className="muted" role="status">
          {t('reference.noResults')}
        </p>
      )}
      {state.hits.length > 0 && (
        <ul className="reference-results" aria-label={t('reference.results')}>
          {hits.items.map((hit) => (
            <li key={hit.entryId}>
              <button type="button" className="reference-hit" onClick={() => onOpen(hit.entryId)}>
                <span className="reference-hit-title">{hit.title}</span>
                {hit.originalTitle !== hit.title && (
                  <span className="muted small" lang="en">
                    {hit.originalTitle}
                  </span>
                )}
                {(hit.whenToUse ?? hit.summary) && <span className="small">{hit.whenToUse ?? hit.summary}</span>}
              </button>
              <HitBadges hit={hit} />
            </li>
          ))}
        </ul>
      )}
      <Pager label={t('reference.results')} page={hits.page} pages={hits.pages} onPage={hits.setPage} />
    </section>
  );
}
