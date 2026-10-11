/**
 * Dev only (the `debug` flag): what may move the source slabs, the result
 * slab or the puzzle card. They move only for these reasons: placement at
 * session start, Recenter, a dataset switch, a puzzle switch, the join
 * (its dock and sequence), pull-apart and the glide home, and the player's
 * own grabs; and a tracking correction, which moves them only in
 * coordinates, keeping them in place in the room. Whatever moves them calls
 * `allowMoves` while it runs; the join system checks each frame
 * (`checkMove`) and warns when one of them moved with no reason active -- a
 * column change, a head movement, anything else.
 *
 * The clock is the caller's (seconds). Kept free of IWSDK imports so it's
 * tested in Node.
 */

export type MoveReason =
  | 'placement'
  | 'recenter'
  | 'dataset-switch'
  | 'puzzle-switch'
  | 'join'
  | 'dock'
  | 'pull-apart'
  | 'glide-home'
  | 'grab'
  | 'tracking-correction';

/** How far an element may drift in a frame without counting as a move (meters). */
export const MOVE_TOLERANCE_METERS = 0.001;

const until = new Map<MoveReason, number>();

/** Allows moves for `reason` from now until `forSeconds` from now (a mover calls it each frame it runs, or once with its duration). */
export function allowMoves(reason: MoveReason, now: number, forSeconds = 0.25): void {
  until.set(reason, Math.max(until.get(reason) ?? -Infinity, now + forSeconds));
}

/** The reasons active at `now`. */
export function activeMoveReasons(now: number): MoveReason[] {
  const active: MoveReason[] = [];
  for (const [reason, end] of until) {
    if (end >= now) {
      active.push(reason);
    }
  }
  return active;
}

type Point = { x: number; y: number; z: number };

/** One tracked element's last position (null before it's first seen). */
export type Tracked = { last: Point | null; warned: boolean };

/**
 * Compares `element`'s position with the last one: a move beyond
 * MOVE_TOLERANCE_METERS with no reason active is a violation (returned as
 * the distance moved; null otherwise). Warns once per run of unexplained
 * moves (`warned`), again after the element has stood still or moved for a
 * reason. Updates `tracked`.
 */
export function checkMove(tracked: Tracked, position: Point, now: number): number | null {
  const last = tracked.last;
  tracked.last = { x: position.x, y: position.y, z: position.z };
  if (!last) {
    return null;
  }
  const moved = Math.hypot(position.x - last.x, position.y - last.y, position.z - last.z);
  if (moved <= MOVE_TOLERANCE_METERS || activeMoveReasons(now).length > 0) {
    tracked.warned = false;
    return null;
  }
  if (tracked.warned) {
    return null;
  }
  tracked.warned = true;
  return moved;
}

/** Tests only. */
export function resetMoveGuardForTests(): void {
  until.clear();
}
