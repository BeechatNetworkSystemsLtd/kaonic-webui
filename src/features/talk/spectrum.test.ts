import { describe, expect, it } from 'vitest';
import { bandEdges, clampBands, meterBars, spectrumBars } from './spectrum';

describe('level animation', () => {
  it('keeps the bar count in range', () => {
    expect([clampBands(2), clampBands(14), clampBands(100), clampBands(Number.NaN)]).toEqual([4, 14, 64, 14]);
  });

  it('splits the bins into geometrically growing bands', () => {
    const edges = bandEdges(256, 8);
    expect(edges).toHaveLength(9);
    expect(edges[0]).toBe(1);
    expect(edges.at(-1)).toBe(256);
    for (let index = 1; index < edges.length; index += 1) expect(edges[index]).toBeGreaterThanOrEqual(edges[index - 1]!);
    // Low bands are narrow, high ones wide.
    expect(edges[2]! - edges[1]!).toBeLessThan(edges[8]! - edges[7]!);
  });

  it('shows each band as its loudest bin', () => {
    const bins = new Uint8Array(256);
    bins[200] = 255;
    const bars = spectrumBars(bins, 8);
    expect(bars).toHaveLength(8);
    expect(bars.at(-1)).toBe(1);
    expect(bars.slice(0, 7).every((bar) => bar === 0)).toBe(true);
  });

  it('fills a meter from the left, rising to the right', () => {
    expect(meterBars(0, 4)).toEqual([0, 0, 0, 0]);
    const half = meterBars(0.5, 4);
    expect(half.slice(2)).toEqual([0, 0]);
    expect(half[1]!).toBeGreaterThan(half[0]!);
    expect(meterBars(2, 4).every((bar) => bar > 0)).toBe(true);
  });
});
