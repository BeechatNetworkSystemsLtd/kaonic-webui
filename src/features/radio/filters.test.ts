import { describe, expect, it } from 'vitest';
import type { RadioFilter } from '@/api';
import { autoFilter, boardRangeHint, filterCovers, filterNote, formatMhz, outsideBoardRange } from './filters';

const R30: RadioFilter[] = [
  { index: 0, label: 'Wide 730–960 MHz', minMhz: 730, maxMhz: 960 },
  { index: 1, label: '868 MHz', minMhz: 862, maxMhz: 876 },
  { index: 2, label: '915 MHz', minMhz: 902, maxMhz: 928 },
];

describe('board filters', () => {
  it('auto takes the narrowest filter that passes, else the wide one', () => {
    expect(autoFilter(R30, 868_100_000)?.index).toBe(1);
    expect(autoFilter(R30, 915_000_000)?.index).toBe(2);
    expect(autoFilter(R30, 800_000_000)?.index).toBe(0);
    expect(autoFilter(R30, 433_000_000)?.index).toBe(0);
    expect(autoFilter([], 868_000_000)).toBeNull();
  });

  it('notes, never refuses, a filter that does not pass the frequency', () => {
    expect(filterCovers(R30[2]!, 868_100_000)).toBe(false);
    expect(filterNote({ filter: 2, filters: R30 }, 868_100_000)).toBe('Does not cover 868.1 MHz');
    expect(filterNote({ filter: 1, filters: R30 }, 868_100_000)).toBeNull();
    expect(filterNote({ filter: 'auto', filters: R30 }, 868_100_000)).toBeNull();
    expect(formatMhz(915_000_000)).toBe('915 MHz');
  });

  it('shows the board range as a hint', () => {
    const r09 = { boardRangeMhz: [390, 510] as [number, number] };
    expect(boardRangeHint(r09)).toBe('Supported 390–510 MHz on this board');
    expect(outsideBoardRange(r09, 433_920_000)).toBe(false);
    expect(outsideBoardRange(r09, 868_100_000)).toBe(true);
    expect(boardRangeHint({ boardRangeMhz: null })).toBeNull();
    expect(outsideBoardRange({}, 1)).toBe(false);
  });
});
