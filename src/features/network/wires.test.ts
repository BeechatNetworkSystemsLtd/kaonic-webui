import { describe, expect, it } from 'vitest';
import { layoutWires, type Box } from './wires';

const box = (left: number, top: number): Box => ({ left, top, width: 200, height: 80 });

describe('network wires', () => {
  it('runs left to right in the wide layout: source edge, device, consumer edge', () => {
    const { sources, consumers } = layoutWires('wide', [box(0, 0), box(0, 100)], box(300, 50), [box(600, 50)]);
    expect(sources[0]!.from).toEqual({ x: 200, y: 40 });
    expect(sources[0]!.to.x).toBe(300);
    expect(consumers[0]!.from.x).toBe(500);
    expect(consumers[0]!.to).toEqual({ x: 600, y: 90 });
    // Two wires into the device do not share a port.
    expect(sources[0]!.to.y).not.toBe(sources[1]!.to.y);
    // A single wire attaches at the middle.
    expect(consumers[0]!.from.y).toBe(90);
  });

  it('wires the tall layout along lanes on the left, furthest card outermost', () => {
    const { sources, consumers } = layoutWires('tall', [box(60, 0), box(60, 100)], box(60, 200), [box(60, 300), box(60, 400)]);
    const laneOf = (path: string) => Number(/Q([\d.-]+),/.exec(path)![1]);
    // The top source is further from the device than the second one.
    expect(laneOf(sources[0]!.path)).toBeLessThan(laneOf(sources[1]!.path));
    // The bottom consumer is further than the first one.
    expect(laneOf(consumers[1]!.path)).toBeLessThan(laneOf(consumers[0]!.path));
    // Traffic direction: sources end at the device, consumers start there.
    expect(sources[0]!.to.x).toBe(60);
    expect(consumers[0]!.from.x).toBe(60);
    expect(sources[0]!.to.y).toBeLessThan(240);
    expect(consumers[0]!.from.y).toBeGreaterThan(240);
  });
});
