import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import type { Peer } from '@/api';
import { shortHash } from '@/lib/format';
import { useElementSize } from '@/lib/useElementSize';
import { KaonicMark } from '@/ui/KaonicMark';
import { hopDistance, layoutMesh, pathToSelf, SELF, type MeshNode } from './meshLayout';
import { chooseLabels } from './labelLayout';
import { onPlane, pickOnPlane, project, scaleOf, type Point3, type View, type Viewport } from './projection';
import type { ScreenPoint } from './trafficBalls';
import { useCamera } from './useCamera';
import { useTrafficBalls, type MeshScene } from './useTrafficBalls';
import styles from './MeshGraph.module.css';

interface MeshGraphProps {
  peers: readonly Peer[];
  /** Reticulum identity hash of this device, shown at the centre. Null until it is known. */
  selfIdentity: string | null;
  /** This device is the Kaonic Admin: drawn in the admin colour. */
  selfIsAdmin?: boolean;
  /** Id of the selected node (a peer id, or SELF), or null. */
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Details of the selected node. Shown in a popup that stays next to it as the map turns. */
  popup?: ReactNode;
}

/** Almost a top view, tilted just enough to show that the map has depth. */
const HOME: View = { yaw: 0.5, pitch: 1.25, zoom: 1, panX: 0, panY: 0 };
const ZOOM = { min: 0.6, max: 8, step: 1.25 };
/** Zoom change per pixel of wheel travel (as an exponent, so in and out are symmetric). */
const WHEEL_ZOOM = 0.0015;
/** From nearly edge-on to straight above. The plane is never seen from below. */
const PITCH = { min: 0.2, max: Math.PI / 2 };
/** Radians of free turning per pixel dragged, when there is no spot of the map to hold on to. */
const DRAG_SPEED = 0.008;
/** Radians of tilt per pixel dragged up or down. The whole range, flat to top view, takes about 270 pixels. */
const TILT_SPEED = 0.005;
/** Radians per arrow-key press. */
const KEY_STEP = 0.12;
/** Closer to the centre than this (in hops) there is no spot to hold on to; the drag turns the map freely instead. */
const GRAB_MIN_RADIUS = 0.25;
/** A press that moves less than this many pixels is a click, not a drag. */
const CLICK_SLOP = 5;
/**
 * Extra distance, in hops, between this device and the first ring. It keeps the
 * neighbours clear of the centre; the rings themselves stay one hop apart.
 */
const INNER_GAP = 0.8;
/** Devices out of range sit just outside the last hop ring, not a whole hop further. */
const OUT_OF_RANGE_GAP = 0.6;
/** The popup's width, and its distance from the node it describes. */
const POPUP = { width: 272, gap: 28, edge: 8 };
/** Pixels kept free around the mesh for labels. */
const MARGIN = 56;
const COMPACT_MARGIN = 36;
/** Below this width the map is drawn compact; the CSS shrinks the nodes to match. */
const COMPACT_WIDTH = 480;
const CIRCLE_STEPS = 72;
/**
 * Nodes grow with the zoom: half a hop wide, within these limits (pixels). A
 * crowded map zoomed out has small nodes that do not cover each other; zooming
 * in makes them big enough to read and to tap.
 */
const NODE_SIZE = { perHop: 0.5, min: 12, max: 34 };
/** However small the nodes get, traffic stays visible: balls shrink no further than this share of full size. */
const BALL_MIN_SCALE = 0.45;
/** Which labels survive in a crowd: the selected device first, then this device, then trusted ones. */
const LABEL_PRIORITY = { selected: 5, self: 4, known: 2, other: 1 };

/** How a device is drawn: this device, whitelisted, waiting to join (or being set up), or anything else. */
type NodeState = 'self' | 'trusted' | 'joining' | 'none';

function stateOf(node: MeshNode): NodeState {
  const peer = node.peer;
  if (!peer) return 'self';
  if (peer.list === 'whitelist' || peer.trust.isAdmin) return 'trusted';
  if (peer.list === 'none' && (peer.trust.network === 'unprovisioned' || peer.trust.provisioning !== null)) return 'joining';
  return 'none';
}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Keeps the mesh centre from being panned far off the map. */
const limitPan = (pan: number, zoom: number, size: Viewport) => {
  const limit = (Math.max(size.width, size.height) / 2) * zoom;
  return clamp(pan, -limit, limit);
};

type Anchor = { x: number; y: number };

/** `base` zoomed to `zoom`, with the spot that was at `from` moved to `to` (pixels from the middle of the map). */
const zoomedView = (base: View, zoom: number, from: Anchor, to: Anchor, size: Viewport) => {
  const ratio = zoom / base.zoom;
  return { zoom, panX: limitPan(to.x - (from.x - base.panX) * ratio, zoom, size), panY: limitPan(to.y - (from.y - base.panY) * ratio, zoom, size) };
};

/**
 * The mesh as a 3D map you can turn. All devices lie on one plane: this device
 * in the centre, every other device on the ring of its hop count, so distance
 * from the centre is distance in hops (evenly spaced nearby, compressed far
 * out, see `hopDistance`).
 *
 * Drag to rotate and tilt. Scroll, pinch, or use the buttons or +/- to zoom;
 * zooming keeps the spot under the pointer (or between the fingers) in place.
 * Two fingers, or a drag with the right mouse button, move the map.
 * The map fills whatever box it is given.
 */
export function MeshGraph({ peers, selfIdentity, selfIsAdmin = false, selected, onSelect, popup }: MeshGraphProps) {
  const [ref, { width, height }] = useElementSize<HTMLDivElement>();
  const { view, steer, hold, target, shown } = useCamera(HOME);
  const [dragging, setDragging] = useState(false);
  const dragMoved = useRef(false);

  // Only the projection changes while the camera moves; the layout follows the peers alone.
  const layout = useMemo(() => layoutMesh(peers), [peers]);
  // The rings to draw. A ring is named by its hop count; devices out of range get one more, just past the furthest.
  // Alone, this device still gets the first-hop ring, so the radar sweeps around it while it listens.
  const known = layout.outOfRangeRing === null ? layout.rings : [...layout.rings, layout.outOfRangeRing];
  const rings = known.length > 0 ? known : [1];
  const outermost = rings.at(-1) ?? 1;
  /** Distance of a ring from the centre, in hops. */
  const reach = (ring: number) => {
    if (ring === 0) return 0;
    return INNER_GAP + (ring === layout.outOfRangeRing ? hopDistance(layout.hopRings) + OUT_OF_RANGE_GAP : hopDistance(ring));
  };
  const viewport: Viewport = { width, height, extent: reach(outermost), margin: width < COMPACT_WIDTH ? COMPACT_MARGIN : MARGIN };
  const toScreen = (point: Point3) => project(point, view, viewport);
  const pointOf = (node: MeshNode) => onPlane(reach(node.ring), node.angle);

  const placed = layout.nodes.map((node) => ({ node, screen: toScreen(pointOf(node)) }));

  const { pixelsPerHop, camera } = scaleOf(view.zoom, viewport);
  const nodeSize = clamp(pixelsPerHop * NODE_SIZE.perHop, NODE_SIZE.min, NODE_SIZE.max);

  // The radar sweep is a disc lying on the mesh plane, as large as the outermost ring. The
  // browser's own 3D transform draws it with the same camera as the rest of the map: the same
  // viewing distance, the same vanishing point (the mesh centre), and the plane tipped back
  // from facing the viewer by a quarter turn less the tilt.
  const centre = toScreen({ x: 0, y: 0, z: 0 });
  const sweep = { radius: pixelsPerHop * reach(outermost), viewingDistance: camera * pixelsPerHop, tipBack: 90 - (view.pitch * 180) / Math.PI };
  const labelled = chooseLabels(
    placed.map(({ node, screen }) => ({
      id: node.id,
      x: screen.x,
      y: screen.y,
      priority:
        (node.id === selected ? LABEL_PRIORITY.selected : node.id === SELF ? LABEL_PRIORITY.self : stateOf(node) === 'none' ? LABEL_PRIORITY.other : LABEL_PRIORITY.known) +
        // Among equals, the nearer device keeps its label.
        screen.scale / 10,
    })),
    nodeSize,
  );
  const byId = new Map(placed.map((entry) => [entry.node.id, entry]));
  const highlighted = useMemo(() => new Set(selected ? pathToSelf(layout.nodes, selected) : []), [layout, selected]);
  const ready = width > 0 && height > 0;

  /* ── traffic ── */

  // What the traffic animation needs from the latest render, without restarting it.
  const scene = useRef<MeshScene>({ nodes: [], positions: new Map(), ballScale: 1 });
  useEffect(() => {
    scene.current = {
      nodes: layout.nodes,
      positions: new Map(placed.map(({ node, screen }) => [node.id, { x: screen.x, y: screen.y }])),
      // A ball is at full size beside a full-size node and shrinks with it, but never to nothing.
      ballScale: clamp(nodeSize / NODE_SIZE.max, BALL_MIN_SCALE, 1),
    };
  });
  const canvas = useRef<HTMLCanvasElement>(null);
  useTrafficBalls(canvas, scene);

  /** The hop ring of the given radius as an SVG path. */
  function ringPath(radius: number): string {
    return Array.from({ length: CIRCLE_STEPS + 1 }, (_, step) => {
      const { x, y } = toScreen(onPlane(radius, (step / CIRCLE_STEPS) * 2 * Math.PI));
      return `${step === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join('');
  }

  /* ── interaction ── */

  /** Keeps the mesh from being moved entirely out of sight. */
  // The handlers below outlive the render they were created in, so they read the latest size from here.
  const live = useRef(viewport);
  useEffect(() => {
    live.current = viewport;
  });

  /** Zooms by a factor while the spot at `anchor` (pixels from the middle of the map) stays where it is. */
  const zoomAbout = useCallback(
    (factor: number, anchor: Anchor) =>
      steer((current) => ({ ...current, ...zoomedView(current, clamp(current.zoom * factor, ZOOM.min, ZOOM.max), anchor, anchor, live.current) })),
    [steer],
  );
  const zoomBy = (factor: number) => zoomAbout(factor, { x: 0, y: 0 });
  const rotateBy = (yaw: number, pitch: number) => {
    steer((current) => ({ ...current, yaw: current.yaw + yaw, pitch: clamp(current.pitch + pitch, PITCH.min, PITCH.max) }));
  };

  // One finger (or the mouse) turns the map; two fingers pinch to zoom.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; middle: { x: number; y: number }; view: View } | null>(null);

  /** The two touching fingers: how far apart they are, and the point between them (pixels from the middle of the map). */
  const fingers = () => {
    const [first, second] = [...pointers.current.values()];
    if (!first || !second) return null;
    const box = ref.current?.getBoundingClientRect();
    return {
      distance: Math.hypot(first.x - second.x, first.y - second.y),
      middle: {
        x: (first.x + second.x) / 2 - (box?.left ?? 0) - live.current.width / 2,
        y: (first.y + second.y) / 2 - (box?.top ?? 0) - live.current.height / 2,
      },
    };
  };

  /** A pointer position relative to the map's top left corner. */
  const local = (event: { clientX: number; clientY: number }) => {
    const box = ref.current?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  };

  /** Dragging with the right mouse button moves the map, the way two fingers do on a touch screen. */
  function startPan(event: ReactPointerEvent<HTMLDivElement>) {
    let last = { x: event.clientX, y: event.clientY };
    hold();
    const onMove = (move: PointerEvent) => {
      const dx = move.clientX - last.x;
      const dy = move.clientY - last.y;
      last = { x: move.clientX, y: move.clientY };
      setDragging(true);
      steer((current) => ({
        ...current,
        panX: limitPan(current.panX + dx, current.zoom, live.current),
        panY: limitPan(current.panY + dy, current.zoom, live.current),
      }));
    };
    const onEnd = () => {
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as Element).closest('[data-control]')) return;
    if (event.button === 2) return startPan(event);
    if (event.button !== 0) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const touch = fingers();
      if (touch) pinch.current = { ...touch, view: target.current };
    }
    if (pointers.current.size !== 1) return;

    let travelled = 0;
    dragMoved.current = false;

    // The spot of the map under the pointer. The drag keeps it under the pointer, like a hand on a turntable.
    // Whatever the camera was still gliding towards is dropped: the drag starts from what is on screen.
    hold();
    const start = shown.current;
    const hit = pickOnPlane(local(event), start, live.current);
    const grab = hit && hit.radius >= GRAB_MIN_RADIUS ? { meshAngle: hit.angle + start.yaw } : null;

    // Listeners live on the window so a drag keeps working outside the map, and clicks on nodes still arrive.
    const onMove = (move: PointerEvent) => {
      const last = pointers.current.get(move.pointerId);
      if (!last) return;
      pointers.current.set(move.pointerId, { x: move.clientX, y: move.clientY });

      if (pinch.current && pointers.current.size === 2) {
        const touch = fingers();
        const began = pinch.current;
        dragMoved.current = true;
        if (!touch || began.distance <= 0) return;
        // Spreading the fingers zooms about the point between them; moving them together moves the map.
        const zoom = clamp((began.view.zoom * touch.distance) / began.distance, ZOOM.min, ZOOM.max);
        steer((current) => ({ ...current, ...zoomedView(began.view, zoom, began.middle, touch.middle, live.current) }));
        return;
      }

      const dx = move.clientX - last.x;
      const dy = move.clientY - last.y;
      travelled += Math.abs(dx) + Math.abs(dy);
      if (travelled < CLICK_SLOP) return;
      dragMoved.current = true;
      setDragging(true);

      if (!grab) {
        rotateBy(-dx * DRAG_SPEED, dy * TILT_SPEED);
        return;
      }

      const size = live.current;
      const pointer = local(move);
      const goal = target.current;

      // Tilt: dragging down always tips the map towards a top view, dragging up lays it flatter.
      // Up-and-down movement beside the centre is turning, not tilting, so it counts for less
      // the closer the pointer is to the horizontal line through the centre.
      const fromCentre = { x: pointer.x - size.width / 2 - goal.panX, y: pointer.y - size.height / 2 - goal.panY };
      const vertical = Math.abs(fromCentre.y) / (Math.hypot(fromCentre.x, fromCentre.y) || 1);
      const pitch = clamp(goal.pitch + dy * TILT_SPEED * vertical, PITCH.min, PITCH.max);

      // Turn: keep the grabbed spot in the pointer's direction from the centre, like a hand on a turntable.
      const under = pickOnPlane(pointer, { ...goal, pitch }, size);
      if (!under || under.radius < GRAB_MIN_RADIUS) return steer((current) => ({ ...current, pitch }));
      // An angle is only known up to whole turns; take the one nearest to where the camera already is.
      const raw = grab.meshAngle - under.angle;
      const yaw = raw + Math.round((goal.yaw - raw) / (2 * Math.PI)) * 2 * Math.PI;

      steer((current) => ({ ...current, yaw, pitch }));
    };
    const onEnd = (end: PointerEvent) => {
      pointers.current.delete(end.pointerId);
      pinch.current = null;
      if (pointers.current.size > 0) return;
      setDragging(false);
      // The click that ends this press comes right after; forget the drag once it has passed.
      window.setTimeout(() => (dragMoved.current = false), 0);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  }

  // The wheel zooms. React registers wheel listeners as passive, so this one is attached by hand to be able to stop the page from scrolling.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if ((event.target as Element).closest('[data-popup]')) return;
      event.preventDefault();
      const box = element.getBoundingClientRect();
      zoomAbout(Math.exp(-event.deltaY * WHEEL_ZOOM), { x: event.clientX - box.left - box.width / 2, y: event.clientY - box.top - box.height / 2 });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [ref, zoomAbout]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const actions: Record<string, () => void> = {
      ArrowLeft: () => rotateBy(KEY_STEP, 0),
      ArrowRight: () => rotateBy(-KEY_STEP, 0),
      ArrowUp: () => rotateBy(0, KEY_STEP),
      ArrowDown: () => rotateBy(0, -KEY_STEP),
      '+': () => zoomBy(ZOOM.step),
      '=': () => zoomBy(ZOOM.step),
      '-': () => zoomBy(1 / ZOOM.step),
      Escape: () => onSelect(null),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  }

  /** A click that ends a drag is not a selection. */
  const select = (id: string | null) => {
    if (!dragMoved.current) onSelect(id);
  };

  return (
    <div
      ref={ref}
      className={styles.graph}
      data-dragging={dragging || undefined}
      style={{ ['--node' as string]: `${nodeSize}px` }}
      tabIndex={0}
      role="group"
      aria-label="Mesh map in 3D. Arrow keys rotate, plus and minus zoom, Escape closes the details."
      onPointerDown={onPointerDown}
      // The right button moves the map, so its menu must not open over it. The details popup keeps its menu, for copying.
      onContextMenu={(event) => {
        if (!(event.target as Element).closest('[data-popup]')) event.preventDefault();
      }}
      onKeyDown={onKeyDown}
      onClick={() => select(null)}
    >
      {ready ? (
        <>
          {rings.length > 0 ? (
            <div className={styles.sweepSpace} style={{ perspective: sweep.viewingDistance, perspectiveOrigin: `${centre.x}px ${centre.y}px` }} aria-hidden>
              <div
                className={styles.sweep}
                style={{ left: centre.x - sweep.radius, top: centre.y - sweep.radius, width: sweep.radius * 2, height: sweep.radius * 2, transform: `rotateX(${sweep.tipBack}deg)` }}
              >
                <div className={styles.beam} />
              </div>
            </div>
          ) : null}
          <svg className={styles.backdrop} width={width} height={height} aria-hidden>
            {rings.map((ring) => {
              const lost = ring === layout.outOfRangeRing || undefined;
              const label = toScreen(onPlane(reach(ring), -view.yaw - Math.PI / 2));
              return (
                <g key={ring}>
                  <path className={styles.ring} data-lost={lost} d={ringPath(reach(ring))} />
                  {/* The label rides on the point of the ring nearest the viewer. */}
                  <text className={styles.ringLabel} x={label.x} y={label.y + 14} textAnchor="middle">
                    {lost ? 'out of range' : ring === 1 ? '1 hop' : `${ring} hops`}
                  </text>
                </g>
              );
            })}

            {/* A link is only a faint track; the traffic on it is drawn as balls, on the canvas above. */}
            {placed.map(({ node, screen }) => {
              const target = node.linkTo ? byId.get(node.linkTo) : undefined;
              if (!target) return null;
              const lit = (highlighted.has(node.id) && highlighted.has(target.node.id)) || undefined;
              return <line key={node.id} className={styles.track} data-lit={lit} x1={target.screen.x} y1={target.screen.y} x2={screen.x} y2={screen.y} />;
            })}
          </svg>
          <canvas ref={canvas} className={styles.traffic} width={Math.round(width * (window.devicePixelRatio || 1))} height={Math.round(height * (window.devicePixelRatio || 1))} aria-hidden />

          {placed.map(({ node, screen }) => {
            // Devices are named by their Reticulum identity; a peer's id is its identity hash.
            const identity = node.peer?.id ?? selfIdentity;
            const name = identity ? shortHash(identity) : 'this device';
            return (
              <button
                key={node.id}
                type="button"
                className={styles.node}
                data-state={stateOf(node)}
                data-admin={(node.peer ? node.peer.trust.isAdmin : selfIsAdmin) || undefined}
                data-lost={!node.inRange || undefined}
                data-selected={node.id === selected || undefined}
                data-labelled={labelled.has(node.id) || undefined}
                style={{
                  left: screen.x,
                  top: screen.y,
                  // Nearer devices are larger, brighter and on top.
                  zIndex: Math.round(1000 - screen.depth * 100),
                  ['--depth-scale' as string]: clamp(screen.scale, 0.6, 1.6),
                  ['--depth-fade' as string]: clamp(0.3 + screen.scale * 0.7, 0.5, 1),
                }}
                aria-pressed={node.id === selected}
                aria-label={node.peer ? describe(node.peer) : `${name}, this device`}
                onClick={(event) => {
                  event.stopPropagation();
                  select(node.id !== selected ? node.id : null);
                }}
              >
                <span className={styles.dot}>
                  <KaonicMark />
                </span>
                <span className={styles.label}>
                  <span className="mono">{name}</span>
                  {node.id === SELF && identity ? <span className={styles.sub}>this device</span> : null}
                  {node.peer?.tag ? <span className={styles.sub}>{node.peer.tag}</span> : null}
                </span>
              </button>
            );
          })}

          {popup && selected && byId.has(selected) ? <Popup anchor={byId.get(selected)!.screen} width={width} height={height}>{popup}</Popup> : null}

          <div className={styles.controls} data-control onClick={(event) => event.stopPropagation()}>
            <button type="button" aria-label="Zoom in" disabled={view.zoom >= ZOOM.max - 0.001} onClick={() => zoomBy(ZOOM.step)}>
              <Plus aria-hidden />
            </button>
            <button type="button" aria-label="Zoom out" disabled={view.zoom <= ZOOM.min + 0.001} onClick={() => zoomBy(1 / ZOOM.step)}>
              <Minus aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Reset view"
              onClick={() => {
                // Come back the short way round, not through every turn made so far.
                steer((current) => ({ ...HOME, yaw: HOME.yaw + Math.round((current.yaw - HOME.yaw) / (2 * Math.PI)) * 2 * Math.PI }));
              }}
            >
              <RotateCcw aria-hidden />
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Sits beside its node, on whichever side has room, and never leaves the map. */
function Popup({ anchor, width, height, children }: { anchor: ScreenPoint; width: number; height: number; children: ReactNode }) {
  const popupWidth = Math.min(POPUP.width, width - 2 * POPUP.edge);
  const wanted = anchor.x > width / 2 ? anchor.x - POPUP.gap - popupWidth : anchor.x + POPUP.gap;
  const left = clamp(wanted, POPUP.edge, Math.max(POPUP.edge, width - popupWidth - POPUP.edge));
  // In the lower half the popup grows upwards from the node, in the upper half downwards.
  const below = anchor.y < height / 2;
  const vertical = below
    ? { top: clamp(anchor.y - POPUP.gap, POPUP.edge, height), maxHeight: height - clamp(anchor.y - POPUP.gap, POPUP.edge, height) - POPUP.edge }
    : { bottom: clamp(height - anchor.y - POPUP.gap, POPUP.edge, height), maxHeight: height - clamp(height - anchor.y - POPUP.gap, POPUP.edge, height) - POPUP.edge };
  return (
    <div
      className={styles.popup}
      data-control
      data-popup
      role="dialog"
      aria-label="Device details"
      style={{ left, width: popupWidth, ...vertical }}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

function describe(peer: Peer): string {
  const where = peer.online && peer.hops !== null ? (peer.hops === 1 ? '1 hop away' : `${peer.hops} hops away`) : 'out of range';
  const standing = peer.trust.isAdmin ? 'our admin' : peer.list === 'whitelist' ? 'whitelisted' : peer.list === 'blacklist' ? 'blacklisted' : peer.trust.network === 'unprovisioned' ? 'waits to join' : 'not whitelisted';
  return `${shortHash(peer.id)}, ${peer.codename}${peer.tag ? `, ${peer.tag}` : ''}, ${where}, ${standing}`;
}

/** What the node colours mean. Shown under the map. */
export function MeshLegend() {
  const items: Array<[NodeState | 'lost' | 'admin', string]> = [
    ['self', 'This device'],
    ['admin', 'Kaonic Admin'],
    ['trusted', 'Whitelisted'],
    ['joining', 'Waiting to join'],
    ['none', 'Not whitelisted'],
    ['lost', 'Out of range'],
  ];
  const flows: Array<[string, string]> = [
    ['var(--series-tx)', 'Sent'],
    ['var(--series-rx)', 'Received'],
    ['var(--series-other)', 'Between other devices'],
  ];
  return (
    <ul className={styles.legend}>
      {items.map(([state, text]) => (
        <li key={state}>
          <span className={styles.key} data-state={state === 'lost' ? 'none' : state} data-lost={state === 'lost' || undefined} />
          {text}
        </li>
      ))}
      {flows.map(([color, text]) => (
        <li key={text}>
          <span className={styles.flowKey} style={{ background: color }} />
          {text}
        </li>
      ))}
    </ul>
  );
}
