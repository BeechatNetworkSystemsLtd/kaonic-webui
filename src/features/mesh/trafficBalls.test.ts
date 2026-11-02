import { describe, expect, it } from 'vitest';
import { ballPosition, isFinished, mergeBalls, RELAY_WAIT_MS, type Ball } from './trafficBalls';

const positions = new Map([
  ['self', { x: 0, y: 0 }],
  ['a', { x: 100, y: 0 }],
  ['b', { x: 100, y: 100 }],
]);
const HOP = 800;
const ball: Ball = { path: ['self', 'a', 'b'], start: 1000, hopMs: HOP, kind: 'sent', radius: 3 };

describe('traffic balls', () => {
  it('travels the path hop by hop, on its own lane beside the link', () => {
    const start = ballPosition(ball, 1000, positions)!;
    expect(start.x).toBeCloseTo(0);
    expect(Math.abs(start.y)).toBeCloseTo(3);

    const midFirstHop = ballPosition(ball, 1000 + HOP / 2, positions)!;
    expect(midFirstHop.x).toBeCloseTo(50);

    const midSecondHop = ballPosition(ball, 1000 + HOP + RELAY_WAIT_MS + HOP / 2, positions)!;
    expect(midSecondHop.y).toBeCloseTo(50);
    expect(Math.abs(midSecondHop.x - 100)).toBeCloseTo(3);
  });

  it('rests at a relay before going on', () => {
    const arriving = ballPosition(ball, 1000 + HOP, positions)!;
    const waiting = ballPosition(ball, 1000 + HOP + RELAY_WAIT_MS - 1, positions)!;
    expect(waiting.x).toBeCloseTo(arriving.x);
    expect(waiting.y).toBeCloseTo(arriving.y);
  });

  it('keeps sent and received on opposite lanes, and other traffic on the line', () => {
    const at = (kind: Ball['kind']) => ballPosition({ ...ball, kind }, 1000 + HOP / 2, positions)!;
    expect(at('sent').y).toBeCloseTo(-at('received').y);
    expect(at('passing').y).toBeCloseTo(0);
  });

  it('finishes after its hops and the waits between them', () => {
    const total = 2 * HOP + RELAY_WAIT_MS;
    expect(isFinished(ball, 1000 + total - 1)).toBe(false);
    expect(isFinished(ball, 1000 + total)).toBe(true);
  });

  it('is not drawn when a node on its path has left the map', () => {
    expect(ballPosition({ ...ball, path: ['self', 'gone'] }, 1000, positions)).toBeNull();
  });

  it('draws a bunch of balls on one link as a single ball that knows how many it stands for', () => {
    // Five packets sent 10 ms apart are within a pixel or two of each other.
    const burst = Array.from({ length: 5 }, (_, index) => ({ ...ball, start: 1000 + index * 10 }));
    const drawn = mergeBalls(burst, 1000 + HOP / 2, positions);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.count).toBe(5);
  });

  it('keeps balls apart that are apart: further along the link, on another link, or going the other way', () => {
    const now = 1000 + HOP / 2;
    const spaced = mergeBalls([ball, { ...ball, start: 1000 + HOP / 3 }], now, positions);
    expect(spaced).toHaveLength(2);
    const otherLink = mergeBalls([ball, { ...ball, start: 1000 - HOP - RELAY_WAIT_MS }], now, positions);
    expect(otherLink).toHaveLength(2);
    const bothWays = mergeBalls([ball, { ...ball, kind: 'received', path: ['a', 'self'] }], now, positions);
    expect(bothWays).toHaveLength(2);
  });
});
