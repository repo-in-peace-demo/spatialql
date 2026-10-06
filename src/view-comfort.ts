/**
 * Comfortable vertical field of view, shared by slab placement and the join
 * result slab. Allocation-free.
 *
 * Angles are measured from a *natural seated gaze*: NATURAL_GAZE_PITCH_DEG
 * below horizontal along the head's yaw, not from the head's actual pitch
 * at placement time. Seated desk work naturally looks slightly down, and a
 * fixed gaze keeps placement independent of where the user happened to be
 * looking when the session started. The whole slab group (source pair,
 * join-type control, result slab) must fit one vertical window of
 * GROUP_MAX_VERTICAL_FOV_DEG centered on that gaze.
 */

import { MathUtils, type Object3D, type Vector3 } from '@iwsdk/core';

/**
 * The natural seated gaze: this far below horizontal. The one place to tune
 * it: desk placement's view fits, the join's band / result / card placement
 * and its fit push-back, every readout, the debug panel and the dev
 * `seated` pose all read it. Was 18; on the Quest 3S, seated users held
 * their heads 2-6 deg down (headset logs of 2026-10-06), so 8. The debug
 * panel logs the head's pitch every 10 s to keep tuning from data.
 */
export const NATURAL_GAZE_PITCH_DEG = 8;
export const NATURAL_GAZE_PITCH_RAD = MathUtils.degToRad(NATURAL_GAZE_PITCH_DEG);

/** The whole group's vertical extent, centered on the natural gaze. Tune on a headset. */
export const GROUP_MAX_VERTICAL_FOV_DEG = 80;
/** Every element's edges stay within this far below / above the natural gaze. */
export const VIEW_MAX_BELOW_GAZE_DEG = GROUP_MAX_VERTICAL_FOV_DEG / 2;
export const VIEW_MAX_ABOVE_GAZE_DEG = GROUP_MAX_VERTICAL_FOV_DEG / 2;

/**
 * Seated reach: every element the user must touch (source slabs, the
 * join-type control) keeps its center at most this far from the eyes.
 * Reach wins over the view window.
 */
export const TOUCH_REACH_MAX_METERS = 0.6;
/** Where touchable content should ideally sit (for the debug readout). */
export const TOUCH_REACH_IDEAL_METERS = 0.5;

/** Row text on view-only slabs should subtend at least this many degrees. */
export const MIN_ROW_TEXT_DEG = 1.0;

// --- Text sized by angle ----------------------------------------------------
// Physical font sizes come from angular targets at each slab's planned eye
// distance, so text reads the same wherever a slab sits and slabs aren't
// physically oversized at arm's length. Defined in the pure text-angles.ts
// (so data tests can use them) and re-exported here.
export {
  fontCmForAngle,
  HEADER_TEXT_TARGET_DEG,
  MIN_ROW_FONT_CM,
  PLANNED_CARD_DISTANCE_METERS,
  PLANNED_CONTROL_DISTANCE_METERS,
  PLANNED_RESULT_DISTANCE_METERS,
  PLANNED_SOURCE_DISTANCE_METERS,
  ROW_TEXT_TARGET_DEG,
  slabTextSizeAt,
} from './text-angles.js';
/** Readouts warn when a slab's actual row text angle is this far off target. */
export const TEXT_ANGLE_TOLERANCE = 0.15;

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

/**
 * Smallest horizontal distance from the head at which a point `drop` meters
 * below eye level (negative = above) sits inside the view window around the
 * gaze. `gazePitchDownRad` is positive when the gaze looks down.
 */
export function minDistanceForDrop(
  drop: number,
  gazePitchDownRad: number,
  maxAboveDeg = VIEW_MAX_ABOVE_GAZE_DEG,
  maxBelowDeg = VIEW_MAX_BELOW_GAZE_DEG,
): number {
  if (drop === 0) {
    return 0;
  }
  const allowed =
    drop > 0 ? MathUtils.degToRad(maxBelowDeg) + gazePitchDownRad : MathUtils.degToRad(maxAboveDeg) - gazePitchDownRad;
  if (allowed >= Math.PI / 2 - 1e-3) {
    return 0;
  }
  if (allowed <= 0) {
    return Infinity;
  }
  return Math.abs(drop) / Math.tan(allowed);
}

/** Signed degrees of `point` relative to the gaze direction (negative = below). */
export function degreesFromForward(head: Vector3, gazePitchDownRad: number, point: Vector3): number {
  const dx = point.x - head.x;
  const dz = point.z - head.z;
  const pitchToPoint = Math.atan2(point.y - head.y, Math.sqrt(dx * dx + dz * dz));
  return MathUtils.radToDeg(pitchToPoint + gazePitchDownRad);
}

export function degreesFitComfort(
  degrees: number,
  maxAboveDeg = VIEW_MAX_ABOVE_GAZE_DEG,
  maxBelowDeg = VIEW_MAX_BELOW_GAZE_DEG,
): boolean {
  return degrees >= -(maxBelowDeg + FOV_TOLERANCE_DEG) && degrees <= maxAboveDeg + FOV_TOLERANCE_DEG;
}

/** Angular height (degrees) of text `heightMeters` tall seen from `distance` meters. */
export function textAngleDeg(heightMeters: number, distance: number): number {
  return MathUtils.radToDeg(2 * Math.atan(heightMeters / 2 / Math.max(distance, 1e-3)));
}

export type SlabEdgeAngles = { topDeg: number; bottomDeg: number; fits: boolean };

/**
 * Measures a placed slab's top and bottom edge midpoints against the gaze,
 * given their local Y offsets (center-anchored slabs: +h/2 / -h/2;
 * top-anchored: 0 / -h). Writes into `out` and uses `scratch`; allocates
 * nothing.
 */
export function measureSlabEdges(
  head: Vector3,
  gazePitchDownRad: number,
  object: Object3D,
  topLocalY: number,
  bottomLocalY: number,
  scratch: Vector3,
  out: SlabEdgeAngles,
  maxAboveDeg = VIEW_MAX_ABOVE_GAZE_DEG,
  maxBelowDeg = VIEW_MAX_BELOW_GAZE_DEG,
): SlabEdgeAngles {
  object.updateWorldMatrix(true, false);
  scratch.set(0, topLocalY, 0);
  object.localToWorld(scratch);
  out.topDeg = degreesFromForward(head, gazePitchDownRad, scratch);
  scratch.set(0, bottomLocalY, 0);
  object.localToWorld(scratch);
  out.bottomDeg = degreesFromForward(head, gazePitchDownRad, scratch);
  out.fits =
    degreesFitComfort(out.topDeg, maxAboveDeg, maxBelowDeg) && degreesFitComfort(out.bottomDeg, maxAboveDeg, maxBelowDeg);
  return out;
}
