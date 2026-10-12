import { describe, expect, it } from 'vitest';
import { formatClock, SessionClock } from './session-clock.js';

describe('the session clock format', () => {
  it('m:ss under an hour, h:mm:ss after, whole seconds', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(59.9)).toBe('0:59');
    expect(formatClock(727)).toBe('12:07');
    expect(formatClock(3599)).toBe('59:59');
    expect(formatClock(3600)).toBe('1:00:00');
    expect(formatClock(3727)).toBe('1:02:07');
    expect(formatClock(36000)).toBe('10:00:00');
    expect(formatClock(-3)).toBe('0:00');
  });
});

describe('the session clock', () => {
  it('starts from 0 when the session starts', () => {
    const clock = new SessionClock();
    expect(clock.elapsed(100)).toBe(0);
    clock.start(100);
    expect(clock.elapsed(100)).toBe(0);
    expect(clock.elapsed(165)).toBe(65);
  });

  it('pauses while the headset is off and resumes when it is back on', () => {
    const clock = new SessionClock();
    clock.start(0);
    clock.setHidden(true, 30);
    expect(clock.elapsed(90)).toBe(30);
    clock.setHidden(false, 90);
    expect(clock.elapsed(100)).toBe(40);
    // Repeated hides and shows, and a duplicate hide.
    clock.setHidden(true, 100);
    clock.setHidden(true, 105);
    clock.setHidden(false, 200);
    clock.setHidden(false, 201);
    expect(clock.elapsed(210)).toBe(50);
  });

  it('a new session starts again from 0', () => {
    const clock = new SessionClock();
    clock.start(0);
    clock.stop(500);
    expect(clock.elapsed(900)).toBe(500);
    clock.start(1000);
    expect(clock.elapsed(1012)).toBe(12);
  });

  it('visibility before any session does nothing', () => {
    const clock = new SessionClock();
    clock.setHidden(false, 5);
    expect(clock.running).toBe(false);
    expect(clock.elapsed(50)).toBe(0);
  });

  it('"Solved in" counts only the time the puzzle was active', () => {
    const clock = new SessionClock();
    clock.start(0);
    clock.puzzleStarted(120);
    // Headset off for 5 minutes mid-puzzle.
    clock.setHidden(true, 150);
    clock.setHidden(false, 450);
    expect(clock.puzzleElapsed(522)).toBe(102); // 30 s before, 72 s after
    // The next puzzle starts over; the session clock doesn't.
    clock.puzzleStarted(522);
    expect(clock.puzzleElapsed(530)).toBe(8);
    expect(clock.elapsed(530)).toBe(230);
  });
});
