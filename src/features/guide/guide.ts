/**
 * The Guide: how a Kaonic node works and how to use it. It is public (reachable
 * before signing in, from the login and setup screens) and bundled with the UI,
 * since the device is usually offline. It holds no device data.
 */

/** Where the guide lives, signed in or not. */
export const GUIDE_PATH = '/guide';

/** The guide's sections, in reading order. The table of contents is built from this list. */
export const SECTIONS = [
  { id: 'node', title: 'What a Kaonic node is' },
  { id: 'first-start', title: 'First start' },
  { id: 'pairing', title: 'Pairing nodes (provisioning)' },
  { id: 'trust', title: 'Trust after pairing' },
  { id: 'using', title: 'Using the device' },
  { id: 'troubleshooting', title: 'Troubleshooting' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

/** Whether a path may be shown before signing in. Only the guide is. */
export function isPublicPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  return path === GUIDE_PATH;
}
