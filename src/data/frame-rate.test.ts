import { describe, expect, it } from 'vitest';
import { chooseFrameRate, PREFERRED_FRAME_RATE_HZ } from '../frame-rate.js';

describe('the frame rate a session asks for', () => {
  it('72 Hz when offered (the Quest 3 offers 72, 80, 90 and 120)', () => {
    expect(PREFERRED_FRAME_RATE_HZ).toBe(72);
    expect(chooseFrameRate([72, 80, 90, 120])).toBe(72);
  });

  it('otherwise the highest offered rate below it, never a faster one', () => {
    expect(chooseFrameRate([60, 90])).toBe(60);
    expect(chooseFrameRate([90, 120])).toBeNull();
    expect(chooseFrameRate([])).toBeNull();
  });

  it('a manual choice (?hz=) works the same way', () => {
    expect(chooseFrameRate([72, 80, 90, 120], 90)).toBe(90);
    expect(chooseFrameRate([72, 80, 90, 120], 85)).toBe(80);
  });
});
