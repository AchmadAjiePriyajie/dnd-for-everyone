import { type FormEvent, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiError, CampaignSummary } from '#shared/access';
import type { Locale } from '#shared/contracts';
import { api } from '../../app/api';
import { Icon, initials } from '../../app/icons';
import { Link, navigate, routePath } from '../../app/router';
import { ErrorMessage, toApiError, useSession } from '../../app/ui';

/** Daftar campaign akun ini, buat campaign baru (jadi DM), atau gabung dengan undangan. */
export function Lobby() {
  const { t, i18n } = useTranslation();
  const session = useSession();
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [title, setTitle] = useState('');
  const [invite, setInvite] = useState('');
  const [createError, setCreateError] = useState<ApiError | null>(null);
  const [joinError, setJoinError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState<'create' | 'join' | 'tutorial' | null>(null);
  const [tutorialError, setTutorialError] = useState<ApiError | null>(null);
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

  const startTutorial = async () => {
    setPending('tutorial');
    setTutorialError(null);
    try {
      navigate(routePath.campaign((await api.createTutorial(i18n.language as Locale)).id));
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.code === 'UNAUTHENTICATED') session.expire();
      setTutorialError(apiError);
      setPending(null);
    }
  };

  return (
    <div className="lobby">
      <section className="lobby-main" aria-labelledby={ids.heading}>
        <header className="page-header">
          <h1 id={ids.heading}>{t('lobby.title')}</h1>
          <p className="muted">{t('lobby.subtitle')}</p>
        </header>
        <ErrorMessage error={loadError} />
        {campaigns === null && !loadError && (
          <ul className="campaign-grid" aria-busy="true" aria-label={t('app.loading')}>
            <li className="campaign-card skeleton" />
            <li className="campaign-card skeleton" />
          </ul>
        )}
        {campaigns?.length === 0 && (
          <div className="empty-state">
            <Icon name="scroll" className="empty-icon" />
            <p className="empty-title">{t('lobby.emptyTitle')}</p>
            <p className="muted">{t('lobby.empty')}</p>
          </div>
        )}
        {campaigns && campaigns.length > 0 && (
          <ul className="campaign-grid">
            {campaigns.map((campaign) => (
              <li key={campaign.id}>
                <Link href={routePath.campaign(campaign.id)} className="campaign-card">
                  <span className="sigil" aria-hidden="true">
                    {initials(campaign.title)}
                  </span>
                  <span className="campaign-body">
                    <span className="campaign-title">{campaign.title}</span>
                    <span className="campaign-meta">
                      <span className={`badge badge-${campaign.role}`}>
                        <Icon name={campaign.role === 'dm' ? 'crown' : 'user'} />
                        {campaign.role === 'dm' ? t('lobby.roleDm') : t('lobby.rolePlayer')}
                      </span>
                      <span className="muted small">{t('lobby.ruleset', { ruleset: campaign.ruleset })}</span>
                    </span>
                  </span>
                  <Icon name="chevronRight" className="card-chevron" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="lobby-side">
        <section className="card tutorial-start">
          <h2><Icon name="scroll" />{t('tutorial.startHeading')}</h2>
          <p className="small">{t('tutorial.startBody')}</p>
          <ErrorMessage error={tutorialError} />
          <button type="button" className="primary block" disabled={pending !== null} aria-busy={pending === 'tutorial'} onClick={() => void startTutorial()}>
            {t('tutorial.start')}
          </button>
        </section>
        <section className="card">
          <h2>
            <Icon name="plus" />
            {t('lobby.createHeading')}
          </h2>
          <form onSubmit={handle('create')}>
            <div className="field">
              <label htmlFor={ids.title}>{t('lobby.campaignTitle')}</label>
              <input id={ids.title} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <ErrorMessage error={createError} />
            <button
              type="submit"
              className="primary block"
              disabled={pending !== null || !title.trim()}
              aria-busy={pending === 'create'}
            >
              {pending === 'create' ? t('lobby.creating') : t('lobby.create')}
            </button>
          </form>
        </section>
        <section className="card">
          <h2>
            <Icon name="ticket" />
            {t('lobby.joinHeading')}
          </h2>
          <form onSubmit={handle('join')}>
            <div className="field">
              <label htmlFor={ids.invite}>{t('lobby.inviteCode')}</label>
              <input
                id={ids.invite}
                className="mono"
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                required
              />
            </div>
            <ErrorMessage error={joinError} />
            <button
              type="submit"
              className="block"
              disabled={pending !== null || !invite.trim()}
              aria-busy={pending === 'join'}
            >
              {pending === 'join' ? t('lobby.joining') : t('lobby.join')}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
