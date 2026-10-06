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
 *   face: from where it entered APPROACH_DEPTH_METERS in front, its travel
 *   toward the face must be at least MIN_APPROACH_RATIO times its sideways
 *   travel. A hand reaching down past the bar to a slab moves mostly along
 *   the face and is rejected.
 * - **Index finger extended,** when the hand's joints are tracked
 *   (straightness at least MIN_INDEX_STRAIGHTNESS).
 * - **Re-arm:** after a press, the same hand presses again only once its
 *   fingertip has pulled back REARM_DEPTH_METERS, so jitter can't double-press.
 *
 * Allocation-free per frame.
 */

import type { Vector3 } from '@iwsdk/core';

export const CONTACT_DEPTH_METERS = 0.01;
export const REARM_DEPTH_METERS = 0.03;
/** Where an approach starts being tracked (in front of the face). */
export const APPROACH_DEPTH_METERS = 0.05;
/** Deeper than this behind the face, a crossing doesn't count (the hand came through from behind). */
export const BEHIND_LIMIT_METERS = 0.03;
/** Travel toward the face vs sideways travel: at least this ratio (1 = at least 45 deg to the face). */
export const MIN_APPROACH_RATIO = 1;
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

type HandState = {
  depth: number;
  armed: boolean;
  approaching: boolean;
  startX: number;
  startY: number;
  startZ: number;
};

function handState(): HandState {
  return { depth: Infinity, armed: true, approaching: false, startX: 0, startY: 0, startZ: 0 };
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
    }
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
    }
    // A finite previous depth: a hand that starts tracking already at the surface isn't a contact.
    const contact =
      Number.isFinite(before) && before > CONTACT_DEPTH_METERS && z <= CONTACT_DEPTH_METERS && z > -BEHIND_LIMIT_METERS;
    if (!contact || !state.armed || !onTarget()) {
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
    if (toward < MIN_APPROACH_RATIO * sideways) {
      return 'rejected-direction';
    }
    const straight = straightness();
    this.last.straightness = straight;
    if (straight !== null && straight < MIN_INDEX_STRAIGHTNESS) {
      return 'rejected-finger';
    }
    state.armed = false;
    return 'press';
  }
}
