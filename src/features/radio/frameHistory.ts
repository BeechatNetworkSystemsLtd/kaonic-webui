import { useMemo, useSyncExternalStore } from 'react';
import { api, type BandId, type RadioFrame } from '@/api';
import { hubNow } from '@/lib/hubClock';
import { createSharedBuffer } from '@/lib/sharedBuffer';

/** Recent radio frames for the waterfalls, shared by every waterfall. */

/** How far back frames are kept. Waterfalls can show at most this much. */
export const FRAME_WINDOW_MS = 60_000;

/** A guard against a flood of frames; the oldest are dropped first. */
const MAX_FRAMES = 4000;

type Source = (onFrames: (frames: RadioFrame[]) => void) => () => void;

export function createFrameHistory(source: Source, windowMs: number, maxFrames: number, now: () => number = hubNow) {
  return createSharedBuffer(source, (frames: readonly RadioFrame[], incoming: RadioFrame[]) => {
    if (incoming.length === 0) return frames;
    const oldest = now() - windowMs;
    return [...frames, ...incoming].filter((frame) => frame.ts >= oldest).slice(-maxFrames);
  });
}

const history = createFrameHistory((onFrames) => api.events.subscribe('frames', onFrames), FRAME_WINDOW_MS, MAX_FRAMES);

/** Frames of one band from the last minute, oldest first. */
export function useBandFrames(band: BandId): readonly RadioFrame[] {
  const all = useSyncExternalStore(history.subscribe, history.getSnapshot);
  return useMemo(() => all.filter((frame) => frame.band === band), [all, band]);
}
