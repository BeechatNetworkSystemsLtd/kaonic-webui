import { useEffect, useRef } from 'react';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { clampBands, meterBars, spectrumBars } from './spectrum';
import styles from './TalkPage.module.css';

/*
 * The level animation above the Talk button, as in the plugin: bands of the
 * spectrum while audio plays or is captured in this browser, else a meter of
 * the level the hub reports. Bars are moved directly (no React render per
 * animation frame). With reduced motion the bars update four times a second,
 * without easing.
 */

const MAX_HEIGHT_PX = 44;
const MIN_HEIGHT_PX = 3;

export function Spectrum({
  bands,
  analyser,
  level,
  tone,
}: {
  bands: number;
  /** Audio in this browser, when there is some. */
  analyser: () => AnalyserNode | null;
  /** The level the hub reports, 0..1, for when there is none. */
  level: number;
  /** Colours the bars: talking from here, or receiving. */
  tone: 'idle' | 'tx' | 'rx';
}) {
  const count = clampBands(bands);
  const bars = useRef<Array<HTMLDivElement | null>>([]);
  const levelRef = useRef(level);
  useEffect(() => {
    levelRef.current = level;
  }, [level]);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');

  useEffect(() => {
    let frame: number | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let bins: Uint8Array<ArrayBuffer> | null = null;
    const draw = () => {
      const node = analyser();
      let heights: number[];
      if (node) {
        if (!bins || bins.length !== node.frequencyBinCount) bins = new Uint8Array(node.frequencyBinCount);
        node.getByteFrequencyData(bins);
        heights = spectrumBars(bins, count);
      } else {
        heights = meterBars(levelRef.current, count);
      }
      heights.forEach((height, index) => {
        const bar = bars.current[index];
        if (bar) bar.style.height = `${(MIN_HEIGHT_PX + height * (MAX_HEIGHT_PX - MIN_HEIGHT_PX)).toFixed(1)}px`;
      });
    };
    if (reduced) {
      timer = setInterval(draw, 250);
    } else {
      const loop = () => {
        draw();
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
    }
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (timer !== null) clearInterval(timer);
    };
  }, [analyser, count, reduced]);

  return (
    <div className={styles.spectrum} data-tone={tone} data-reduced={reduced || undefined} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className={styles.bar}
          ref={(element) => {
            bars.current[index] = element;
          }}
        />
      ))}
    </div>
  );
}
