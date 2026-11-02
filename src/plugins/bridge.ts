/*
 * The contract between the Kaonic UI (host) and a plugin's page (guest), which
 * runs in an iframe. Messages are plain objects sent with `postMessage`.
 *
 *   guest → host   { type: 'kaonic:ready' }            the page has loaded and listens
 *   host  → guest  { type: 'kaonic:theme', tokens }    design tokens, so the page can match the UI
 *
 * Keep this small and versioned by addition: new message types, never changed ones.
 */

import { readTokens } from '@/lib/tokens';

export type GuestMessage = { type: 'kaonic:ready' };
export type HostMessage = { type: 'kaonic:theme'; tokens: Record<string, string> };

/** Tokens a plugin page may rely on. Names match `styles/tokens.css`. */
const SHARED_TOKENS = [
  '--bg',
  '--surface',
  '--surface-raised',
  '--line',
  '--text',
  '--text-muted',
  '--accent',
  '--accent-ink',
  '--ok',
  '--warn',
  '--danger',
  '--font',
  '--font-mono',
  '--radius',
] as const;

export function readThemeTokens(): Record<string, string> {
  return readTokens(document.documentElement, Object.fromEntries(SHARED_TOKENS.map((name) => [name, name])));
}

export function isGuestMessage(data: unknown): data is GuestMessage {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'kaonic:ready';
}

/*
 * What a plugin page is allowed to do. `allow-same-origin` is deliberately
 * absent: plugin pages are served from the hub's own origin, and with it a
 * plugin could call the hub's API with the signed-in user's session.
 *
 * The cost: a plugin page cannot use cookies or storage, and requests to its
 * own backend come from an opaque origin. Revisit together with the hub's
 * plugin proxy design (for example a separate origin per plugin).
 */
export const PLUGIN_SANDBOX = 'allow-scripts allow-forms allow-downloads';
