import { describe, expect, it } from 'vitest';
import {
  HeadYawHistory,
  RECENTER_COUNTDOWN_SECONDS,
  RECENTER_SETTLED_MAX_DEG,
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
function runCountdown(
  groupYaw: number,
  headAt: (t: number) => number,
  settledYaw: number | null = null,
  buttonYaw = groupYaw + BUTTON_OFFSET,
): { yaw: number; seconds: number; cancelled: boolean } {
  const c = new RecenterCountdown();
  c.start(headAt(0), groupYaw, buttonYaw, settledYaw);
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

  it('regression (headset log 2026-10-11 04:33): already facing the button\'s way before the press, the countdown completes there', () => {
    // Yaws + left: the head at 33° left for seconds before, the group at 1.5° right, the button at 36° left.
    const group = -1.5 * DEG;
    const button = 36 * DEG;
    const head = 33 * DEG;
    const result = runCountdown(group, (t) => head + 0.8 * DEG * Math.sin(t * 9), head, button);
    expect(result.cancelled).toBe(false);
    expect(result.seconds).toBeCloseTo(RECENTER_COUNTDOWN_SECONDS, 1);
    expect(result.yaw / DEG).toBeCloseTo(33, 0);
  });

  it('a glance at the button to press it (facing the group before) still cancels when the head stays there', () => {
    const result = runCountdown(0, () => BUTTON_OFFSET, 2 * DEG);
    expect(RECENTER_SETTLED_MAX_DEG).toBe(15);
    expect(result.cancelled).toBe(true);
  });

  it('no runaway drift: once recentered toward the button, the next press needs a turn to it (it cancels again)', () => {
    // First press: facing the button's way already -> the group comes to the head (36° left).
    let group = 0;
    group = runCountdown(group, () => BUTTON_OFFSET, BUTTON_OFFSET).yaw;
    expect(group / DEG).toBeCloseTo(39, 0);
    // The button is now 39° further left; pressing it again means turning to it from the new group: a glance.
    const again = runCountdown(group, () => group + BUTTON_OFFSET, group);
    expect(again.cancelled).toBe(true);
  });
});

describe('the head\'s settled yaw before a press', () => {
  it('is the median 3.0 to 1.2 s before the press, ignoring the turn to the button just before it', () => {
    const history = new HeadYawHistory();
    for (let t = 0; t <= 5; t += FRAME) {
      // Facing 33° until 4.2 s, then turning to the button (40°) for the reach and the hold.
      history.record(t, (t < 4.2 ? 33 : 40) * DEG);
    }
    expect((history.settledYaw(5) ?? NaN) / DEG).toBeCloseTo(33, 6);
  });

  it('is unknown right after a session starts (too few samples), and handles yaws across +/-180°', () => {
    const history = new HeadYawHistory();
    for (let t = 0; t <= 1.0; t += FRAME) {
      history.record(t, 0);
    }
    expect(history.settledYaw(1.0)).toBeNull();
    const behind = new HeadYawHistory();
    for (let t = 0; t <= 4; t += FRAME) {
      behind.record(t, (Math.floor(t * 90) % 2 === 0 ? 179 : -179) * DEG);
    }
    expect(Math.abs(yawDelta(behind.settledYaw(4) ?? 0, Math.PI)) / DEG).toBeLessThan(1.01);
  });
});
