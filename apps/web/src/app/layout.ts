import { useSyncExternalStore } from 'react';

export type Breakpoint = 'wide' | 'medium' | 'narrow';
const WIDE = '(min-width: 1200px)';
const MEDIUM = '(min-width: 768px)';

function current(): Breakpoint {
  if (typeof globalThis.matchMedia !== 'function') return 'wide';
  if (globalThis.matchMedia(WIDE).matches) return 'wide';
  return globalThis.matchMedia(MEDIUM).matches ? 'medium' : 'narrow';
}

function subscribe(listener: () => void): () => void {
  if (typeof globalThis.matchMedia !== 'function') return () => undefined;
  const queries = [globalThis.matchMedia(WIDE), globalThis.matchMedia(MEDIUM)];
  for (const query of queries) query.addEventListener?.('change', listener);
  return () => { for (const query of queries) query.removeEventListener?.('change', listener); };
}

/** wide ≥1200 px: three columns + hotbar; medium 768–1199 px: drawers; narrow <768 px: bottom tabs. */
export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, current, () => 'wide');
}
