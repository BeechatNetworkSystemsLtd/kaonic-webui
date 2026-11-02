import { describe, expect, it } from 'vitest';
import { onPlane, pickOnPlane, project, type View, type Viewport } from './projection';

const viewport: Viewport = { width: 800, height: 600, extent: 3, margin: 50 };
const front: View = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 };

describe('projection', () => {
  it('puts the centre of the scene in the centre of the viewport', () => {
    expect(project({ x: 0, y: 0, z: 0 }, front, viewport)).toMatchObject({ x: 400, y: 300, scale: 1, depth: 0 });
  });

  it('keeps a point on the plane at its radius from the centre', () => {
    const point = onPlane(2, 1.1);
    expect(point.y).toBe(0);
    expect(Math.hypot(point.x, point.z)).toBeCloseTo(2);
  });

  it('draws nearer points larger', () => {
    const near = project({ x: 0, y: 0, z: -3 }, front, viewport);
    const far = project({ x: 0, y: 0, z: 3 }, front, viewport);
    expect(near.scale).toBeGreaterThan(1);
    expect(far.scale).toBeLessThan(1);
  });

  it('fits the outermost ring in the width at zoom 1 and scales with zoom', () => {
    const edge = project({ x: 3, y: 0, z: 0 }, front, viewport);
    expect(edge.x).toBeLessThanOrEqual(800 - 50);
    const zoomed = project({ x: 3, y: 0, z: 0 }, { ...front, zoom: 2 }, viewport);
    expect(zoomed.x - 400).toBeCloseTo((edge.x - 400) * 2);
  });

  it('moves up on screen for points above the equator, and tilting shows the far side higher', () => {
    expect(project({ x: 0, y: 1, z: 0 }, front, viewport).y).toBeLessThan(300);
    expect(project({ x: 0, y: 0, z: 2 }, { ...front, pitch: 0.5 }, viewport).y).toBeLessThan(300);
  });

  it('turns the scene with yaw', () => {
    const quarter = project({ x: 1, y: 0, z: 0 }, { ...front, yaw: Math.PI / 2 }, viewport);
    expect(quarter.x).toBeCloseTo(400);
    expect(quarter.depth).toBeCloseTo(-1);
  });
});

describe('picking the plane', () => {
  const view: View = { yaw: 0.7, pitch: 1.1, zoom: 1.3, panX: 40, panY: -25 };

  it('finds the plane point that was projected to a screen position', () => {
    for (const [radius, angle] of [[1, 0.3], [2.5, 2], [3, -1.2]] as const) {
      const screen = project(onPlane(radius, angle), view, viewport);
      const hit = pickOnPlane(screen, view, viewport)!;
      expect(hit.radius).toBeCloseTo(radius);
      // The pick is in view coordinates: add the turn to get back to the mesh's own angle.
      expect(Math.cos(hit.angle + view.yaw)).toBeCloseTo(Math.cos(angle));
      expect(Math.sin(hit.angle + view.yaw)).toBeCloseTo(Math.sin(angle));
    }
  });

  it('sees nothing above the horizon', () => {
    expect(pickOnPlane({ x: 400, y: -5000 }, { ...front, pitch: 0.2 }, viewport)).toBeNull();
  });
});
