/**
 * When to bring the slab group back in front of the player, as a pure state
 * machine (no IWSDK imports, so it's tested in Node). Desk placement feeds
 * it the XR session's visibility changes, the reference space's `reset`
 * event and the Recenter button, and asks each frame whether to run.
 *
 * - **Headset back on:** the session goes `hidden` and then `visible` again
 *   after at least RECENTER_AFTER_HIDDEN_SECONDS. `visible-blurred` (a
 *   system menu) never starts or ends a hidden spell.
 * - **Recenter:** the reference space's `reset` (the Meta button's recenter).
 * - **Button:** always runs (once the desk allows it).
 * - Triggers within RECENTER_MERGE_SECONDS of each other (waking the
 *   headset often fires both) run once.
 * - While `blocked` (a slab is held, the desk is switching tables, a slab is
 *   docking or gliding), a requested re-placement waits, then runs once.
 */

/** A hidden spell at least this long counts as the headset coming back on (short blips don't). */
export const RECENTER_AFTER_HIDDEN_SECONDS = 5;
/** Triggers this close together run one re-placement. */
export const RECENTER_MERGE_SECONDS = 1;

export type RecenterReason = 'headset-on' | 'reset' | 'button';
export type SessionVisibility = 'visible' | 'visible-blurred' | 'hidden';

export class RecenterTrigger {
  /** When the current hidden spell began (ms), or null while not hidden. */
  private hiddenSinceMs: number | null = null;
  /** A re-placement waiting to run, and why (the first reason wins). */
  private pending: RecenterReason | null = null;
  private lastRequestMs = -Infinity;
  /** The last hidden spell's length (ms), for the log. */
  lastHiddenMs = 0;

  /** The session's visibility changed. Returns true if it queued a re-placement. */
  onVisibility(state: SessionVisibility, nowMs: number): boolean {
    if (state === 'hidden') {
      this.hiddenSinceMs ??= nowMs;
      return false;
    }
    if (state !== 'visible' || this.hiddenSinceMs === null) {
      return false;
    }
    this.lastHiddenMs = nowMs - this.hiddenSinceMs;
    this.hiddenSinceMs = null;
    return this.lastHiddenMs >= RECENTER_AFTER_HIDDEN_SECONDS * 1000 && this.request('headset-on', nowMs);
  }

  /** The reference space was reset (recentered). */
  onReset(nowMs: number): boolean {
    return this.request('reset', nowMs);
  }

  /**
   * Queues a re-placement. Automatic triggers within RECENTER_MERGE_SECONDS
   * of the last request merge into it; the button always queues.
   */
  request(reason: RecenterReason, nowMs: number): boolean {
    const merged = reason !== 'button' && nowMs - this.lastRequestMs < RECENTER_MERGE_SECONDS * 1000;
    this.lastRequestMs = nowMs;
    if (merged || this.pending !== null) {
      return false;
    }
    this.pending = reason;
    return true;
  }

  /** Whether a re-placement is waiting. */
  get waiting(): boolean {
    return this.pending !== null;
  }

  /** Each frame: the reason to re-place now, or null (nothing waiting, or `blocked`). */
  poll(blocked: boolean): RecenterReason | null {
    if (this.pending === null || blocked) {
      return null;
    }
    const reason = this.pending;
    this.pending = null;
    return reason;
  }

  /** A session ended: forget any hidden spell and anything waiting. */
  reset(): void {
    this.hiddenSinceMs = null;
    this.pending = null;
    this.lastRequestMs = -Infinity;
  }
}
