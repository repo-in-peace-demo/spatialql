/**
 * The link between desk placement (which owns the source slabs and the
 * dataset switch) and the systems that need to know about it, so none of
 * them import each other. Placement registers itself as `desk`.
 */

import type { Quaternion, Vector3 } from '@iwsdk/core';
import type { DatasetId } from './data/datasets.js';
import type { DeskState } from './data/desk-session.js';

export interface DeskControls {
  /** Which dataset is on the desk, or which switch is under way. */
  readonly deskState: DeskState;
  /**
   * Switches the desk to `dataset` (leave, build, arrive). The caller makes
   * sure the join is idle and no slab is held; placement checks too and
   * waits. A request for the loaded dataset does nothing.
   */
  requestDataset(dataset: DatasetId): void;
  /** Whether any source slab is held right now. */
  anySlabHeld(): boolean;
  /**
   * This session's surface search found a table or desk, but too far away
   * to use (the slabs float): the card suggests moving closer.
   */
  readonly surfaceTooFar: boolean;
  /**
   * The Recenter button: after a short "Look straight ahead" countdown
   * (recenter-countdown.ts), re-places the whole group in front of where the
   * player then looks (as when the headset comes back on, or after a
   * recenter), once no slab is held. `button`: where the pressed button is
   * (world), so a head still turned toward it gets more time.
   */
  requestRecenter(button?: Vector3): void;
  /** Whether a recenter glide is moving the slabs (the join system re-places what follows them). */
  readonly recenterGliding: boolean;
  /** Counts re-placements; the join system takes the slabs' new home poses when it changes. */
  readonly placementEpoch: number;
  /**
   * The last recenter's normal side-by-side pose for `tableId` (where it
   * would sit apart, even if the pair was joined and glided as one) into
   * `outPos` / `outQuat`; false if no recenter placed it.
   */
  recenterHome(tableId: string, outPos: Vector3, outQuat: Quaternion): boolean;
}

/** Registered in free play too (Recenter works there); challenge mode's switch only runs in challenge mode. */
export const deskBridge: { desk: DeskControls | null } = { desk: null };

/** Whether the desk is ready (not mid-switch); true when there's no desk bridge (free play before init). */
export function deskReady(): boolean {
  const desk = deskBridge.desk;
  return !desk || desk.deskState.phase === 'ready';
}
