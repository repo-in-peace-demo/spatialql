/**
 * A fingertip poke on a flat touch surface (the INNER | LEFT control, the
 * puzzle bar, the result slab's NULL cells), checked against the surface's
 * own geometry. The SDK's poke (a UIKit click) needs the fingertip to reach
 * within 2 cm and pull back out within 800 ms; on the headset, hand-tracking
 * jitter at the surface kept most pokes from ever completing. This presses
 * on contact instead.
 *
 * Per hand, in the surface's frame (z = distance in front of its face):
 * - **Contact:** the fingertip crosses from more than CONTACT_DEPTH_METERS in
 *   front to within it (and not more than BEHIND_LIMIT_METERS behind) over
 *   a target (the caller decides, with its own tolerance).
 * - **From the viewer's side:** the fingertip must arrive moving toward the
 *   face: from where it entered APPROACH_DEPTH_METERS in front, its path
 *   must be within MAX_POKE_APPROACH_DEG of straight at the face (sideways
 *   travel at most tan(60°) times its travel toward it). A hand reaching
 *   past the bar to a slab slides along the face and is rejected.
 * - **Index finger extended,** when the hand's joints are tracked
 *   (straightness at least MIN_INDEX_STRAIGHTNESS).
 * - **Re-arm:** after a press, the same hand presses again only once its
 *   fingertip has pulled back REARM_DEPTH_METERS, so jitter can't double-press.
 *
 * Allocation-free per frame.
 */

import type { Vector3 } from '@iwsdk/core';

export const CONTACT_DEPTH_METERS = 0.01;
/** A fingertip this close in front of a target (and over it) hovers it: the same outline as the hand pointer's. */
export const POKE_HOVER_DEPTH_METERS = 0.03;
export const REARM_DEPTH_METERS = 0.03;
/** Where an approach starts being tracked (in front of the face). */
export const APPROACH_DEPTH_METERS = 0.05;
/** Deeper than this behind the face, a crossing doesn't count (the hand came through from behind). */
export const BEHIND_LIMIT_METERS = 0.03;
/**
 * The steepest approach that still presses: degrees off straight at the face
 * (0 = straight in). 2026-10-10 headset log: picker tiles and Filter chips
 * (far left, high) were poked at 47-58° and rejected at the old 45°; slides
 * along the face (a hand passing to a slab) came in at 61-77°.
 */
export const MAX_POKE_APPROACH_DEG = 60;
const MAX_SIDEWAYS_PER_TOWARD = Math.tan((MAX_POKE_APPROACH_DEG * Math.PI) / 180);
/** An index finger this straight counts as extended (1 = straight). */
export const MIN_INDEX_STRAIGHTNESS = 0.8;
/** In-plane tolerance around a target's rectangle (the caller's hit test uses it). */
export const POKE_TARGET_TOLERANCE_METERS = 0.005;

/**
 * Pinches on a button (the control's options and the puzzle bar's) count
 * up to this far in front of its face -- on the headset, players pinched
 * 5-10 cm in front of the button they meant --
 */
export const BUTTON_PINCH_FRONT_DEPTH_METERS = 0.06;
/** ...and only this far behind it, toward the slabs (keeping the palm out of their grab range). */
export const BUTTON_PINCH_BACK_DEPTH_METERS = 0.03;

export type PokeVerdict = 'none' | 'press' | 'rejected-direction' | 'rejected-finger';

/**
 * Dev log: a contact that didn't press (rejected, or off every target),
 * reported once the fingertip has pulled back out: why, its approach angle
 * (degrees off straight in; NaN when off-target), and how deep it went
 * (meters in front of the face; negative = behind it).
 */
export type PokeMiss = { verdict: 'rejected-direction' | 'rejected-finger' | 'off-target'; angleDeg: number; deepest: number };

/** Dev log: a missed contact, e.g. "rejected: came in 55° off straight (max 60°); reached 1.8 cm behind the face". */
export function pokeMissText(miss: PokeMiss): string {
  if (!import.meta.env.DEV) {
    return '';
  }
  const why =
    miss.verdict === 'off-target'
      ? 'touched the surface off every target'
      : miss.verdict === 'rejected-finger'
        ? `rejected: index finger not extended (came in ${miss.angleDeg.toFixed(0)}° off straight)`
        : `rejected: came in ${miss.angleDeg.toFixed(0)}° off straight (max ${MAX_POKE_APPROACH_DEG}°)`;
  const depth = miss.deepest >= 0 ? `${(miss.deepest * 100).toFixed(1)} cm in front of` : `${(-miss.deepest * 100).toFixed(1)} cm behind`;
  return `${why}; the fingertip reached ${depth} the face`;
}

/** A contact's approach angle (degrees off straight at the face) from its travel toward the face and sideways. */
export function approachAngleDeg(toward: number, sideways: number): number {
  return (Math.atan2(sideways, Math.max(toward, 0)) * 180) / Math.PI;
}

/**
 * Dev log: the last poke press (by any ContactPoke) -- which hand, its
 * approach (travel toward the face and sideways, meters; speed, m/s), the
 * fingertip's depth at contact, and the index's straightness. The touch
 * probe prints it with the press (touch-probe.ts).
 */
export const lastPokePress = {
  hand: '',
  toward: 0,
  sideways: 0,
  speed: 0,
  depth: 0,
  straightness: null as number | null,
  atMs: -Infinity,
};

type HandState = {
  depth: number;
  /** A contact that didn't press, still in progress: its deepest depth so far (reported on pulling back). */
  missing: boolean;
  miss: PokeMiss;
  /** When the approach started (ms; performance.now()). */
  startMs: number;
  armed: boolean;
  approaching: boolean;
  startX: number;
  startY: number;
  startZ: number;
};

function handState(): HandState {
  return {
    depth: Infinity,
    missing: false,
    miss: { verdict: 'off-target', angleDeg: NaN, deepest: Infinity },
    startMs: 0,
    armed: true,
    approaching: false,
    startX: 0,
    startY: 0,
    startZ: 0,
  };
}

export class ContactPoke {
  private readonly hands: Record<string, HandState> = { left: handState(), right: handState() };
  /** The last contact's approach: travel toward the face and sideways (meters), and the finger's straightness. */
  readonly last = { toward: 0, sideways: 0, straightness: null as number | null };

  /** The hand isn't tracked (or the surface isn't live): forget its approach. */
  reset(hand: string): void {
    const state = this.hands[hand];
    if (state) {
      state.depth = Infinity;
      state.approaching = false;
      state.armed = true;
      state.missing = false;
    }
  }

  /** Dev log: `hand`'s last contact that didn't press, once the fingertip has pulled back out (once; else null). */
  takeMiss(hand: string): PokeMiss | null {
    const state = this.hands[hand];
    if (!state || state.missing || state.miss.deepest === Infinity) {
      return null;
    }
    this.reported.verdict = state.miss.verdict;
    this.reported.angleDeg = state.miss.angleDeg;
    this.reported.deepest = state.miss.deepest;
    state.miss.deepest = Infinity;
    return this.reported;
  }

  private readonly reported: PokeMiss = { verdict: 'off-target', angleDeg: NaN, deepest: 0 };

  /** Starts a non-pressing contact's report: `angleDeg` NaN when it wasn't on a target. */
  private startMiss(state: HandState, verdict: PokeMiss['verdict'], angleDeg: number, z: number): void {
    state.missing = true;
    state.miss.verdict = verdict;
    state.miss.angleDeg = angleDeg;
    state.miss.deepest = z;
  }

  /**
   * One frame for `hand`, with its fingertip at `local` (the surface's
   * frame). `onTarget` is asked only at a contact; `straightness` too (null
   * when the hand's joints aren't tracked: then it isn't checked).
   */
  update(hand: string, local: Vector3, onTarget: () => boolean, straightness: () => number | null): PokeVerdict {
    const state = this.hands[hand];
    if (!state) {
      return 'none';
    }
    const z = local.z;
    const before = state.depth;
    state.depth = z;
    // A contact that didn't press: follow how deep it goes, until the fingertip is back out.
    if (state.missing) {
      state.miss.deepest = Math.min(state.miss.deepest, z);
      if (z > CONTACT_DEPTH_METERS) {
        state.missing = false;
      }
    }
    if (z > REARM_DEPTH_METERS) {
      state.armed = true;
    }
    if (z > APPROACH_DEPTH_METERS || z < -BEHIND_LIMIT_METERS) {
      state.approaching = false;
    } else if (z > CONTACT_DEPTH_METERS && (!state.approaching || z > state.startZ)) {
      // The approach starts at the farthest point in the zone: pulling back
      // and coming in again starts a new approach.
      state.approaching = true;
      state.startX = local.x;
      state.startY = local.y;
      state.startZ = z;
      state.startMs = performance.now();
    }
    // A finite previous depth: a hand that starts tracking already at the surface isn't a contact.
    const contact =
      Number.isFinite(before) && before > CONTACT_DEPTH_METERS && z <= CONTACT_DEPTH_METERS && z > -BEHIND_LIMIT_METERS;
    if (!contact || !state.armed) {
      return 'none';
    }
    if (!onTarget()) {
      this.startMiss(state, 'off-target', NaN, z);
      return 'none';
    }
    // From where it entered the approach zone (or, for a fast poke that
    // jumped straight in, from the frame before).
    const startZ = state.approaching ? state.startZ : before;
    const toward = startZ - z;
    const sideways = state.approaching ? Math.hypot(local.x - state.startX, local.y - state.startY) : 0;
    this.last.toward = toward;
    this.last.sideways = sideways;
    this.last.straightness = null;
    state.approaching = false;
    if (sideways > MAX_SIDEWAYS_PER_TOWARD * Math.max(toward, 0)) {
      this.startMiss(state, 'rejected-direction', approachAngleDeg(toward, sideways), z);
      return 'rejected-direction';
    }
    const straight = straightness();
    this.last.straightness = straight;
    if (straight !== null && straight < MIN_INDEX_STRAIGHTNESS) {
      this.startMiss(state, 'rejected-finger', approachAngleDeg(toward, sideways), z);
      return 'rejected-finger';
    }
    state.armed = false;
    const now = performance.now();
    lastPokePress.hand = hand;
    lastPokePress.toward = toward;
    lastPokePress.sideways = sideways;
    lastPokePress.speed = state.approaching || startZ !== before ? toward / Math.max((now - state.startMs) / 1000, 1 / 90) : toward * 90;
    lastPokePress.depth = z;
    lastPokePress.straightness = straight;
    lastPokePress.atMs = now;
    return 'press';
  }
}
