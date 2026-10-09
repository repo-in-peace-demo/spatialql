import { describe, expect, it } from 'vitest';
import {
  REACH_HINT_CONTROL_METERS,
  REACH_HINT_HYSTERESIS_METERS,
  REACH_HINT_SLAB_METERS,
  REACH_HINT_SUSTAIN_SECONDS,
  ReachHint,
} from '../reach-hint.js';

const TICK = 0.25;

/** Runs `seconds` of measurements at 4 Hz with fixed distances; the steps that weren't 'none'. */
function run(hint: ReachHint, seconds: number, control: number, slab: number): string[] {
  const out: string[] = [];
  for (let t = 0; t < seconds - 1e-9; t += TICK) {
    const step = hint.step(TICK, control, slab);
    if (step !== 'none') {
      out.push(step);
    }
  }
  return out;
}

describe('the reach hint', () => {
  it('limits: controls 0.65 m from the nearer shoulder, slabs 0.90 m from the eyes, 2 s, 5 cm hysteresis', () => {
    expect(REACH_HINT_CONTROL_METERS).toBe(0.65);
    expect(REACH_HINT_SLAB_METERS).toBe(0.9);
    expect(REACH_HINT_SUSTAIN_SECONDS).toBe(2);
    expect(REACH_HINT_HYSTERESIS_METERS).toBe(0.05);
  });

  it('never shows at the logged placement distances (controls 0.45-0.54 m, slabs 0.62-0.76 m)', () => {
    const hint = new ReachHint();
    expect(run(hint, 10, 0.54, 0.76)).toEqual([]);
  });

  it('a brief lean back (1.5 s past the limit) does not show it; 2 s does', () => {
    const hint = new ReachHint();
    expect(run(hint, 1.5, 0.7, 0.7)).toEqual([]);
    expect(run(hint, 1, 0.5, 0.7)).toEqual([]);
    expect(run(hint, 2, 0.7, 0.7)).toEqual(['show']);
  });

  it('either limit alone shows it (slabs too far, controls fine)', () => {
    expect(run(new ReachHint(), 2, 0.5, 0.95)).toEqual(['show']);
  });

  it('hides only once both are 5 cm back inside their limits', () => {
    const hint = new ReachHint();
    run(hint, 2, 0.7, 0.7);
    expect(run(hint, 1, 0.62, 0.7)).toEqual([]); // 0.62 > 0.60: still shown
    expect(run(hint, 1, 0.6, 0.87)).toEqual([]); // slabs 0.87 > 0.85: still shown
    expect(run(hint, 0.25, 0.6, 0.85)).toEqual(['hide']);
  });

  it('a Recenter hides it at once and restarts the timer', () => {
    const hint = new ReachHint();
    run(hint, 2, 0.7, 0.7);
    expect(hint.reset()).toBe('hide');
    expect(run(hint, 1.75, 0.7, 0.7)).toEqual([]);
    expect(hint.reset()).toBe('none');
  });
});
