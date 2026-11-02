import { describe, expect, it } from 'vitest';
import type { RadioFrame } from '@/api';
import { createFrameHistory } from './frameHistory';
import { rssiColor } from './Waterfall';

const frame = (ts: number): RadioFrame => ({
  seq: ts,
  ts,
  band: 'a_sub',
  direction: 'rx',
  rssi: -70,
  len: 100,
  frequencyHz: 869_535_000,
  bandwidthHz: 200_000,
  durationMs: 50,
  kind: 'data',
  hops: 0,
  destination: null,
  destinationType: null,
  packetLen: 100,
  peerId: null,
  peer: null,
});

describe('frame history', () => {
  it('drops frames older than the window and caps the count', () => {
    let push: (frames: RadioFrame[]) => void = () => undefined;
    let now = 10_000;
    const history = createFrameHistory(
      (onFrames) => {
        push = onFrames;
        return () => undefined;
      },
      1000,
      3,
      () => now,
    );
    history.subscribe(() => undefined);

    push([frame(9_100), frame(9_500)]);
    expect(history.getSnapshot().map((f) => f.ts)).toEqual([9_100, 9_500]);

    now = 10_400;
    push([frame(10_300)]);
    expect(history.getSnapshot().map((f) => f.ts)).toEqual([9_500, 10_300]);

    push([frame(10_310), frame(10_320), frame(10_330)]);
    expect(history.getSnapshot().map((f) => f.ts)).toEqual([10_310, 10_320, 10_330]);
  });
});

describe('rssiColor', () => {
  it('clamps to the ends of the scale', () => {
    expect(rssiColor(-140)).toBe(rssiColor(-100));
    expect(rssiColor(-10)).toBe(rssiColor(-40));
    expect(rssiColor(-100)).not.toBe(rssiColor(-40));
  });
});
