import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { MeshPacket } from '@/api';
import { useHubStream } from '@/data/queries';
import { readTokens } from '@/lib/tokens';
import { routeBetween, SELF, type MeshNode } from './meshLayout';
import { ballRadius, drawBalls, hopTime, isFinished, makeGlowSprite, MAX_BALLS, type Ball, type BallKind, type ScreenPoint } from './trafficBalls';

/** What the animation needs to know about the map as it is drawn right now. */
export interface MeshScene {
  nodes: MeshNode[];
  positions: Map<string, ScreenPoint>;
  /** How large balls are drawn, 1 being full size. Follows the size of the nodes. */
  ballScale: number;
}

/**
 * Animates traffic on the mesh map. Each mesh packet launches one ball along
 * its route: out from this device, in to it, through it, or between two other
 * devices.
 *
 * The balls are painted on a canvas, outside React. The paint loop runs only
 * while there is a ball in flight; with no traffic it costs nothing.
 */
export function useTrafficBalls(canvas: RefObject<HTMLCanvasElement | null>, scene: RefObject<MeshScene>) {
  const balls = useRef<Ball[]>([]);
  const frame = useRef(0);
  /** Colours and glow sprites, rebuilt only when the theme's colours change. */
  const look = useRef<{ key: string; colors: Record<BallKind, string>; sprites: Record<BallKind, HTMLCanvasElement> } | null>(null);

  const start = useCallback(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (frame.current || !element || !context) return;

    const colors: Record<BallKind, string> = readTokens(element, { sent: '--series-tx', received: '--series-rx', passing: '--series-other' });
    const key = `${colors.sent} ${colors.received} ${colors.passing}`;
    if (look.current?.key !== key) {
      const sprites = { sent: makeGlowSprite(colors.sent), received: makeGlowSprite(colors.received), passing: makeGlowSprite(colors.passing) };
      look.current = { key, colors, sprites };
    }
    const { sprites } = look.current;

    const paint = (now: number) => {
      // The canvas is sized in device pixels; draw in CSS pixels.
      const ratio = element.clientWidth > 0 ? element.width / element.clientWidth : 1;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, element.clientWidth, element.clientHeight);
      balls.current = balls.current.filter((ball) => !isFinished(ball, now));
      if (balls.current.length === 0) {
        frame.current = 0;
        return;
      }
      drawBalls(context, balls.current, now, scene.current.positions, sprites, colors, scene.current.ballScale);
      frame.current = requestAnimationFrame(paint);
    };
    frame.current = requestAnimationFrame(paint);
  }, [canvas, scene]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const launch = useCallback(
    (packets: MeshPacket[]) => {
      // Nobody is watching a hidden tab, and people who ask for less motion get none.
      if (document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const now = performance.now();
      for (const packet of packets) {
        const path = routeBetween(scene.current.nodes, packet.fromId ?? SELF, packet.toId ?? SELF);
        if (!path || path.length < 2) continue;
        const kind: BallKind = packet.fromId === null ? 'sent' : packet.toId === null ? 'received' : 'passing';
        balls.current.push({ path, start: now, hopMs: hopTime(packet.bytes), kind, radius: ballRadius(packet.bytes) });
      }
      balls.current = balls.current.slice(-MAX_BALLS);
      if (balls.current.length > 0) start();
    },
    [scene, start],
  );
  useHubStream('packets', launch);
}
