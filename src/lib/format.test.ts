import { describe, expect, it } from 'vitest';
import { formatAgo, formatBytes, formatClock, formatCount, formatDuration, formatFrequency, formatMegabytes, formatRate, shortHash } from './format';

describe('format', () => {
  it('shortens counts', () => {
    expect(formatCount(812)).toBe('812');
    expect(formatCount(9_999)).toBe('9999');
    expect(formatCount(14_100)).toBe('14.1k');
    expect(formatCount(310_000)).toBe('310k');
    expect(formatCount(2_950_000)).toBe('2.95M');
    expect(formatCount(48_300_000)).toBe('48.3M');
  });

  it('gives the time of day to the millisecond', () => {
    expect(formatClock(new Date(2026, 0, 2, 9, 5, 7, 42).getTime())).toBe('09:05:07.042');
  });

  it('scales rates', () => {
    expect(formatRate(0)).toBe('0 bit/s');
    expect(formatRate(999)).toBe('999 bit/s');
    expect(formatRate(1530)).toBe('1.5 kbit/s');
    expect(formatRate(250_000)).toBe('250 kbit/s');
    expect(formatRate(3_400_000)).toBe('3.4 Mbit/s');
  });

  it('formats frequencies and sizes', () => {
    expect(formatFrequency(869_535_000)).toBe('869.535 MHz');
    expect(formatMegabytes(142)).toBe('142 MB');
    expect(formatMegabytes(2310)).toBe('2.3 GB');
    expect(formatBytes(812)).toBe('812 B');
    expect(formatBytes(48_200)).toBe('47 KB');
    expect(formatBytes(3_500_000)).toBe('3.3 MB');
    expect(formatBytes(52_000_000)).toBe('50 MB');
  });

  it('formats durations with two units at most', () => {
    expect(formatDuration(59)).toBe('59s');
    expect(formatDuration(3700)).toBe('1h 1m');
    expect(formatDuration(93_784)).toBe('1d 2h');
  });

  it('formats relative time', () => {
    expect(formatAgo(1000, 1_030_000)).toBe('just now');
    expect(formatAgo(1000, 1_000_000 + 3 * 3600 * 1000)).toBe('3h 0m ago');
  });

  it('shortens hashes', () => {
    expect(shortHash('a41f0c7be9d24836b05e1f7a2c9d6e30')).toBe('a41f..6e30');
    expect(shortHash('abc')).toBe('abc');
  });
});
