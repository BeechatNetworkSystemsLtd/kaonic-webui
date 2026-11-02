/*
 * The level animation above the Talk button, as the plugin drew it. All the
 * analysis is in the browser: the node is a single-core A7 with no business
 * computing a spectrum for a page.
 *
 * - With audio in the browser (talking from its microphone, or listening),
 *   bars are bands of the spectrum. Speech energy sits low, so bands grow
 *   geometrically, as the ear hears them; linear bins would leave the top half
 *   always dark.
 * - Talking from the device's microphone, no audio reaches the page: the bars
 *   fill from the left as a meter of the level the hub reports.
 */

export const MIN_BANDS = 4;
export const MAX_BANDS = 64;

export const clampBands = (bands: number) => Math.max(MIN_BANDS, Math.min(MAX_BANDS, Math.round(bands) || 14));

/** `bands + 1` bin indices, from 1 up to `binCount`, growing geometrically. */
export function bandEdges(binCount: number, bands: number): number[] {
  const count = clampBands(bands);
  const edges: number[] = [];
  for (let index = 0; index <= count; index += 1) edges.push(Math.min(binCount, Math.round(binCount ** (index / count))));
  return edges;
}

/** Each band's height, 0..1: its loudest bin (0..255, as `getByteFrequencyData` gives). */
export function spectrumBars(bins: ArrayLike<number>, bands: number): number[] {
  const edges = bandEdges(bins.length, bands);
  const bars: number[] = [];
  for (let band = 0; band < edges.length - 1; band += 1) {
    let peak = 0;
    const end = Math.max(edges[band]! + 1, edges[band + 1]!);
    for (let bin = edges[band]!; bin < end && bin < bins.length; bin += 1) peak = Math.max(peak, bins[bin]!);
    bars.push(peak / 255);
  }
  return bars;
}

/** A level (0..1) as bars lit from the left; lit bars rise to the right, as the plugin's did. */
export function meterBars(level: number, bands: number): number[] {
  const count = clampBands(bands);
  const lit = Math.round(Math.min(1, Math.max(0, level)) * count);
  return Array.from({ length: count }, (_, index) => (index < lit ? 0.3 + 0.7 * ((index + 1) / count) : 0));
}
