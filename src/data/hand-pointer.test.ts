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
  PinchMotion,
  PINCH_OPEN_METERS,
  PINCH_OPENING_WINDOW_SECONDS,
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
