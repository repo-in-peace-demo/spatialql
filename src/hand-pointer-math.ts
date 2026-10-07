/**
 * The hand pointer's rules, kept pure (no IWSDK imports) so they're tested
 * in Node. The join system runs the pointer (`hand-pointer` in
 * join-system.ts): the hand's WebXR target ray, smoothed, frozen just
 * before a pinch closes, drawn as a thin ray with a cursor dot.
 */

/** How far the pointer reaches (meters): anything in the group, from a relaxed seated posture. */
export const HAND_POINTER_MAX_METERS = 2.0;
/** The pointer comes on once the wrist is at least this far in front of the head (horizontally)... */
export const HAND_POINTER_MIN_FORWARD_METERS = 0.15;
/**
 * ...and, once on, stays on until it's nearer than this (hysteresis: a
 * seated wrist hovering at the threshold flickered on and off every 150 ms).
 */
export const HAND_POINTER_OFF_FORWARD_METERS = 0.12;
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
 * The freeze lasts at most this long: a relaxed hand can rest with its tips
 * under HAND_POINTER_OPEN_METERS for seconds (a headset log had the ray
 * stuck for 2.1 s), so after this it follows the hand again, and it re-arms
 * only once the fingers open.
 */
export const HAND_POINTER_FREEZE_MAX_SECONDS = 0.35;
/**
 * A pinch that starts again less than this long after the platform's pinch
 * ended continues the same pinch (the platform's pinch can flicker): if that
 * pinch pressed, it doesn't press again. Real re-pinches open for longer: a
 * headset log's repeated pinches came as little as 199 ms apart, start to
 * start; the double Prev's second pinch came 83 ms after the first.
 */
export const HAND_POINTER_FLICKER_OPEN_SECONDS = 0.1;
/** At least this long between a hand's pointer presses, whatever the pinch did. */
export const HAND_POINTER_PRESS_GAP_SECONDS = 0.15;
/** A ray pose that hasn't changed at all for this long is stale (live tracking always jitters): hidden. */
export const HAND_POINTER_STALE_SECONDS = 0.15;
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

/**
 * Whether a hand is raised in front of the body: the pointer shows. `wasOn`
 * (the pointer showed last frame) lowers the forward threshold to
 * HAND_POINTER_OFF_FORWARD_METERS.
 */
export function pointerRaised(wristForwardMeters: number, wristBelowEyesMeters: number, wasOn = false): boolean {
  const minForward = wasOn ? HAND_POINTER_OFF_FORWARD_METERS : HAND_POINTER_MIN_FORWARD_METERS;
  return wristForwardMeters >= minForward && wristBelowEyesMeters <= HAND_POINTER_MAX_BELOW_EYES_METERS;
}

/** The share of the way to move toward the new pose this frame (exponential smoothing). */
export function smoothingAlpha(deltaSeconds: number): number {
  return deltaSeconds <= 0 ? 0 : 1 - Math.exp(-deltaSeconds / HAND_POINTER_SMOOTH_SECONDS);
}

/** What a frame of `PinchFreeze.step` did: nothing new, the freeze started, or it ran out. */
export type FreezeEvent = 'none' | 'started' | 'expired';

/** Why a pointer press was refused (see `PinchFreeze.pinchStart`), or '' when it may press. */
export type PressBlock = '' | 'stale' | 'flicker' | 'repeat';

/**
 * One hand's pinch, as the pointer sees it: the pre-pinch freeze (closing
 * fingers freeze the ray, at most HAND_POINTER_FREEZE_MAX_SECONDS; re-armed
 * when the platform's pinch ends, or the fingers open wide) and the press
 * gate (every platform pinch may press once, except from a stale pose or a
 * flicker of a pinch that already pressed). Pure state, no allocation.
 *
 * Every pinch is the platform's own pinch (select start): its detection is
 * the source of truth for "a new pinch". Our tip distances only time the
 * freeze. (Requiring the tips to open past HAND_POINTER_OPEN_METERS before
 * the next press blocked 99 real pinches in a headset log: relaxed fingers
 * between pinches rarely open that far.)
 */
export class PinchFreeze {
  /** The ray is frozen this frame. */
  frozen = false;
  /** When the current freeze started (seconds). */
  frozenSince = -Infinity;
  /** A new freeze may start (since the last pinch ended, or the fingers opened). */
  private armed = true;
  /** When the platform's pinch last ended. */
  private releasedAt = -Infinity;
  /** The current pinch (flickers included) pressed. */
  private pinchPressed = false;
  private lastPressAt = -Infinity;

  reset(): void {
    this.frozen = false;
    this.frozenSince = -Infinity;
    this.armed = true;
    this.pinchPressed = false;
  }

  /**
   * Advances one frame from the thumb-index tip distance (null when the tips
   * aren't tracked: the ray isn't frozen).
   */
  step(tipDistanceMeters: number | null, now: number): FreezeEvent {
    if (tipDistanceMeters === null) {
      this.frozen = false;
      return 'none';
    }
    if (tipDistanceMeters >= HAND_POINTER_OPEN_METERS) {
      this.frozen = false;
      this.armed = true;
      return 'none';
    }
    if (this.frozen) {
      if (now - this.frozenSince > HAND_POINTER_FREEZE_MAX_SECONDS) {
        // Follows the hand again; the next pinch can still press.
        this.frozen = false;
        return 'expired';
      }
      return 'none';
    }
    if (this.armed && tipDistanceMeters < HAND_POINTER_CLOSING_METERS) {
      this.frozen = true;
      this.frozenSince = now;
      this.armed = false;
      return 'started';
    }
    return 'none';
  }

  /** The platform's pinch ended (select end): unfrozen, re-armed, and timed for the flicker rule. */
  released(now: number): void {
    this.releasedAt = now;
    this.frozen = false;
    this.armed = true;
  }

  /**
   * A platform pinch started (select start): whether it may press through
   * the pointer. Never from a stale pose (`fresh` false); not a flicker of a
   * pinch that already pressed (it started again within
   * HAND_POINTER_FLICKER_OPEN_SECONDS of ending: a headset log had one pinch
   * press Prev twice); not within HAND_POINTER_PRESS_GAP_SECONDS of the last
   * press. Call once per pinch start.
   */
  pinchStart(fresh: boolean, now: number): PressBlock {
    const flicker = now - this.releasedAt < HAND_POINTER_FLICKER_OPEN_SECONDS;
    if (!flicker) {
      this.pinchPressed = false;
    }
    if (!fresh) {
      return 'stale';
    }
    if (flicker && this.pinchPressed) {
      return 'flicker';
    }
    if (now - this.lastPressAt < HAND_POINTER_PRESS_GAP_SECONDS) {
      return 'repeat';
    }
    return '';
  }

  /** Records a press (after `pinchStart` allowed it). */
  pressed(now: number): void {
    this.pinchPressed = true;
    this.lastPressAt = now;
  }

  /** Seconds since the last press (for the blocked-press log). */
  sinceLastPress(now: number): number {
    return now - this.lastPressAt;
  }

  /** Seconds the fingers were apart before this pinch (since the platform's pinch last ended). */
  openFor(now: number): number {
    return now - this.releasedAt;
  }
}

/**
 * Detects a stale ray: one whose pose hasn't changed at all for
 * HAND_POINTER_STALE_SECONDS (the platform may hold the last pose when it
 * loses the hand; live tracking always jitters).
 */
export class StaleRay {
  private readonly last = new Float64Array(6);
  private has = false;
  private sameSince = 0;

  reset(): void {
    this.has = false;
  }

  /** Records this frame's pose; true if it's stale. */
  step(now: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): boolean {
    const l = this.last;
    const same = this.has && l[0] === ox && l[1] === oy && l[2] === oz && l[3] === dx && l[4] === dy && l[5] === dz;
    if (!same) {
      l[0] = ox;
      l[1] = oy;
      l[2] = oz;
      l[3] = dx;
      l[4] = dy;
      l[5] = dz;
      this.has = true;
      this.sameSince = now;
      return false;
    }
    return now - this.sameSince >= HAND_POINTER_STALE_SECONDS;
  }

  /** How long the pose has been unchanged (seconds). */
  unchangedFor(now: number): number {
    return this.has ? now - this.sameSince : 0;
  }
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
