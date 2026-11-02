import type { LinkState, NodeList, NodeNetwork } from '@/api';

/** How each node list, network and link state reads in the UI. */
export const LIST_TEXT: Record<NodeList, string> = { whitelist: 'Whitelist', blacklist: 'Blacklist', none: 'New, on neither list' };
export const NETWORK_TEXT: Record<NodeNetwork, string> = {
  ours: 'Certified by our admin',
  other: 'Belongs to another admin',
  unprovisioned: 'Waiting to join',
  unknown: 'Not known yet',
};
export const LINK_TEXT: Record<LinkState, string> = {
  active: 'Secure link up',
  pending: 'Connecting',
  refused: 'Refused',
  none: 'No link',
};
