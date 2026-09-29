/**
 * The join interaction's state machine, kept pure (no IWSDK/three) so every
 * transition is unit-testable apart from the animation code that reacts to
 * it.
 *
 *   idle --enterRange--> previewing --release(moving)--> joined
 *   previewing --exitRange--> idle
 *   idle --commit--> joined                     (programmatic / debug join)
 *   joined --setJoinType / toggleJoinType--> joined
 *   joined --pullApart--> separating --separated--> idle
 *
 * LEFT/RIGHT RULE: the slab that stayed put is the LEFT table; the slab the
 * user brought over (the one held and released) is the RIGHT table. So
 * bringing orders to customers yields `customers LEFT JOIN orders`. This is
 * decided by who moved, never by which side of the screen a slab docks on.
 *
 * Events that don't apply to the current phase return the same state object
 * unchanged, so callers can detect "no transition" by identity.
 */

import type { JoinType } from './types.js';

export type SlabId = string;

export const DEFAULT_JOIN_TYPE: JoinType = 'inner';

export type JoinState =
  | { phase: 'idle' }
  | { phase: 'previewing'; moving: SlabId; stationary: SlabId }
  | { phase: 'joined'; left: SlabId; right: SlabId; joinType: JoinType }
  | { phase: 'separating'; left: SlabId; right: SlabId; joinType: JoinType };

export type JoinEvent =
  | { type: 'enterRange'; moving: SlabId; stationary: SlabId }
  | { type: 'exitRange' }
  | { type: 'release'; slab: SlabId }
  | { type: 'commit'; left: SlabId; right: SlabId }
  | { type: 'setJoinType'; joinType: JoinType }
  | { type: 'toggleJoinType' }
  | { type: 'pullApart' }
  | { type: 'separated' };

export const INITIAL_JOIN_STATE: JoinState = { phase: 'idle' };

export function transition(state: JoinState, event: JoinEvent): JoinState {
  switch (state.phase) {
    case 'idle':
      if (event.type === 'enterRange' && event.moving !== event.stationary) {
        return { phase: 'previewing', moving: event.moving, stationary: event.stationary };
      }
      if (event.type === 'commit' && event.left !== event.right) {
        return { phase: 'joined', left: event.left, right: event.right, joinType: DEFAULT_JOIN_TYPE };
      }
      return state;

    case 'previewing':
      if (event.type === 'exitRange') {
        return { phase: 'idle' };
      }
      if (
        event.type === 'enterRange' &&
        event.moving !== event.stationary &&
        (event.moving !== state.moving || event.stationary !== state.stationary)
      ) {
        return { phase: 'previewing', moving: event.moving, stationary: event.stationary };
      }
      if (event.type === 'release' && event.slab === state.moving) {
        return { phase: 'joined', left: state.stationary, right: state.moving, joinType: DEFAULT_JOIN_TYPE };
      }
      return state;

    case 'joined':
      if (event.type === 'setJoinType' && event.joinType !== state.joinType) {
        return { ...state, joinType: event.joinType };
      }
      if (event.type === 'toggleJoinType') {
        return { ...state, joinType: state.joinType === 'inner' ? 'left' : 'inner' };
      }
      if (event.type === 'pullApart') {
        return { phase: 'separating', left: state.left, right: state.right, joinType: state.joinType };
      }
      return state;

    case 'separating':
      if (event.type === 'separated') {
        return { phase: 'idle' };
      }
      return state;
  }
}
