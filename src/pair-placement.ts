/**
 * Where the two source slabs go, kept pure (plain numbers, no scene) so it's
 * tested in Node and a headset session can be replayed through it.
 *
 * Two steps, on purpose:
 *
 * - `decidePlacementMode` -- floating, on the desk, or at the desk's edge,
 *   and which desk -- runs only when the layout anchor is set (session start
 *   and its surface search, Recenter, the headset back on, a reset). It's
 *   the only place the surface rule (surface-placement.ts) is applied.
 * - `planPair` places a pair for a given mode. Dataset switches call only
 *   this, with the mode decided at the anchor, so they resize around the same
 *   anchored positions and never re-decide desk or floating -- even when a
 *   new dataset's slab sizes would have tipped the decision.
 *
 * Both work from the layout anchor's eyes and yaw (layout-anchor.ts), never
 * the live head. Floating: the pair ahead of and below the eyes, bottom
 * edges on one line, pushed forward if an edge would leave the comfortable
 * view but never past SLAB_VIEW_DISTANCE_METERS. On a surface: bottom edges
 * resting on it, each slab propped up to face the eyes.
 */

import { DESK_EDGE_BEYOND_REACH_MAX_METERS, surfacePlacementCase } from './surface-placement.js';
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
// On a surface: the bottom edges rest on it, at least this far ahead of the
// eyes (horizontally; in practice where the centers sit at the view distance).
export const SURFACE_FORWARD_METERS = 0.32;
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
export type PlacementMode =
  | { kind: 'floating' }
  | { kind: 'on-surface' | 'desk-edge'; surfaceY: number; footprint: Footprint | null };
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

/** Bottom-edge distance putting a propped slab's center at the view distance, for a given lean. */
function surfaceReachForward(eyeRise: number, half: number, lean: number, lateral: number): number {
  const centerDrop = eyeRise - half * Math.cos(lean);
  const r2 = SLAB_VIEW_DISTANCE_METERS * SLAB_VIEW_DISTANCE_METERS - centerDrop * centerDrop - lateral * lateral;
  return r2 > 0 ? Math.sqrt(r2) - half * Math.sin(lean) : 0;
}

/** Center distance keeping both edges of a floating slab in view. */
function floatingForwardToFit(half: number, sinLean: number, cosLean: number): number {
  return Math.max(
    edgeFitDistance(FLOATING_BELOW_HEAD_METERS + half * cosLean, -half * sinLean),
    edgeFitDistance(FLOATING_BELOW_HEAD_METERS - half * cosLean, half * sinLean),
  );
}

/** Bottom-edge distance keeping a propped slab's top (its name tab's top) in view. */
function surfaceForwardToFit(eyesY: number, surfaceY: number, half: number, tab: number, sinLean: number, cosLean: number): number {
  const bottomY = surfaceY + SURFACE_LIFT_METERS;
  const topY = bottomY + (2 * half + tab) * cosLean;
  // Only the top edge: a slab resting on a desk keeps its bottom edge on it
  // even a few degrees under the view window (approved 2026-10-07).
  return edgeFitDistance(eyesY - topY, (2 * half + tab) * sinLean);
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
  const reach = Math.min(floatingReachForward(FLOATING_BELOW_HEAD_METERS, off.left), floatingReachForward(FLOATING_BELOW_HEAD_METERS, off.right));
  let forward = FLOATING_FORWARD_METERS;
  let lean = eyeFacingLean(FLOATING_BELOW_HEAD_METERS, forward);
  for (let i = 0; i < FIT_ITERATIONS; i++) {
    const sin = Math.sin(lean);
    const cos = Math.cos(lean);
    forward = Math.min(reach, Math.max(FLOATING_FORWARD_METERS, floatingForwardToFit(leftHalf, sin, cos), floatingForwardToFit(rightHalf, sin, cos)));
    lean = eyeFacingLean(FLOATING_BELOW_HEAD_METERS, forward);
  }
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

/** On a surface: the bottom-edge line's midpoint (clamped into the footprint), and the surface case it makes. */
function surfaceLine(eyes: P3, yaw: number, surfaceY: number, footprint: Footprint | null, left: SlabSize, right: SlabSize) {
  const forwardAxis = forwardOf(yaw);
  const off = offsets(left, right);
  const tab = Math.max(0, left.tab, right.tab);
  const eyeRise = eyes.y - (surfaceY + SURFACE_LIFT_METERS);
  let forward = SURFACE_FORWARD_METERS;
  for (let i = 0; i < FIT_ITERATIONS; i++) {
    const leftLean = eyeFacingLeanFromBottom(eyeRise, forward, left.height);
    const rightLean = eyeFacingLeanFromBottom(eyeRise, forward, right.height);
    const reachForward = Math.max(
      SURFACE_FORWARD_METERS,
      Math.min(surfaceReachForward(eyeRise, left.height / 2, leftLean, off.left), surfaceReachForward(eyeRise, right.height / 2, rightLean, off.right)),
    );
    forward = Math.max(
      reachForward,
      surfaceForwardToFit(eyes.y, surfaceY, left.height / 2, tab, Math.sin(leftLean), Math.cos(leftLean)),
      surfaceForwardToFit(eyes.y, surfaceY, right.height / 2, tab, Math.sin(rightLean), Math.cos(rightLean)),
    );
  }
  let anchor = add(eyes, forwardAxis, forward);
  anchor.y = surfaceY;
  if (footprint) {
    const local = footprint.toLocal(anchor);
    local.x = Math.min(footprint.maxX, Math.max(footprint.minX, local.x));
    local.z = Math.min(footprint.maxZ, Math.max(footprint.minZ, local.z));
    local.y = footprint.topY;
    anchor = footprint.toWorld(local);
  }
  // The view distance wins over the surface: how far the line may be with every center within it.
  const anchorForward = Math.max(0.05, dot({ x: anchor.x - eyes.x, y: anchor.y - eyes.y, z: anchor.z - eyes.z }, forwardAxis));
  const anchorEyeRise = eyes.y - (anchor.y + SURFACE_LIFT_METERS);
  let reachForward = anchorForward;
  for (let i = 0; i < FIT_ITERATIONS; i++) {
    reachForward = Math.min(
      surfaceReachForward(anchorEyeRise, left.height / 2, eyeFacingLeanFromBottom(anchorEyeRise, reachForward, left.height), off.left),
      surfaceReachForward(anchorEyeRise, right.height / 2, eyeFacingLeanFromBottom(anchorEyeRise, reachForward, right.height), off.right),
    );
  }
  return { anchor, anchorForward, anchorEyeRise, reachForward, case: surfacePlacementCase(anchorForward, reachForward) };
}

/**
 * The placement mode for a new anchor: floating without a surface, else the
 * surface rule for this pair (on the surface, at its edge, or floating when
 * it's beyond DESK_EDGE_BEYOND_REACH_MAX_METERS of reach). Call only when the
 * anchor is set.
 */
export function decidePlacementMode(
  eyes: P3,
  yaw: number,
  surface: { y: number; footprint: Footprint | null } | null,
  left: SlabSize,
  right: SlabSize,
): { mode: PlacementMode; surfaceForward: number | null; reachForward: number | null } {
  if (!surface) {
    return { mode: { kind: 'floating' }, surfaceForward: null, reachForward: null };
  }
  const line = surfaceLine(eyes, yaw, surface.y, surface.footprint, left, right);
  const mode: PlacementMode =
    line.case === 'floating' ? { kind: 'floating' } : { kind: line.case, surfaceY: surface.y, footprint: surface.footprint };
  return { mode, surfaceForward: line.anchorForward, reachForward: line.reachForward };
}

/** The pair's poses for `mode` (decided at the anchor): never re-decides desk or floating. */
export function planPair(eyes: P3, yaw: number, mode: PlacementMode, left: SlabSize, right: SlabSize): PairPlan {
  if (mode.kind === 'floating') {
    return planFloating(eyes, yaw, left, right);
  }
  const forwardAxis = forwardOf(yaw);
  const rightAxis = rightOf(yaw);
  const off = offsets(left, right);
  const line = surfaceLine(eyes, yaw, mode.surfaceY, mode.footprint, left, right);
  let anchor = line.anchor;
  let anchorForward = line.anchorForward;
  if (mode.kind === 'desk-edge' || line.anchorForward > line.reachForward + DESK_EDGE_BEYOND_REACH_MAX_METERS) {
    // At the desk's edge (or, for a pair that wouldn't reach the desk, at the same reach line): at the view distance.
    anchor = add(anchor, forwardAxis, line.reachForward - anchorForward);
    anchorForward = line.reachForward;
  }
  const pose = (lateral: number, size: SlabSize): SlabPose => {
    const lean = eyeFacingLeanFromBottom(line.anchorEyeRise, anchorForward, size.height);
    const half = size.height / 2;
    const center = add(add(anchor, rightAxis, lateral), forwardAxis, half * Math.sin(lean));
    center.y += SURFACE_LIFT_METERS + half * Math.cos(lean);
    return { center, lean };
  };
  return {
    left: pose(-off.left, left),
    right: pose(off.right, right),
    mode: mode.kind,
    deskY: anchor.y,
  };
}
