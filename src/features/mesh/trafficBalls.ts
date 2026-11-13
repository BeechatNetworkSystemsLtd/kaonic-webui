/*
 * The moving dots on the mesh map. Every mesh packet this device knows about
 * becomes one ball that travels its route hop by hop: it crosses a link in the
 * time the packet is on the air, and waits a moment at each relay, the way a
 * store-and-forward mesh really moves data.
 *
 * This module only knows about time and geometry; `useTrafficBalls` feeds it
 * packets and the current screen positions, and it draws onto a canvas.
 */

/** Sent by this device, addressed to it, or neither (relayed or overheard). */
export type BallKind = 'sent' | 'received' | 'passing';

export interface Ball {
  /** Node ids from where the ball starts to where it ends. */
  path: string[];
  /** `performance.now()` at launch. */
  start: number;
  /** Time to cross one link. */
  hopMs: number;
  kind: BallKind;
  radius: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/** A relay receives the whole packet, then sends it on: the ball rests at the node this long. */
export const RELAY_WAIT_MS = 220;
/** More than this many balls at once adds nothing but work; the oldest are dropped. */
export const MAX_BALLS = 120;
/** Pixels each direction is shifted off the link's centre line, so the two streams do not collide. */
const LANE_OFFSET = 3;
/** Fading copies drawn behind a ball, and how far back in time each one sits. */
const TRAIL_STEPS = 5;
const TRAIL_STEP_MS = 28;

const LANE: Record<BallKind, number> = { sent: 1, received: -1, passing: 0 };

export const ballRadius = (bytes: number) => 1.2 + Math.min(1, bytes / 1000) * 1.3;

/** Bigger packets are on the air longer. Slowed down from real airtime so the eye can follow. */
export const hopTime = (bytes: number) => 450 + Math.min(1, bytes / 1000) * 550;

const hopsOf = (ball: Ball) => ball.path.length - 1;

export const isFinished = (ball: Ball, now: number) => now - ball.start >= hopsOf(ball) * ball.hopMs + (hopsOf(ball) - 1) * RELAY_WAIT_MS;

interface Flight {
  point: ScreenPoint;
  /** The link the ball is on, as "from>to": the same for every ball travelling that link in that direction. */
  link: string;
  /** How far along the link it is, in pixels. */
  along: number;
}

/** Where a ball is at a given time and which link it is on, or null if a node on its path is not on the map. */
function flightOf(ball: Ball, now: number, positions: ReadonlyMap<string, ScreenPoint>): Flight | null {
  const hops = hopsOf(ball);
  const stage = ball.hopMs + RELAY_WAIT_MS;
  const elapsed = Math.max(0, now - ball.start);
  const hop = Math.min(hops - 1, Math.floor(elapsed / stage));
  const fromId = ball.path[hop]!;
  const toId = ball.path[hop + 1]!;
  const from = positions.get(fromId);
  const to = positions.get(toId);
  if (!from || !to) return null;

  // Within a stage the ball first crosses the link, then rests at the far end.
  const linear = Math.min(1, (elapsed - hop * stage) / ball.hopMs);
  // Ease in and out, so a ball seems to leave and arrive rather than slide through.
  const eased = linear * linear * (3 - 2 * linear);

  // Keep to one side of the link: sent on one lane, received on the other, the rest down the middle.
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const laneX = (-(to.y - from.y) / length) * LANE_OFFSET * LANE[ball.kind];
  const laneY = ((to.x - from.x) / length) * LANE_OFFSET * LANE[ball.kind];

  return {
    point: { x: from.x + (to.x - from.x) * eased + laneX, y: from.y + (to.y - from.y) * eased + laneY },
    link: `${fromId}>${toId}`,
    along: length * eased,
  };
}

/** Where a ball is at a given time, or null if a node on its path is not on the map. */
export function ballPosition(ball: Ball, now: number, positions: ReadonlyMap<string, ScreenPoint>): ScreenPoint | null {
  return flightOf(ball, now, positions)?.point ?? null;
}

/**
 * On the screen, balls on the same link closer together than this (pixels)
 * are one ball. A run of packets on a short link would otherwise pile up into
 * a single bright blob.
 */
const MERGE_WITHIN = 14;
/** A merged ball grows a little with what it stands for, up to this many times its size. */
const MERGE_GROWTH = 1.5;

export interface DrawnBall {
  ball: Ball;
  /** How many balls this one stands for. */
  count: number;
}

/**
 * Thins the balls down to the ones worth drawing: of several of the same kind
 * bunched together on one link, only the first is kept, and it remembers how
 * many it stands for.
 */
export function mergeBalls(balls: readonly Ball[], now: number, positions: ReadonlyMap<string, ScreenPoint>): DrawnBall[] {
  const slots = new Map<string, DrawnBall>();
  for (const ball of balls) {
    const flight = flightOf(ball, now, positions);
    if (!flight) continue;
    const slot = `${flight.link}:${ball.kind}:${Math.floor(flight.along / MERGE_WITHIN)}`;
    const taken = slots.get(slot);
    if (taken) taken.count += 1;
    else slots.set(slot, { ball, count: 1 });
  }
  return [...slots.values()];
}

/** Size, in pixels, of the pre-drawn glow image. It is scaled to each ball when drawn. */
const SPRITE = 64;
/** How many times wider than the ball its glow reaches. */
const GLOW_REACH = 2.5;

/**
 * A soft glowing dot, drawn once per colour and then stamped for every ball.
 * Stamping an image costs almost nothing; blurring a shadow per ball per frame
 * (the obvious way to get a glow) kept a whole CPU core busy.
 */
export function makeGlowSprite(color: string): HTMLCanvasElement {
  const sprite = document.createElement('canvas');
  sprite.width = SPRITE;
  sprite.height = SPRITE;
  const context = sprite.getContext('2d');
  if (!context) return sprite;
  const centre = SPRITE / 2;
  context.fillStyle = color;
  // Many faint discs of shrinking size add up to a smooth falloff in the ball's own colour.
  const layers = 14;
  context.globalAlpha = 0.07;
  for (let layer = 0; layer < layers; layer += 1) {
    context.beginPath();
    context.arc(centre, centre, centre * (1 - layer / layers), 0, Math.PI * 2);
    context.fill();
  }
  // The solid core: the ball itself.
  context.globalAlpha = 0.95;
  context.beginPath();
  context.arc(centre, centre, centre / GLOW_REACH, 0, Math.PI * 2);
  context.fill();
  return sprite;
}

/**
 * Draws the balls, each with its glow and a short fading tail.
 *
 * `scale` shrinks them with the map: zoomed out, where devices are small and
 * close together, a ball must be small too, or it swallows the devices it
 * passes.
 */
export function drawBalls(
  context: CanvasRenderingContext2D,
  balls: readonly Ball[],
  now: number,
  positions: ReadonlyMap<string, ScreenPoint>,
  sprites: Record<BallKind, CanvasImageSource>,
  colors: Record<BallKind, string>,
  scale: number,
) {
  for (const { ball, count } of mergeBalls(balls, now, positions)) {
    const radius = ball.radius * scale * Math.min(MERGE_GROWTH, 1 + (count - 1) * 0.12);
    context.fillStyle = colors[ball.kind];
    for (let step = TRAIL_STEPS; step >= 1; step -= 1) {
      const point = ballPosition(ball, now - step * TRAIL_STEP_MS, positions);
      if (!point) continue;
      context.globalAlpha = 0.28 * (1 - step / (TRAIL_STEPS + 1));
      context.beginPath();
      context.arc(point.x, point.y, radius * (1 - step / (TRAIL_STEPS + 2)), 0, Math.PI * 2);
      context.fill();
    }
    const head = ballPosition(ball, now, positions);
    if (!head) continue;
    const size = radius * GLOW_REACH * 2;
    // Traffic that is not ours is drawn fainter: it is context, not the story.
    context.globalAlpha = ball.kind === 'passing' ? 0.55 : 0.9;
    context.drawImage(sprites[ball.kind], head.x - size / 2, head.y - size / 2, size, size);
  }
  context.globalAlpha = 1;
}
