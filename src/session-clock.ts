/**
 * How long the player has been in the app this XR session, and on the
 * current puzzle: pure (no IWSDK imports), so it's tested in Node.
 *
 * - Starts from 0 when a session starts (Start enters XR); a new session
 *   starts again from 0.
 * - Pauses while the headset is off (the session `hidden`); time hidden
 *   counts for neither the session nor the puzzle. A system menu
 *   (`visible-blurred`) keeps it running.
 * - Puzzle switches, joins and Recenter don't touch the session clock; a
 *   puzzle's own time starts when it loads (`puzzleStarted`).
 *
 * Times are the caller's clock, in seconds.
 */
export class SessionClock {
  /** Active seconds banked before the current running stretch. */
  private banked = 0;
  /** When the current running stretch began, or null while paused or stopped. */
  private runningSince: number | null = null;
  private started = false;
  /** The session's active seconds when the current puzzle loaded. */
  private puzzleStart = 0;

  /** A new session: from 0, running. */
  start(now: number): void {
    this.banked = 0;
    this.runningSince = now;
    this.started = true;
    this.puzzleStart = 0;
  }

  /** The session ended (back to the browser page): stopped where it was. */
  stop(now: number): void {
    this.pause(now);
    this.started = false;
  }

  /** The headset went off (`hidden`) or came back on. */
  setHidden(hidden: boolean, now: number): void {
    if (!this.started) {
      return;
    }
    if (hidden) {
      this.pause(now);
    } else if (this.runningSince === null) {
      this.runningSince = now;
    }
  }

  /** The session's active seconds (0 before the first session). */
  elapsed(now: number): number {
    return this.banked + (this.runningSince === null ? 0 : Math.max(0, now - this.runningSince));
  }

  /** A puzzle loaded: its own time starts now. */
  puzzleStarted(now: number): void {
    this.puzzleStart = this.elapsed(now);
  }

  /** The current puzzle's active seconds (from its load, without time hidden). */
  puzzleElapsed(now: number): number {
    return Math.max(0, this.elapsed(now) - this.puzzleStart);
  }

  get running(): boolean {
    return this.runningSince !== null;
  }

  private pause(now: number): void {
    if (this.runningSince !== null) {
      this.banked += Math.max(0, now - this.runningSince);
      this.runningSince = null;
    }
  }
}

/** `m:ss` under an hour (`12:07`), `h:mm:ss` after (`1:02:07`); whole seconds, rounded down. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = s < 10 ? `0${s}` : String(s);
  if (h === 0) {
    return `${m}:${ss}`;
  }
  return `${h}:${m < 10 ? `0${m}` : m}:${ss}`;
}
