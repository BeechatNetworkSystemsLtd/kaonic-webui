import { describe, expect, it, vi } from 'vitest';
import type { TrafficSample } from '@/api';
import { createTrafficHistory } from './trafficHistory';

const sample = (ts: number): TrafficSample => ({
  ts,
  channels: {
    a_sub: { rxBps: ts, txBps: 0 },
    a_24: { rxBps: 0, txBps: 0 },
    b_sub: { rxBps: 0, txBps: 0 },
    b_24: { rxBps: 0, txBps: 0 },
    vpn: { rxBps: 0, txBps: 0 },
  },
});

describe('traffic history', () => {
  it('keeps only the newest samples', () => {
    let push: (s: TrafficSample) => void = () => undefined;
    const history = createTrafficHistory((onSample) => {
      push = onSample;
      return () => undefined;
    }, 3);
    history.subscribe(() => undefined);
    [1, 2, 3, 4, 5].forEach((ts) => push(sample(ts)));
    expect(history.getSnapshot().map((s) => s.ts)).toEqual([3, 4, 5]);
  });

  it('listens to the source only while someone is subscribed', () => {
    const stop = vi.fn();
    const source = vi.fn(() => stop);
    const history = createTrafficHistory(source, 3);

    const first = history.subscribe(() => undefined);
    const second = history.subscribe(() => undefined);
    expect(source).toHaveBeenCalledTimes(1);

    first();
    expect(stop).not.toHaveBeenCalled();
    second();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
