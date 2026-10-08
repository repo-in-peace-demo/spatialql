import { describe, expect, it } from 'vitest';
import {
  RECENTER_COUNTDOWN_SECONDS,
  RECENTER_LOOK_AWAY_SECONDS,
  RECENTER_TURNED_MAX_DEG,
  RECENTER_YAW_WINDOW_SECONDS,
  RecenterCountdown,
  yawDelta,
} from '../recenter-countdown.js';

const DEG = Math.PI / 180;
const FRAME = 1 / 90;
/** The Recenter button's direction from the eyes, relative to the group's (the column's bottom-left cell: ~39° left). */
const BUTTON_OFFSET = 39 * DEG;

/** Runs one countdown to its end with the head's yaw at each moment (`headAt(t)`, t from the press); returns the yaw it recenters to (or the group's, cancelled) and how long it took. */
function runCountdown(groupYaw: number, headAt: (t: number) => number): { yaw: number; seconds: number; cancelled: boolean } {
  const c = new RecenterCountdown();
  c.start(headAt(0), groupYaw, groupYaw + BUTTON_OFFSET);
  let t = 0;
  for (;;) {
    t += FRAME;
    const step = c.step(FRAME, headAt(t));
    if (step === 'cancelled') {
      return { yaw: groupYaw, seconds: t, cancelled: true };
    } else if (step === 'done') {
      return { yaw: c.yaw(), seconds: t, cancelled: false };
    }
  }
}

describe('the Recenter countdown', () => {
  it('counts 1.5 s, takes the median of the last 0.3 s; looking back over 25° toward the button after 0.5 s cancels', () => {
    expect(RECENTER_COUNTDOWN_SECONDS).toBe(1.5);
    expect(RECENTER_LOOK_AWAY_SECONDS).toBe(0.5);
    expect(RECENTER_YAW_WINDOW_SECONDS).toBe(0.3);
    expect(RECENTER_TURNED_MAX_DEG).toBe(25);
  });

  it('regression (headset log 2026-10-09 00:52): repeated presses with the head turned toward the button do not drift the group', () => {
    // The log: 0° -> -5° -> -26° -> -42° -> ... -> -93° (+ right) in nine presses, each recentering at the press.
    // Now each press looks at the button (between the group and it), then back straight ahead within ~0.4 s.
    let group = 0;
    const groups: number[] = [];
    for (let press = 0; press < 9; press++) {
      const atButton = group + BUTTON_OFFSET * 0.7;
      const ahead = 0;
      const headAt = (t: number) => (t < 0.4 ? atButton + (ahead - atButton) * (t / 0.4) : ahead + 1.5 * DEG * Math.sin(t * 9));
      group = runCountdown(group, headAt).yaw;
      groups.push(group);
    }
    for (const yaw of groups) {
      expect(Math.abs(yaw) / DEG).toBeLessThan(2);
    }
  });

  it('a head still on the button cancels it once the look-away time is up (nothing moves)', () => {
    const result = runCountdown(0, () => BUTTON_OFFSET);
    expect(result.cancelled).toBe(true);
    expect(result.seconds).toBeCloseTo(RECENTER_LOOK_AWAY_SECONDS, 1);
  });

  it('looking back at the button mid-countdown cancels it', () => {
    const result = runCountdown(0, (t) => (t < 0.9 ? 0 : BUTTON_OFFSET));
    expect(result.cancelled).toBe(true);
    expect(result.seconds).toBeGreaterThan(0.9);
    expect(result.seconds).toBeLessThan(RECENTER_COUNTDOWN_SECONDS);
  });

  it('a head turned the other way (away from the button) is not held back', () => {
    const result = runCountdown(0, () => -30 * DEG);
    expect(result.cancelled).toBe(false);
    expect(result.seconds).toBeCloseTo(RECENTER_COUNTDOWN_SECONDS, 1);
    expect(result.yaw / DEG).toBeCloseTo(-30, 6);
  });

  it('the median ignores a brief glance at the end, and handles yaws across +/-180°', () => {
    const glance = runCountdown(0, (t) => (t > 1.42 && t < 1.47 ? 20 * DEG : 2 * DEG));
    expect(glance.yaw / DEG).toBeCloseTo(2, 6);
    const behind = runCountdown(Math.PI, (t) => (Math.floor(t * 90) % 2 === 0 ? 179 * DEG : -179 * DEG));
    expect(Math.abs(yawDelta(behind.yaw, Math.PI)) / DEG).toBeLessThan(1.01);
  });
});
