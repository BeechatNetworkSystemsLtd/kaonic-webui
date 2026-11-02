import styles from './PluginGlyph.module.css';

/*
 * A plugin's mark: a 5×5 mirrored pattern and a hue, both worked out from its
 * id, so the same plugin always looks the same on every device. It lights up
 * while the plugin runs.
 */

const SIZE = 5;
const HUES = ['amber', 'blue', 'teal', 'violet'] as const;

/** FNV-1a: small, stable, and spreads similar ids apart. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/** Which cells are on, row by row. The left three columns come from the hash; the right two mirror them. */
function cellsOf(id: string): boolean[] {
  const bits = hash(id);
  const cells: boolean[] = [];
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const source = col < 3 ? col : SIZE - 1 - col;
      cells.push(((bits >> (row * 3 + source)) & 1) === 1);
    }
  }
  // The centre stays on, so no plugin gets an empty mark.
  cells[(SIZE * SIZE - 1) / 2] = true;
  return cells;
}

export function PluginGlyph({ id, lit }: { id: string; lit: boolean }) {
  const hue = HUES[hash(`${id}:hue`) % HUES.length]!;
  return (
    <svg className={styles.glyph} data-hue={hue} data-lit={lit} viewBox="0 0 5 5" aria-hidden>
      {cellsOf(id).map((on, index) =>
        on ? (
          <rect
            key={index}
            className={styles.cell}
            x={(index % SIZE) + 0.12}
            y={Math.floor(index / SIZE) + 0.12}
            width={0.76}
            height={0.76}
            rx={0.18}
            // Lighting up sweeps from the top-left corner.
            style={{ transitionDelay: lit ? `${((index % SIZE) + Math.floor(index / SIZE)) * 35}ms` : '0ms' }}
          />
        ) : null,
      )}
    </svg>
  );
}
