import { describe, expect, it } from 'vitest';
import {
  angleBetweenDeg,
  HoldSelect,
  HAND_POINTER_CLOSING_METERS,
  HAND_POINTER_FLICKER_OPEN_SECONDS,
  HAND_POINTER_FREEZE_LOOKBACK_SECONDS,
  HAND_POINTER_FREEZE_MAX_SECONDS,
  HAND_POINTER_MAX_BELOW_EYES_METERS,
  HAND_POINTER_MAX_METERS,
  HAND_POINTER_MIN_FORWARD_METERS,
  HAND_POINTER_OFF_FORWARD_METERS,
  HAND_POINTER_OPEN_METERS,
  HAND_POINTER_PITCH_OFFSET_DEG,
  HAND_POINTER_PRESS_GAP_SECONDS,
  HAND_POINTER_SMOOTH_SECONDS,
  HAND_POINTER_STALE_SECONDS,
  pitchDeg,
  PinchFreeze,
  PINCH_CLOSE_WINDOW_SECONDS,
  PINCH_CLOSED_HOLD_SECONDS,
  PINCH_CLOSED_METERS,
  PINCH_START_MAX_METERS,
  PinchConfirm,
  pinchStartVerdict,
  POINTER_PRESS_MIN_VISIBLE_SECONDS,
  PinchMotion,
  PINCH_OPEN_METERS,
  PINCH_OPEN_NULL_METERS,
  PINCH_OPENING_WINDOW_SECONDS,
  PINCH_TARGET_LOCK_SECONDS,
  RECENTER_HOLD_SECONDS,
  pointerRaised,
  PoseHistory,
  smoothingAlpha,
  StaleRay,
} from '../hand-pointer-math.js';

describe('the hand pointer', () => {
  it('reaches the whole group (at least 2 m), and keeps the platform ray by default', () => {
    expect(HAND_POINTER_MAX_METERS).toBeGreaterThanOrEqual(2);
    expect(HAND_POINTER_PITCH_OFFSET_DEG).toBe(0);
  });

  it('is on for a hand raised in front (seated, leaning back), off for a hand in the lap or at the body', () => {
    // Leaning back, hand at chest height in front of you.
    expect(pointerRaised(0.3, 0.35)).toBe(true);
    // Hand resting in the lap.
    expect(pointerRaised(0.3, HAND_POINTER_MAX_BELOW_EYES_METERS + 0.1)).toBe(false);
    // Hand against the body.
    expect(pointerRaised(HAND_POINTER_MIN_FORWARD_METERS - 0.05, 0.3)).toBe(false);
  });

  it('smooths: about 63% of the way in one time constant, nothing for no time', () => {
    expect(smoothingAlpha(0)).toBe(0);
    expect(smoothingAlpha(HAND_POINTER_SMOOTH_SECONDS)).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(smoothingAlpha(1)).toBeGreaterThan(0.99);
  });

  it('stays on for a wrist that drifts a little nearer (on at 0.15 m ahead, off below 0.12 m)', () => {
    expect(HAND_POINTER_MIN_FORWARD_METERS).toBe(0.15);
    expect(HAND_POINTER_OFF_FORWARD_METERS).toBe(0.12);
    expect(pointerRaised(0.13, 0.2, false)).toBe(false);
    expect(pointerRaised(0.13, 0.2, true)).toBe(true);
    expect(pointerRaised(0.11, 0.2, true)).toBe(false);
  });

  it('freezes as a pinch closes and unfreezes only once the fingers open again (hysteresis)', () => {
    const f = new PinchFreeze();
    const between = (HAND_POINTER_CLOSING_METERS + HAND_POINTER_OPEN_METERS) / 2;
    expect(f.step(HAND_POINTER_CLOSING_METERS + 0.005, 0)).toBe('none');
    expect(f.frozen).toBe(false);
    expect(f.step(HAND_POINTER_CLOSING_METERS - 0.005, 0.01)).toBe('started');
    expect(f.step(between, 0.02)).toBe('none');
    expect(f.frozen).toBe(true);
    f.step(HAND_POINTER_OPEN_METERS + 0.005, 0.03);
    expect(f.frozen).toBe(false);
  });

  it('never stays frozen longer than the maximum; the platform pinch ending re-arms it', () => {
    const f = new PinchFreeze();
    const closed = HAND_POINTER_CLOSING_METERS - 0.01;
    f.step(closed, 0);
    expect(f.step(closed, HAND_POINTER_FREEZE_MAX_SECONDS - 0.01)).toBe('none');
    expect(f.frozen).toBe(true);
    // The earlier log's 2.1 s stuck ray: now it follows the hand after the maximum.
    expect(f.step(closed, HAND_POINTER_FREEZE_MAX_SECONDS + 0.01)).toBe('expired');
    expect(f.frozen).toBe(false);
    expect(f.step(closed, 2.1)).toBe('none');
    // The platform's pinch ends with the tips still under 6 cm: the next closing freezes again.
    f.released(2.2);
    expect(f.step(closed, 2.25)).toBe('started');
  });

  it('regression (headset log 2026-10-08 02:07): pinches after a run-out freeze press, though the fingers never opened 6 cm', () => {
    const f = new PinchFreeze();
    // 4 cm apart: under the old 6 cm "open" threshold the whole time.
    const resting = 0.04;
    const pinched = 0.01;
    // The freeze ran out at 02:07:41.39 (seconds within the minute below).
    f.step(pinched, 41.0);
    expect(f.step(pinched, 41.39)).toBe('expired');
    // The logged pinch starts on Recenter (each blocked then as "frozen ... and ran out"),
    // each released 50 ms later, the fingers back to 4 cm between them (49.352 -> 49.551: 199 ms).
    const starts = [43.076, 43.751, 44.273, 46.11, 47.917, 48.318, 48.596, 49.352, 49.551, 50.072];
    for (const start of starts) {
      f.step(pinched, start);
      expect(f.pinchStart(true, start), `pinch at ${start}`).toBe('');
      f.pressed(start);
      f.released(start + 0.05);
      f.step(resting, start + 0.06);
    }
  });

  it('never presses from a stale pose; a flicker of a pinch that pressed counts once', () => {
    const f = new PinchFreeze();
    expect(f.pinchStart(false, 0.05)).toBe('stale');
    expect(f.pinchStart(true, 0.06)).toBe('');
    f.pressed(0.06);
    // The earlier log's double Prev: pinch starts 83 ms apart, the platform's pinch flickering open briefly.
    f.released(0.1);
    expect(f.pinchStart(true, 0.143)).toBe('flicker');
    f.released(0.3);
    expect(f.pinchStart(true, 0.3 + HAND_POINTER_FLICKER_OPEN_SECONDS - 0.01)).toBe('flicker');
    // Released long enough: a new pinch, which presses.
    f.released(0.6);
    expect(f.pinchStart(true, 0.6 + HAND_POINTER_FLICKER_OPEN_SECONDS + 0.01)).toBe('');
    // Deliberate quick pinches (the log's 199-290 ms apart) each press.
    f.pressed(0.8);
    f.released(0.9);
    expect(f.pinchStart(true, 1.07)).toBe('');
    // Never two presses closer than the gap.
    f.pressed(1.07);
    f.released(1.08);
    expect(f.pinchStart(true, 1.07 + HAND_POINTER_PRESS_GAP_SECONDS - 0.01)).not.toBe('');
  });

  it('a ray pose that does not change at all goes stale; any jitter keeps it live', () => {
    const s = new StaleRay();
    expect(s.step(0, 0, 1, 0, 0, 0, -1)).toBe(false);
    expect(s.step(HAND_POINTER_STALE_SECONDS - 0.01, 0, 1, 0, 0, 0, -1)).toBe(false);
    expect(s.step(HAND_POINTER_STALE_SECONDS + 0.01, 0, 1, 0, 0, 0, -1)).toBe(true);
    expect(s.step(HAND_POINTER_STALE_SECONDS + 0.02, 0, 1.0001, 0, 0, 0, -1)).toBe(false);
  });

  it('the freeze uses the pose from before the fingers started closing', () => {
    const history = new PoseHistory();
    const out = new Float64Array(6);
    expect(history.at(0, 0.1, out)).toBe(false);
    // 90 fps: the aim drifts down as the fingers close.
    for (let frame = 0; frame <= 20; frame++) {
      const t = frame / 90;
      history.push(t, 0, 1, 0, 0, -frame * 0.01, -1);
    }
    const now = 20 / 90;
    history.at(now, HAND_POINTER_FREEZE_LOOKBACK_SECONDS, out);
    // At least 0.1 s back: frame 11 or earlier (its dy is -0.11 or higher).
    expect(out[4]).toBeGreaterThanOrEqual(-0.11);
    expect(out[4]).toBeLessThan(-0.05);
  });

  it('measures the aim: the angle to a target and the ray pitch', () => {
    expect(angleBetweenDeg(0, 0, -1, 0, 0, -1)).toBeCloseTo(0);
    expect(angleBetweenDeg(0, 0, -1, 0, 1, -1)).toBeCloseTo(45);
    expect(pitchDeg(0, 1, -1)).toBeCloseTo(45);
    expect(pitchDeg(0, -1, -Math.sqrt(3))).toBeCloseTo(-30);
  });
});

/**
 * A hand's pinches as join-system.ts runs them: the tips sampled every
 * frame (90 fps) from `gapAt`, and at each platform pinch start (released
 * 50 ms... or `releaseAfter` later) a press only if the freeze's gate and the
 * pinch motion both allow it. Returns the press times.
 */
function runPinches(gapAt: (t: number) => number, starts: readonly number[], releaseAfter = 0.05): number[] {
  const freeze = new PinchFreeze();
  const motion = new PinchMotion();
  const presses: number[] = [];
  const end = starts[starts.length - 1] + 1;
  let next = 0;
  for (let t = starts[0] - 1; t <= end; t += 1 / 90) {
    for (const start of starts) {
      if (Math.abs(start + releaseAfter - t) < 0.5 / 90) {
        freeze.released(t);
      }
    }
    const gap = gapAt(t);
    freeze.step(gap, t);
    motion.sample(gap, t);
    if (next < starts.length && t >= starts[next]) {
      const block = freeze.pinchStart(true, t);
      if (block === '' && motion.isPinchMotion(t)) {
        presses.push(starts[next]);
        freeze.pressed(t);
        motion.pressed();
      }
      next++;
    }
  }
  return presses;
}

describe('pinch motion: a resting pointing hand never presses', () => {
  it('needs the tips open past 2.2 cm within 0.4 s before the pinch', () => {
    expect(PINCH_OPEN_METERS).toBe(0.022);
    expect(PINCH_OPENING_WINDOW_SECONDS).toBe(0.4);
  });

  it('regression (headset log 2026-10-09 00:33): the flickering pinch on Hint presses nothing', () => {
    // Pointing at Hint from 08.964, the thumb resting by the index finger:
    // the tips 0.9-1.3 cm apart throughout (each logged pinch start), the
    // platform's pinch restarting about every 200 ms.
    const starts = [9.416, 9.98, 10.381, 10.622, 10.74, 11.331, 11.548, 11.624, 12.626];
    const resting = (t: number) => 0.011 + 0.002 * Math.sin(t * 17);
    expect(runPinches(resting, starts, 0.18)).toEqual([]);
  });

  it('real pinches still press: each one opens first (the 02:07 log\'s Recenter pinches, 199 ms apart at the closest)', () => {
    // Between pinches the fingers rest 4 cm apart (as the earlier regression models them), then close to 1 cm.
    const starts = [43.076, 43.751, 44.273, 46.11, 47.917, 48.318, 48.596, 49.352, 49.551, 50.072];
    const gapAt = (t: number) => {
      for (const start of starts) {
        if (t >= start - 0.08 && t < start + 0.05) {
          return 0.01;
        }
      }
      return 0.04;
    };
    expect(runPinches(gapAt, starts)).toEqual(starts);
  });

  it('a pinch from barely open fingers (2 cm) does not press; from 2.6 cm (the smallest logged real opening) it does', () => {
    const pinchFrom = (open: number) => (t: number) => (t < 5 - 0.15 ? open : 0.01);
    expect(runPinches(pinchFrom(0.02), [5])).toEqual([]);
    expect(runPinches(pinchFrom(0.026), [5])).toEqual([5]);
  });

  it('after a press, it re-arms only once the fingers open again (a flicker 500 ms later stays one press)', () => {
    const gapAt = (t: number) => (t < 4.85 ? 0.04 : 0.01);
    expect(runPinches(gapAt, [5, 5.5])).toEqual([5]);
  });

  it('an opening longer than 0.4 s before the pinch is not part of it', () => {
    const gapAt = (t: number) => (t < 4.5 ? 0.04 : 0.011);
    expect(runPinches(gapAt, [5])).toEqual([]);
  });

  it('logs the widest tip distance in the window', () => {
    const m = new PinchMotion();
    m.sample(0.03, 1.0);
    m.sample(0.012, 1.2);
    expect(m.widest(1.3)).toBeCloseTo(0.03, 9);
    expect(m.widest(1.5)).toBeCloseTo(0.012, 9);
    expect(new PinchMotion().widest(1)).toBe(-1);
  });
});

describe('the Exit hold: one continuous select that started on Exit', () => {
  /** Frames of [selecting, selectStart, startOk, onExit]; returns the hold time (s) at 90 fps, reset whenever it isn't held. */
  function holdTime(frames: [boolean, boolean, boolean, boolean][]): number {
    const exit = new HoldSelect();
    let held = 0;
    let longest = 0;
    for (const [selecting, start, ok, on] of frames) {
      const onExit = exit.needsOnTarget(selecting, start) && on;
      held = exit.step(selecting, start, ok, onExit) ? held + 1 / 90 : 0;
      longest = Math.max(longest, held);
    }
    return longest;
  }
  const repeat = <T>(frame: T, seconds: number): T[] => Array.from({ length: Math.round(seconds * 90) }, () => frame);

  it('regression (headset log 2026-10-09 00:33): a pinch held since 14.5 s, the pointer arriving on Exit at 28.4 s, never holds it', () => {
    const frames: [boolean, boolean, boolean, boolean][] = [
      // 14.506: the pinch starts on nothing (whatever its motion).
      [true, true, true, false],
      // Held while the pointer crosses the other buttons...
      ...repeat<[boolean, boolean, boolean, boolean]>([true, false, true, false], 12.2),
      // ...crosses Exit for a moment (26.70)...
      ...repeat<[boolean, boolean, boolean, boolean]>([true, false, true, true], 0.03),
      ...repeat<[boolean, boolean, boolean, boolean]>([true, false, true, false], 1.66),
      // ...and rests on it from 28.396.
      ...repeat<[boolean, boolean, boolean, boolean]>([true, false, true, true], 2),
    ];
    expect(holdTime(frames)).toBe(0);
  });

  it('hover alone (no select), or a no-motion pinch on Exit, never moves the ring', () => {
    expect(holdTime(repeat([false, false, true, true], 2))).toBe(0);
    expect(holdTime([[true, true, false, true], ...repeat<[boolean, boolean, boolean, boolean]>([true, false, false, true], 2)])).toBe(0);
  });

  it('a pinch motion that starts on Exit holds it; a one-frame flicker resets it to zero for good', () => {
    const held: [boolean, boolean, boolean, boolean][] = [[true, true, true, true], ...repeat<[boolean, boolean, boolean, boolean]>([true, false, true, true], 1.2)];
    expect(holdTime(held)).toBeGreaterThan(1.1);
    const flicker: [boolean, boolean, boolean, boolean][] = [
      [true, true, true, true],
      ...repeat<[boolean, boolean, boolean, boolean]>([true, false, true, true], 0.6),
      [false, false, true, true],
      // The platform's pinch restarts at once, the fingers never opened: not a pinch motion.
      [true, true, false, true],
      ...repeat<[boolean, boolean, boolean, boolean]>([true, false, false, true], 1.5),
    ];
    expect(holdTime(flicker)).toBeLessThan(0.62);
  });

  it('leaving Exit ends the hold; coming back with the same select does not resume it', () => {
    const frames: [boolean, boolean, boolean, boolean][] = [
      [true, true, true, true],
      ...repeat<[boolean, boolean, boolean, boolean]>([true, false, true, true], 0.5),
      [true, false, true, false],
      ...repeat<[boolean, boolean, boolean, boolean]>([true, false, true, true], 1.5),
    ];
    expect(holdTime(frames)).toBeLessThan(0.52);
  });
});

/**
 * Logged pinch presses (headset logs 2026-10-09): the tips' distance at the
 * platform's pinch start, the widest in the 0.4 s before it (cm), and how
 * long the pointer had been shown (s).
 */
type LoggedPinch = { at: string; startGap: number; widest: number; visible: number };
/** The three presses made while only pointing (02:57-02:59 log). */
const POINTING_ONLY: LoggedPinch[] = [
  { at: '02:57:18.432 Hint', startGap: 3.4, widest: 3.7, visible: 5.65 },
  { at: '02:58:50.757 NULL cell', startGap: 1.1, widest: 3.4, visible: 3.03 },
  { at: '02:59:05.437 Recenter', startGap: 2.2, widest: 2.6, visible: 17.72 },
];
/** Every intended pinch press in the four logs (00:52, 00:56, 02:22, 02:56). */
const INTENDED: LoggedPinch[] = [
  { at: '00:53:02.240', startGap: 0.6, widest: 3.9, visible: 16.66 },
  { at: '00:53:05.851', startGap: 0.5, widest: 2.8, visible: 20.27 },
  { at: '00:53:06.931', startGap: 0.3, widest: 2.8, visible: 21.35 },
  { at: '00:53:08.324', startGap: 0.3, widest: 2.8, visible: 22.74 },
  { at: '00:53:09.645', startGap: 0.4, widest: 2.7, visible: 24.07 },
  { at: '00:53:12.299', startGap: 0.3, widest: 3.2, visible: 26.72 },
  { at: '00:53:12.926', startGap: 0.4, widest: 3.5, visible: 27.35 },
  { at: '00:53:13.246', startGap: 0.4, widest: 3.8, visible: 27.67 },
  { at: '00:57:36.456', startGap: 1.4, widest: 3.6, visible: 1.3 },
  { at: '00:57:50.786', startGap: 1.2, widest: 2.9, visible: 10.54 },
  { at: '02:23:20.712', startGap: 1.1, widest: 2.5, visible: 12.57 },
  { at: '02:23:30.312', startGap: 1.1, widest: 3.4, visible: 22.17 },
  { at: '02:24:30.617', startGap: 0.9, widest: 3.7, visible: 1.47 },
  { at: '02:24:39.567', startGap: 1.9, widest: 4.4, visible: 1.93 },
  { at: '02:25:06.008', startGap: 0.9, widest: 2.6, visible: 28.37 },
  { at: '02:25:43.961', startGap: 1.1, widest: 6.2, visible: 18.28 },
  { at: '02:25:53.251', startGap: 1.8, widest: 2.9, visible: 27.57 },
  { at: '02:26:00.361', startGap: 1.8, widest: 3.1, visible: 34.68 },
  { at: '02:26:03.528', startGap: 1.3, widest: 2.7, visible: 37.85 },
  { at: '02:26:08.366', startGap: 1.5, widest: 3.0, visible: 42.69 },
  { at: '02:26:45.690', startGap: 1.0, widest: 2.9, visible: 18.2 },
  { at: '02:59:15.720', startGap: 1.5, widest: 3.9, visible: 1.41 },
];
const startVerdict = (p: LoggedPinch) => pinchStartVerdict(p.widest / 100 >= PINCH_OPEN_METERS, p.startGap / 100, p.visible);

/** Runs a pinch's tip distance (`gapAt(t)`, cm, t from the start) through PinchConfirm at 90 fps; the outcome. */
function confirmPinch(gapAt: (t: number) => number, heldFor = 1): string {
  const c = new PinchConfirm();
  c.start(0, gapAt(0) / 100, true);
  for (let t = 1 / 90; t <= heldFor + 1e-9; t += 1 / 90) {
    const step = c.step(t, gapAt(t) / 100, true);
    if (step !== 'pending') {
      return step;
    }
  }
  return c.step(heldFor + 1 / 90, gapAt(heldFor) / 100, false);
}

/**
 * Drives PinchConfirm as join-system.ts does each frame (90 fps): `start`
 * on the platform's pinch start (armed to press), then `frame` while held
 * and on the frame it ends. Returns what happened, frame by frame.
 */
function runFrames(gapAt: (t: number) => number, heldFor: number): string[] {
  const c = new PinchConfirm();
  c.start(0, gapAt(0) / 100, true);
  const steps: string[] = [];
  let t = 0;
  for (; t + 1 / 90 < heldFor; ) {
    t += 1 / 90;
    const step = c.frame(t, gapAt(t) / 100, true, false);
    if (step !== 'pending') {
      steps.push(step);
    }
  }
  // The frame the platform's pinch ends: not selecting any more.
  t += 1 / 90;
  const end = c.frame(t, gapAt(t) / 100, false, true);
  if (end !== 'pending') {
    steps.push(end);
  }
  return steps;
}

describe('a clear pinch from a shown pointer', () => {
  it('wiring: a quick tap presses on the frame it ends; a held pinch presses once, while held (headset log 2026-10-09 04:25:38.667)', () => {
    // The logged tap: 43 ms, closed to 1.2 cm the whole time -- ignored before the fix.
    expect(runFrames(() => 1.2, 0.043)).toEqual(['press']);
    // 25 ms (the emulator check): still a press, on release.
    expect(runFrames(() => 0.2, 0.025)).toEqual(['press']);
    // Held 200 ms: presses after 40 ms closed, and not again on release.
    expect(runFrames(() => 0.8, 0.2)).toEqual(['press']);
    // A tap that never closed to 1.8 cm: dropped on release.
    expect(runFrames(() => 2.1, 0.05)).toEqual(['released']);
    // Held, never closing: dropped once the window ends, and nothing more on release.
    expect(runFrames(() => 2.1, 0.8)).toEqual(['no-close']);
  });

  it('FROZEN constants (2026-10-09): change only for a clear regression in a session log', () => {
    expect(PINCH_OPEN_METERS).toBe(0.022);
    expect(PINCH_OPENING_WINDOW_SECONDS).toBe(0.4);
    expect(POINTER_PRESS_MIN_VISIBLE_SECONDS).toBe(0.2);
    expect(PINCH_START_MAX_METERS).toBe(0.025);
    expect(PINCH_CLOSED_METERS).toBe(0.018);
    expect(PINCH_CLOSED_HOLD_SECONDS).toBe(0.04);
    expect(PINCH_CLOSE_WINDOW_SECONDS).toBe(0.5);
    expect(PINCH_OPEN_NULL_METERS).toBe(0.015);
    expect(PINCH_TARGET_LOCK_SECONDS).toBe(0.25);
    expect(RECENTER_HOLD_SECONDS).toBe(0.6);
  });

  it('regression (headset log 2026-10-09 02:57-02:59): the Hint pinch that started 3.4 cm apart never presses; Recenter (2.2 cm) is a hold now', () => {
    expect(POINTING_ONLY.map((p) => `${p.at}: ${startVerdict(p)}`)).toEqual([
      '02:57:18.432 Hint: start-open',
      '02:58:50.757 NULL cell: ',
      '02:59:05.437 Recenter: ',
    ]);
    // Recenter acts only after RECENTER_HOLD_SECONDS of one continuous pinch (HoldSelect), not on a pinch.
    expect(RECENTER_HOLD_SECONDS).toBeGreaterThan(PINCH_CLOSE_WINDOW_SECONDS);
  });

  it('regression (headset log 2026-10-09 04:22): real attempts from a just-raised hand, 2.1-2.2 cm at the start, now start', () => {
    expect(pinchStartVerdict(true, 0.022, 0.36)).toBe('');
    expect(pinchStartVerdict(true, 0.021, 0.23)).toBe('');
    expect(pinchStartVerdict(true, 0.028, 0.35)).toBe('start-open');
  });

  it('ASSUMPTION-BASED (the log has only the tips at its start): the 02:58 NULL cell pinch, if the tips reopened within 2 frames, never presses', () => {
    // Logged: 1.1 cm at the start, and the pointer left the cell 112 ms later (the hand was moving).
    // Assumed, not logged: the tips went back above 1.8 cm within 2 frames and stayed there.
    const reopened = (t: number) => (t < 2 / 90 ? 1.1 : 1.1 + 40 * t);
    expect(confirmPinch(reopened)).toBe('no-close');
  });

  it('all 22 intended pinch presses in the four logs still press (modelled closing from their start gap to 0.8 cm in 0.1 s)', () => {
    let pressed = 0;
    for (const p of INTENDED) {
      expect(startVerdict(p), p.at).toBe('');
      const closing = (t: number) => Math.max(0.8, p.startGap - ((p.startGap - 0.8) * t) / 0.1);
      if (confirmPinch(closing) === 'press') {
        pressed++;
      }
    }
    expect(pressed).toBe(INTENDED.length);
    expect(INTENDED.length).toBe(22);
  });

  it('a hand whose pointer is off (resting) or just shown never presses', () => {
    expect(pinchStartVerdict(true, 0.008, 0)).toBe('not-visible');
    expect(pinchStartVerdict(true, 0.008, 0.15)).toBe('not-visible');
    expect(pinchStartVerdict(true, 0.008, 0.25)).toBe('');
  });

  it('flickers near the 1.8 cm line, or a pinch released before it closes, never press; a quick tap that closed does', () => {
    // Alternating 1.7 / 1.9 cm every frame: never 40 ms closed in a row, and it never ends.
    expect(confirmPinch((t) => (Math.round(t * 90) % 2 === 0 ? 1.7 : 1.9))).toBe('no-close');
    // Released after 40 ms, never closer than 1.9 cm: not a pinch.
    expect(confirmPinch(() => 1.9, 0.04)).toBe('released');
    // A 53 ms tap that reached 1.6 cm: presses on release.
    expect(confirmPinch(() => 1.6, 0.053)).toBe('press');
    // Closed and held 40 ms: presses.
    expect(confirmPinch(() => 0.8)).toBe('press');
  });

  it('regression (headset log 2026-10-09 03:57): first tries that took 3-4 pinches now press', () => {
    // LEFT, 03:58:39.273: opened 3.1 cm, tips 1.6 cm at the start, narrowest 1.6, released after 53 ms.
    expect(pinchStartVerdict(0.031 >= PINCH_OPEN_METERS, 0.016, 16.62)).toBe('');
    expect(confirmPinch(() => 1.6, 0.053)).toBe('press');
    // NULL row 6, 04:03:25.358: opened 4.5 cm, 1.2 cm at the start, narrowest 1.0, 60 ms closed, 133 ms long.
    expect(pinchStartVerdict(0.045 >= PINCH_OPEN_NULL_METERS, 0.012, 17.87)).toBe('');
    expect(confirmPinch((t) => (t < 0.06 ? 1.0 : 2.0), 0.133)).toBe('press');
    // NULL row 7 milk, 03:59:59.726: opened only 1.6 cm (a NULL cell takes 1.5), 1.6 at the start, 81 ms long.
    expect(pinchStartVerdict(0.016 >= PINCH_OPEN_NULL_METERS, 0.016, 66.9)).toBe('');
    expect(confirmPinch(() => 1.6, 0.081)).toBe('press');
    // NULL row 7, 04:00:20.592: opened 1.6 cm, narrowest 0.2.
    expect(pinchStartVerdict(0.016 >= PINCH_OPEN_NULL_METERS, 0.015, 87.76)).toBe('');
    expect(confirmPinch((t) => Math.max(0.2, 1.5 - 20 * t))).toBe('press');
    // A button still needs 2.2 cm: the same 1.6 cm opening on a button doesn't count.
    expect(pinchStartVerdict(0.016 >= PINCH_OPEN_METERS, 0.016, 66.9)).toBe('no-opening');
  });

  it('regression (headset log 2026-10-09 03:59:38): the stray Recenter pinch lasted 440 ms, under its 0.6 s hold', () => {
    expect(0.44).toBeLessThan(RECENTER_HOLD_SECONDS);
  });
});
