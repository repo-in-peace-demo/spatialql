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
import type { QuerySpec } from './data/query.js';
import type { PressPath } from './touch-probe.js';

/** A challenge element the join system places, with its size (meters). */
export type PlacedElement = {
  object: Object3D;
  widthMeters: number;
  heightMeters: number;
  /** The card's row text size (meters), for the readout's text angle at its actual distance. */
  textFontMeters?: number;
};

/**
 * The bar (the control column) also lists its buttons. Its origin is its
 * left edge's vertical middle; its buttons are turned onto an arc around the
 * eyes (band-arc.ts), so each center's x is its arc length from the left edge
 * and its y is in the bar's frame (hit tests unroll the arc first). Its
 * height changes with the filter area (it grows upward: the join system keeps
 * its bottom edge put).
 */
export type PlacedBar = PlacedElement & {
  buttons: readonly { name: string; centerX: number; centerY: number; width: number }[];
  buttonHeightMeters: number;
  /** The INNER | LEFT row's middle, in the bar's frame (meters): the join system places the control there. */
  leadCenterYMeters: number;
  /**
   * How much of `widthMeters` extends left of the column's own place (the
   * in-XR puzzle picker, open): the join system keeps the column's right
   * edge, the control and the group's plan where they were. 0 or absent: none.
   */
  extendLeftMeters?: number;
  /**
   * A button that acts only when held (besides Exit, always held), and for
   * how long: challenge mode's Show answer, before the answer is shown. The
   * join system times the hold and draws its ring (onHoldComplete,
   * onHoldCancelled). Null: none.
   */
  holdButton: { name: string; seconds: number } | null;
  /** Shows or hides its Recenter button's hover label (the join system tracks fingertips and rays over it). */
  onRecenterHover?: (hovered: boolean) => void;
  /** The band's lean as placed (radians: the eyes' elevation seen from the bar), so its curved buttons stay level. */
  onArcLean?: (leanRad: number) => void;
  /** Shows or hides its Exit button's "Hold to exit" label (hovered or held). */
  onExitHover?: (hovered: boolean) => void;
  /** The hand pointer is on `buttons[index]` (-1: none); `previous` was hovered before. Outlines it. */
  onPointerHover?: (index: number, previous: number) => void;
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
  /** Presses the bar button nearest `point` (a pinch point, or where a hand's ray hit the bar). */
  pressBarAt(point: Vector3, hand: string, path: PressPath): void;
  /**
   * A NULL in a source table was poked or pinched (only the result's NULLs
   * filter): the card says where to poke instead.
   */
  onWrongNull(tableId: string, path: PressPath): void;
  /** The bar's `holdButton` was held its full time: it acts now. */
  onHoldComplete(name: string): void;
  /** The bar's `holdButton` was let go (or left) before its time: nothing happened (challenge mode says to hold). */
  onHoldCancelled(name: string): void;
  /** A press on a NULL in the column already filtered (no change): the bar's WHERE label pulses. */
  onNullFilterRepeat(): void;
}

/** One Filter chip: a result column with a NULL the player sees, and its header. */
export type NullFilterChoice = { column: number; header: string };

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
  /** The result slab's status badge, mirroring the card ("Solved!" in gold, "Completed", the diff summary); null hides it. */
  setResultBadge(text: string | null, look: 'won' | 'neutral'): void;
  /** Once, gently: the shown NULL cells' outlines brighten and settle (the first-time cue for the NULL poke). */
  pulseNullCells(): void;
  /** The Filter button's chips: result columns with a NULL in a shown row (empty unless joined). */
  nullFilterChoices(): NullFilterChoice[];
  /** A Filter chip: filters to rows where result `column` IS NULL, as a poke on one of its NULLs would. */
  applyNullFilter(column: number, path: PressPath): void;
  /** Briefly pulses these result rows (e.g. the rows a fan-out repeats). */
  pulseRows(rows: readonly number[]): void;
  /** Whether any shown result row holds a NULL. */
  hasVisibleNull(): boolean;
  /** Dev (`F`): pokes the first shown NULL cell; false if there's none. */
  debugPokeFirstNull(): boolean;
  /** Dev (`A` / `X`): puts the join into a query's state through the real transitions. */
  debugApply(spec: QuerySpec): void;
  /** Whether a slab is still gliding home (a switch waits for it). */
  isGliding(): boolean;
  /** Whether `hand` is holding a source slab (its pokes and pinches on the side column are ignored). */
  handHoldsSlab(hand: 'left' | 'right'): boolean;
}

export const joinBridge: { join: JoinControls | null; challenge: ChallengeHooks | null } = {
  join: null,
  challenge: null,
};
