import { useCallback, useSyncExternalStore } from 'react';

/** Layout breakpoints. Keep in sync with the media queries in `shell/AppShell.module.css`. */
export const BREAKPOINTS = {
  /** Below this the navigation becomes a drawer. */
  nav: '(min-width: 860px)',
  /** Below this the right rail becomes a drawer. */
  rail: '(min-width: 1280px)',
} as const;

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
