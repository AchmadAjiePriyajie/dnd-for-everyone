import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import type { AccountView, ApiError } from '#shared/access';
import type { Locale } from '#shared/contracts';
import { AuthScreen } from '../features/auth/AuthScreen';
import { CampaignRoom } from '../features/campaign/CampaignRoom';
import { Lobby } from '../features/lobby/Lobby';
import { ReferencePage } from '../features/reference/ReferencePage';
import { api } from './api';
import { Icon, initials } from './icons';
import { currentLocale, i18n, LOCALES, setLocale } from './i18n';
import { resetRoomStore, useConnectionStatus } from './room-store';
import { Link, navigate, routePath, useRoute } from './router';
import { ErrorMessage, type Session, SessionContext, toApiError } from './ui';

type AuthPhase =
  | { phase: 'loading' }
  | { phase: 'error'; error: ApiError }
  | { phase: 'anonymous'; bootstrapRequired: boolean }
  | { phase: 'authenticated'; account: AccountView };

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

const LOCALE_NAMES: Record<Locale, string> = { en: 'English', id: 'Bahasa Indonesia' };

export function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <Shell />
    </I18nextProvider>
  );
}

function Shell() {
  const { t } = useTranslation();
  const route = useRoute();
  const [auth, setAuth] = useState<AuthPhase>({ phase: 'loading' });
  const [save, setSave] = useState<SaveState>('idle');
  const saveTicket = useRef(0);

  const authenticate = useCallback((account: AccountView) => {
    // Preferensi akun menang atas preferensi browser setelah login.
    if (account.locale && account.locale !== currentLocale()) setLocale(account.locale);
    setAuth({ phase: 'authenticated', account });
  }, []);

  const load = useCallback(async () => {
    setAuth({ phase: 'loading' });
    try {
      const state = await api.authState();
      if (state.authenticated) authenticate(await api.me());
      else setAuth({ phase: 'anonymous', bootstrapRequired: state.bootstrapRequired });
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.code === 'UNAUTHENTICATED') setAuth({ phase: 'anonymous', bootstrapRequired: false });
      else setAuth({ phase: 'error', error: apiError });
    }
  }, [authenticate]);

  useEffect(() => {
    void load();
  }, [load]);

  // Konfirmasi "tersimpan" cukup sebentar; status gagal tetap terlihat.
  useEffect(() => {
    if (save !== 'saved') return;
    const timer = setTimeout(() => setSave('idle'), 3000);
    return () => clearTimeout(timer);
  }, [save]);

  const expire = useCallback(() => {
    resetRoomStore();
    setSave('idle');
    setAuth({ phase: 'anonymous', bootstrapRequired: false });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Sesi lokal tetap ditutup; server membersihkan sesi kedaluwarsa.
    }
    expire();
    navigate(routePath.lobby());
  }, [expire]);

  const account = auth.phase === 'authenticated' ? auth.account : null;
  const session = useMemo<Session | null>(() => (account ? { account, signOut, expire } : null), [account, signOut, expire]);

  const changeLocale = (locale: Locale) => {
    setLocale(locale);
    if (!account) return;
    const ticket = ++saveTicket.current;
    setSave('saving');
    api.setLocale(locale).then(
      () => ticket === saveTicket.current && setSave('saved'),
      (error) => {
        if (ticket !== saveTicket.current) return;
        if (toApiError(error).code === 'UNAUTHENTICATED') expire();
        else setSave('failed');
      },
    );
  };

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        {t('app.skipToContent')}
      </a>
      <header className="topbar">
        <Link href={routePath.lobby()} className="brand">
          <Icon name="d20" className="brand-mark" />
          <span>{t('app.name')}</span>
        </Link>
        {session && (
          <nav aria-label={t('app.mainNav')}>
            <Link href={routePath.lobby()} aria-current={route.name === 'lobby' ? 'page' : undefined}>
              <Icon name="scroll" />
              {t('app.campaigns')}
            </Link>
            <Link href={routePath.reference()} aria-current={route.name === 'reference' && !route.campaignId ? 'page' : undefined}>
              <Icon name="eye" />
              {t('app.reference')}
            </Link>
          </nav>
        )}
        <div className="topbar-tools">
          {session && <ConnectionBadge />}
          <LanguageSelect onChange={changeLocale} />
          {session && (
            <>
              <span className="account" title={t('app.signedInAs', { username: session.account.username })}>
                <span className="avatar avatar-sm" aria-hidden="true">
                  {initials(session.account.username)}
                </span>
                <span className="account-name">{session.account.username}</span>
              </span>
              <button type="button" className="small ghost" onClick={() => void signOut()}>
                <Icon name="logOut" />
                <span className="signout-label">{t('app.signOut')}</span>
              </button>
            </>
          )}
        </div>
      </header>
      <p className={`toast save-${save}`} role="status">
        {save !== 'idle' && <Icon name={save === 'failed' ? 'alert' : save === 'saved' ? 'check' : 'globe'} />}
        {save === 'idle' ? '' : t(`save.${save}`)}
      </p>
      <main id="main" tabIndex={-1}>
        {auth.phase === 'loading' && <p className="muted">{t('app.loading')}</p>}
        {auth.phase === 'error' && (
          <section className="card">
            <ErrorMessage error={auth.error} />
            <button type="button" onClick={() => void load()}>
              {t('app.retry')}
            </button>
          </section>
        )}
        {auth.phase === 'anonymous' && (
          <AuthScreen bootstrapRequired={auth.bootstrapRequired} onAuthenticated={authenticate} />
        )}
        {session && (
          <SessionContext.Provider value={session}>
            <Routes />
          </SessionContext.Provider>
        )}
      </main>
    </div>
  );
}

function Routes() {
  const { t } = useTranslation();
  const route = useRoute();
  if (route.name === 'lobby') return <Lobby />;
  if (route.name === 'campaign') return <CampaignRoom key={route.campaignId} campaignId={route.campaignId} />;
  if (route.name === 'reference') return <ReferencePage key={route.campaignId ?? ''} campaignId={route.campaignId} />;
  return (
    <section className="card">
      <h1>{t('notFound.title')}</h1>
      <p>{t('notFound.body')}</p>
      <Link href={routePath.lobby()}>{t('room.back')}</Link>
    </section>
  );
}

function LanguageSelect({ onChange }: { onChange(locale: Locale): void }) {
  const { t, i18n: instance } = useTranslation();
  const id = useId();
  return (
    <div className="language">
      <label htmlFor={id}>
        <Icon name="globe" />
        <span className="language-label">{t('app.language')}</span>
      </label>
      <select id={id} value={instance.language} onChange={(e) => onChange(e.target.value as Locale)}>
        {LOCALES.map((locale) => (
          <option key={locale} value={locale} lang={locale}>
            {LOCALE_NAMES[locale]}
          </option>
        ))}
      </select>
    </div>
  );
}

function ConnectionBadge() {
  const { t } = useTranslation();
  const status = useConnectionStatus();
  // Di luar room tidak ada koneksi realtime yang perlu dilaporkan.
  if (status === 'idle') return null;
  return (
    <span className={`connection connection-${status}`} role="status" title={t('connection.label')}>
      <span className="dot" aria-hidden="true" />
      {t(`connection.${status}`)}
    </span>
  );
}
