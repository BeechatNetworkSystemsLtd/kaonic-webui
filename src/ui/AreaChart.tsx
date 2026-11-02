import { useId, useMemo, useState, type PointerEvent } from 'react';
import styles from './AreaChart.module.css';

export interface ChartSeries {
  id: string;
  label: string;
  /** A CSS colour, normally a `--series-*` token. */
  color: string;
  /** One value per entry of `times`. */
  values: readonly number[];
}

interface AreaChartProps {
  /** What the chart shows, for screen readers. */
  label: string;
  /** Sample times, Unix milliseconds, oldest first. Shared by all series. */
  times: readonly number[];
  series: readonly ChartSeries[];
  /** Width of the time axis. The newest sample sits at the right edge. */
  windowMs: number;
  formatValue: (value: number) => string;
  height?: number;
}

const VIEW_WIDTH = 1000;

/** Rounds up to 1, 2 or 5 times a power of ten, so axis labels are round numbers. */
export function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((candidate) => candidate * magnitude >= value) ?? 10;
  return step * magnitude;
}

/** "now", "45 s ago", "2 min ago". */
export function formatAge(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds <= 0) return 'now';
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = seconds / 60;
  return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} min ago`;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour12: false });

/**
 * A live time-series chart: lines over a soft gradient fill, a labelled value
 * axis, a time axis, and a tooltip with a marker on each line under the pointer.
 * All series share one value axis.
 */
export function AreaChart({ label, times, series, windowMs, formatValue, height = 120 }: AreaChartProps) {
  const gradientId = useId();
  const [hovered, setHovered] = useState<number | null>(null);

  const end = times.at(-1) ?? 0;
  const start = end - windowMs;

  // Everything below changes only with the data, not while the pointer moves over the chart.
  const { first, visible, peak, max, shapes } = useMemo(() => {
    // Only samples inside the window are drawn; keep one before it so the line reaches the left edge.
    const inside = times.findIndex((time) => time >= start);
    const first = Math.max(0, inside - 1);
    const peak = Math.max(0, ...series.flatMap((s) => s.values.slice(first)));
    const max = niceCeil(peak);
    const shapes = series.map((s) => {
      if (inside < 0) return null;
      const line = times.slice(first).map((time, offset) => [((time - start) / windowMs) * VIEW_WIDTH, (1 - (s.values[first + offset] ?? 0) / max) * height] as const);
      if (line.length < 2) return null;
      const path = line.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L');
      return { fill: `M${line[0]![0]},${height} L${path} L${line.at(-1)![0]},${height} Z`, stroke: `M${path}` };
    });
    return { first, visible: inside >= 0, peak, max, shapes };
  }, [times, series, start, windowMs, height]);

  const xOf = (time: number) => (time - start) / windowMs;
  const yOf = (value: number) => 1 - value / max;

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!visible) return;
    const box = event.currentTarget.getBoundingClientRect();
    const time = start + ((event.clientX - box.left) / box.width) * windowMs;
    let nearest = first;
    for (let index = first; index < times.length; index += 1) {
      if (Math.abs(times[index]! - time) < Math.abs(times[nearest]! - time)) nearest = index;
    }
    setHovered(nearest);
  }

  const at = hovered !== null && hovered < times.length && times[hovered]! >= start ? hovered : null;
  const atX = at !== null ? xOf(times[at]!) : 0;

  return (
    <figure className={styles.chart}>
      <div className={styles.plot} style={{ height }} onPointerMove={onPointerMove} onPointerLeave={() => setHovered(null)}>
        <svg className={styles.svg} viewBox={`0 0 ${VIEW_WIDTH} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
          <defs>
            {series.map((s, index) => (
              <linearGradient key={s.id} id={`${gradientId}-${index}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={s.color} stopOpacity="0.32" />
                <stop offset="1" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {[0, 0.5].map((ratio) => (
            <line key={ratio} className={styles.grid} x1={0} x2={VIEW_WIDTH} y1={ratio * height + 0.5} y2={ratio * height + 0.5} />
          ))}
          <line className={styles.axis} x1={0} x2={VIEW_WIDTH} y1={height - 0.5} y2={height - 0.5} />
          {series.map((s, index) => {
            const shape = shapes[index];
            if (!shape) return null;
            return (
              <g key={s.id}>
                <path fill={`url(#${gradientId}-${index})`} d={shape.fill} />
                <path className={styles.line} stroke={s.color} d={shape.stroke} />
              </g>
            );
          })}
        </svg>

        {!visible ? (
          <span className={styles.waiting}>Waiting for data</span>
        ) : peak > 0 ? (
          <>
            <span className={styles.tick} style={{ top: 0 }}>{formatValue(max)}</span>
            <span className={styles.tick} style={{ top: '50%' }}>{formatValue(max / 2)}</span>
          </>
        ) : null}

        {at !== null ? (
          <>
            <span className={styles.cursor} style={{ left: `${atX * 100}%` }} />
            {series.map((s) => (
              <span key={s.id} className={styles.marker} style={{ left: `${atX * 100}%`, top: `${yOf(s.values[at] ?? 0) * 100}%`, background: s.color }} />
            ))}
            <div className={styles.tooltip} data-side={atX > 0.5 ? 'left' : 'right'} style={{ left: `${atX * 100}%` }}>
              <p className={`${styles.tooltipTime} num`}>{clock(times[at]!)}</p>
              {series.map((s) => (
                <p key={s.id} className={styles.tooltipRow}>
                  <span className={styles.swatch} style={{ background: s.color }} />
                  {s.label}
                  <span className={`${styles.tooltipValue} num`}>{formatValue(s.values[at] ?? 0)}</span>
                </p>
              ))}
            </div>
          </>
        ) : null}
      </div>
      <div className={styles.timeAxis} aria-hidden>
        <span>{formatAge(windowMs)}</span>
        <span>{formatAge(windowMs / 2)}</span>
        <span>now</span>
      </div>
    </figure>
  );
}
