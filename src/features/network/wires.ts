/*
 * Geometry of the wires on the Network page. Pure functions: boxes in, SVG
 * paths out. A wire is always drawn in the direction traffic flows, so the
 * moving dots on it run the right way without knowing anything else.
 */

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Wire {
  /** SVG path data, from where traffic comes to where it goes. */
  path: string;
  from: Point;
  to: Point;
}

/** `wide`: sources left, device in the middle, consumers right. `tall`: everything stacked, wired along the left edge. */
export type Layout = 'wide' | 'tall';

/** Distance between neighbouring wires where several meet the device. */
const PORT_SPACING = 16;
/** In the tall layout, wires run down lanes left of the cards. */
const LANE = { first: 14, spacing: 9, corner: 8 };

const middle = (box: Box) => box.top + box.height / 2;
/** Where the n-th of `count` wires attaches, spread evenly around a centre. */
const spread = (index: number, count: number, spacing: number) => (index - (count - 1) / 2) * spacing;

/** A smooth left-to-right curve, the kind node editors draw. */
function curve(from: Point, to: Point): string {
  const reach = Math.max(36, (to.x - from.x) / 2);
  return `M${from.x},${from.y} C${from.x + reach},${from.y} ${to.x - reach},${to.y} ${to.x},${to.y}`;
}

/** Out to a lane on the left, along it, and back in: a wire with two rounded corners. */
function viaLane(from: Point, to: Point, laneX: number): string {
  const down = to.y > from.y ? 1 : -1;
  const r = Math.min(LANE.corner, Math.abs(to.y - from.y) / 2);
  return [
    `M${from.x},${from.y}`,
    `H${laneX + r}`,
    `Q${laneX},${from.y} ${laneX},${from.y + r * down}`,
    `V${to.y - r * down}`,
    `Q${laneX},${to.y} ${laneX + r},${to.y}`,
    `H${to.x}`,
  ].join(' ');
}

/**
 * Wires from every source into the device and from the device out to every
 * consumer. Boxes are given top to bottom; the result has the same order.
 */
export function layoutWires(layout: Layout, sources: readonly Box[], hub: Box, consumers: readonly Box[]): { sources: Wire[]; consumers: Wire[] } {
  if (layout === 'wide') {
    return {
      sources: sources.map((box, index) => {
        const from = { x: box.left + box.width, y: middle(box) };
        const to = { x: hub.left, y: middle(hub) + spread(index, sources.length, PORT_SPACING) };
        return { path: curve(from, to), from, to };
      }),
      consumers: consumers.map((box, index) => {
        const from = { x: hub.left + hub.width, y: middle(hub) + spread(index, consumers.length, PORT_SPACING) };
        const to = { x: box.left, y: middle(box) };
        return { path: curve(from, to), from, to };
      }),
    };
  }

  // Tall: sources sit above the device and consumers below. The card furthest from the
  // device takes the outermost lane, so no wire has to cross another card's wire.
  const lane = (order: number) => hub.left - LANE.first - order * LANE.spacing;
  const hubInY = (order: number) => middle(hub) - PORT_SPACING / 2 - order * LANE.spacing;
  const hubOutY = (order: number) => middle(hub) + PORT_SPACING / 2 + order * LANE.spacing;
  return {
    sources: sources.map((box, index) => {
      const order = sources.length - 1 - index;
      const from = { x: box.left, y: middle(box) };
      const to = { x: hub.left, y: hubInY(order) };
      return { path: viaLane(from, to, lane(order)), from, to };
    }),
    consumers: consumers.map((box, index) => {
      const from = { x: hub.left, y: hubOutY(index) };
      const to = { x: box.left, y: middle(box) };
      return { path: viaLane(from, to, lane(index)), from, to };
    }),
  };
}
