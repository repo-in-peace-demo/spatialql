/**
 * The Recenter button's countdown, kept pure (no IWSDK imports) so it's
 * tested in Node. Recenter puts the group in front of where the head faces;
 * but to press the button (in the control column, left of the result) the
 * player looks at it, so recentering at the press moved the group toward the
 * button every time -- a headset log drifted it 0° -> -93° in nine presses.
 * So a press starts a countdown ("Look straight ahead"), and the recenter
 * uses the head's yaw at its end: the median over the last
 * RECENTER_YAW_WINDOW_SECONDS, smoothing small movements. If the head is
 * still turned more than RECENTER_TURNED_MAX_DEG toward the button then, the
 * countdown runs once more; after that it proceeds.
 *
 * Yaws are radians, + to the left (three.js's rotation about +Y).
 */

export const RECENTER_COUNTDOWN_SECONDS = 1.5;
export const RECENTER_YAW_WINDOW_SECONDS = 0.3;
export const RECENTER_TURNED_MAX_DEG = 25;
/** Head-yaw samples kept (at 90 fps, ~0.7 s: more than the window). */
const SAMPLES = 64;

/** One frame of the countdown: still counting, counting again (the head was still turned), or done (`yaw()`). */
export type CountdownStep = 'counting' | 'extended' | 'done';

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
  private extended = false;
  private readonly times = new Float64Array(SAMPLES);
  private readonly yaws = new Float64Array(SAMPLES);
  private readonly window = new Float64Array(SAMPLES);
  private count = 0;
  private head = 0;
  private clock = 0;

  /** A press: the head's yaw now, the group's yaw, and the Recenter button's direction from the eyes. */
  start(headYaw: number, groupYaw: number, buttonYaw: number): void {
    this.active = true;
    this.elapsed = 0;
    this.extended = false;
    this.pressYaw = headYaw;
    this.groupYaw = groupYaw;
    this.buttonYaw = buttonYaw;
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
    if (this.elapsed < RECENTER_COUNTDOWN_SECONDS) {
      return 'counting';
    }
    if (!this.extended && this.turnedTowardButton(this.yaw())) {
      this.extended = true;
      this.elapsed = 0;
      return 'extended';
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
