/**
 * Where the two source slabs go, kept pure (plain numbers, no scene) so it's
 * tested in Node and a headset session can be replayed through it.
 *
 * Two steps, on purpose:
 *
 * - `decidePlacementMode` -- floating, on the desk, or at the desk's edge,
 *   and which desk -- runs only when the layout anchor is set (session start
 *   and its surface search, Recenter, the headset back on, a reset). It's
 *   the only place desk-or-floating is decided.
 * - `planPair` places a pair for a given mode. Dataset switches call only
 *   this, with the mode decided at the anchor, so they resize around the same
 *   anchored positions and never re-decide desk or floating -- even when a
 *   new dataset's slab sizes would have tipped the decision.
 *
 * Both work from the layout anchor's eyes and yaw (layout-anchor.ts), never
 * the live head. Floating: the pair ahead of and below the eyes, bottom
 * edges on one line, pushed forward if an edge would leave the comfortable
 * view but never past SLAB_VIEW_DISTANCE_METERS. On a surface: the same
 * distance (a desk never pulls the slabs closer: closer, they'd spread past
 * the view's width), bottom edges resting on it there, each slab propped up
 * to face the eyes; a surface that doesn't reach that far isn't used.
 */

import {
  eyeFacingLean,
  eyeFacingLeanFromBottom,
  minDistanceForDrop,
  NATURAL_GAZE_PITCH_RAD,
  SLAB_VIEW_DISTANCE_METERS,
} from './view-comfort.js';

// Floating: slab centers at SLAB_VIEW_DISTANCE_METERS from the eyes, this
// far below them (at least this far ahead), so the group sits about centered
// on the natural gaze (4 deg down) and out of the near field.
export const FLOATING_FORWARD_METERS = 0.65;
export const FLOATING_BELOW_HEAD_METERS = 0.25;
// Keeps the bottom edge from z-fighting with the surface it rests on.
export const SURFACE_LIFT_METERS = 0.002;
// Distance and tilt depend on each other; this many alternations settle both.
const FIT_ITERATIONS = 3;
// Well outside the join system's preview range (6 cm, 9 cm to exit), so a
// join always takes a deliberate push.
export const SLAB_GAP_METERS = 0.15;

export type P3 = { x: number; y: number; z: number };
/** A slab's size (meters): its width, its height, and its name tab's height above it. */
export type SlabSize = { width: number; height: number; tab: number };
/**
 * A detected surface's footprint: its local frame (`toLocal` / `toWorld`) and
 * the bounds of its top within it.
 */
export type Footprint = {
  toLocal(p: P3): P3;
  toWorld(p: P3): P3;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  topY: number;
};
/** A detected desk: its top's height and footprint (null: a synthetic, unbounded one). */
export type DeskSurface = { surfaceY: number; footprint: Footprint | null };
export type PlacementMode =
  /** At the tuned floating pose; `shadow`: the desk below, which the slabs cast a soft shadow onto. */
  | { kind: 'floating'; shadow?: DeskSurface }
  | ({ kind: 'on-surface' } & DeskSurface);

/**
 * The slabs rest on a desk only when its top is at most this far below the
 * eyes: then resting there keeps them as close as floating (about 0.60 m,
 * row text 1.13° or more). A lower desk (most seated desks: 0.40-0.47 m below
 * the eyes) would put them about 20 cm lower and farther (0.7 m, text about
 * 1.0°), so the pair floats at its tuned pose above it and casts a shadow on
 * it instead.
 */
export const DESK_REST_MAX_BELOW_EYES_METERS = 0.3;
/** A slab's center, and how far it leans back from vertical (radians); its yaw is the anchor's. */
export type SlabPose = { center: P3; lean: number };
export type PairPlan = { left: SlabPose; right: SlabPose; mode: PlacementMode['kind']; deskY: number | null };

const forwardOf = (yaw: number): P3 => ({ x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) });
const rightOf = (yaw: number): P3 => ({ x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) });
const add = (a: P3, b: P3, s = 1): P3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
const dot = (a: P3, b: P3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Horizontal distance for a point `edgeOffset` beyond a reference point, `drop` below the eyes, to stay in view. */
function edgeFitDistance(drop: number, edgeOffset: number): number {
  return minDistanceForDrop(drop, NATURAL_GAZE_PITCH_RAD) - edgeOffset;
}

/** Horizontal center distance putting a center `drop` below the eyes (and `lateral` aside) at the view distance. */
function floatingReachForward(drop: number, lateral: number): number {
  const r2 = SLAB_VIEW_DISTANCE_METERS * SLAB_VIEW_DISTANCE_METERS - drop * drop - lateral * lateral;
  return r2 > 0 ? Math.sqrt(r2) : 0;
}

/** Center distance keeping both edges of a floating slab in view. */
function floatingForwardToFit(half: number, sinLean: number, cosLean: number): number {
  return Math.max(
    edgeFitDistance(FLOATING_BELOW_HEAD_METERS + half * cosLean, -half * sinLean),
    edgeFitDistance(FLOATING_BELOW_HEAD_METERS - half * cosLean, half * sinLean),
  );
}

const offsets = (left: SlabSize, right: SlabSize) => ({
  left: SLAB_GAP_METERS / 2 + left.width / 2,
  right: SLAB_GAP_METERS / 2 + right.width / 2,
});

/** Floating: both bottom edges on one line, the taller slab's center FLOATING_BELOW_HEAD_METERS below the eyes. */
function planFloating(eyes: P3, yaw: number, left: SlabSize, right: SlabSize): PairPlan {
  const forwardAxis = forwardOf(yaw);
  const rightAxis = rightOf(yaw);
  const leftHalf = left.height / 2;
  const rightHalf = right.height / 2;
  const off = offsets(left, right);
  const forward = floatingForward(left, right);
  const lean = eyeFacingLean(FLOATING_BELOW_HEAD_METERS, forward);
  const anchor = add(eyes, forwardAxis, forward);
  anchor.y = eyes.y - FLOATING_BELOW_HEAD_METERS;
  const taller = Math.max(leftHalf, rightHalf);
  // Up along a slab leaning back by `lean`: up, and away from the viewer.
  const up = add({ x: 0, y: Math.cos(lean), z: 0 }, forwardAxis, Math.sin(lean));
  return {
    left: { center: add(add(anchor, rightAxis, -off.left), up, leftHalf - taller), lean },
    right: { center: add(add(anchor, rightAxis, off.right), up, rightHalf - taller), lean },
    mode: 'floating',
    deskY: null,
  };
}

/** The floating pair's bottom-line distance (horizontal, from the eyes): where the pair sits, on a desk too. */
function floatingForward(left: SlabSize, right: SlabSize): number {
  const off = offsets(left, right);
  const reach = Math.min(floatingReachForward(FLOATING_BELOW_HEAD_METERS, off.left), floatingReachForward(FLOATING_BELOW_HEAD_METERS, off.right));
  let forward = FLOATING_FORWARD_METERS;
  let lean = eyeFacingLean(FLOATING_BELOW_HEAD_METERS, forward);
  for (let i = 0; i < FIT_ITERATIONS; i++) {
    const sin = Math.sin(lean);
    const cos = Math.cos(lean);
    forward = Math.min(reach, Math.max(FLOATING_FORWARD_METERS, floatingForwardToFit(left.height / 2, sin, cos), floatingForwardToFit(right.height / 2, sin, cos)));
    lean = eyeFacingLean(FLOATING_BELOW_HEAD_METERS, forward);
  }
  return forward;
}

/** Where the pair's bottom line would rest on a surface: straight ahead at the floating distance, at the surface's height. */
function surfacePoint(eyes: P3, yaw: number, surfaceY: number, left: SlabSize, right: SlabSize): { point: P3; forward: number } {
  const forward = floatingForward(left, right);
  const point = add(eyes, forwardOf(yaw), forward);
  point.y = surfaceY;
  return { point, forward };
}

/** Whether `point` lies on the footprint's top (in its own frame); always true for a footprint-less (synthetic) surface. */
function onFootprint(point: P3, footprint: Footprint | null): boolean {
  if (!footprint) {
    return true;
  }
  const local = footprint.toLocal(point);
  return local.x >= footprint.minX && local.x <= footprint.maxX && local.z >= footprint.minZ && local.z <= footprint.maxZ;
}

/**
 * The placement mode for a new anchor: floating without a surface; on the
 * surface when it's high enough (DESK_REST_MAX_BELOW_EYES_METERS) and
 * reaches the floating distance straight ahead (the pair then rests on it
 * there, as far away as it would float: a desk never pulls the slabs
 * closer); otherwise floating at the tuned pose, casting a shadow on it.
 * Call only when the anchor is set.
 */
export function decidePlacementMode(
  eyes: P3,
  yaw: number,
  surface: { y: number; footprint: Footprint | null } | null,
  left: SlabSize,
  right: SlabSize,
): { mode: PlacementMode; forward: number; onSurface: boolean | null; highEnough: boolean | null } {
  const { point, forward } = surfacePoint(eyes, yaw, surface?.y ?? 0, left, right);
  if (!surface) {
    return { mode: { kind: 'floating' }, forward, onSurface: null, highEnough: null };
  }
  const desk: DeskSurface = { surfaceY: surface.y, footprint: surface.footprint };
  const reaches = onFootprint(point, surface.footprint);
  const highEnough = eyes.y - surface.y <= DESK_REST_MAX_BELOW_EYES_METERS + 1e-9;
  const mode: PlacementMode = reaches && highEnough ? { kind: 'on-surface', ...desk } : { kind: 'floating', shadow: desk };
  return { mode, forward, onSurface: reaches, highEnough };
}

/**
 * Where a slab's shadow falls on the desk below it: straight under its
 * center, at the desk's height; null when there's no desk under it (off the
 * footprint) or the slab isn't above it.
 */
export function shadowPoint(center: P3, desk: DeskSurface): P3 | null {
  const point = { x: center.x, y: desk.surfaceY, z: center.z };
  if (center.y <= desk.surfaceY || !onFootprint(point, desk.footprint)) {
    return null;
  }
  return point;
}

/** The pair's poses for `mode` (decided at the anchor): never re-decides desk or floating. */
export function planPair(eyes: P3, yaw: number, mode: PlacementMode, left: SlabSize, right: SlabSize): PairPlan {
  if (mode.kind === 'floating') {
    return planFloating(eyes, yaw, left, right);
  }
  const forwardAxis = forwardOf(yaw);
  const rightAxis = rightOf(yaw);
  const off = offsets(left, right);
  // Resting on the surface at the floating distance (this pair's), propped up to face the eyes.
  const { point, forward } = surfacePoint(eyes, yaw, mode.surfaceY, left, right);
  const eyeRise = eyes.y - (mode.surfaceY + SURFACE_LIFT_METERS);
  const pose = (lateral: number, size: SlabSize): SlabPose => {
    const lean = eyeFacingLeanFromBottom(eyeRise, forward, size.height);
    const half = size.height / 2;
    const center = add(add(point, rightAxis, lateral), forwardAxis, half * Math.sin(lean));
    center.y += SURFACE_LIFT_METERS + half * Math.cos(lean);
    return { center, lean };
  };
  return {
    left: pose(-off.left, left),
    right: pose(off.right, right),
    mode: mode.kind,
    deskY: mode.surfaceY,
  };
}
