import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { RadioFrame } from '@/api';
import { formatFrequency } from '@/lib/format';
import { readTokens } from '@/lib/tokens';
import { hubNow } from '@/lib/hubClock';
import { FRAME_WINDOW_MS } from './frameHistory';
import styles from './Waterfall.module.css';

/*
 * A waterfall built from packets rather than from a spectrum sweep: frequency
 * runs left to right, time runs downwards with the newest at the top. Each
 * frame is a bar as wide as the bandwidth it occupied and as tall as its time
 * on air. Received frames are coloured by signal strength; sent frames are
 * yellow, the same colour "sent" has in the traffic charts.
 */

const RSSI_MIN = -100;
const RSSI_MAX = -40;

/** Weak → strong, one hue getting lighter (the "received" blue). */
const RSSI_STOPS: ReadonlyArray<readonly [number, number, number]> = [
  [26, 45, 74],
  [48, 110, 184],
  [90, 169, 245],
  [206, 232, 255],
];

function mixRssiColor(rssi: number): string {
  const ratio = (rssi - RSSI_MIN) / (RSSI_MAX - RSSI_MIN);
  const position = ratio * (RSSI_STOPS.length - 1);
  const low = RSSI_STOPS[Math.floor(position)]!;
  const high = RSSI_STOPS[Math.min(RSSI_STOPS.length - 1, Math.floor(position) + 1)]!;
  const mix = position - Math.floor(position);
  const channel = (index: 0 | 1 | 2) => Math.round(low[index] + (high[index] - low[index]) * mix);
  return `rgb(${channel(0)} ${channel(1)} ${channel(2)})`;
}

/** One colour per whole dBm, worked out once: the waterfall paints thousands of bars a second. */
const RSSI_PALETTE = Array.from({ length: RSSI_MAX - RSSI_MIN + 1 }, (_, offset) => mixRssiColor(RSSI_MIN + offset));

export function rssiColor(rssi: number): string {
  return RSSI_PALETTE[Math.min(RSSI_MAX, Math.max(RSSI_MIN, Math.round(rssi))) - RSSI_MIN]!;
}

const RSSI_GRADIENT = `linear-gradient(90deg, ${[RSSI_MIN, -80, -60, RSSI_MAX].map(rssiColor).join(', ')})`;

/** Frames scroll this often. Smooth enough to read, cheap enough to leave running. */
const REDRAW_MS = 200;
const MIN_BAR_HEIGHT = 2;
const MIN_SPAN_HZ = 500_000;

interface WaterfallProps {
  /** What the chart shows, for screen readers. */
  label: string;
  frames: readonly RadioFrame[];
  /** The band's tuned frequency: the centre of the horizontal axis. */
  centerHz: number;
  height?: number;
}

interface Geometry {
  width: number;
  height: number;
  startHz: number;
  spanHz: number;
  now: number;
}

/** Where a frame's bar is drawn, in CSS pixels. */
function barOf(frame: RadioFrame, g: Geometry) {
  const width = Math.max(3, (frame.bandwidthHz / g.spanHz) * g.width);
  const x = ((frame.frequencyHz - g.startHz) / g.spanHz) * g.width - width / 2;
  const height = Math.max(MIN_BAR_HEIGHT, (frame.durationMs / FRAME_WINDOW_MS) * g.height);
  const y = ((g.now - frame.ts) / FRAME_WINDOW_MS) * g.height;
  return { x, y, width, height };
}

export function Waterfall({ label, frames, centerHz, height = 220 }: WaterfallProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(frames);
  const [tip, setTip] = useState<{ x: number; y: number; frame: RadioFrame; ageSecs: number; flip: boolean } | null>(null);

  // Wide enough to show the widest frame with some room on both sides.
  const widest = Math.max(0, ...frames.map((frame) => frame.bandwidthHz));
  const spanHz = Math.max(MIN_SPAN_HZ, widest * 2.5);
  const startHz = centerHz - spanHz / 2;

  useEffect(() => {
    latest.current = frames;
  }, [frames]);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    const colors = readTokens(element, { grid: '--line', sent: '--series-tx' });

    function draw() {
      if (!element || !context) return;
      const ratio = window.devicePixelRatio || 1;
      const width = element.clientWidth;
      if (element.width !== Math.round(width * ratio) || element.height !== Math.round(height * ratio)) {
        element.width = Math.round(width * ratio);
        element.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      // The tuned frequency, and a line every 15 seconds.
      context.fillStyle = colors.grid;
      context.fillRect(Math.round(width / 2), 0, 1, height);
      for (let seconds = 15; seconds < FRAME_WINDOW_MS / 1000; seconds += 15) {
        context.fillRect(0, Math.round((seconds * 1000 * height) / FRAME_WINDOW_MS), width, 1);
      }

      const geometry: Geometry = { width, height, startHz, spanHz, now: hubNow() };
      for (const frame of latest.current) {
        const bar = barOf(frame, geometry);
        if (bar.y > height) continue;
        context.fillStyle = frame.direction === 'tx' ? colors.sent : rssiColor(frame.rssi ?? RSSI_MIN);
        context.fillRect(bar.x, bar.y, bar.width, bar.height);
      }
    }

    draw();
    const timer = window.setInterval(draw, REDRAW_MS);
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => {
      window.clearInterval(timer);
      observer.disconnect();
    };
  }, [height, startHz, spanHz]);

  function onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const geometry: Geometry = { width: box.width, height, startHz, spanHz, now: hubNow() };
    // Bars are thin, so the target is taller than the mark. Newest wins when several overlap.
    let hit: RadioFrame | undefined;
    for (let index = frames.length - 1; index >= 0 && !hit; index -= 1) {
      const bar = barOf(frames[index]!, geometry);
      if (x >= bar.x && x <= bar.x + bar.width && y >= bar.y - 4 && y <= bar.y + bar.height + 4) hit = frames[index];
    }
    setTip(hit ? { x, y, frame: hit, ageSecs: Math.max(0, (geometry.now - hit.ts) / 1000), flip: x > box.width / 2 } : null);
  }

  const received = frames.filter((frame) => frame.direction === 'rx').length;

  return (
    <figure className={styles.waterfall}>
      <div className={styles.body}>
        <div className={styles.plot} style={{ height }}>
          <canvas
            ref={canvas}
            className={styles.canvas}
            role="img"
            aria-label={`${label}. ${received} received and ${frames.length - received} sent frames in the last minute.`}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setTip(null)}
          />
          {frames.length === 0 ? <span className={styles.empty}>No frames in the last minute</span> : null}
          {tip ? <FrameTip {...tip} /> : null}
        </div>
        <div className={styles.timeAxis} style={{ height }} aria-hidden>
          <span>now</span>
          <span>30 s</span>
          <span>60 s</span>
        </div>
      </div>
      <div className={`${styles.freqAxis} num`} aria-hidden>
        <span>{formatFrequency(startHz)}</span>
        <span>{formatFrequency(centerHz)}</span>
        <span>{formatFrequency(startHz + spanHz)}</span>
      </div>
      <figcaption className={styles.legend}>
        <span className={styles.legendItem}>
          Received, by signal
          <span className="num">{RSSI_MIN}</span>
          <span className={styles.ramp} style={{ background: RSSI_GRADIENT }} />
          <span className="num">{RSSI_MAX} dBm</span>
        </span>
        <span className={styles.legendItem}>
          <span className={styles.sentSwatch} />
          Sent
        </span>
      </figcaption>
    </figure>
  );
}

function FrameTip({ x, y, frame, ageSecs, flip }: { x: number; y: number; frame: RadioFrame; ageSecs: number; flip: boolean }) {
  return (
    <div className={styles.tip} data-side={flip ? 'left' : 'right'} style={{ left: x, top: y }}>
      <p className={styles.tipTitle}>
        {frame.direction === 'tx' ? `Sent${frame.peer ? ` to ${frame.peer}` : ''}` : `Received${frame.peer ? ` from ${frame.peer}` : ''}`}
      </p>
      <p className="num">
        {frame.rssi !== null ? `${frame.rssi} dBm, ` : ''}
        {frame.len} bytes, {Math.round(frame.durationMs)} ms on air
      </p>
      <p className={`${styles.tipMuted} num`}>
        {formatFrequency(frame.frequencyHz)}, {ageSecs.toFixed(1)} s ago
      </p>
    </div>
  );
}
