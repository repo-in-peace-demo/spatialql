import { describe, expect, it } from 'vitest';
import { ANCHOR_SETTLE_CAP_SECONDS, ANCHOR_SETTLE_SECONDS, AnchorSettle } from './anchor-settle.js';

const head = (x: number, y = 1.18, z = 0) => ({ x, y, z });

describe('the session anchor waits for tracking to settle', () => {
  it('a still head with no reset: ready after ANCHOR_SETTLE_SECONDS', () => {
    const settle = new AnchorSettle();
    settle.start(0);
    expect(settle.sample(0.1, head(0))).toBe(false);
    expect(settle.sample(0.1 + ANCHOR_SETTLE_SECONDS - 0.01, head(0.005))).toBe(false);
    expect(settle.sample(0.1 + ANCHOR_SETTLE_SECONDS, head(0.01))).toBe(true);
  });

  it('the 2026-10-13 start: a reset 0.2 s in (with the head jumping to its corrected pose) restarts the wait', () => {
    const settle = new AnchorSettle();
    settle.start(0);
    // Before the reset: the uncorrected pose, (-0.58, 1.10, -1.05).
    expect(settle.sample(0.1, { x: -0.58, y: 1.1, z: -1.05 })).toBe(false);
    settle.onReset(0.2);
    expect(settle.resets).toBe(1);
    // After it: the corrected pose, where the player really sits; still for half a second from here.
    expect(settle.sample(0.25, { x: -0.09, y: 1.18, z: -0.29 })).toBe(false);
    expect(settle.sample(0.6, { x: -0.09, y: 1.18, z: -0.29 })).toBe(false);
    expect(settle.sample(0.75, { x: -0.09, y: 1.18, z: -0.29 })).toBe(true);
  });

  it('a moving head restarts the wait; past the cap it is taken anyway', () => {
    const settle = new AnchorSettle();
    settle.start(0);
    let t = 0;
    for (let i = 0; i < 60; i++) {
      t += 0.1;
      // 5 cm a step: never still.
      if (settle.sample(t, head(i * 0.05))) {
        break;
      }
    }
    expect(t).toBeLessThan(ANCHOR_SETTLE_CAP_SECONDS + 0.05);
    expect(t).toBeGreaterThanOrEqual(ANCHOR_SETTLE_CAP_SECONDS - 0.05);
  });

  it('never at the tracking origin placeholder (0, 0, 0), even past the cap', () => {
    const settle = new AnchorSettle();
    settle.start(0);
    expect(settle.sample(10, { x: 0, y: 0, z: 0 })).toBe(false);
    expect(settle.sample(10.1, head(0))).toBe(true);
  });
});
