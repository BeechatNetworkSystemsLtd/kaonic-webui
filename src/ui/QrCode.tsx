import { useMemo } from 'react';
import qrcode from 'qrcode-generator';
import styles from './QrCode.module.css';

/** Blank modules around the code. Scanners need it to find the edges. */
const QUIET_ZONE = 4;

/**
 * A QR code of `value`, drawn as one SVG path. It stays dark on light in every
 * theme: not every scanner reads an inverted code.
 */
export function QrCode({ value, label, size = 192 }: { value: string; label: string; size?: number }) {
  const { path, extent } = useMemo(() => {
    const code = qrcode(0, 'M');
    code.addData(value);
    code.make();
    const count = code.getModuleCount();
    let path = '';
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (code.isDark(row, col)) path += `M${col + QUIET_ZONE},${row + QUIET_ZONE}h1v1h-1z`;
      }
    }
    return { path, extent: count + QUIET_ZONE * 2 };
  }, [value]);

  return (
    <svg className={styles.code} viewBox={`0 0 ${extent} ${extent}`} width={size} height={size} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={extent} height={extent} className={styles.paper} />
      <path d={path} className={styles.ink} />
    </svg>
  );
}
