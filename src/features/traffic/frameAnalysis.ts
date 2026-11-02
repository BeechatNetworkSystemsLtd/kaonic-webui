import type { BandId, FrameKind, RadioFrame } from '@/api';
import { hubNow } from '@/lib/hubClock';
import { createSharedBuffer, type SharedBuffer } from '@/lib/sharedBuffer';

/*
 * The traffic analyser's logic: the rolling window of frames it looks at, the
 * filters, and the breakdowns. Pure functions; the page only draws them.
 */

/** How far back the analyser keeps frames. */
export const ANALYSER_WINDOW_MS = 15 * 60 * 1000;

/** A guard against a flood: the oldest frames go first. */
export const ANALYSER_MAX_FRAMES = 5000;

/** What reaches the buffer: the hub's backlog once, then each live burst. */
export type AnalyserInput = { seed: RadioFrame[] } | { live: RadioFrame[] };

/** The same frame from the backlog and the live feed: the hub numbers every frame. */
const frameKey = (frame: RadioFrame) => frame.seq;

/** Frames of the last `windowMs`, oldest first, at most `maxFrames`. The backlog may overlap live frames that arrived while it loaded. */
export function createAnalyserHistory(
  source: (push: (input: AnalyserInput) => void) => () => void,
  windowMs: number = ANALYSER_WINDOW_MS,
  maxFrames: number = ANALYSER_MAX_FRAMES,
  now: () => number = hubNow,
): SharedBuffer<RadioFrame> {
  return createSharedBuffer(source, (frames: readonly RadioFrame[], input: AnalyserInput) => {
    let next: RadioFrame[];
    if ('seed' in input) {
      const seen = new Set(frames.map(frameKey));
      next = [...input.seed.filter((frame) => !seen.has(frameKey(frame))), ...frames].sort((a, b) => a.ts - b.ts);
    } else {
      if (input.live.length === 0) return frames;
      next = [...frames, ...input.live];
    }
    const oldest = now() - windowMs;
    return next.filter((frame) => frame.ts >= oldest).slice(-maxFrames);
  });
}

/* ── filters ── */

export interface FrameFilter {
  band: BandId | 'all';
  direction: 'rx' | 'tx' | 'all';
  kind: FrameKind | 'all';
  /** A peer id, `unattributed` for frames no node could be named for, or `all`. */
  peer: string;
}

export const NO_FILTER: FrameFilter = { band: 'all', direction: 'all', kind: 'all', peer: 'all' };

export const UNATTRIBUTED = 'unattributed';

export function matches(frame: RadioFrame, filter: FrameFilter): boolean {
  if (filter.band !== 'all' && frame.band !== filter.band) return false;
  if (filter.direction !== 'all' && frame.direction !== filter.direction) return false;
  if (filter.kind !== 'all' && frame.kind !== filter.kind) return false;
  if (filter.peer !== 'all' && (frame.peerId ?? UNATTRIBUTED) !== filter.peer) return false;
  return true;
}

/* ── naming ── */

/** In the order the breakdown lists them: what carries meaning first, the leftovers last. */
export const FRAME_KINDS: readonly FrameKind[] = ['data', 'announce', 'link_request', 'proof', 'segment', 'corrupt'];

export const KIND_NAMES: Record<FrameKind, string> = {
  data: 'Data',
  announce: 'Announce',
  link_request: 'Link request',
  proof: 'Proof',
  segment: 'Segment',
  corrupt: 'Corrupt',
};

export const KIND_HINTS: Record<FrameKind, string> = {
  data: 'A packet of data, to a node or over a link.',
  announce: 'A node saying it is there, with its keys.',
  link_request: 'A node opening an encrypted link.',
  proof: 'A receipt: proof that a packet or link arrived.',
  segment: 'Part of a packet sent as several frames; the last frame completes it.',
  corrupt: 'A frame that arrived but could not be decoded: interference, a collision or a weak signal.',
};

/* ── breakdowns ── */

export interface PeerBreakdown {
  /** A peer id, or `unattributed`. */
  id: string;
  name: string;
  frames: number;
  rxBytes: number;
  txBytes: number;
  /** Mean signal of the frames received from it, dBm. */
  avgRssi: number | null;
}

/** Per node, most bytes first. Frames no node could be named for are grouped at the end. */
export function byPeer(frames: readonly RadioFrame[]): PeerBreakdown[] {
  const groups = new Map<string, PeerBreakdown & { rssiSum: number; rssiCount: number }>();
  for (const frame of frames) {
    const id = frame.peerId ?? UNATTRIBUTED;
    let group = groups.get(id);
    if (!group) {
      group = { id, name: frame.peerId ? (frame.peer ?? frame.peerId.slice(0, 8)) : 'Not attributed', frames: 0, rxBytes: 0, txBytes: 0, avgRssi: null, rssiSum: 0, rssiCount: 0 };
      groups.set(id, group);
    }
    group.frames += 1;
    if (frame.direction === 'rx') {
      group.rxBytes += frame.len;
      if (frame.rssi !== null) {
        group.rssiSum += frame.rssi;
        group.rssiCount += 1;
      }
    } else {
      group.txBytes += frame.len;
    }
  }
  return [...groups.values()]
    .map(({ rssiSum, rssiCount, ...group }) => ({ ...group, avgRssi: rssiCount > 0 ? Math.round(rssiSum / rssiCount) : null }))
    .sort((a, b) => Number(a.id === UNATTRIBUTED) - Number(b.id === UNATTRIBUTED) || b.rxBytes + b.txBytes - (a.rxBytes + a.txBytes));
}

export interface KindBreakdown {
  kind: FrameKind;
  frames: number;
  bytes: number;
  /** Share of all frames, 0..1. */
  share: number;
}

/** Every kind, in the fixed order, including those with no frames, so rows never jump about. */
export function byKind(frames: readonly RadioFrame[]): KindBreakdown[] {
  const counts = new Map<FrameKind, { frames: number; bytes: number }>(FRAME_KINDS.map((kind) => [kind, { frames: 0, bytes: 0 }]));
  for (const frame of frames) {
    const entry = counts.get(frame.kind);
    if (!entry) continue;
    entry.frames += 1;
    entry.bytes += frame.len;
  }
  return FRAME_KINDS.map((kind) => {
    const entry = counts.get(kind)!;
    return { kind, ...entry, share: frames.length > 0 ? entry.frames / frames.length : 0 };
  });
}

/** Upper bounds (exclusive) of the size histogram's buckets, in bytes. The last bucket takes everything above. */
export const SIZE_BUCKETS = [64, 128, 256, 512, 1024, 2048] as const;

export interface SizeBucket {
  /** Inclusive lower bound, bytes. */
  from: number;
  /** Exclusive upper bound, bytes; null for the open last bucket. */
  to: number | null;
  frames: number;
}

export function sizeHistogram(frames: readonly RadioFrame[]): SizeBucket[] {
  const buckets: SizeBucket[] = SIZE_BUCKETS.map((to, index) => ({ from: index === 0 ? 0 : SIZE_BUCKETS[index - 1]!, to, frames: 0 }));
  buckets.push({ from: SIZE_BUCKETS.at(-1)!, to: null, frames: 0 });
  for (const frame of frames) {
    const index = SIZE_BUCKETS.findIndex((to) => frame.len < to);
    buckets[index === -1 ? buckets.length - 1 : index]!.frames += 1;
  }
  return buckets;
}

export interface Totals {
  frames: number;
  rxBytes: number;
  txBytes: number;
  /** Seconds of air the frames took. */
  airtimeSecs: number;
  /** Received frames that did not decode, 0..1. */
  corruptShare: number;
}

export function totals(frames: readonly RadioFrame[]): Totals {
  let rxBytes = 0;
  let txBytes = 0;
  let airtimeMs = 0;
  let rxFrames = 0;
  let corrupt = 0;
  for (const frame of frames) {
    airtimeMs += frame.durationMs;
    if (frame.direction === 'rx') {
      rxBytes += frame.len;
      rxFrames += 1;
      if (frame.kind === 'corrupt') corrupt += 1;
    } else {
      txBytes += frame.len;
    }
  }
  return { frames: frames.length, rxBytes, txBytes, airtimeSecs: airtimeMs / 1000, corruptShare: rxFrames > 0 ? corrupt / rxFrames : 0 };
}

/** The nodes frames were attributed to, for the filter's choices, by name. */
export function peerChoices(frames: readonly RadioFrame[]): Array<{ id: string; name: string }> {
  const names = new Map<string, string>();
  for (const frame of frames) if (frame.peerId && !names.has(frame.peerId)) names.set(frame.peerId, frame.peer ?? frame.peerId.slice(0, 8));
  return [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}
