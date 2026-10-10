/**
 * The Recenter button's countdown, kept pure (no IWSDK imports) so it's
 * tested in Node. Recenter puts the group in front of where the head faces;
 * but to press the button (in the control column, left of the result) the
 * player looks at it, so recentering at the press moved the group toward the
 * button every time -- a headset log drifted it 0° -> -93° in nine presses.
 * So a press starts a countdown ("Look straight ahead"), and the recenter
 * uses the head's yaw at its end: the median over the last
 * RECENTER_YAW_WINDOW_SECONDS, smoothing small movements. Looking back
 * toward the button (more than RECENTER_TURNED_MAX_DEG, after the first
 * RECENTER_LOOK_AWAY_SECONDS to look away) cancels it, as does pressing
 * Recenter again (the caller's `cancel`) -- unless the player was already
 * facing the button's way before reaching for it (within
 * RECENTER_SETTLED_MAX_DEG, `settledYaw`): then that is where they want the
 * tables, not a glance at the button (headset log 2026-10-11 04:33: facing
 * -33° with the button at -36°, four presses all cancelled). At most one
 * step can come of it: once recentered, the button is off to the side again.
 *
 * Yaws are radians, + to the left (three.js's rotation about +Y).
 */

export const RECENTER_COUNTDOWN_SECONDS = 1.5;
export const RECENTER_YAW_WINDOW_SECONDS = 0.3;
export const RECENTER_TURNED_MAX_DEG = 25;
/** Time to look away from the button after pressing it, before looking back at it cancels. */
export const RECENTER_LOOK_AWAY_SECONDS = 0.5;
/**
 * The head's yaw before the press (the caller's median over a window before
 * the hold started) this close to the button's direction: the player was
 * already facing that way, so facing it now doesn't cancel.
 */
export const RECENTER_SETTLED_MAX_DEG = 15;
/** Head-yaw samples kept (at 90 fps, ~0.7 s: more than the window). */
const SAMPLES = 64;

/** One frame of the countdown: still counting, cancelled (the head turned back toward the button), or done (`yaw()`). */
export type CountdownStep = 'counting' | 'cancelled' | 'done';

/** The signed difference a - b, wrapped to (-pi, pi]. */
export function yawDelta(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) {
    d -= 2 * Math.PI;
  } else if (d <= -Math.PI) {
    d += 2 * Math.PI;
  }
  return d;
}

export class RecenterCountdown {
  /** A countdown is running. */
  active = false;
  /** Seconds into the current countdown. */
  elapsed = 0;
  /** The yaw at the press, the group's yaw then, and the button's direction (for the log and the turned check). */
  pressYaw = 0;
  groupYaw = 0;
  buttonYaw = 0;
  /** The player was facing the button's way before the press (see RECENTER_SETTLED_MAX_DEG): looking there never cancels. */
  facingButtonAlready = false;
  private readonly times = new Float64Array(SAMPLES);
  private readonly yaws = new Float64Array(SAMPLES);
  private readonly window = new Float64Array(SAMPLES);
  private count = 0;
  private head = 0;
  private clock = 0;

  /**
   * A press: the head's yaw now, the group's yaw, the Recenter button's
   * direction from the eyes, and (if known) the head's settled yaw from
   * before the player reached for the button.
   */
  start(headYaw: number, groupYaw: number, buttonYaw: number, settledYaw: number | null = null): void {
    this.active = true;
    this.elapsed = 0;
    this.pressYaw = headYaw;
    this.groupYaw = groupYaw;
    this.buttonYaw = buttonYaw;
    this.facingButtonAlready =
      settledYaw !== null && (Math.abs(yawDelta(settledYaw, buttonYaw)) * 180) / Math.PI <= RECENTER_SETTLED_MAX_DEG;
    this.count = 0;
    this.head = 0;
    this.clock = 0;
  }

  cancel(): void {
    this.active = false;
  }

  /** The countdown's progress (0-1), for the ring. */
  progress(): number {
    return Math.min(1, this.elapsed / RECENTER_COUNTDOWN_SECONDS);
  }

  /** One frame: `delta` seconds passed, the head's yaw now. */
  step(delta: number, headYaw: number): CountdownStep {
    this.clock += delta;
    this.elapsed += delta;
    this.times[this.head] = this.clock;
    this.yaws[this.head] = headYaw;
    this.head = (this.head + 1) % SAMPLES;
    this.count = Math.min(this.count + 1, SAMPLES);
    if (!this.facingButtonAlready && this.elapsed >= RECENTER_LOOK_AWAY_SECONDS && this.turnedTowardButton(this.yaw())) {
      this.active = false;
      return 'cancelled';
    }
    if (this.elapsed < RECENTER_COUNTDOWN_SECONDS) {
      return 'counting';
    }
    this.active = false;
    return 'done';
  }

  /** Whether `yaw` is turned more than RECENTER_TURNED_MAX_DEG from the group's forward, toward the button. */
  turnedTowardButton(yaw: number): boolean {
    const side = Math.sign(yawDelta(this.buttonYaw, this.groupYaw)) || 1;
    return (yawDelta(yaw, this.groupYaw) * side * 180) / Math.PI > RECENTER_TURNED_MAX_DEG;
  }

  /** The median head yaw over the last RECENTER_YAW_WINDOW_SECONDS (unwrapped around the latest sample). */
  yaw(): number {
    if (this.count === 0) {
      return this.pressYaw;
    }
    const latest = this.yaws[(this.head - 1 + SAMPLES) % SAMPLES];
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.clock - this.times[i] <= RECENTER_YAW_WINDOW_SECONDS + 1e-9) {
        this.window[n++] = latest + yawDelta(this.yaws[i], latest);
      }
    }
    const sorted = this.window.subarray(0, n).sort();
    return n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  }
}

/** The window before a press (seconds before it) the head's settled yaw is taken from: before the hold and the reach. */
export const RECENTER_SETTLED_FROM_SECONDS = 3;
export const RECENTER_SETTLED_TO_SECONDS = 1.2;
/** Head-yaw samples kept for it (at 90 fps, ~3.6 s). */
const HISTORY_SAMPLES = 324;

/**
 * The head's yaw over the last few seconds (one sample a frame), for the
 * settled yaw before a Recenter press. Allocation-free.
 */
export class HeadYawHistory {
  private readonly times = new Float64Array(HISTORY_SAMPLES);
  private readonly yaws = new Float64Array(HISTORY_SAMPLES);
  private readonly window = new Float64Array(HISTORY_SAMPLES);
  private count = 0;
  private head = 0;

  record(time: number, yaw: number): void {
    this.times[this.head] = time;
    this.yaws[this.head] = yaw;
    this.head = (this.head + 1) % HISTORY_SAMPLES;
    this.count = Math.min(this.count + 1, HISTORY_SAMPLES);
  }

  clear(): void {
    this.count = 0;
    this.head = 0;
  }

  /**
   * The median yaw from RECENTER_SETTLED_FROM_SECONDS to
   * RECENTER_SETTLED_TO_SECONDS before `time` (unwrapped around the newest
   * sample in it), or null with too few samples there (under half the window
   * at 30 fps: e.g. right after a session starts).
   */
  settledYaw(time: number): number | null {
    let n = 0;
    let reference = NaN;
    for (let i = 0; i < this.count; i++) {
      const age = time - this.times[i];
      if (age >= RECENTER_SETTLED_TO_SECONDS && age <= RECENTER_SETTLED_FROM_SECONDS) {
        if (Number.isNaN(reference)) {
          reference = this.yaws[i];
        }
        this.window[n++] = reference + yawDelta(this.yaws[i], reference);
      }
    }
    if (n < ((RECENTER_SETTLED_FROM_SECONDS - RECENTER_SETTLED_TO_SECONDS) * 30) / 2) {
      return null;
    }
    const sorted = this.window.subarray(0, n).sort();
    return n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  }
}
