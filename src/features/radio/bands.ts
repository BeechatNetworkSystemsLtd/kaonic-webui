import type { BandId } from '@/api';

/* Names for the four radio bands, used wherever a band is shown. */

export const BAND_IDS: readonly BandId[] = ['a_sub', 'a_24', 'b_sub', 'b_24'];

export const BAND_NAMES: Record<BandId, string> = {
  a_sub: 'Radio A, Sub-GHz',
  a_24: 'Radio A, 2.4 GHz',
  b_sub: 'Radio B, Sub-GHz',
  b_24: 'Radio B, 2.4 GHz',
};
