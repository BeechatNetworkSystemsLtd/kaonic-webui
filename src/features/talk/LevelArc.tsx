import { useEffect, useRef } from 'react';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { ease, levelOf } from './spectrum';
import styles from './TalkPage.module.css';

/*
 * The loudness around the Talk button: an arc that rises from the bottom up
 * both sides and meets at the top at full level. It is moved directly (no
 * React render per animation frame). With reduced motion it updates four
 * times a second, without easing.
 */

/** Half the circle: each side covers this much of the path at full level. */
const HALF = 50;

export function LevelArc({
  analyser,
  level,
  tone,
}: {
  /** Audio in this browser, when there is some. */
  analyser: () => AnalyserNode | null;
  /** The level the hub reports, 0..1, for when there is none. */
  level: number;
  /** Colours the arc: talking from here, or receiving. */
  tone: 'idle' | 'tx' | 'rx';
}) {
  const sides = useRef<Array<SVGCircleElement | null>>([]);
  const levelRef = useRef(level);
  useEffect(() => {
    levelRef.current = level;
  }, [level]);
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');

  useEffect(() => {
    let frame: number | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let bins: Uint8Array<ArrayBuffer> | null = null;
    let shown = 0;
    const draw = () => {
      const node = analyser();
      let target = levelRef.current;
      if (node) {
        if (!bins || bins.length !== node.frequencyBinCount) bins = new Uint8Array(node.frequencyBinCount);
        node.getByteFrequencyData(bins);
        target = levelOf(bins);
      }
      shown = reduced ? target : ease(shown, target);
      const dash = `${(shown * HALF).toFixed(2)} 100`;
      for (const side of sides.current) side?.setAttribute('stroke-dasharray', dash);
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
  }, [analyser, reduced]);

  return (
    <svg className={styles.arc} data-tone={tone} viewBox="0 0 100 100" aria-hidden="true">
      <circle className={styles.arcTrack} cx="50" cy="50" r="38" />
      {/* Both start at the bottom; one runs up the left side, its mirror up the right. */}
      {[0, 1].map((side) => (
        <circle
          key={side}
          ref={(element) => {
            sides.current[side] = element;
          }}
          className={styles.arcFill}
          cx="50"
          cy="50"
          r="38"
          pathLength={100}
          strokeDasharray="0 100"
          transform={side === 0 ? 'rotate(90 50 50)' : 'rotate(90 50 50) scale(1 -1) translate(0 -100)'}
        />
      ))}
    </svg>
  );
}
