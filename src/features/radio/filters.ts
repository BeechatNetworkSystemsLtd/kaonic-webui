import type { RadioBand, RadioFilter } from '@/api';

/* The board's sub-GHz filters and range: informative only, every filter can be chosen. */

/** 868_100_000 → "868.1 MHz". */
export function formatMhz(hz: number): string {
  return `${Number((hz / 1_000_000).toFixed(3))} MHz`;
}

export function filterCovers(filter: RadioFilter, centreHz: number): boolean {
  return centreHz >= filter.minMhz * 1_000_000 && centreHz <= filter.maxMhz * 1_000_000;
}

/** What auto picks: the narrowest filter that passes the centre, else the first (the wide one). */
export function autoFilter(filters: RadioFilter[], centreHz: number): RadioFilter | null {
  const covering = filters.filter((filter) => filterCovers(filter, centreHz));
  covering.sort((a, b) => a.maxMhz - a.minMhz - (b.maxMhz - b.minMhz));
  return covering[0] ?? filters[0] ?? null;
}

/** "Supported 390–510 MHz on this board", or nothing when the hub does not know. */
export function boardRangeHint(band: Pick<RadioBand, 'boardRangeMhz'>): string | null {
  return band.boardRangeMhz ? `Supported ${band.boardRangeMhz[0]}–${band.boardRangeMhz[1]} MHz on this board` : null;
}

export function outsideBoardRange(band: Pick<RadioBand, 'boardRangeMhz'>, centreHz: number): boolean {
  if (!band.boardRangeMhz) return false;
  const [min, max] = band.boardRangeMhz;
  return centreHz < min * 1_000_000 || centreHz > max * 1_000_000;
}

/** A note under the filter: the chosen one does not pass the channel centre. */
export function filterNote(band: Pick<RadioBand, 'filter' | 'filters'>, centreHz: number): string | null {
  if (typeof band.filter !== 'number') return null;
  const chosen = band.filters?.find((filter) => filter.index === band.filter);
  return chosen && !filterCovers(chosen, centreHz) ? `Does not cover ${formatMhz(centreHz)}` : null;
}
