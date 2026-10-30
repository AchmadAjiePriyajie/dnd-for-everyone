import { type FormEvent, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiError, CampaignSummary } from '#shared/access';
import { api } from '../../app/api';
import { Link, navigate, routePath } from '../../app/router';
import { ErrorMessage, toApiError, useSession } from '../../app/ui';

/** Daftar campaign akun ini, buat campaign baru (jadi DM), atau gabung dengan undangan. */
export function Lobby() {
  const { t } = useTranslation();
  const session = useSession();
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [title, setTitle] = useState('');
  const [invite, setInvite] = useState('');
  const [createError, setCreateError] = useState<ApiError | null>(null);
  const [joinError, setJoinError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState<'create' | 'join' | null>(null);
  const ids = { title: useId(), invite: useId(), heading: useId() };

  useEffect(() => {
    let active = true;
    api.campaigns().then(
      (list) => active && setCampaigns(list),
      (error) => {
        if (!active) return;
        const apiError = toApiError(error);
        if (apiError.code === 'UNAUTHENTICATED') session.expire();
        else setLoadError(apiError);
      },
    );
    return () => {
      active = false;
    };
  }, [session]);

  const handle = (kind: 'create' | 'join') => async (event: FormEvent) => {
    event.preventDefault();
    const setError = kind === 'create' ? setCreateError : setJoinError;
    setPending(kind);
    setError(null);
    try {
      const campaignId =
        kind === 'create' ? (await api.createCampaign(title)).id : (await api.joinCampaign(invite)).campaignId;
      navigate(routePath.campaign(campaignId));
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.code === 'UNAUTHENTICATED') session.expire();
      setError(apiError);
      setPending(null);
    }
  };

  return (
    <div className="lobby">
      <section className="card" aria-labelledby={ids.heading}>
        <h1 id={ids.heading}>{t('lobby.title')}</h1>
        <ErrorMessage error={loadError} />
        {campaigns === null && !loadError && <p className="muted">{t('app.loading')}</p>}
        {campaigns?.length === 0 && <p className="muted">{t('lobby.empty')}</p>}
        {campaigns && campaigns.length > 0 && (
          <ul className="campaign-list">
            {campaigns.map((campaign) => (
              <li key={campaign.id}>
                <Link href={routePath.campaign(campaign.id)} className="campaign-link">
                  <span className="campaign-title">{campaign.title}</span>
                  <span className={`badge badge-${campaign.role}`}>
                    {campaign.role === 'dm' ? t('lobby.roleDm') : t('lobby.rolePlayer')}
                  </span>
                  <span className="muted small">{t('lobby.ruleset', { ruleset: campaign.ruleset })}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="lobby-forms">
        <section className="card">
          <h2>{t('lobby.createHeading')}</h2>
          <form onSubmit={handle('create')}>
            <div className="field">
              <label htmlFor={ids.title}>{t('lobby.campaignTitle')}</label>
              <input id={ids.title} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <ErrorMessage error={createError} />
            <button type="submit" className="primary" disabled={pending !== null || !title.trim()} aria-busy={pending === 'create'}>
              {pending === 'create' ? t('lobby.creating') : t('lobby.create')}
            </button>
          </form>
        </section>
        <section className="card">
          <h2>{t('lobby.joinHeading')}</h2>
          <form onSubmit={handle('join')}>
            <div className="field">
              <label htmlFor={ids.invite}>{t('lobby.inviteCode')}</label>
              <input
                id={ids.invite}
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                required
              />
            </div>
            <ErrorMessage error={joinError} />
            <button type="submit" disabled={pending !== null || !invite.trim()} aria-busy={pending === 'join'}>
              {pending === 'join' ? t('lobby.joining') : t('lobby.join')}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
