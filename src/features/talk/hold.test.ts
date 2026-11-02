import { describe, expect, it } from 'vitest';
import { createHold } from './hold';

function recorder() {
  const calls: string[] = [];
  const hold = createHold({ press: () => calls.push('press'), release: () => calls.push('release') });
  return { hold, calls };
}

describe('hold to talk', () => {
  it('presses once with the space bar, whatever the key repeats', () => {
    const { hold, calls } = recorder();
    expect(hold.keyDown('Space')).toBe(true);
    hold.keyDown('Space');
    hold.keyDown('Space');
    expect(hold.keyUp('Space')).toBe(true);
    expect(calls).toEqual(['press', 'release']);
  });

  it('ignores other keys', () => {
    const { hold, calls } = recorder();
    expect(hold.keyDown('KeyA')).toBe(false);
    expect(calls).toEqual([]);
  });

  it('follows one pointer and ignores a second one', () => {
    const { hold, calls } = recorder();
    hold.pointerDown(1);
    hold.pointerDown(2);
    hold.pointerUp(2);
    expect(hold.held()).toBe(true);
    hold.pointerUp(1);
    expect(calls).toEqual(['press', 'release']);
  });

  it('stays held while either the pointer or the key is down', () => {
    const { hold, calls } = recorder();
    hold.pointerDown(1);
    hold.keyDown('Space');
    hold.pointerUp(1);
    expect(hold.held()).toBe(true);
    hold.keyUp('Space');
    expect(calls).toEqual(['press', 'release']);
  });

  it('lets go when focus is lost', () => {
    const { hold, calls } = recorder();
    hold.keyDown('Space');
    hold.cancel();
    hold.cancel();
    expect(calls).toEqual(['press', 'release']);
    expect(hold.held()).toBe(false);
  });
});
