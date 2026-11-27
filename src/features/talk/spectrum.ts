/*
 * The level the arc around the Talk button shows. All the analysis is in the
 * browser: the node is a single-core A7 with no business computing it for a
 * page. With audio in the browser it comes from the analyser's spectrum; with
 * the device's microphone, from the level the hub reports.
 */

/** Loudness 0..1 from `getByteFrequencyData` bins: their RMS, lifted so speech fills most of the arc. */
export function levelOf(bins: ArrayLike<number>): number {
  if (bins.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < bins.length; index += 1) sum += (bins[index]! / 255) ** 2;
  return Math.min(1, Math.sqrt(sum / bins.length) * 2.2);
}

/** One animation step towards `target`: quick to rise, slow to fall, so the arc does not flicker. */
export function ease(current: number, target: number): number {
  const rate = target > current ? 0.45 : 0.08;
  const next = current + (target - current) * rate;
  return Math.abs(next - target) < 0.002 ? target : next;
}
