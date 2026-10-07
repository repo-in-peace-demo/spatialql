/**
 * The hand pointer's rules, kept pure (no IWSDK imports) so they're tested
 * in Node. The join system runs the pointer (`hand-pointer` in
 * join-system.ts): the hand's WebXR target ray, smoothed, frozen just
 * before a pinch closes, drawn as a thin ray with a cursor dot.
 */

/** How far the pointer reaches (meters): anything in the group, from a relaxed seated posture. */
export const HAND_POINTER_MAX_METERS = 2.0;
/** The pointer is on while the wrist is at least this far in front of the head (horizontally)... */
export const HAND_POINTER_MIN_FORWARD_METERS = 0.15;
/** ...and at most this far below the eyes (a hand resting in the lap isn't pointing). */
export const HAND_POINTER_MAX_BELOW_EYES_METERS = 0.6;
/** Smoothing of the ray's origin and direction (exponential, this time constant, seconds). */
export const HAND_POINTER_SMOOTH_SECONDS = 0.06;
/** As the fingers start closing for a pinch, the ray freezes at its pose from this long before. */
export const HAND_POINTER_FREEZE_LOOKBACK_SECONDS = 0.1;
/** Thumb and index tips closer than this: a pinch is closing (the ray freezes)... */
export const HAND_POINTER_CLOSING_METERS = 0.045;
/** ...and it unfreezes once they're this far apart again. */
export const HAND_POINTER_OPEN_METERS = 0.06;
/**
 * A fixed upward tilt of the ray (degrees), a tuning knob: 0 keeps the
 * platform's ray. Set it only if headset logs show a consistent offset
 * between the ray and the targets' centers (see the pinch log's "aim").
 */
export const HAND_POINTER_PITCH_OFFSET_DEG = 0;
/** Near wins: a fingertip this close in front of a band button turns the pointer off (poke applies). */
export const HAND_POINTER_NEAR_BUTTON_METERS = 0.05;
/** How many past poses the freeze can look back through (at 72-90 fps, 0.1 s is 8-9 frames). */
export const HAND_POINTER_HISTORY = 16;

/** Whether a hand is raised in front of the body: the pointer shows. */
export function pointerRaised(wristForwardMeters: number, wristBelowEyesMeters: number): boolean {
  return wristForwardMeters >= HAND_POINTER_MIN_FORWARD_METERS && wristBelowEyesMeters <= HAND_POINTER_MAX_BELOW_EYES_METERS;
}

/** The share of the way to move toward the new pose this frame (exponential smoothing). */
export function smoothingAlpha(deltaSeconds: number): number {
  return deltaSeconds <= 0 ? 0 : 1 - Math.exp(-deltaSeconds / HAND_POINTER_SMOOTH_SECONDS);
}

/**
 * Whether the ray is frozen this frame, from the thumb-index tip distance
 * and whether it was frozen last frame (hysteresis between closing and open).
 */
export function pointerFrozen(tipDistanceMeters: number, wasFrozen: boolean): boolean {
  return wasFrozen ? tipDistanceMeters < HAND_POINTER_OPEN_METERS : tipDistanceMeters < HAND_POINTER_CLOSING_METERS;
}

/**
 * A ring of past ray poses (origin and direction, with their time), allocated
 * once; `at` finds the newest pose at least `ageSeconds` old.
 */
export class PoseHistory {
  private readonly data = new Float64Array(HAND_POINTER_HISTORY * 7);
  private count = 0;
  private next = 0;

  clear(): void {
    this.count = 0;
    this.next = 0;
  }

  push(time: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): void {
    const i = this.next * 7;
    this.data[i] = time;
    this.data[i + 1] = ox;
    this.data[i + 2] = oy;
    this.data[i + 3] = oz;
    this.data[i + 4] = dx;
    this.data[i + 5] = dy;
    this.data[i + 6] = dz;
    this.next = (this.next + 1) % HAND_POINTER_HISTORY;
    this.count = Math.min(this.count + 1, HAND_POINTER_HISTORY);
  }

  /**
   * Writes the newest pose at least `ageSeconds` older than `now` into
   * `out` ([ox, oy, oz, dx, dy, dz]); the oldest kept if none is that old.
   * False when empty.
   */
  at(now: number, ageSeconds: number, out: Float64Array): boolean {
    if (this.count === 0) {
      return false;
    }
    let chosen = -1;
    let oldest = -1;
    for (let k = 1; k <= this.count; k++) {
      const slot = (this.next - k + HAND_POINTER_HISTORY) % HAND_POINTER_HISTORY;
      oldest = slot;
      if (now - this.data[slot * 7] >= ageSeconds) {
        chosen = slot;
        break;
      }
    }
    const i = (chosen >= 0 ? chosen : oldest) * 7;
    for (let j = 0; j < 6; j++) {
      out[j] = this.data[i + 1 + j];
    }
    return true;
  }
}

/** Degrees between two directions (normalized or not). */
export function angleBetweenDeg(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const la = Math.hypot(ax, ay, az);
  const lb = Math.hypot(bx, by, bz);
  if (la === 0 || lb === 0) {
    return NaN;
  }
  const cos = Math.min(1, Math.max(-1, (ax * bx + ay * by + az * bz) / (la * lb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** A direction's elevation (degrees above horizontal). */
export function pitchDeg(x: number, y: number, z: number): number {
  return (Math.atan2(y, Math.hypot(x, z)) * 180) / Math.PI;
}
