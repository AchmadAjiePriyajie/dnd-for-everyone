import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Id } from '#shared/contracts';
import { Link, routePath } from '../../app/router';
import { ReferenceReader } from '../reference/ReferenceReader';
import { SearchPanel } from '../reference/SearchPanel';

/** Rules lookup inside the combat screen; the full reader stays one link away. */
export function RulesPanel({ campaignId }: { campaignId: Id }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [entryId, setEntryId] = useState<Id | null>(null);
  const full = (id: Id) => `${routePath.reference(campaignId)}?entry=${encodeURIComponent(id)}`;
  return <div className="rules-panel">
    {entryId ? <>
      <button type="button" onClick={() => setEntryId(null)}>{t('screen.backToSearch')}</button>
      <ReferenceReader entryId={entryId} campaignId={campaignId} bookmarked={false} onToggleBookmark={() => undefined} onOpen={setEntryId} refHref={full} />
      <Link href={full(entryId)}>{t('screen.openFullReference')}</Link>
    </> : <SearchPanel query={query} onQueryChange={setQuery} campaignId={campaignId} onOpen={setEntryId} />}
  </div>;
}
