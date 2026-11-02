import { describe, expect, it } from 'vitest';
import type { RadioFrame } from '@/api';
import { byKind, byPeer, createAnalyserHistory, matches, NO_FILTER, peerChoices, sizeHistogram, totals, type AnalyserInput } from './frameAnalysis';

let seq = 0;
const frame = (patch: Partial<RadioFrame> = {}): RadioFrame => ({
  seq: ++seq,
  ts: 1000,
  band: 'b_sub',
  direction: 'rx',
  rssi: -70,
  len: 100,
  frequencyHz: 869_535_000,
  bandwidthHz: 1_094_000,
  durationMs: 2,
  kind: 'data',
  hops: 0,
  destination: 'd'.repeat(32),
  destinationType: 'single',
  packetLen: 100,
  peerId: 'a'.repeat(32),
  peer: 'bench001',
  ...patch,
});

function history(nowMs: number, windowMs = 10_000, maxFrames = 100) {
  let push: (input: AnalyserInput) => void = () => undefined;
  const buffer = createAnalyserHistory(
    (onInput) => {
      push = onInput;
      return () => undefined;
    },
    windowMs,
    maxFrames,
    () => nowMs,
  );
  buffer.subscribe(() => undefined);
  return { buffer, push: (input: AnalyserInput) => push(input) };
}

describe('analyser history', () => {
  it('merges the backlog in front of live frames without doubles', () => {
    const { buffer, push } = history(10_000);
    push({ live: [frame({ seq: 2, ts: 5000 }), frame({ seq: 3, ts: 6000 })] });
    push({ seed: [frame({ seq: 1, ts: 4000 }), frame({ seq: 2, ts: 5000 })] });
    expect(buffer.getSnapshot().map((f) => f.ts)).toEqual([4000, 5000, 6000]);
  });

  it('keeps frames that only look alike, such as the segments of one packet', () => {
    const { buffer, push } = history(10_000);
    push({ live: [frame({ seq: 8, ts: 5000, kind: 'segment' })] });
    push({ seed: [frame({ seq: 7, ts: 5000, kind: 'segment' }), frame({ seq: 8, ts: 5000, kind: 'segment' })] });
    expect(buffer.getSnapshot().map((f) => f.seq)).toEqual([7, 8]);
  });

  it('forgets frames older than the window and keeps at most the cap', () => {
    const { buffer, push } = history(20_000, 10_000, 2);
    push({ live: [frame({ ts: 5000 }), frame({ ts: 15_000 }), frame({ ts: 16_000 }), frame({ ts: 17_000 })] });
    expect(buffer.getSnapshot().map((f) => f.ts)).toEqual([16_000, 17_000]);
  });

  it('does not notify for an empty burst', () => {
    const { buffer, push } = history(10_000);
    push({ live: [frame()] });
    const before = buffer.getSnapshot();
    push({ live: [] });
    expect(buffer.getSnapshot()).toBe(before);
  });
});

describe('filters', () => {
  it('matches on every field, and groups frames without a node', () => {
    const anonymous = frame({ peerId: null, peer: null, kind: 'corrupt' });
    expect(matches(frame(), NO_FILTER)).toBe(true);
    expect(matches(frame(), { ...NO_FILTER, band: 'a_sub' })).toBe(false);
    expect(matches(frame(), { ...NO_FILTER, direction: 'tx' })).toBe(false);
    expect(matches(anonymous, { ...NO_FILTER, kind: 'corrupt', peer: 'unattributed' })).toBe(true);
    expect(matches(anonymous, { ...NO_FILTER, peer: 'a'.repeat(32) })).toBe(false);
  });
});

describe('breakdowns', () => {
  const frames = [
    frame({ len: 300, rssi: -60 }),
    frame({ len: 100, rssi: -80, kind: 'corrupt' }),
    frame({ direction: 'tx', rssi: null, len: 50, kind: 'announce' }),
    frame({ peerId: 'b'.repeat(32), peer: 'bench002', len: 1000 }),
    frame({ peerId: null, peer: null, kind: 'segment', len: 2047 }),
  ];

  it('sums per node, most bytes first, the unnamed last', () => {
    const peers = byPeer(frames);
    expect(peers.map((peer) => peer.name)).toEqual(['bench002', 'bench001', 'Not attributed']);
    const bench001 = peers[1]!;
    expect(bench001).toMatchObject({ frames: 3, rxBytes: 400, txBytes: 50, avgRssi: -70 });
  });

  it('lists every kind in a fixed order with its share', () => {
    const kinds = byKind(frames);
    expect(kinds.map((kind) => kind.kind)).toEqual(['data', 'announce', 'link_request', 'proof', 'segment', 'corrupt']);
    expect(kinds[0]).toMatchObject({ frames: 2, bytes: 1300, share: 0.4 });
    expect(kinds[2]).toMatchObject({ frames: 0, share: 0 });
    expect(byKind([]).every((kind) => kind.share === 0)).toBe(true);
  });

  it('puts each size in its bucket, the largest in the open one', () => {
    const buckets = sizeHistogram([frame({ len: 0 }), frame({ len: 63 }), frame({ len: 64 }), frame({ len: 2047 }), frame({ len: 4000 })]);
    expect(buckets.map((bucket) => bucket.frames)).toEqual([2, 1, 0, 0, 0, 1, 1]);
    expect(buckets.at(-1)).toMatchObject({ from: 2048, to: null });
  });

  it('totals bytes, airtime and the corrupt share of received frames', () => {
    expect(totals(frames)).toMatchObject({ frames: 5, rxBytes: 3447, txBytes: 50, airtimeSecs: 0.01, corruptShare: 0.25 });
  });

  it('offers each named node once, by name', () => {
    expect(peerChoices(frames)).toEqual([
      { id: 'a'.repeat(32), name: 'bench001' },
      { id: 'b'.repeat(32), name: 'bench002' },
    ]);
  });
});
