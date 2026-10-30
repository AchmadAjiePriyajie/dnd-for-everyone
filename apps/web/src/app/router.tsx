import { type AnchorHTMLAttributes, type MouseEvent, useSyncExternalStore } from 'react';

/** Rute frontend; host menyajikan index.html untuk navigasi ini (lihat server web.ts). */
export type Route =
  | { name: 'lobby' }
  | { name: 'campaign'; campaignId: string }
  | { name: 'reference'; campaignId?: string }
  | { name: 'not-found' };

export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'lobby' };
  if (/^\/reference\/?$/.test(pathname)) return { name: 'reference' };
  const campaign = /^\/campaigns\/([^/]+)(\/reference)?\/?$/.exec(pathname);
  if (campaign) {
    try {
      const campaignId = decodeURIComponent(campaign[1]!);
      return campaign[2] ? { name: 'reference', campaignId } : { name: 'campaign', campaignId };
    } catch {
      return { name: 'not-found' };
    }
  }
  return { name: 'not-found' };
}

export const routePath = {
  lobby: () => '/',
  campaign: (campaignId: string) => `/campaigns/${encodeURIComponent(campaignId)}`,
  reference: (campaignId?: string) =>
    campaignId === undefined ? '/reference' : `/campaigns/${encodeURIComponent(campaignId)}/reference`,
};

const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('popstate', notify);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('popstate', notify);
  };
}

const getPath = () => window.location.pathname;

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (path === window.location.pathname) return;
  if (options.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  notify();
}

export function useRoute(): Route {
  return parseRoute(useSyncExternalStore(subscribe, getPath, getPath));
}

/** Link biasa yang memakai router client; ctrl/middle click tetap membuka tab baru. */
export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handle} {...rest} />;
}
