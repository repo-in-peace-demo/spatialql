import { describe, expect, it } from 'vitest';
import {
  angleBetweenDeg,
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
