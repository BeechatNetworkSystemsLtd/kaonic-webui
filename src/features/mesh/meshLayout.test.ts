import { describe, expect, it } from 'vitest';
import type { Peer } from '@/api';
import { hopDistance, layoutMesh, LINEAR_HOPS, pathToSelf, routeBetween, SELF } from './meshLayout';

const peer = (id: string, hops: number | null, viaId: string | null = null): Peer => ({
  id,
  codename: id,
  tag: '',
  online: hops !== null,
  firstSeenTs: 0,
  lastSeenTs: 0,
  list: 'none',
  version: '1.0.0',
  hops,
  viaId,
  rssi: null,
  rttMs: null,
  tunnelIp: null,
  trust: { network: 'unknown', isAdmin: false, provisioning: null },
  link: { state: 'none', detail: null },
});

describe('hop distance', () => {
  it('spaces near hops evenly and compresses far ones, without ever reversing the order', () => {
    expect(hopDistance(1)).toBe(1);
    expect(hopDistance(LINEAR_HOPS)).toBe(LINEAR_HOPS);
    // No jump where the two scales meet.
    expect(hopDistance(LINEAR_HOPS + 1)).toBe(LINEAR_HOPS + 1);
    // 127 hops fits in about a dozen steps instead of 127.
    expect(hopDistance(127)).toBeLessThan(13);
    for (let hops = 1; hops < 128; hops += 1) expect(hopDistance(hops + 1)).toBeGreaterThan(hopDistance(hops));
  });
});

describe('mesh layout', () => {
  const peers = [peer('a', 1), peer('b', 1), peer('a1', 2, 'a'), peer('a2', 2, 'a'), peer('a1x', 3, 'a1'), peer('lost', null), peer('orphan', 2)];
  const layout = layoutMesh(peers);
  const node = (id: string) => layout.nodes.find((n) => n.id === id)!;

  it('puts each peer on the ring of its hop count', () => {
    expect(layout.hopRings).toBe(3);
    expect(node(SELF).ring).toBe(0);
    expect(node('a').ring).toBe(1);
    expect(node('a1').ring).toBe(2);
    expect(node('a1x').ring).toBe(3);
  });

  it('links neighbours to this device and further peers to the one they are reached through', () => {
    expect(node('a').linkTo).toBe(SELF);
    expect(node('a1').linkTo).toBe('a');
    expect(pathToSelf(layout.nodes, 'a1x')).toEqual(['a1x', 'a1', 'a', SELF]);
  });

  it('draws no link when the path is unknown, and keeps out-of-range peers on their own ring', () => {
    expect(node('orphan').linkTo).toBeNull();
    expect(node('orphan').ring).toBe(2);
    expect(layout.outOfRangeRing).toBe(4);
    expect(node('lost')).toMatchObject({ ring: 4, linkTo: null, inRange: false });
  });

  it('keeps a branch inside its parent slice so links do not cross', () => {
    const [low, high] = [node('a1').angle, node('a2').angle].sort((x, y) => x - y);
    expect(node('a').angle).toBeGreaterThan(low!);
    expect(node('a').angle).toBeLessThan(high!);
    // A branch with more devices behind it gets a wider slice than a lone neighbour.
    const angles = layout.nodes.filter((n) => n.id !== SELF).map((n) => n.angle);
    expect(new Set(angles.map((angle) => angle.toFixed(6))).size).toBeGreaterThan(4);
  });

  it('routes a packet between any two devices through the node they have in common', () => {
    // To and from this device: straight along the branch.
    expect(routeBetween(layout.nodes, SELF, 'a1x')).toEqual([SELF, 'a', 'a1', 'a1x']);
    expect(routeBetween(layout.nodes, 'a1x', SELF)).toEqual(['a1x', 'a1', 'a', SELF]);
    // Different branches: through this device.
    expect(routeBetween(layout.nodes, 'a1', 'b')).toEqual(['a1', 'a', SELF, 'b']);
    // Same branch: it turns round at the shared neighbour and never reaches this device.
    expect(routeBetween(layout.nodes, 'a1x', 'a2')).toEqual(['a1x', 'a1', 'a', 'a2']);
    expect(routeBetween(layout.nodes, 'a', 'a1')).toEqual(['a', 'a1']);
    // No known link, no route.
    expect(routeBetween(layout.nodes, SELF, 'orphan')).toBeNull();
    expect(routeBetween(layout.nodes, SELF, 'lost')).toBeNull();
  });

  it('handles an empty mesh', () => {
    expect(layoutMesh([])).toMatchObject({ hopRings: 0, rings: [], outOfRangeRing: null, nodes: [{ id: SELF }] });
  });

  it('draws a ring for every near hop, and for far hops only where a device is', () => {
    expect(layout.rings).toEqual([1, 2, 3]);
    const far = layoutMesh([peer('a', 1), peer('far', 127, 'a'), peer('mid', 40, 'a')]);
    expect(far.hopRings).toBe(127);
    expect(far.rings).toEqual([1, 2, 3, 4, 5, 40, 127]);
  });

  it('curls a long chain of relays into a spiral instead of stacking it on one line', () => {
    const chain = Array.from({ length: 40 }, (_, index) => peer(`n${index + 1}`, index + 1, index === 0 ? null : `n${index}`));
    const placed = layoutMesh(chain).nodes.filter((n) => n.id !== SELF);
    const angles = placed.map((n) => n.angle);
    // Near hops keep their direction; every far hop turns a little further the same way.
    expect(new Set(angles.slice(0, LINEAR_HOPS)).size).toBe(1);
    for (let index = LINEAR_HOPS; index < angles.length; index += 1) expect(angles[index]!).toBeGreaterThan(angles[index - 1]!);
    // Neighbours on the chain end up apart on the map, not on top of each other.
    const at = (n: (typeof placed)[number]) => ({ x: hopDistance(n.ring) * Math.cos(n.angle), y: hopDistance(n.ring) * Math.sin(n.angle) });
    for (let index = LINEAR_HOPS; index < placed.length; index += 1) {
      const a = at(placed[index]!);
      const b = at(placed[index - 1]!);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.4);
    }
  });

  it('thins out far rings when every hop is occupied, keeping the furthest', () => {
    // A chain with one device on every hop from 1 to 127.
    const chain = Array.from({ length: 127 }, (_, index) => peer(`n${index + 1}`, index + 1, index === 0 ? null : `n${index}`));
    const { rings } = layoutMesh(chain);
    expect(rings.slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(rings.at(-1)).toBe(127);
    expect(rings.length).toBeLessThan(20);
    // No two neighbouring rings are crowded together.
    for (let index = 1; index < rings.length; index += 1) {
      expect(hopDistance(rings[index]!) - hopDistance(rings[index - 1]!)).toBeGreaterThanOrEqual(0.6 - 1e-9);
    }
  });
});
