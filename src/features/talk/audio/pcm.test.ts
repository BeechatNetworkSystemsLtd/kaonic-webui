import { describe, expect, it } from 'vitest';
import { Downsampler, FRAME_SAMPLES, FrameAssembler, floatToInt16, gainOf, int16ToFloat, levelOf, Upsampler } from './pcm';

describe('samples', () => {
  it('converts floats to 16-bit and back, clipping', () => {
    expect(floatToInt16(1)).toBe(32767);
    expect(floatToInt16(-1)).toBe(-32768);
    expect(floatToInt16(2)).toBe(32767);
    expect(floatToInt16(0)).toBe(0);
    expect(int16ToFloat(-32768)).toBe(-1);
  });

  it('reads silence as 0 and full scale as 1', () => {
    expect(levelOf(new Int16Array(320))).toBe(0);
    expect(levelOf(new Int16Array(320).fill(32767))).toBeCloseTo(1, 2);
    expect(levelOf([])).toBe(0);
  });

  it('maps mic gain 0-100 to a quarter up to four times, 50 unchanged', () => {
    expect(gainOf(50)).toBe(1);
    expect(gainOf(0)).toBe(0.25);
    expect(gainOf(100)).toBe(4);
  });
});

describe('Downsampler', () => {
  it('turns 48 kHz into a third as many samples, averaged', () => {
    const down = new Downsampler(48_000);
    const out = down.push([1, 1, 1, 0, 0, 0, 0.5, 0.5, 0.5]);
    expect(Array.from(out)).toEqual([1, 0, 0.5]);
  });

  it('carries the fraction across pushes at 44.1 kHz', () => {
    const down = new Downsampler(44_100);
    let produced = 0;
    for (let index = 0; index < 441; index += 1) produced += down.push(new Float32Array(100)).length;
    // 44 100 samples in, 16 000 out (give or take the one still pending).
    expect(Math.abs(produced - 16_000)).toBeLessThanOrEqual(1);
  });

  it('refuses to go up', () => {
    expect(() => new Downsampler(8000)).toThrow();
  });
});

describe('Upsampler', () => {
  it('makes three samples of each at 48 kHz, interpolating, across pushes', () => {
    const up = new Upsampler(16_000, 48_000);
    const first = up.push([0.3]);
    const second = up.push([0.6, 0.6]);
    expect(first.length + second.length).toBe(9);
    expect(second[0]).toBeCloseTo(0.3, 5);
    expect(second[1]).toBeCloseTo(0.4, 5);
    expect(second[2]).toBeCloseTo(0.5, 5);
  });
});

describe('FrameAssembler', () => {
  it('makes whole 320-sample frames and keeps the rest for the next push', () => {
    const assembler = new FrameAssembler();
    expect(assembler.push(new Float32Array(300).fill(0.5))).toEqual([]);
    const frames = assembler.push(new Float32Array(400).fill(0.5), 2);
    expect(frames).toHaveLength(2);
    expect(frames[0]!.length).toBe(FRAME_SAMPLES);
    expect(frames[0]![0]).toBe(16384);
    expect(frames[0]![FRAME_SAMPLES - 1]).toBe(32767);
  });
});
