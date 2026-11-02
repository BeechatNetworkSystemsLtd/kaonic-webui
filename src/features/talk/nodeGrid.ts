import type { Peer, PttBurst, PttTalker } from '@/api';

/*
 * The Talk page's node grid: every node of our network as a tile, the one on
 * air highlighted. Voice packets name the talker by the first 4 bytes of its
 * identity hash only (the rest of the id the hub reports may be zeros), so a
 * talker is matched to a node by those 8 hex characters.
 */

export interface TalkTile {
  /** The node's identity hash (this device's for the "you" tile). */
  id: string;
  codename: string;
  isAdmin: boolean;
  online: boolean;
  self: boolean;
  talking: boolean;
  /** When it last talked (Unix ms), as far as this page has seen. */
  lastTalkedTs: number | null;
}

/** What a voice packet knows of a talker: the first 4 bytes of its identity hash, as hex. */
export const talkerPrefix = (id: string) => id.slice(0, 8).toLowerCase();

export interface SelfNode {
  id: string;
  codename: string;
  isAdmin: boolean;
}

/** Remembers the latest talk of every talker (by prefix) from the recent bursts and the current talker. */
export function lastTalked(previous: ReadonlyMap<string, number>, recent: readonly PttBurst[], talker: PttTalker | null, nowMs: number): Map<string, number> {
  const next = new Map(previous);
  const note = (prefix: string, ts: number) => {
    if ((next.get(prefix) ?? 0) < ts) next.set(prefix, ts);
  };
  for (const burst of recent) note(talkerPrefix(burst.talker.id), burst.startedTs + burst.durationMs);
  if (talker) note(talkerPrefix(talker.id), nowMs);
  return next;
}

/** Tiles in display order: this device, the Kaonic Admin, then the rest of our network by name. */
export function talkTiles(peers: readonly Peer[], self: SelfNode | null, talker: PttTalker | null, talked: ReadonlyMap<string, number>): TalkTile[] {
  const onAir = talker && !talker.local ? talkerPrefix(talker.id) : null;
  const ours = peers
    .filter((peer) => peer.trust.network === 'ours' || peer.trust.isAdmin)
    .map<TalkTile>((peer) => ({
      id: peer.id,
      codename: peer.codename || peer.id.slice(0, 8),
      isAdmin: peer.trust.isAdmin,
      online: peer.online,
      self: false,
      talking: onAir !== null && talkerPrefix(peer.id) === onAir,
      lastTalkedTs: talked.get(talkerPrefix(peer.id)) ?? null,
    }))
    .sort((a, b) => Number(b.isAdmin) - Number(a.isAdmin) || a.codename.localeCompare(b.codename));
  if (!self) return ours;
  const you: TalkTile = {
    id: self.id,
    codename: self.codename || self.id.slice(0, 8),
    isAdmin: self.isAdmin,
    online: true,
    self: true,
    talking: talker?.local === true,
    lastTalkedTs: talked.get(talkerPrefix(self.id)) ?? null,
  };
  return [you, ...ours];
}
