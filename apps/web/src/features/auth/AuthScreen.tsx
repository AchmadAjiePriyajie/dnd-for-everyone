import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AccountView, ApiError } from '#shared/access';
import { api } from '../../app/api';
import { Icon } from '../../app/icons';
import { ErrorMessage, toApiError } from '../../app/ui';

type Mode = 'signIn' | 'register' | 'bootstrap';

/**
 * Masuk, daftar dengan undangan, atau setup akun host pertama. Kata sandi hanya
 * hidup di state form ini dan hilang saat form ditutup.
 */
export function AuthScreen({
  bootstrapRequired,
  onAuthenticated,
}: {
  bootstrapRequired: boolean;
  onAuthenticated(account: AccountView): void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>(bootstrapRequired ? 'bootstrap' : 'signIn');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const ids = { username: useId(), password: useId(), invite: useId(), error: useId(), uHint: useId(), pHint: useId() };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const account =
        mode === 'signIn'
          ? await api.login(username, password)
          : mode === 'register'
            ? await api.register(invite, username, password)
            : await api.bootstrap(username, password);
      setPassword('');
      onAuthenticated(account);
    } catch (caught) {
      setError(toApiError(caught));
      setPending(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  const creating = mode !== 'signIn';
  const copy = {
    signIn: { title: t('auth.signInTitle'), intro: t('auth.signInIntro'), submit: t('auth.signIn'), busy: t('auth.signingIn') },
    register: {
      title: t('auth.registerTitle'),
      intro: t('auth.registerIntro'),
      submit: t('auth.register'),
      busy: t('auth.registering'),
    },
    bootstrap: {
      title: t('auth.bootstrapTitle'),
      intro: t('auth.bootstrapIntro'),
      submit: t('auth.bootstrap'),
      busy: t('auth.registering'),
    },
  }[mode];

  return (
    <div className="auth-layout">
      <aside className="auth-pitch" aria-label={t('app.name')}>
        <Icon name="d20" className="auth-emblem" />
        <p className="eyebrow">{t('app.name')}</p>
        <p className="pitch-title">{t('auth.pitchTitle')}</p>
        <ul className="pitch-list">
          <li>
            <Icon name="shield" />
            {t('auth.pitch1')}
          </li>
          <li>
            <Icon name="ticket" />
            {t('auth.pitch2')}
          </li>
          <li>
            <Icon name="globe" />
            {t('auth.pitch3')}
          </li>
        </ul>
      </aside>
      <section className="card auth" aria-labelledby={`${ids.error}-title`}>
        <h1 id={`${ids.error}-title`}>{copy.title}</h1>
        <p className="muted">{copy.intro}</p>
        <form onSubmit={submit} noValidate aria-describedby={error ? ids.error : undefined}>
          {mode === 'register' && (
            <div className="field">
              <label htmlFor={ids.invite}>{t('auth.invite')}</label>
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
          )}
          <div className="field">
            <label htmlFor={ids.username}>{t('auth.username')}</label>
            <input
              id={ids.username}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby={creating ? ids.uHint : undefined}
              required
            />
            {creating && (
              <p className="hint" id={ids.uHint}>
                {t('auth.usernameHint')}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor={ids.password}>{t('auth.password')}</label>
            <div className="input-with-action">
              <input
                id={ids.password}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={creating ? 'new-password' : 'current-password'}
                aria-describedby={creating ? ids.pHint : undefined}
                required
              />
              <button
                type="button"
                className="icon-button"
                aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((v) => !v)}
              >
                <Icon name={showPassword ? 'eyeOff' : 'eye'} />
              </button>
            </div>
            {creating && (
              <p className="hint" id={ids.pHint}>
                {t('auth.passwordHint')}
              </p>
            )}
          </div>
          <ErrorMessage error={error} id={ids.error} />
          <button type="submit" className="primary block" disabled={pending} aria-busy={pending}>
            {pending ? copy.busy : copy.submit}
          </button>
        </form>
        {mode === 'signIn' && (
          <button type="button" className="link" onClick={() => switchMode('register')}>
            <Icon name="ticket" />
            {t('auth.toRegister')}
          </button>
        )}
        {mode === 'register' && (
          <button type="button" className="link" onClick={() => switchMode('signIn')}>
            <Icon name="arrowLeft" />
            {t('auth.toSignIn')}
          </button>
        )}
      </section>
    </div>
  );
}
