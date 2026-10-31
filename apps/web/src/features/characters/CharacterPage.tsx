import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiError } from '#shared/access';
import type { CharacterOptions } from '#shared/characters';
import type { Id, Locale } from '#shared/contracts';
import { api } from '../../app/api';
import { Icon } from '../../app/icons';
import { useRoomEntry } from '../../app/room-store';
import { Link, routePath } from '../../app/router';
import { ErrorMessage, toApiError, useSession } from '../../app/ui';
import { CharacterSheet } from './CharacterSheet';
import { CharacterWizard } from './CharacterWizard';
import { DmCharacterTools } from './DmCharacterTools';
import { FeatureList } from './FeatureList';
import { Inventory, Vitals } from './Inventory';
import { LevelUpWizard } from './LevelUpWizard';
import { Spellbook } from './Spellbook';
import type { CharacterView } from './types';

/** Draft milik sendiri dibuka di wizard; selain itu (atau setelah final) tampil sebagai sheet. */
export function CharacterPage({ campaignId, characterId }: { campaignId: Id; characterId: Id }) {
  const { t, i18n } = useTranslation();
  const session = useSession();
  const locale = i18n.language as Locale;
  // Memantau room menjaga koneksi realtime; command hanya dikirim saat tersambung.
  const room = useRoomEntry(campaignId)?.snapshot;
  const [view, setView] = useState<CharacterView | null>(null);
  const [options, setOptions] = useState<CharacterOptions | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const fail = useCallback(
    (cause: unknown) => {
      const apiError = toApiError(cause);
      if (apiError.code === 'UNAUTHENTICATED') session.expire();
      setError(apiError);
    },
    [session],
  );

  const reload = useCallback(async () => {
    setView(await api.character(campaignId, characterId, locale));
  }, [campaignId, characterId, locale]);

  // Muat ulang saat room berubah (mis. koreksi atau transfer oleh DM) agar sheet tidak usang.
  const sequence = room?.eventSequence;
  useEffect(() => {
    reload().catch(fail);
  }, [reload, fail, sequence]);

  useEffect(() => {
    api.characterOptions(campaignId, locale).then(setOptions, fail);
  }, [campaignId, locale, fail]);

  const back = (
    <Link href={routePath.campaign(campaignId)} className="back-link">
      <Icon name="arrowLeft" />
      {t('reference.backToRoom')}
    </Link>
  );
  if (error) {
    return (
      <div className="room">
        {back}
        <ErrorMessage error={error} />
      </div>
    );
  }
  if (!view || !options) {
    return (
      <div className="room">
        {back}
        <p className="muted">{t('app.loading')}</p>
      </div>
    );
  }
  const owner = view.character.ownerAccountId === session.account.accountId;
  const editable = view.character.status === 'draft' && owner;
  const isDm = room?.you.role === 'dm';
  const live = view.character.status === 'final' && view.character.resources?.initialized;
  const canEdit = Boolean(live) && (owner || isDm);
  return (
    <div className="room">
      {back}
      {editable ? (
        <CharacterWizard view={view} options={options} campaignId={campaignId} reload={reload} />
      ) : (
        <>
          <CharacterSheet view={view} options={options} />
          {live && (
            <div className="sheet-columns">
              <Vitals view={view} campaignId={campaignId} reload={reload} canEdit={canEdit} isDm={isDm} />
              <Inventory view={view} options={options} campaignId={campaignId} reload={reload} canEdit={canEdit} />
            </div>
          )}
          {live && <Spellbook view={view} options={options} campaignId={campaignId} reload={reload} canEdit={canEdit} />}
          {live && (owner || isDm) && <LevelUpWizard view={view} options={options} campaignId={campaignId} reload={reload} owner={owner} isDm={isDm} />}
          <FeatureList
            view={view}
            options={options}
            campaignId={campaignId}
            reload={reload}
            canUse={owner && view.character.status === 'final'}
            isDm={isDm}
          />
        </>
      )}
      {isDm && room && <DmCharacterTools view={view} members={room.members} campaignId={campaignId} reload={reload} />}
    </div>
  );
}
