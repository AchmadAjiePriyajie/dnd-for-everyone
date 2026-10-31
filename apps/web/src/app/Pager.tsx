import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export const PAGE_SIZE = 20;

/** Client-side paging over data already loaded; falls back to page 1 when the list shrinks below it. */
export function usePaged<T>(items: T[], pageSize = PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  useEffect(() => { if (page > pages) setPage(1); }, [page, pages]);
  const current = Math.min(page, pages);
  return { page: page > pages ? 1 : current, pages, items: items.slice(((page > pages ? 1 : current) - 1) * pageSize, (page > pages ? 1 : current) * pageSize), setPage };
}

export function Pager({ page, pages, onPage, label }: { page: number; pages: number; onPage(page: number): void; label: string }) {
  const { t } = useTranslation();
  if (pages <= 1) return null;
  return <nav className="pager" aria-label={t('pager.label', { label })}>
    <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('pager.previous')}</button>
    <span className="small">{t('pager.page', { page, pages })}</span>
    <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t('pager.next')}</button>
  </nav>;
}
