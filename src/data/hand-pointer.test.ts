import { describe, expect, it } from 'vitest';
import {
  angleBetweenDeg,
  HAND_POINTER_CLOSING_METERS,
  HAND_POINTER_FREEZE_LOOKBACK_SECONDS,
  HAND_POINTER_MAX_BELOW_EYES_METERS,
  HAND_POINTER_MAX_METERS,
  HAND_POINTER_MIN_FORWARD_METERS,
  HAND_POINTER_OPEN_METERS,
  HAND_POINTER_PITCH_OFFSET_DEG,
  HAND_POINTER_SMOOTH_SECONDS,
  pitchDeg,
  pointerFrozen,
  pointerRaised,
  PoseHistory,
  smoothingAlpha,
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

  it('freezes as a pinch closes and unfreezes only once the fingers open again (hysteresis)', () => {
    expect(pointerFrozen(HAND_POINTER_CLOSING_METERS + 0.005, false)).toBe(false);
    expect(pointerFrozen(HAND_POINTER_CLOSING_METERS - 0.005, false)).toBe(true);
    expect(pointerFrozen((HAND_POINTER_CLOSING_METERS + HAND_POINTER_OPEN_METERS) / 2, true)).toBe(true);
    expect(pointerFrozen(HAND_POINTER_OPEN_METERS + 0.005, true)).toBe(false);
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
