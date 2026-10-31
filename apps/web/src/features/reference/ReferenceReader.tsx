import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiError } from '#shared/access';
import type { Id, Locale } from '#shared/contracts';
import type { ReferenceEntryView, SearchHit } from '#shared/reference';
import { api } from '../../app/api';
import { Icon } from '../../app/icons';
import { ErrorMessage, toApiError } from '../../app/ui';
import { Markdown } from './Markdown';

/** Label asal/terjemahan: panduan aplikasi, entri campaign, dan teks EN fallback. */
export function HitBadges({ hit }: { hit: SearchHit }) {
  const { t } = useTranslation();
  return (
    <span className="reference-badges">
      {hit.source.kind === 'guide' && <span className="badge">{t('reference.badgeGuide')}</span>}
      {hit.source.kind === 'campaign' && <span className="badge">{t('reference.badgeCampaign')}</span>}
      {hit.translation === 'fallback' && (
        <span className="badge" lang="en">
          {t('reference.badgeFallback')}
        </span>
      )}
    </span>
  );
}

const titleCache = new Map<string, Promise<string>>();

/** Judul entri pada locale aktif (di-cache), untuk tautan terkait dan bookmark. */
export function EntryTitle({ id, campaignId }: { id: Id; campaignId?: Id }) {
  const { i18n } = useTranslation();
  const locale = i18n.language as Locale;
  const [title, setTitle] = useState<string>(id);
  useEffect(() => {
    const key = `${locale}|${campaignId ?? ''}|${id}`;
    let pending = titleCache.get(key);
    if (!pending) {
      pending = api.referenceEntry(id, locale, campaignId).then((entry) => entry.title);
      pending.catch(() => titleCache.delete(key));
      titleCache.set(key, pending);
    }
    let active = true;
    pending.then(
      (value) => active && setTitle(value),
      () => active && setTitle(id),
    );
    return () => {
      active = false;
    };
  }, [id, locale, campaignId]);
  return <>{title}</>;
}

/** Isi entri: teks lokal, judul asli EN, sumber/atribusi, bantuan singkat dan entri terkait. */
export function ReferenceReader({
  entryId,
  campaignId,
  bookmarked,
  onToggleBookmark,
  onOpen,
  refHref,
}: {
  entryId: Id;
  campaignId?: Id;
  bookmarked: boolean;
  onToggleBookmark(entryId: Id, bookmarked: boolean): void;
  onOpen(entryId: Id): void;
  refHref(entryId: Id): string;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as Locale;
  const headingId = useId();
  const [state, setState] = useState<{ entry: ReferenceEntryView | null; error: ApiError | null }>({ entry: null, error: null });

  useEffect(() => {
    let active = true;
    api.referenceEntry(entryId, locale, campaignId).then(
      (entry) => active && setState({ entry, error: null }),
      (error) => active && setState({ entry: null, error: toApiError(error) }),
    );
    return () => {
      active = false;
    };
  }, [entryId, locale, campaignId]);

  if (state.error) return <ErrorMessage error={state.error} />;
  const entry = state.entry?.entryId === entryId ? state.entry : null;
  if (!entry) return <p className="muted">{t('app.loading')}</p>;

  const source = entry.source;
  return (
    <article className="card reference-reader" aria-labelledby={headingId}>
      <header className="reference-reader-head">
        <div>
          <h2 id={headingId}>
            <Icon name="scroll" />
            {entry.title}
          </h2>
          {entry.originalTitle !== entry.title && (
            <p className="muted small">
              {t('reference.originalTitle')} <span lang="en">{entry.originalTitle}</span>
            </p>
          )}
          <HitBadges hit={entry} />
        </div>
        <button
          type="button"
          className="small"
          aria-pressed={bookmarked}
          aria-label={bookmarked ? t('reference.bookmarkRemove') : t('reference.bookmarkAdd')}
          onClick={() => onToggleBookmark(entryId, !bookmarked)}
        >
          <Icon name={bookmarked ? 'check' : 'plus'} />
          {bookmarked ? t('reference.bookmarked') : t('reference.bookmark')}
        </button>
      </header>
      {entry.whenToUse && (
        <p className="reference-when">
          <strong>{t('reference.whenToUse')}</strong> {entry.whenToUse}
        </p>
      )}
      <div className="reference-body" lang={entry.translation === 'fallback' ? 'en' : locale}>
        <Markdown text={entry.body} refHref={refHref} onRef={onOpen} />
      </div>
      {entry.relatedIds.length > 0 && (
        <nav className="reference-related" aria-label={t('reference.related')}>
          <h3>{t('reference.related')}</h3>
          <ul>
            {entry.relatedIds.map((id) => (
              <li key={id}>
                <a
                  href={refHref(id)}
                  onClick={(event) => {
                    event.preventDefault();
                    onOpen(id);
                  }}
                >
                  <EntryTitle id={id} campaignId={campaignId} />
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <footer className="source-line">
        {source.kind === 'srd' && t('reference.sourceSrd', { section: source.section, page: source.page })}
        {source.kind === 'guide' && t('reference.sourceGuide')}
        {source.kind === 'campaign' && t('reference.sourceCampaign')}
        {entry.translation === 'translated' && source.kind === 'srd' && <> · {t('reference.translatedNote')}</>}
      </footer>
    </article>
  );
}
