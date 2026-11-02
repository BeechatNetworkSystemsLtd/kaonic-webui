/*
 * A small terminal screen: enough of VT100/xterm for a login shell, `top`, `less` and `vi`
 * over a slow radio. Cursor movement, erasing, scrolling, insert/delete, and the basic
 * colours. Anything else is read and ignored. Pure: `write` changes the screen, the view
 * reads `lines`.
 */

export interface Style {
  /** 0-15, or null for the default. */
  fg: number | null;
  bg: number | null;
  bold: boolean;
  inverse: boolean;
}

export interface Cell {
  char: string;
  style: Style;
}

const PLAIN: Style = { fg: null, bg: null, bold: false, inverse: false };
const SCROLLBACK = 500;
const blank = (style: Style = PLAIN): Cell => ({ char: ' ', style });
const row = (cols: number, style?: Style): Cell[] => Array.from({ length: cols }, () => blank(style));

export class Screen {
  cols: number;
  rows: number;
  /** Lines that scrolled off the top, oldest first. */
  scrollback: Cell[][] = [];
  grid: Cell[][];
  x = 0;
  y = 0;
  private style: Style = PLAIN;
  private saved = { x: 0, y: 0 };
  private top = 0;
  private bottom: number;
  /** An escape sequence cut by the end of a chunk. */
  private pending = '';
  private decoder = new TextDecoder();
  /** Bumped on every change, so a view knows when to draw. */
  version = 0;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.grid = Array.from({ length: rows }, () => row(cols));
    this.bottom = rows - 1;
  }

  /** The scrollback, then the screen. */
  get lines(): Cell[][] {
    return [...this.scrollback, ...this.grid];
  }

  resize(cols: number, rows: number) {
    if (cols === this.cols && rows === this.rows) return;
    const fit = (line: Cell[]) => (line.length >= cols ? line.slice(0, cols) : [...line, ...row(cols - line.length)]);
    let grid = this.grid.map(fit);
    // Shrinking pushes the top lines into the scrollback, as the cursor stays on screen.
    while (grid.length > rows) {
      if (this.y > 0) {
        this.pushScrollback(grid.shift()!);
        this.y -= 1;
      } else grid.pop();
    }
    while (grid.length < rows) grid = [...grid, row(cols)];
    this.grid = grid;
    this.cols = cols;
    this.rows = rows;
    this.top = 0;
    this.bottom = rows - 1;
    this.x = Math.min(this.x, cols - 1);
    this.y = Math.min(this.y, rows - 1);
    this.version += 1;
  }

  write(bytes: Uint8Array | string) {
    const text = this.pending + (typeof bytes === 'string' ? bytes : this.decoder.decode(bytes, { stream: true }));
    this.pending = '';
    let index = 0;
    while (index < text.length) {
      const char = text[index]!;
      if (char === '\x1b') {
        const used = this.escape(text, index);
        if (used === 0) {
          // Incomplete: wait for the rest (but never hold on to garbage forever).
          this.pending = text.slice(index, index + 64);
          break;
        }
        index += used;
        continue;
      }
      this.control(char);
      index += 1;
    }
    this.version += 1;
  }

  private control(char: string) {
    switch (char) {
      case '\r':
        this.x = 0;
        return;
      case '\n':
      case '\v':
      case '\f':
        this.lineFeed();
        return;
      case '\b':
        this.x = Math.max(0, this.x - 1);
        return;
      case '\t':
        this.x = Math.min(this.cols - 1, (Math.floor(this.x / 8) + 1) * 8);
        return;
      default:
        if (char < ' ' || char === '\x7f') return;
        this.print(char);
    }
  }

  private print(char: string) {
    if (this.x >= this.cols) {
      this.x = 0;
      this.lineFeed();
    }
    this.grid[this.y]![this.x] = { char, style: this.style };
    this.x += 1;
  }

  private pushScrollback(line: Cell[]) {
    this.scrollback.push(line);
    if (this.scrollback.length > SCROLLBACK) this.scrollback.shift();
  }

  private lineFeed() {
    if (this.y === this.bottom) this.scrollUp(1);
    else this.y = Math.min(this.rows - 1, this.y + 1);
  }

  private scrollUp(count: number) {
    for (let n = 0; n < count; n += 1) {
      const [gone] = this.grid.splice(this.top, 1);
      // Only a full-screen scroll keeps what left: a region scroll (an editor) does not.
      if (this.top === 0 && this.bottom === this.rows - 1) this.pushScrollback(gone!);
      this.grid.splice(this.bottom, 0, row(this.cols));
    }
  }

  private scrollDown(count: number) {
    for (let n = 0; n < count; n += 1) {
      this.grid.splice(this.bottom, 1);
      this.grid.splice(this.top, 0, row(this.cols));
    }
  }

  /** Reads one escape sequence at `start`; returns its length, or 0 when it is not complete yet. */
  private escape(text: string, start: number): number {
    const next = text[start + 1];
    if (next === undefined) return 0;
    if (next === '[') {
      let end = start + 2;
      while (end < text.length && !/[@-~]/.test(text[end]!)) end += 1;
      if (end >= text.length) return 0;
      this.csi(text.slice(start + 2, end), text[end]!);
      return end - start + 1;
    }
    if (next === ']') {
      // An operating-system command (a window title): ends with BEL or ESC \.
      for (let end = start + 2; end < text.length; end += 1) {
        if (text[end] === '\x07') return end - start + 1;
        if (text[end] === '\x1b' && text[end + 1] === '\\') return end - start + 2;
      }
      return 0;
    }
    if (next === '(' || next === ')' || next === '#') return text.length > start + 2 ? 3 : 0;
    if (next === '7') this.saved = { x: this.x, y: this.y };
    else if (next === '8') ({ x: this.x, y: this.y } = this.saved);
    else if (next === 'M') {
      if (this.y === this.top) this.scrollDown(1);
      else this.y = Math.max(0, this.y - 1);
    } else if (next === 'D') this.lineFeed();
    else if (next === 'E') {
      this.x = 0;
      this.lineFeed();
    } else if (next === 'c') this.reset();
    return 2;
  }

  private reset() {
    this.grid = Array.from({ length: this.rows }, () => row(this.cols));
    this.x = this.y = 0;
    this.style = PLAIN;
    this.top = 0;
    this.bottom = this.rows - 1;
  }

  private csi(params: string, final: string) {
    const isPrivate = params.startsWith('?');
    const numbers = (isPrivate ? params.slice(1) : params).split(';').map((part) => (part === '' ? NaN : Number.parseInt(part, 10)));
    const n = (index: number, fallback = 1) => {
      const value = numbers[index];
      return value === undefined || Number.isNaN(value) ? fallback : value;
    };
    const line = this.grid[this.y]!;
    switch (final) {
      case 'A':
        this.y = Math.max(this.y >= this.top ? this.top : 0, this.y - n(0));
        break;
      case 'B':
        this.y = Math.min(this.y <= this.bottom ? this.bottom : this.rows - 1, this.y + n(0));
        break;
      case 'C':
        this.x = Math.min(this.cols - 1, this.x + n(0));
        break;
      case 'D':
        this.x = Math.max(0, Math.min(this.x, this.cols - 1) - n(0));
        break;
      case 'E':
        this.y = Math.min(this.rows - 1, this.y + n(0));
        this.x = 0;
        break;
      case 'F':
        this.y = Math.max(0, this.y - n(0));
        this.x = 0;
        break;
      case 'G':
      case '`':
        this.x = clamp(n(0) - 1, 0, this.cols - 1);
        break;
      case 'd':
        this.y = clamp(n(0) - 1, 0, this.rows - 1);
        break;
      case 'H':
      case 'f':
        this.y = clamp(n(0) - 1, 0, this.rows - 1);
        this.x = clamp(n(1) - 1, 0, this.cols - 1);
        break;
      case 'J': {
        const mode = n(0, 0);
        const from = mode === 0 ? this.y + 1 : 0;
        const to = mode === 1 ? this.y : this.rows;
        if (mode === 0) this.eraseInLine(this.x, this.cols);
        if (mode === 1) this.eraseInLine(0, this.x + 1);
        for (let y = from; y < to; y += 1) this.grid[y] = row(this.cols, this.style);
        if (mode === 3) this.scrollback = [];
        break;
      }
      case 'K': {
        const mode = n(0, 0);
        if (mode === 0) this.eraseInLine(this.x, this.cols);
        else if (mode === 1) this.eraseInLine(0, this.x + 1);
        else this.eraseInLine(0, this.cols);
        break;
      }
      case 'X':
        this.eraseInLine(this.x, this.x + n(0));
        break;
      case 'P':
        line.splice(this.x, n(0));
        while (line.length < this.cols) line.push(blank(this.style));
        break;
      case '@':
        line.splice(this.x, 0, ...row(n(0), this.style));
        line.length = this.cols;
        break;
      case 'L':
      case 'M':
        if (this.y >= this.top && this.y <= this.bottom) {
          const savedTop = this.top;
          this.top = this.y;
          if (final === 'L') this.scrollDown(n(0));
          else for (let k = 0; k < n(0); k += 1) {
            this.grid.splice(this.top, 1);
            this.grid.splice(this.bottom, 0, row(this.cols));
          }
          this.top = savedTop;
        }
        break;
      case 'S':
        this.scrollUp(n(0));
        break;
      case 'T':
        this.scrollDown(n(0));
        break;
      case 'r':
        this.top = clamp(n(0) - 1, 0, this.rows - 1);
        this.bottom = clamp(n(1, this.rows) - 1, this.top, this.rows - 1);
        this.x = 0;
        this.y = 0;
        break;
      case 's':
        this.saved = { x: this.x, y: this.y };
        break;
      case 'u':
        ({ x: this.x, y: this.y } = this.saved);
        break;
      case 'm':
        this.sgr(numbers);
        break;
      case 'h':
      case 'l':
        // The alternate screen (full-screen programs) is drawn on this one, cleared.
        if (isPrivate && (n(0) === 1049 || n(0) === 47 || n(0) === 1047)) this.reset();
        break;
      default:
        break;
    }
  }

  private eraseInLine(from: number, to: number) {
    const line = this.grid[this.y]!;
    for (let x = Math.max(0, from); x < Math.min(this.cols, to); x += 1) line[x] = blank(this.style);
  }

  private sgr(numbers: number[]) {
    let style = { ...this.style };
    for (let index = 0; index < Math.max(1, numbers.length); index += 1) {
      const code = Number.isNaN(numbers[index] ?? NaN) ? 0 : numbers[index]!;
      if (code === 0) style = { ...PLAIN };
      else if (code === 1) style.bold = true;
      else if (code === 22) style.bold = false;
      else if (code === 7) style.inverse = true;
      else if (code === 27) style.inverse = false;
      else if (code >= 30 && code <= 37) style.fg = code - 30;
      else if (code >= 90 && code <= 97) style.fg = code - 90 + 8;
      else if (code === 39) style.fg = null;
      else if (code >= 40 && code <= 47) style.bg = code - 40;
      else if (code >= 100 && code <= 107) style.bg = code - 100 + 8;
      else if (code === 49) style.bg = null;
      else if (code === 38 || code === 48) {
        // 256-colour and true-colour: the first 16 are kept, the rest become the default.
        const kind = numbers[index + 1];
        const value = kind === 5 ? numbers[index + 2] : undefined;
        const colour = value !== undefined && value < 16 ? value : null;
        if (code === 38) style.fg = colour;
        else style.bg = colour;
        index += kind === 5 ? 2 : kind === 2 ? 4 : 0;
      }
    }
    this.style = style;
  }
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** What a key press sends to the shell, or null for keys the terminal does not take. */
export function keySequence(event: { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): string | null {
  if (event.metaKey) return null;
  const { key } = event;
  if (event.ctrlKey && key.length === 1) {
    const lower = key.toLowerCase();
    if (lower >= 'a' && lower <= 'z') return String.fromCharCode(lower.charCodeAt(0) - 96);
    if (key === '[') return '\x1b';
    if (key === '\\') return '\x1c';
    if (key === ']') return '\x1d';
    if (key === ' ' || key === '@') return '\x00';
    return null;
  }
  const named: Record<string, string> = {
    Enter: '\r',
    Backspace: '\x7f',
    Tab: '\t',
    Escape: '\x1b',
    ArrowUp: '\x1b[A',
    ArrowDown: '\x1b[B',
    ArrowRight: '\x1b[C',
    ArrowLeft: '\x1b[D',
    Home: '\x1b[H',
    End: '\x1b[F',
    Insert: '\x1b[2~',
    Delete: '\x1b[3~',
    PageUp: '\x1b[5~',
    PageDown: '\x1b[6~',
    F1: '\x1bOP',
    F2: '\x1bOQ',
    F3: '\x1bOR',
    F4: '\x1bOS',
  };
  if (named[key]) return named[key]!;
  if (key.length === 1) return event.altKey ? `\x1b${key}` : key;
  return null;
}

/** A line as text, trailing spaces dropped: what Copy takes. */
export const lineText = (line: Cell[]) => line.map((cell) => cell.char).join('').replace(/\s+$/, '');
