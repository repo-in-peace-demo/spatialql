import { describe, expect, it } from 'vitest';
import { HINT_PRESS_GAP_SECONDS, HintGate, SHOW_ANSWER_HOLD_SECONDS } from '../hint-gate.js';

describe('the Hint gate', () => {
  it('at least 0.8 s between presses; Show answer is a 0.8 s hold', () => {
    expect(HINT_PRESS_GAP_SECONDS).toBe(0.8);
    expect(SHOW_ANSWER_HOLD_SECONDS).toBe(0.8);
    const gate = new HintGate();
    expect(gate.press(1)).toBe('hint');
    expect(gate.press(1.79)).toBe('ignored');
    expect(gate.press(2.6)).toBe('hint');
  });

  it('the logged presses (headset log 2026-10-09 00:33), by the gate alone: two hints', () => {
    // The pinch-motion rule (hand-pointer.test.ts) stops all of these; the third tier would be a hold anyway.
    const gate = new HintGate();
    expect([9.416, 9.98, 10.381, 10.622].map((t) => gate.press(t))).toEqual(['hint', 'ignored', 'hint', 'ignored']);
  });

  it('the answer shown by its hold spaces the next press too', () => {
    const gate = new HintGate();
    gate.pressed(5);
    expect(gate.press(5.5)).toBe('ignored');
    expect(gate.press(5.9)).toBe('hint');
  });
});
