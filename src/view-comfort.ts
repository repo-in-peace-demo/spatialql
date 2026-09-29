/**
 * Comfortable vertical field of view, shared by slab placement and the join
 * result slab. Angles are measured against the head's forward direction
 * (pitch included), so a user already looking down tolerates content lower
 * down. Allocation-free.
 */

import { MathUtils, type Object3D, type Vector3 } from '@iwsdk/core';

/** A slab edge may sit at most this far below the head's forward direction. */
export const FOV_MAX_BELOW_FORWARD_DEG = 40;
/** ...and at most this far above it. */
export const FOV_MAX_ABOVE_FORWARD_DEG = 25;
/**
 * The join result slab may reach this far above the head's forward
 * direction (seated users read slightly-above-eye content comfortably, like
 * a monitor) before it would have to shrink, which it never does.
 */
export const RESULT_MAX_ABOVE_FORWARD_DEG = 30;

/** Slabs never lie flatter or stand straighter than these (degrees from flat). */
export const SLAB_MIN_TILT_FROM_FLAT_DEG = 30;
export const SLAB_MAX_TILT_FROM_FLAT_DEG = 85;
// Expressed as lean back from vertical, which is how slab rotations are set.
const MIN_LEAN_RAD = MathUtils.degToRad(90 - SLAB_MAX_TILT_FROM_FLAT_DEG);
const MAX_LEAN_RAD = MathUtils.degToRad(90 - SLAB_MIN_TILT_FROM_FLAT_DEG);

/**
 * Lean back from vertical (radians) that points a slab's face at the eyes,
 * given how far the eyes are above the slab's center (`eyeRise`) and the
 * center's horizontal distance along the shared viewing direction. A slab
 * leaning back by L has its face normal raised L above horizontal, so the
 * face is perpendicular to the eye line when L equals the eye line's
 * elevation. Clamped to the tilt limits above.
 */
export function eyeFacingLean(eyeRise: number, forwardDistance: number): number {
  const elevation = Math.atan2(eyeRise, Math.max(forwardDistance, 1e-3));
  return MathUtils.clamp(elevation, MIN_LEAN_RAD, MAX_LEAN_RAD);
}

/**
 * Eye-facing lean for a slab whose bottom edge rests at a fixed point: its
 * center moves as it leans (up by h/2*cos L, away by h/2*sin L), so this
 * iterates to a fixed point. `eyeRise` / `forwardDistance` are measured to
 * the bottom edge's midpoint.
 */
export function eyeFacingLeanFromBottom(eyeRise: number, forwardDistance: number, height: number): number {
  const half = height / 2;
  let lean = (MIN_LEAN_RAD + MAX_LEAN_RAD) / 2;
  for (let i = 0; i < 6; i++) {
    lean = eyeFacingLean(eyeRise - half * Math.cos(lean), forwardDistance + half * Math.sin(lean));
  }
  return lean;
}
// Small slack so float rounding at exactly the limit doesn't warn.
const FOV_TOLERANCE_DEG = 0.5;

const FOV_MAX_BELOW_RAD = MathUtils.degToRad(FOV_MAX_BELOW_FORWARD_DEG);
const FOV_MAX_ABOVE_RAD = MathUtils.degToRad(FOV_MAX_ABOVE_FORWARD_DEG);

/**
 * Smallest horizontal distance from the head at which a point `drop` meters
 * below eye level (negative = above) sits inside the comfortable vertical
 * field of view. `headPitchDownRad` is positive when looking down.
 */
export function minDistanceForDrop(
  drop: number,
  headPitchDownRad: number,
  maxAboveDeg = FOV_MAX_ABOVE_FORWARD_DEG,
): number {
  if (drop === 0) {
    return 0;
  }
  const maxAboveRad = maxAboveDeg === FOV_MAX_ABOVE_FORWARD_DEG ? FOV_MAX_ABOVE_RAD : MathUtils.degToRad(maxAboveDeg);
  const allowed = drop > 0 ? FOV_MAX_BELOW_RAD + headPitchDownRad : maxAboveRad - headPitchDownRad;
  if (allowed >= Math.PI / 2 - 1e-3) {
    return 0;
  }
  if (allowed <= 0) {
    return Infinity;
  }
  return Math.abs(drop) / Math.tan(allowed);
}

/** Signed degrees of `point` relative to the head's forward direction (negative = below). */
export function degreesFromForward(head: Vector3, headPitchDownRad: number, point: Vector3): number {
  const dx = point.x - head.x;
  const dz = point.z - head.z;
  const pitchToPoint = Math.atan2(point.y - head.y, Math.sqrt(dx * dx + dz * dz));
  return MathUtils.radToDeg(pitchToPoint + headPitchDownRad);
}

export function degreesFitComfort(degrees: number, maxAboveDeg = FOV_MAX_ABOVE_FORWARD_DEG): boolean {
  return degrees >= -(FOV_MAX_BELOW_FORWARD_DEG + FOV_TOLERANCE_DEG) && degrees <= maxAboveDeg + FOV_TOLERANCE_DEG;
}

export type SlabEdgeAngles = { topDeg: number; bottomDeg: number; fits: boolean };

/**
 * Measures a placed slab's top and bottom edge midpoints, given their local
 * Y offsets (center-anchored slabs: +h/2 / -h/2; top-anchored: 0 / -h).
 * Writes into `out` and uses `scratch`; allocates nothing.
 */
export function measureSlabEdges(
  head: Vector3,
  headPitchDownRad: number,
  object: Object3D,
  topLocalY: number,
  bottomLocalY: number,
  scratch: Vector3,
  out: SlabEdgeAngles,
  maxAboveDeg = FOV_MAX_ABOVE_FORWARD_DEG,
): SlabEdgeAngles {
  object.updateWorldMatrix(true, false);
  scratch.set(0, topLocalY, 0);
  object.localToWorld(scratch);
  out.topDeg = degreesFromForward(head, headPitchDownRad, scratch);
  scratch.set(0, bottomLocalY, 0);
  object.localToWorld(scratch);
  out.bottomDeg = degreesFromForward(head, headPitchDownRad, scratch);
  out.fits = degreesFitComfort(out.topDeg, maxAboveDeg) && degreesFitComfort(out.bottomDeg, maxAboveDeg);
  return out;
}
