/**
 * The link between desk placement (which owns the source slabs and the
 * dataset switch) and the systems that need to know about it, so none of
 * them import each other. Placement registers itself as `desk`.
 */

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
}

export const deskBridge: { desk: DeskControls | null } = { desk: null };

/** Whether the desk is ready (not mid-switch); true when there's no desk bridge (free play before init). */
export function deskReady(): boolean {
  const desk = deskBridge.desk;
  return !desk || desk.deskState.phase === 'ready';
}
