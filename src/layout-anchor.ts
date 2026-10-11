/**
 * The session layout anchor: the one rule for where things go.
 *
 * Every placement -- the source slabs and their homes, the result slab,
 * the puzzle card, the column (INNER | LEFT and the puzzle bar), the reach
 * banner -- for every puzzle, dataset and joined state, is computed from
 * this anchor: an eye position and a yaw. Never from the live head, nor from
 * a head pose stored along the way. So head movement never moves anything.
 *
 * It's set only at session start, on Recenter (the button), when the
 * headset comes back on after a while, and on a reference-space reset (the
 * platform's own recenter): `setLayoutAnchor` takes one of those reasons.
 * The live head is still read for sensing (which way the player faces,
 * whether they're out of reach, where a hand points), never for placement.
 *
 * Kept free of IWSDK imports so it's tested in Node.
 */

export type AnchorReason = 'session-start' | 'recenter' | 'headset-on' | 'reset';

export type LayoutAnchor = {
  /** The eyes (world, meters). */
  x: number;
  y: number;
  z: number;
  /** Facing (three.js yaw about +Y, radians: 0 faces -Z, + turns left). */
  yaw: number;
  /** What set it last; null before the first set. */
  reason: AnchorReason | null;
  /** Bumped on every set (placements can tell a new anchor from the one they used). */
  epoch: number;
};

/** Before the first set: a standing default, facing -Z (what the placement used before a session). */
const anchor: LayoutAnchor = { x: 0, y: 1.6, z: 0, yaw: 0, reason: null, epoch: 0 };

type Point = { x: number; y: number; z: number };

/** Sets the anchor: only at session start, Recenter, headset back on, or a reference-space reset. */
export function setLayoutAnchor(eyes: Point, yaw: number, reason: AnchorReason): void {
  anchor.x = eyes.x;
  anchor.y = eyes.y;
  anchor.z = eyes.z;
  anchor.yaw = yaw;
  anchor.reason = reason;
  anchor.epoch++;
}

/** The anchor (read-only; copy what you need). */
export function layoutAnchor(): Readonly<LayoutAnchor> {
  return anchor;
}

/** Writes the anchor's eye position into `out` (any {x, y, z} with `set`, e.g. a three.js Vector3). */
export function anchorEyes<T extends { set(x: number, y: number, z: number): T }>(out: T): T {
  return out.set(anchor.x, anchor.y, anchor.z);
}

/** Tests only: back to the default, as before any session. */
export function resetLayoutAnchorForTests(): void {
  anchor.x = 0;
  anchor.y = 1.6;
  anchor.z = 0;
  anchor.yaw = 0;
  anchor.reason = null;
  anchor.epoch = 0;
}
