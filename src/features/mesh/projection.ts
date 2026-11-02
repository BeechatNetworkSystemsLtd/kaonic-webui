/*
 * The little bit of 3D the mesh map needs: turn a point in space into a point
 * on screen, given where the viewer is looking from. No library, no WebGL; the
 * map has a few dozen points at most.
 *
 * Space: x to the right, y up, z away from the viewer. Units are hops.
 */

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface View {
  /** Rotation around the vertical axis, radians. */
  yaw: number;
  /** Tilt, radians. Positive looks down on the scene from above. */
  pitch: number;
  /** 1 fits the whole mesh in the viewport. */
  zoom: number;
  /** How far the mesh centre is moved from the middle of the viewport, in pixels. */
  panX: number;
  panY: number;
}

export interface Viewport {
  width: number;
  height: number;
  /** Radius of the mesh in hops: the outermost ring. */
  extent: number;
  /** Pixels kept free around the mesh at zoom 1, for labels. */
  margin: number;
}

export interface Projected {
  x: number;
  y: number;
  /** Size multiplier from perspective: above 1 is nearer than the centre. */
  scale: number;
  /** Distance from the viewer's plane through the centre, in hops; larger is further away. */
  depth: number;
}

/**
 * The viewer stands this many mesh radii from the centre. Smaller is a stronger
 * perspective: the near side of the mesh looms larger and the far side recedes.
 */
const CAMERA_DISTANCE = 2.2;

/** How much wider than the viewport's half-height the mesh may be drawn. */
const TALL_ALLOWANCE = 1.2;

/** A point on the mesh plane (the ground, y = 0), at a distance and direction from the centre. */
export function onPlane(radius: number, angle: number): Point3 {
  return { x: radius * Math.cos(angle), y: 0, z: radius * Math.sin(angle) };
}

/** The two numbers every projection needs: how far the viewer is, and how many pixels a hop is at the centre. */
export function scaleOf(zoom: number, viewport: Viewport) {
  const extent = Math.max(viewport.extent, 1e-6);
  // The mesh is a disc seen at an angle, so it is wider than tall on screen: let it use the
  // width, up to a little more than the height would allow if it were seen from straight above.
  const room = Math.max(0, Math.min(viewport.width / 2, (viewport.height / 2) * TALL_ALLOWANCE) - viewport.margin);
  return { camera: CAMERA_DISTANCE * extent, pixelsPerHop: (room / extent) * zoom };
}

export function project(point: Point3, view: View, viewport: Viewport): Projected {
  // Turn the scene around the vertical axis, then tilt it towards the viewer.
  const x = point.x * Math.cos(view.yaw) + point.z * Math.sin(view.yaw);
  const z1 = -point.x * Math.sin(view.yaw) + point.z * Math.cos(view.yaw);
  const y = point.y * Math.cos(view.pitch) + z1 * Math.sin(view.pitch);
  const depth = -point.y * Math.sin(view.pitch) + z1 * Math.cos(view.pitch);

  const { camera, pixelsPerHop } = scaleOf(view.zoom, viewport);
  const scale = camera / (camera + depth);

  return {
    x: viewport.width / 2 + view.panX + x * pixelsPerHop * scale,
    y: viewport.height / 2 + view.panY - y * pixelsPerHop * scale,
    scale,
    depth,
  };
}

/**
 * The reverse of `project` for the mesh plane: which point of the plane is
 * under a screen position, for a view (its turn is ignored, see below).
 *
 * The answer is in the plane's coordinates before the turn (yaw) is applied:
 * `radius` from the centre and `angle` as seen by the viewer. The same spot of
 * the mesh has angle `angle + yaw` in the mesh's own coordinates. Returns null
 * above the horizon, where the line of sight never meets the plane.
 */
export function pickOnPlane(screen: { x: number; y: number }, view: Omit<View, 'yaw'>, viewport: Viewport): { radius: number; angle: number } | null {
  const { pitch } = view;
  const { camera, pixelsPerHop } = scaleOf(view.zoom, viewport);
  if (pixelsPerHop <= 0) return null;
  const u = (screen.x - viewport.width / 2 - view.panX) / pixelsPerHop;
  const v = (viewport.height / 2 + view.panY - screen.y) / pixelsPerHop;

  const reach = camera * Math.sin(pitch) - v * Math.cos(pitch);
  if (reach <= 1e-6) return null;
  const z = (v * camera) / reach;
  const depth = z * Math.cos(pitch);
  if (camera + depth <= 1e-6) return null;
  const x = (u * (camera + depth)) / camera;

  return { radius: Math.hypot(x, z), angle: Math.atan2(z, x) };
}
