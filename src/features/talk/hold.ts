/*
 * Press-and-hold for the talk button: held while a pointer is down on it or
 * the space bar is down. Press fires once when the first starts, release once
 * when the last ends; key repeats, a second pointer and stray releases change
 * nothing. Losing focus or the page lets go, so the floor is never stuck.
 */

export interface Hold {
  pointerDown(pointerId: number): void;
  pointerUp(pointerId: number): void;
  /** True when the key is the talk key (the caller then stops its default action). */
  keyDown(code: string): boolean;
  keyUp(code: string): boolean;
  /** Focus or visibility lost: everything lets go. */
  cancel(): void;
  held(): boolean;
}

export const TALK_KEY = 'Space';

export function createHold(handlers: { press: () => void; release: () => void }): Hold {
  let pointer: number | null = null;
  let key = false;
  let held = false;

  function update() {
    const now = pointer !== null || key;
    if (now === held) return;
    held = now;
    if (now) handlers.press();
    else handlers.release();
  }

  return {
    pointerDown(pointerId) {
      if (pointer !== null) return;
      pointer = pointerId;
      update();
    },
    pointerUp(pointerId) {
      if (pointer !== pointerId) return;
      pointer = null;
      update();
    },
    keyDown(code) {
      if (code !== TALK_KEY) return false;
      key = true;
      update();
      return true;
    },
    keyUp(code) {
      if (code !== TALK_KEY) return false;
      key = false;
      update();
      return true;
    },
    cancel() {
      pointer = null;
      key = false;
      update();
    },
    held: () => held,
  };
}
