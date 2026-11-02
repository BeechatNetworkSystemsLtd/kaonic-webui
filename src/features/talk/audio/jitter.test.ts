import { describe, expect, it } from 'vitest';
import { JitterBuffer } from './jitter';

const samples = (count: number, value: number) => new Float32Array(count).fill(value);

describe('JitterBuffer', () => {
  it('plays silence until the target is held, then plays it in order', () => {
    const buffer = new JitterBuffer(8, 32);
    const out = new Float32Array(4);
    buffer.push(samples(4, 1));
    buffer.pull(out);
    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
    buffer.push(samples(4, 2));
    buffer.pull(out);
    expect(Array.from(out)).toEqual([1, 1, 1, 1]);
    buffer.pull(out);
    expect(Array.from(out)).toEqual([2, 2, 2, 2]);
  });

  it('runs dry into silence, counts it, and waits for the target again', () => {
    const buffer = new JitterBuffer(4, 32);
    buffer.push(samples(6, 1));
    const out = new Float32Array(4);
    buffer.pull(out);
    buffer.pull(out);
    expect(Array.from(out)).toEqual([1, 1, 0, 0]);
    expect(buffer.underruns).toBe(1);
    buffer.push(samples(2, 3));
    buffer.pull(out);
    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
  });

  it('drops the oldest samples past the maximum', () => {
    const buffer = new JitterBuffer(2, 6);
    buffer.push(samples(4, 1));
    buffer.push(samples(4, 2));
    expect(buffer.buffered).toBe(6);
    expect(buffer.dropped).toBe(2);
    const out = new Float32Array(6);
    buffer.pull(out);
    expect(Array.from(out)).toEqual([1, 1, 2, 2, 2, 2]);
  });

  it('clears', () => {
    const buffer = new JitterBuffer(2, 8);
    buffer.push(samples(4, 1));
    buffer.clear();
    const out = new Float32Array(2);
    buffer.pull(out);
    expect(Array.from(out)).toEqual([0, 0]);
  });
});
