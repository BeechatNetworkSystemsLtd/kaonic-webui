import type { Peer } from '@/api';

/*
 * Where each device goes on the mesh map. Pure geometry, no rendering.
 *
 * This device is the centre. A peer sits on the ring of its hop count, so
 * distance from the centre is distance in hops. All devices lie on one plane;
 * the map shows that plane in 3D.
 *
 * Peers reached through the same neighbour are fanned out behind it, so each
 * branch of the mesh gets its own slice of the circle and links do not cross.
 * Beyond the near hops a branch also curls round the centre (see `FAR_ARC`).
 */

/** Id of this device in the layout. */
export const SELF = 'self';

export interface MeshNode {
  id: string;
  /** Null for this device. */
  peer: Peer | null;
  /** 0 for this device, the hop count for peers in range, the outermost ring for the rest. */
  ring: number;
  /** Direction from the centre, in radians. */
  angle: number;
  /** The node a link is drawn to. Null when there is no known link (this device, or a path we cannot tell). */
  linkTo: string | null;
  inRange: boolean;
}

export interface MeshLayout {
  nodes: MeshNode[];
  /** The largest hop count in range. */
  hopRings: number;
  /**
   * The hop counts that get a ring drawn, nearest first: every one of the near
   * hops, and beyond those only ones that have a device on them and are not
   * crowded against the ring before. The furthest occupied hop always has one.
   */
  rings: number[];
  /** The ring holding devices that are out of range, or null if there are none. */
  outOfRangeRing: number | null;
}

/** Up to this many hops, every hop is one equal step out from the centre. */
export const LINEAR_HOPS = 5;

/**
 * How far from the centre a hop count is drawn, in steps.
 *
 * Near hops are spaced evenly: that is where most devices are and where the
 * difference between hops matters. Reticulum allows paths of up to 128 hops,
 * and spacing those evenly would squeeze the near mesh into a dot, so beyond
 * `LINEAR_HOPS` each doubling of the distance adds one more step. Further is
 * still always further out.
 */
export function hopDistance(hops: number): number {
  return hops <= LINEAR_HOPS ? hops : LINEAR_HOPS + Math.log2(hops - LINEAR_HOPS + 1);
}

/**
 * Far out, hops are drawn close together, so a long run of relays would stack
 * up into one solid line. Instead each far device is turned a little further
 * round the centre than the one before it: a chain of relays becomes a spiral
 * arm, and its devices stay apart. This is the distance along the arc, in
 * steps, from one device to the next.
 */
const FAR_ARC = 0.55;

/** Far rings closer together than this (in steps) would run into each other; the nearer one of a pair is kept. */
const MIN_RING_GAP = 0.6;

/** Picks the rings to draw for the hop counts that have devices on them. */
function ringsFor(occupied: ReadonlySet<number>): number[] {
  const furthest = Math.max(0, ...occupied);
  const rings = Array.from({ length: Math.min(furthest, LINEAR_HOPS) }, (_, index) => index + 1);
  for (const hops of [...occupied].filter((count) => count > LINEAR_HOPS).sort((a, b) => a - b)) {
    const roomBefore = hopDistance(hops) - hopDistance(rings.at(-1) ?? 0) >= MIN_RING_GAP;
    // Leave room for the furthest ring too, which is drawn whatever happens.
    const roomAfter = hops === furthest || hopDistance(furthest) - hopDistance(hops) >= MIN_RING_GAP;
    if (roomBefore && roomAfter) rings.push(hops);
  }
  if (furthest > LINEAR_HOPS && rings.at(-1) !== furthest) rings.push(furthest);
  return rings;
}

const isInRange = (peer: Peer) => peer.online && peer.hops !== null && peer.hops >= 1;

export function layoutMesh(peers: readonly Peer[]): MeshLayout {
  const inRange = new Map(peers.filter(isInRange).map((peer) => [peer.id, peer]));
  const occupied = new Set([...inRange.values()].map((peer) => peer.hops!));
  const hopRings = Math.max(0, ...occupied);
  const rings = ringsFor(occupied);
  const lost = peers.filter((peer) => !isInRange(peer));
  const outOfRangeRing = lost.length > 0 ? hopRings + 1 : null;

  /** The node a peer is linked to, if we know it: this device for neighbours, else a nearer peer. */
  function linkOf(peer: Peer): string | null {
    if (!isInRange(peer)) return null;
    if (peer.hops === 1) return SELF;
    const via = peer.viaId ? inRange.get(peer.viaId) : undefined;
    return via && via.hops! < peer.hops! ? via.id : null;
  }

  // The tree used for placing nodes. A node without a known link hangs off the centre.
  const children = new Map<string, Peer[]>();
  for (const peer of peers) {
    const parent = linkOf(peer) ?? SELF;
    children.set(parent, [...(children.get(parent) ?? []), peer]);
  }
  for (const list of children.values()) list.sort((a, b) => a.codename.localeCompare(b.codename));

  const leaves = (id: string): number => {
    const own = children.get(id) ?? [];
    return own.length === 0 ? 1 : own.reduce((sum, child) => sum + leaves(child.id), 0);
  };

  const nodes: MeshNode[] = [{ id: SELF, peer: null, ring: 0, angle: 0, linkTo: null, inRange: true }];

  /** Gives each child a share of its parent's slice in proportion to how many devices are behind it. */
  function place(parentId: string, start: number, end: number) {
    const own = children.get(parentId) ?? [];
    const total = own.reduce((sum, child) => sum + leaves(child.id), 0);
    let from = start;
    for (const child of own) {
      const to = from + ((end - start) * leaves(child.id)) / total;
      const reachable = isInRange(child);
      // A far device, and everything behind it, is turned round the centre by one arc length.
      const turn = reachable && child.hops! > LINEAR_HOPS ? FAR_ARC / hopDistance(child.hops!) : 0;
      nodes.push({
        id: child.id,
        peer: child,
        ring: reachable ? child.hops! : (outOfRangeRing ?? hopRings + 1),
        angle: (from + to) / 2 + turn,
        linkTo: linkOf(child),
        inRange: reachable,
      });
      place(child.id, from + turn, to + turn);
      from = to;
    }
  }
  place(SELF, 0, 2 * Math.PI);

  return { nodes, hopRings, rings, outOfRangeRing };
}

/**
 * The ids a packet passes on its way from one node to another, both ends
 * included. The mesh is drawn as a tree around this device, so the route climbs
 * from the sender to the first node the two have in common and descends to the
 * receiver. Null if either end has no known link into the mesh.
 */
export function routeBetween(nodes: readonly MeshNode[], fromId: string, toId: string): string[] | null {
  const up = pathToSelf(nodes, fromId);
  const down = pathToSelf(nodes, toId);
  if (up.at(-1) !== SELF || down.at(-1) !== SELF) return null;
  const meet = up.findIndex((id) => down.includes(id));
  return [...up.slice(0, meet + 1), ...down.slice(0, down.indexOf(up[meet]!)).reverse()];
}

/** The ids from a node back to this device, following known links. Starts with the node itself. */
export function pathToSelf(nodes: readonly MeshNode[], id: string): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const path: string[] = [];
  for (let current = byId.get(id); current; current = current.linkTo ? byId.get(current.linkTo) : undefined) {
    path.push(current.id);
  }
  return path;
}
