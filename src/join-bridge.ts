/**
 * The narrow link between the join system and challenge mode, so neither
 * system imports the other. The join system registers itself as `join`;
 * challenge mode registers its hooks as `challenge`. Without challenge mode
 * (free play), `challenge` stays null and the join system behaves exactly as
 * before.
 */

import type { Object3D, Vector3 } from '@iwsdk/core';
import type { RowStatus } from './data/compare.js';
import type { JoinState } from './data/join-state.js';

/** A challenge element the join system places, with its size (meters). */
export type PlacedElement = { object: Object3D; widthMeters: number; heightMeters: number };

/** The bar also lists its buttons (in its own frame), for the readout. Its width changes with the chip. */
export type PlacedBar = PlacedElement & {
  buttons: readonly { name: string; centerX: number; width: number }[];
  buttonHeightMeters: number;
};

export type ChallengeLayout = {
  /** View-only card above the result slot (origin at its center). */
  card: PlacedElement;
  /** Touchable bar in the control band (origin at its center); kept in sync by challenge mode. */
  bar: PlacedBar;
};

/** What challenge mode provides to the join system. */
export interface ChallengeHooks {
  /** A join sequence, toggle or filter change has finished animating. */
  onSettled(): void;
  /** The join phase changed (e.g. joined, or back to idle after separating). */
  onPhase(phase: JoinState['phase']): void;
  /**
   * In-plane distance from a pinch at `point` to the nearest bar button, if
   * it's within the bar's pinch margin (and near its surface); else Infinity.
   * The join system compares it with the control's, so the nearest wins.
   */
  barDistance(point: Vector3): number;
  /** Presses the bar button nearest a pinch at `point`. */
  pressBarAt(point: Vector3, hand: string): void;
}

/** What the join system offers challenge mode. */
export interface JoinControls {
  readonly joinState: JoinState;
  /** Ids of the source tables on the desk (a puzzle may only load on exactly these). */
  deskTableIds(): string[];
  setChallengeLayout(layout: ChallengeLayout): void;
  /** The target silhouette shown in the result slot before a join (top-anchored), or null. */
  setSilhouette(silhouette: PlacedElement | null): void;
  /** Re-places the card, bar and silhouette (now if joined, e.g. after the bar resized; else before the next join). */
  requestLayout(): void;
  requestClearFilter(): void;
  /** Next puzzle: separate if joined, and glide both slabs back to where they started. */
  resetToHome(): void;
  /** Diff markers per result row, and how many placeholder rows to show; null clears them. */
  applyDiff(rowStatus: readonly RowStatus[] | null, missing: number): void;
  setWinLook(won: boolean): void;
  /** Briefly pulses the shown rows that hold a NULL (the coach for the NULL poke). */
  pulseNullRows(): void;
  /** Whether any shown result row holds a NULL. */
  hasVisibleNull(): boolean;
  /** Dev (`F`): pokes the first shown NULL cell; false if there's none. */
  debugPokeFirstNull(): boolean;
}

export const joinBridge: { join: JoinControls | null; challenge: ChallengeHooks | null } = {
  join: null,
  challenge: null,
};
