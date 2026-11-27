import { describe, expect, it } from 'vitest';
import { ease, levelOf } from './spectrum';

describe('level arc', () => {
  it('reads silence as nothing and loud audio as full', () => {
    expect(levelOf([])).toBe(0);
    expect(levelOf(new Uint8Array(64))).toBe(0);
    expect(levelOf(new Uint8Array(64).fill(255))).toBe(1);
    const quiet = levelOf(new Uint8Array(64).fill(20));
    expect(quiet).toBeGreaterThan(0);
    expect(quiet).toBeLessThan(0.5);
  });

  it('rises quickly and falls slowly', () => {
    const up = ease(0, 1);
    const down = 1 - ease(1, 0);
    expect(up).toBeGreaterThan(down);
    expect(ease(0.5, 0.5)).toBe(0.5);
    let level = 0;
    for (let step = 0; step < 50; step += 1) level = ease(level, 1);
    expect(level).toBe(1);
  });
});
