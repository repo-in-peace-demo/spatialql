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

/** Why a pointer press was refused (see `PinchFreeze.pinchStart`, `PinchMotion`), or '' when it may press. */
export type PressBlock = '' | 'stale' | 'flicker' | 'repeat' | 'no-opening' | 'start-open' | 'not-visible';

/**
 * A real pinch is a motion: the thumb and index tips open past this, then
 * close. A relaxed pointing hand rests its thumb near the index finger, and
 * the platform's pinch flickers on and off there (a headset log: restarts
 * every ~200 ms with the tips 0.9-1.3 cm apart, pressing Hint three times).
 * The tips' distance at the platform's pinch start can't tell them apart
 * (0.3-1.9 cm for both); the widest opening in the window before it can.
 * Three headset logs (2026-10-09 00:52-02:26): every press that looked
 * intentional opened 2.6-6.2 cm first; ignored, resting pinches mostly
 * 1.3-2.0 cm. 2.2 cm keeps a 0.4 cm margin under the real ones.
 */
export const PINCH_OPEN_METERS = 0.022;
/**
 * NULL cells (a reversible filter, undone by Clear) take pinches from a
 * smaller opening: on the headset (2026-10-09 03:57 log) deliberate re-pinches
 * on a NULL cell opened only 1.6-2.1 cm.
 */
export const PINCH_OPEN_NULL_METERS = 0.015;

/**
 * What a pinch presses, for its opening: a NULL cell, Prev or Next (a
 * "stepper": low stakes and reversible, so they share the NULL cells' 1.5 cm
 * opening -- 2026-10-10 log: rapid Prev re-pinches opened 1.7-1.8 cm), or
 * anything else (2.2 cm).
 */
export type PinchTargetKind = 'null' | 'stepper' | 'other';

/** The opening (meters) a pinch on `kind` needs. */
export function pinchOpenMetersFor(kind: PinchTargetKind): number {
  return kind === 'other' ? PINCH_OPEN_METERS : PINCH_OPEN_NULL_METERS;
}
/** The opening must come within this long before the platform's pinch starts. */
export const PINCH_OPENING_WINDOW_SECONDS = 0.4;
/** Tip-distance samples kept per hand (at 90 fps, ~0.7 s: more than the window). */
export const PINCH_MOTION_HISTORY = 64;

/**
 * One hand's pinch motion, from its thumb-index tip distance sampled every
 * frame: a platform pinch (select start) counts as a press only if the tips
 * were at least PINCH_OPEN_METERS apart within PINCH_OPENING_WINDOW_SECONDS
 * before it, and -- after a press -- only once they've opened past that
 * again (a re-arm: closed, then open). Pure state, no allocation.
 */
export class PinchMotion {
  /** The opening this tracker requires (PINCH_OPEN_METERS, or PINCH_OPEN_NULL_METERS). */
  constructor(private readonly openMeters = PINCH_OPEN_METERS) {}

  private readonly times = new Float64Array(PINCH_MOTION_HISTORY);
  private readonly gaps = new Float64Array(PINCH_MOTION_HISTORY);
  private count = 0;
  private head = 0;
  /** When the tips were last at least PINCH_OPEN_METERS apart (while armed). */
  private openAt = -Infinity;
  /** A press may come from the next opening (false after a press until the tips close, then open). */
  private armed = true;
  private closedSincePress = false;
  /** For the log: the last press, the first close since it, and the last opening (any), in clock seconds. */
  pressedAt = -Infinity;
  closedAfterPressAt = -Infinity;
  lastOpenAt = -Infinity;
  /** The latest tip distance sampled (meters), or null before any (for the poke log). */
  latest: number | null = null;

  reset(): void {
    this.latest = null;
    this.count = 0;
    this.head = 0;
    this.openAt = -Infinity;
    this.armed = true;
    this.closedSincePress = false;
    this.pressedAt = -Infinity;
    this.closedAfterPressAt = -Infinity;
    this.lastOpenAt = -Infinity;
  }

  /** The opening this tracker requires (meters). */
  get openThreshold(): number {
    return this.openMeters;
  }

  /** One frame's tip distance (null: the tips aren't tracked; nothing is recorded). */
  sample(tipDistanceMeters: number | null, now: number): void {
    if (tipDistanceMeters === null) {
      this.latest = null;
      return;
    }
    this.latest = tipDistanceMeters;
    this.times[this.head] = now;
    this.gaps[this.head] = tipDistanceMeters;
    this.head = (this.head + 1) % PINCH_MOTION_HISTORY;
    this.count = Math.min(this.count + 1, PINCH_MOTION_HISTORY);
    if (tipDistanceMeters < this.openMeters) {
      if (!this.closedSincePress) {
        this.closedAfterPressAt = now;
      }
      this.closedSincePress = true;
      return;
    }
    this.lastOpenAt = now;
    if (!this.armed && this.closedSincePress) {
      this.armed = true;
    }
    if (this.armed) {
      this.openAt = now;
    }
  }

  /** At a platform pinch start: whether it's a pinch motion (an opening, since the last press, just before it). */
  isPinchMotion(now: number): boolean {
    return this.armed && now - this.openAt <= PINCH_OPENING_WINDOW_SECONDS;
  }

  /** A press came from this pinch: the next needs the tips to close and open again. */
  pressed(now = -Infinity): void {
    this.armed = false;
    this.closedSincePress = false;
    this.openAt = -Infinity;
    this.pressedAt = now;
    this.closedAfterPressAt = -Infinity;
  }

  /** The widest tip distance (meters) sampled within the window before `now`, or -1 if none (for the log). */
  widest(now: number): number {
    let widest = -1;
    for (let i = 0; i < this.count; i++) {
      if (now - this.times[i] <= PINCH_OPENING_WINDOW_SECONDS) {
        widest = Math.max(widest, this.gaps[i]);
      }
    }
    return widest;
  }
}

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

// --- Pinch press constants: FROZEN (2026-10-09) ------------------------------------------
// Tuned over five headset sessions (2026-10-09 00:33-04:29) against logged
// real and phantom pinches. Change them only for a clear regression seen in a
// session log (scripts/headset_log.py summary / pinches); hand-pointer.test.ts
// pins the values. PINCH_OPEN_METERS and PINCH_OPEN_NULL_METERS above are part
// of the set. (2026-10-10, approved: Prev and Next take PINCH_OPEN_NULL_METERS
// too, via pinchOpenMetersFor; the constants themselves are unchanged.)

/**
 * A hand's pointer presses only once it has been shown for this long: a hand
 * resting in the lap or at the side (pointer off) never presses, nor one
 * just raised.
 */
export const POINTER_PRESS_MIN_VISIBLE_SECONDS = 0.2;
/**
 * A pinch whose pointer isn't on a pressable target at its start presses
 * the last one it was on within this long (the ray hops at small, far
 * targets: the headset log had it switching between a NULL cell, the result
 * and a slab every ~250 ms).
 */
export const PINCH_TARGET_LOCK_SECONDS = 0.25;
/** Recenter acts only when held this long (a stray pinch moved the whole group). */
export const RECENTER_HOLD_SECONDS = 0.6;
/**
 * The platform's pinch must start with the tips at most this far apart: a
 * headset log (2026-10-09 02:57) had Hint pressed by a pinch reported at
 * 3.4 cm as the pointer swept onto it; intended presses started at 0.3-1.9 cm,
 * and a few just-raised hands' real attempts at 2.1-2.2 cm (04:22 log), so 2.5.
 */
export const PINCH_START_MAX_METERS = 0.025;
/**
 * A clear pinch: after the platform's pinch starts, the tips close to at
 * most PINCH_CLOSED_METERS and stay there PINCH_CLOSED_HOLD_SECONDS, within
 * PINCH_CLOSE_WINDOW_SECONDS of the start -- or, a quick tap, the pinch ends
 * within the window having reached it. Only then does it press. The
 * 2026-10-09 03:57 log: every deliberate pinch reached 1.8 cm (narrowest
 * 0.2-1.8, median 1.0), a quarter lasted under 122 ms, and 1.2 cm for 60 ms
 * took 3-4 pinches on LEFT and on NULL cells.
 */
export const PINCH_CLOSED_METERS = 0.018;
export const PINCH_CLOSED_HOLD_SECONDS = 0.04;
/** 0.5 s, not 0.3: a slow real pinch (04:25:00 log) closed after 0.3 s. */
export const PINCH_CLOSE_WINDOW_SECONDS = 0.5;

/**
 * Whether a hand's platform pinch may start a press (before it closes):
 * '' if so; else why not. `motion`: PinchMotion's verdict; `startGap`: the
 * tips' distance at the start (null: untracked); `visibleFor`: seconds the
 * hand's pointer has been shown.
 */
export function pinchStartVerdict(motion: boolean, startGap: number | null, visibleFor: number): PressBlock {
  if (visibleFor < POINTER_PRESS_MIN_VISIBLE_SECONDS) {
    return 'not-visible';
  }
  if (!motion) {
    return 'no-opening';
  }
  if (startGap === null || startGap > PINCH_START_MAX_METERS) {
    return 'start-open';
  }
  return '';
}

/** A pending pinch press, frame by frame: still closing, press now, or dropped (it didn't close, or ended first). */
export type PinchConfirmStep = 'pending' | 'press' | 'no-close' | 'released';

/**
 * One hand's pinch from its platform start: whether it becomes a clear
 * pinch (see PINCH_CLOSED_METERS), and -- for the log, on any pinch -- its
 * narrowest tip distance and how long the tips stayed closed. Pure state.
 */
export class PinchConfirm {
  /** A press is waiting for the pinch to close. */
  pending = false;
  /** The current (or last) pinch: when it started, its narrowest tip distance, and seconds closed. */
  startAt = -Infinity;
  minGap = Infinity;
  closedFor = 0;
  private closedSince = -Infinity;

  /** The platform's pinch started; `press`: it may press once it closes. */
  start(now: number, gap: number | null, press: boolean): void {
    this.pending = press;
    this.startAt = now;
    this.minGap = gap ?? Infinity;
    this.closedFor = 0;
    this.closedSince = gap !== null && gap <= PINCH_CLOSED_METERS ? now : -Infinity;
  }

  /** One frame while the pinch is held (`selecting`), with the tips' distance (null: untracked). */
  step(now: number, gap: number | null, selecting: boolean): PinchConfirmStep {
    if (gap !== null) {
      this.minGap = Math.min(this.minGap, gap);
    }
    const closed = gap !== null && gap <= PINCH_CLOSED_METERS;
    if (closed && this.closedSince === -Infinity) {
      this.closedSince = now;
    } else if (!closed && this.closedSince !== -Infinity) {
      this.closedFor += now - this.closedSince;
      this.closedSince = -Infinity;
    }
    if (!this.pending) {
      return 'pending';
    }
    if (!selecting) {
      this.pending = false;
      // A quick tap: it ended within the window, having closed.
      return this.minGap <= PINCH_CLOSED_METERS && now - this.startAt <= PINCH_CLOSE_WINDOW_SECONDS + 1e-9 ? 'press' : 'released';
    }
    if (closed && now - this.closedSince >= PINCH_CLOSED_HOLD_SECONDS - 1e-9) {
      this.pending = false;
      return 'press';
    }
    if (now - this.startAt > PINCH_CLOSE_WINDOW_SECONDS) {
      this.pending = false;
      return 'no-close';
    }
    return 'pending';
  }

  /**
   * One frame of the platform's pinch, as the join system runs it: while held
   * (`selecting`), and on the frame it ends (`selectEnd`), where a quick tap
   * presses. 'press' at most once per pinch. (A headset log showed taps
   * ignored when only the held path was acted on.)
   */
  frame(now: number, gap: number | null, selecting: boolean, selectEnd: boolean): PinchConfirmStep {
    if (selectEnd) {
      return this.step(now, gap, false);
    }
    return selecting ? this.step(now, gap, true) : 'pending';
  }

  /** Seconds the tips have been closed in this pinch (for the log at its end). */
  closedSeconds(now: number): number {
    return this.closedFor + (this.closedSince === -Infinity ? 0 : now - this.closedSince);
  }
}

/**
 * One hand's select (pinch or trigger) as a button hold (Exit, Show
 * answer): it holds the button only if it started on it (`startOk`: a
 * controller's trigger, or a hand's pinch motion) and has stayed on it,
 * selecting, every frame since. Any end of the select -- a one-frame flicker
 * too -- or leaving the button ends it for good: a select already held when
 * the pointer arrives never holds it. Pure state.
 */
export class HoldSelect {
  /** This hand's current select started on the button and is still on it. */
  startedOn = false;

  reset(): void {
    this.startedOn = false;
  }

  /**
   * One frame. `onTarget`: the select is on the button now (the caller may
   * skip measuring it, passing false, when neither `selectStart` nor
   * `startedOn`). Returns whether this select holds the button this frame.
   */
  step(selecting: boolean, selectStart: boolean, startOk: boolean, onTarget: boolean): boolean {
    if (!selecting) {
      this.startedOn = false;
    } else if (selectStart) {
      this.startedOn = startOk && onTarget;
    } else if (this.startedOn) {
      this.startedOn = onTarget;
    }
    return this.startedOn;
  }

  /** Whether the caller needs `onTarget` this frame. */
  needsOnTarget(selecting: boolean, selectStart: boolean): boolean {
    return selecting && (selectStart || this.startedOn);
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
