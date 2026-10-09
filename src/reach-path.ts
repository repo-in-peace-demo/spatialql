/**
 * The hand's path to a slab, kept pure (no IWSDK imports) so it's tested in
 * Node. Hands give no physical feedback, so nothing in the scene should sit
 * between a hand and a slab it reaches for: the straight path from each
 * shoulder to each slab's grab points (its top edge, name tab included, and
 * its near edge, at the middle and near both ends) must clear every UI element
 * (the card, the column, the result, the INNER | LEFT control, the reach
 * banner, the debug panel) by REACH_PATH_MIN_CLEARANCE_METERS.
 *
 * Elements are flat rectangles; the distance from a segment to one is exact
 * (zero when the segment passes through it).
 */

export type Vec3 = { x: number; y: number; z: number };

/** A flat rectangle: its center, two unit in-plane axes, and its half-extents along them (meters). */
export type ReachRect = { name: string; center: Vec3; u: Vec3; v: Vec3; halfU: number; halfV: number };

export const REACH_PATH_MIN_CLEARANCE_METERS = 0.05;
/** The shoulders, as the layout readout assumes them: this far to each side of, and below, the eyes. */
export const SHOULDER_SIDE_METERS = 0.18;
export const SHOULDER_DROP_METERS = 0.25;
/** Grab points along an edge: the middle, and this fraction of the half-width toward each end. */
export const GRAB_POINT_SPREAD = 0.9;

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (a: Vec3): number => Math.sqrt(dot(a, a));
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));

/** A rectangle from three of its corners: bottom-left, bottom-right, top-left. */
export function rectFromCorners(name: string, bottomLeft: Vec3, bottomRight: Vec3, topLeft: Vec3): ReachRect {
  const across = sub(bottomRight, bottomLeft);
  const upward = sub(topLeft, bottomLeft);
  const width = length(across);
  const height = length(upward);
  return {
    name,
    center: add(bottomLeft, scale(add(across, upward), 0.5)),
    u: scale(across, 1 / Math.max(width, 1e-9)),
    v: scale(upward, 1 / Math.max(height, 1e-9)),
    halfU: width / 2,
    halfV: height / 2,
  };
}

/** The nearest point of `rect` to `p`. */
function closestOnRect(p: Vec3, rect: ReachRect): Vec3 {
  const d = sub(p, rect.center);
  const a = Math.max(-rect.halfU, Math.min(rect.halfU, dot(d, rect.u)));
  const b = Math.max(-rect.halfV, Math.min(rect.halfV, dot(d, rect.v)));
  return add(rect.center, add(scale(rect.u, a), scale(rect.v, b)));
}

/** The distance between segments p0-p1 and q0-q1. */
function segmentSegmentDistance(p0: Vec3, p1: Vec3, q0: Vec3, q1: Vec3): number {
  const d1 = sub(p1, p0);
  const d2 = sub(q1, q0);
  const r = sub(p0, q0);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s = 0;
  let t = 0;
  if (a <= 1e-12 && e <= 1e-12) {
    return length(r);
  }
  if (a <= 1e-12) {
    t = clamp01(f / e);
  } else {
    const c = dot(d1, r);
    if (e <= 1e-12) {
      s = clamp01(-c / a);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > 1e-12 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  return length(sub(add(p0, scale(d1, s)), add(q0, scale(d2, t))));
}

/** The distance from segment a-b to `rect` (0 if it passes through it). */
export function segmentRectDistance(a: Vec3, b: Vec3, rect: ReachRect): number {
  const normal = cross(rect.u, rect.v);
  const da = dot(sub(a, rect.center), normal);
  const db = dot(sub(b, rect.center), normal);
  // Crosses the plane: inside the rectangle there is a hit.
  if ((da <= 0 && db >= 0) || (da >= 0 && db <= 0)) {
    const t = da === db ? 0 : da / (da - db);
    const p = add(a, scale(sub(b, a), t));
    const d = sub(p, rect.center);
    if (Math.abs(dot(d, rect.u)) <= rect.halfU && Math.abs(dot(d, rect.v)) <= rect.halfV) {
      return 0;
    }
  }
  // Otherwise the nearest pair is an endpoint against the face, or the segment against an edge.
  let best = Math.min(length(sub(a, closestOnRect(a, rect))), length(sub(b, closestOnRect(b, rect))));
  const corner = (su: number, sv: number) => add(rect.center, add(scale(rect.u, su * rect.halfU), scale(rect.v, sv * rect.halfV)));
  const corners = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  for (let i = 0; i < 4; i++) {
    best = Math.min(best, segmentSegmentDistance(a, b, corners[i], corners[(i + 1) % 4]));
  }
  return best;
}

/** The two shoulders for eyes at `head`, with `right` the horizontal unit vector to the viewer's right. */
export function shoulders(head: Vec3, right: Vec3): Vec3[] {
  return [-1, 1].map((side) => ({
    x: head.x + right.x * side * SHOULDER_SIDE_METERS,
    y: head.y - SHOULDER_DROP_METERS,
    z: head.z + right.z * side * SHOULDER_SIDE_METERS,
  }));
}

/**
 * A slab's grab points from its edges' ends (world): along the top edge
 * (name tab included) and the near (bottom) edge, the middle and
 * GRAB_POINT_SPREAD of the way to each end.
 */
export function grabPoints(topLeft: Vec3, topRight: Vec3, bottomLeft: Vec3, bottomRight: Vec3): Vec3[] {
  const points: Vec3[] = [];
  for (const [l, r] of [
    [topLeft, topRight],
    [bottomLeft, bottomRight],
  ]) {
    const mid = scale(add(l, r), 0.5);
    const half = scale(sub(r, l), 0.5 * GRAB_POINT_SPREAD);
    points.push(sub(mid, half), mid, add(mid, half));
  }
  return points;
}

/** One element's closest approach to any shoulder-to-grab-point path. */
export type ReachClearance = { name: string; meters: number; shoulder: number; point: number };

/** For each rectangle, its smallest distance to any path from `from` (shoulders) to `to` (grab points). */
export function reachClearances(from: readonly Vec3[], to: readonly Vec3[], rects: readonly ReachRect[]): ReachClearance[] {
  return rects.map((rect) => {
    let best: ReachClearance = { name: rect.name, meters: Infinity, shoulder: -1, point: -1 };
    from.forEach((a, shoulder) => {
      to.forEach((b, point) => {
        const meters = segmentRectDistance(a, b, rect);
        if (meters < best.meters) {
          best = { name: rect.name, meters, shoulder, point };
        }
      });
    });
    return best;
  });
}

/** A one-line readout: each element's clearance in cm, flagged under the minimum. */
export function reachClearanceText(clearances: readonly ReachClearance[]): string {
  return clearances
    .map(
      (c) =>
        `${c.name} ${(c.meters * 100).toFixed(1)} cm` +
        (c.meters < REACH_PATH_MIN_CLEARANCE_METERS ? ` (under ${REACH_PATH_MIN_CLEARANCE_METERS * 100} cm)` : ''),
    )
    .join(', ');
}
