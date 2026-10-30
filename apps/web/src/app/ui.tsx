import { createContext, type ReactNode, useContext, useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AccountView, ApiError } from '#shared/access';
import { ApiClientError } from './api';

export interface Session {
  account: AccountView;
  signOut(): Promise<void>;
  /** Server menjawab UNAUTHENTICATED: kembali ke layar masuk. */
  expire(): void;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession outside SessionContext');
  return session;
}

export function toApiError(error: unknown): ApiError {
  return error instanceof ApiClientError ? error.error : { code: 'INTERNAL', params: {} };
}

/** Teks error terjemahan dari kode + parameter yang sama untuk setiap bahasa. */
export function useErrorText(): (error: ApiError) => string {
  const { t, i18n } = useTranslation();
  return (error) =>
    i18n.exists(`errors.${error.code}`)
      ? t(`errors.${error.code}`, error.params)
      : t('errors.UNKNOWN', { code: error.code });
}

export function ErrorMessage({ error, id }: { error: ApiError | null | undefined; id?: string }) {
  const text = useErrorText();
  if (!error) return null;
  return (
    <p className="error" role="alert" id={id}>
      {text(error)}
    </p>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog modal: fokus masuk ke dialog, Tab berputar di dalamnya, Escape menutup,
 * dan fokus kembali ke elemen pemicu setelah ditutup.
 */
export function Dialog({
  title,
  children,
  actions,
  onClose,
}: {
  title: string;
  children: ReactNode;
  actions: ReactNode;
  onClose(): void;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current!;
    (node.querySelector<HTMLElement>('[data-autofocus]') ?? node.querySelector<HTMLElement>(FOCUSABLE) ?? node).focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <h2 id={titleId}>{title}</h2>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>
  );
}
