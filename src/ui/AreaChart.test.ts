import { describe, expect, it } from 'vitest';
import { formatAge, niceCeil } from './AreaChart';

describe('niceCeil', () => {
  it('rounds up to 1, 2 or 5 times a power of ten', () => {
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(1.2)).toBe(2);
    expect(niceCeil(340)).toBe(500);
    expect(niceCeil(5001)).toBe(10_000);
    expect(niceCeil(200_000)).toBe(200_000);
  });
});

describe('formatAge', () => {
  it('names a distance in time', () => {
    expect(formatAge(0)).toBe('now');
    expect(formatAge(45_000)).toBe('45 s ago');
    expect(formatAge(120_000)).toBe('2 min ago');
    expect(formatAge(150_000)).toBe('2.5 min ago');
  });
});
