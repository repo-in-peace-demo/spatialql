/**
 * The control band's arc, kept pure (no IWSDK imports) so it's tested in
 * Node. The band (INNER | LEFT, the puzzle bar or free play's bar) is laid
 * out flat by UIKit, then each item is turned about the vertical axis
 * through the eyes onto a circle around them, so every button keeps its
 * height, faces the eyes, stays level (no roll) and is the same distance
 * away (BAND_ARC_RADIUS_METERS, at the band's own height).
 *
 * Frame: a band document's own frame. Its origin is its left edge's middle,
 * BAND_ARC_RADIUS_METERS from the eyes, facing them: the eyes sit at
 * (0, 0, radius). It leans back by `lean` (the eyes' elevation seen from it,
 * radians), so world up is (0, cos lean, sin lean) in this frame. A flat
 * item centered `s` from the left edge (an arc length, at the band's height)
 * turns by `s / (radius cos lean)` about that up axis.
 */

/** The band's distance from the eyes. */
export const BAND_ARC_RADIUS_METERS = 0.5;

/** An item's place on the arc, in the band's frame: its center, and its rotation (Euler XYZ, radians: UIKit's order). */
export type ArcPlacement = { x: number; y: number; z: number; rx: number; ry: number; rz: number };

/** The angle (radians, + right) an arc length `s` turns by, about the vertical through the eyes. */
export function arcAngle(s: number, radius: number, lean: number): number {
  return s / (radius * Math.cos(lean));
}

/** `v` rotated by `angle` about the band's up axis (world up, in its frame), in place. */
function rotateAboutUp(v: { x: number; y: number; z: number }, angle: number, lean: number): void {
  const ux = 0;
  const uy = Math.cos(lean);
  const uz = Math.sin(lean);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dot = ux * v.x + uy * v.y + uz * v.z;
  const cx = uy * v.z - uz * v.y;
  const cy = uz * v.x - ux * v.z;
  const cz = ux * v.y - uy * v.x;
  const x = v.x * c + cx * s + ux * dot * (1 - c);
  const y = v.y * c + cy * s + uy * dot * (1 - c);
  const z = v.z * c + cz * s + uz * dot * (1 - c);
  v.x = x;
  v.y = y;
  v.z = z;
}

const _v = { x: 0, y: 0, z: 0 };

/**
 * Where a flat item centered at (`s`, `y`) in the band's frame goes on the
 * arc, and how it turns (to face the eyes, level). Allocation-free: writes
 * `out`.
 */
export function arcPlace(s: number, y: number, radius: number, lean: number, out: ArcPlacement): ArcPlacement {
  // Its flat center seen from the eyes, turned about the vertical through them.
  const angle = -arcAngle(s, radius, lean);
  _v.x = 0;
  _v.y = y;
  _v.z = -radius;
  rotateAboutUp(_v, angle, lean);
  out.x = _v.x;
  out.y = _v.y;
  out.z = _v.z + radius;
  // The rotation: `angle` about up (0, cos lean, sin lean), as Euler XYZ (three.js's decomposition).
  const uy = Math.cos(lean);
  const uz = Math.sin(lean);
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  const t = 1 - c;
  const m11 = c;
  const m12 = -uz * sn;
  const m13 = uy * sn;
  const m23 = t * uy * uz;
  const m33 = t * uz * uz + c;
  const m22 = t * uy * uy + c;
  const m32 = t * uy * uz;
  out.ry = Math.asin(Math.max(-1, Math.min(1, m13)));
  if (Math.abs(m13) < 0.9999999) {
    out.rx = Math.atan2(-m23, m33);
    out.rz = Math.atan2(-m12, m11);
  } else {
    out.rx = Math.atan2(m32, m22);
    out.rz = 0;
  }
  return out;
}

/**
 * A point in the band's frame, unrolled (in place) into the flat layout's
 * frame: x becomes the arc length where it sits (plus its offset across
 * the item there), y its height on the band, z its depth in front of the
 * item's face (+ toward the eyes). The items' flat rectangles then work
 * as-is for hit tests, pokes and pinches.
 */
export function unrollArc(point: { x: number; y: number; z: number }, radius: number, lean: number): void {
  const uy = Math.cos(lean);
  const uz = Math.sin(lean);
  // From the eyes; its horizontal part (perpendicular to up).
  const dx = point.x;
  const dy = point.y;
  const dz = point.z - radius;
  const along = dy * uy + dz * uz;
  const hx = dx;
  const hy = dy - along * uy;
  const hz = dz - along * uz;
  // The angle from the band's origin direction (0, sin lean, -cos lean), + right.
  const angle = Math.atan2(hx, hy * uz - hz * uy);
  _v.x = dx;
  _v.y = dy;
  _v.z = dz;
  rotateAboutUp(_v, angle, lean);
  point.x = _v.x + radius * Math.cos(lean) * angle;
  point.y = _v.y;
  point.z = _v.z + radius;
}

/**
 * Where a ray meets the band's circle around the eyes, going outward: the
 * distance along the ray (in units of its direction's length), or Infinity.
 * Horizontal only: `ox`, `oz` from the eyes, `dx`, `dz` its direction,
 * `radius` the circle's horizontal radius.
 */
export function rayCircleDistance(ox: number, oz: number, dx: number, dz: number, radius: number): number {
  const a = dx * dx + dz * dz;
  const b = 2 * (ox * dx + oz * dz);
  const c = ox * ox + oz * oz - radius * radius;
  const disc = b * b - 4 * a * c;
  if (a < 1e-12 || disc < 0) {
    return Infinity;
  }
  const t = (-b + Math.sqrt(disc)) / (2 * a);
  return t > 0 ? t : Infinity;
}
