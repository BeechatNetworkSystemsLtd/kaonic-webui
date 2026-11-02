import { useCallback, useEffect, useRef, useState } from 'react';
import type { View } from './projection';

/**
 * The time, in ms, the camera takes to cover about two thirds of the way to
 * where it was told to go. Short enough that a drag still feels attached to
 * the hand, long enough to turn wheel steps and key presses into a glide.
 */
const GLIDE_MS = 55;
/** Differences smaller than this are not worth another frame. */
const SETTLED = 0.0004;
/** Pixels of pan that count as much as one radian of turn when judging whether the camera has arrived. */
const PAN_SCALE = 400;

/**
 * A camera that glides. Controls steer a target; the drawn view moves towards
 * it frame by frame and then stops. Nothing runs, and nothing re-renders,
 * while the camera is at rest.
 */
export function useCamera(home: View) {
  const [view, setView] = useState(home);
  /** Where the camera is going. */
  const target = useRef(home);
  /** Where it is now: the same as `view`, readable from event handlers. */
  const shown = useRef(home);
  const frame = useRef(0);

  const run = useCallback(() => {
    if (frame.current) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let last = performance.now();

    const step = (now: number) => {
      const elapsed = Math.min(100, now - last);
      last = now;
      const goal = target.current;
      const from = shown.current;
      const gap =
        Math.abs(goal.yaw - from.yaw) +
        Math.abs(goal.pitch - from.pitch) +
        Math.abs(goal.zoom - from.zoom) / from.zoom +
        (Math.abs(goal.panX - from.panX) + Math.abs(goal.panY - from.panY)) / PAN_SCALE;

      if (still || gap < SETTLED) {
        shown.current = goal;
        setView(goal);
        frame.current = 0;
        return;
      }
      const share = 1 - Math.exp(-elapsed / GLIDE_MS);
      const next = {
        yaw: from.yaw + (goal.yaw - from.yaw) * share,
        pitch: from.pitch + (goal.pitch - from.pitch) * share,
        zoom: from.zoom + (goal.zoom - from.zoom) * share,
        panX: from.panX + (goal.panX - from.panX) * share,
        panY: from.panY + (goal.panY - from.panY) * share,
      };
      shown.current = next;
      setView(next);
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /** Moves the target. The update receives the current target, so steps add up even mid-glide. */
  const steer = useCallback(
    (update: (current: View) => View) => {
      target.current = update(target.current);
      run();
    },
    [run],
  );

  /** Forgets wherever the camera was still heading: the next move starts from what is on screen. */
  const hold = useCallback(() => {
    target.current = shown.current;
  }, []);

  return { view, steer, hold, target, shown };
}
