import { describe, expect, it } from 'vitest';
import { keySequence, lineText, Screen } from './terminal';

const text = (screen: Screen) => screen.grid.map(lineText);

describe('Screen', () => {
  it('prints, wraps and scrolls into the scrollback', () => {
    const screen = new Screen(5, 2);
    screen.write('abcdefg\r\nxy\r\nz');
    expect(text(screen)).toEqual(['xy', 'z']);
    expect(screen.scrollback.map(lineText)).toEqual(['abcde', 'fg']);
  });

  it('moves the cursor and erases', () => {
    const screen = new Screen(10, 3);
    screen.write('hello\x1b[2;3Hxx\x1b[1;2H\x1b[K');
    expect(text(screen)).toEqual(['h', '  xx', '']);
    screen.write('\x1b[2J');
    expect(text(screen)).toEqual(['', '', '']);
  });

  it('keeps colours and resets them', () => {
    const screen = new Screen(10, 1);
    screen.write('\x1b[1;32mok\x1b[0m.');
    expect(screen.grid[0]![0]!.style).toMatchObject({ fg: 2, bold: true });
    expect(screen.grid[0]![2]!.style).toMatchObject({ fg: null, bold: false });
  });

  it('waits for an escape sequence cut between chunks, and for split UTF-8', () => {
    const screen = new Screen(10, 1);
    screen.write('a\x1b[3');
    screen.write('1mb');
    expect(lineText(screen.grid[0]!)).toBe('ab');
    expect(screen.grid[0]![1]!.style.fg).toBe(1);
    const bytes = new TextEncoder().encode('é');
    screen.write(bytes.slice(0, 1));
    screen.write(bytes.slice(1));
    expect(lineText(screen.grid[0]!)).toBe('abé');
  });

  it('ignores titles and private modes, and deletes characters', () => {
    const screen = new Screen(10, 1);
    screen.write('\x1b]0;root@node\x07abcdef\x1b[?25l\x1b[1;2H\x1b[2P');
    expect(lineText(screen.grid[0]!)).toBe('adef');
  });

  it('keeps the screen when it is resized', () => {
    const screen = new Screen(10, 3);
    screen.write('one\r\ntwo\r\nthree');
    screen.resize(4, 2);
    expect(text(screen)).toEqual(['two', 'thre']);
    expect(screen.scrollback.map(lineText)).toEqual(['one']);
  });
});

describe('keySequence', () => {
  const key = (key: string, more: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => keySequence({ key, ctrlKey: false, altKey: false, metaKey: false, ...more });
  it('turns keys into what a terminal sends', () => {
    expect(key('a')).toBe('a');
    expect(key('Enter')).toBe('\r');
    expect(key('ArrowUp')).toBe('\x1b[A');
    expect(key('c', { ctrlKey: true })).toBe('\x03');
    expect(key('Shift')).toBeNull();
    expect(key('c', { metaKey: true })).toBeNull();
  });
});
