import { describe, expect, it } from 'vitest';
import { DAILY_EPOCH_DAY, dailyPuzzleId, dayFromIso, isoFromDay, localDay } from './daily.js';
import { DAILY_SCHEDULE } from './puzzles.js';

describe('calendar days', () => {
  it('a whole local calendar date is one day', () => {
    expect(localDay(new Date(2026, 9, 3, 0, 5))).toBe(localDay(new Date(2026, 9, 3, 23, 55)));
    expect(localDay(new Date(2026, 9, 4, 0, 5)) - localDay(new Date(2026, 9, 3, 23, 55))).toBe(1);
  });

  it('consecutive dates are consecutive days all year, across DST changes', () => {
    for (let i = 0; i < 366; i++) {
      // Noon avoids any local-midnight DST oddity in the runner's time zone.
      const today = localDay(new Date(2026, 0, 1 + i, 12));
      const tomorrow = localDay(new Date(2026, 0, 2 + i, 12));
      expect(tomorrow - today).toBe(1);
      expect(Number.isInteger(today)).toBe(true);
    }
  });

  it('parses and formats YYYY-MM-DD', () => {
    expect(dayFromIso('2026-10-01')).toBe(localDay(new Date(2026, 9, 1, 12)));
    expect(isoFromDay(dayFromIso('2026-10-03') as number)).toBe('2026-10-03');
    expect(dayFromIso('2026-02-30')).toBeNull();
    expect(dayFromIso('2026-1-3')).toBeNull();
    expect(dayFromIso('tomorrow')).toBeNull();
  });
});

describe('dailyPuzzleId', () => {
  it('is the same for everyone on a date, and cycles through the schedule', () => {
    expect(dailyPuzzleId(DAILY_EPOCH_DAY)).toBe(DAILY_SCHEDULE[0]);
    expect(dailyPuzzleId(DAILY_EPOCH_DAY + 1)).toBe(DAILY_SCHEDULE[1]);
    expect(dailyPuzzleId(DAILY_EPOCH_DAY + DAILY_SCHEDULE.length)).toBe(DAILY_SCHEDULE[0]);
  });

  it('wraps backwards before the epoch', () => {
    expect(dailyPuzzleId(DAILY_EPOCH_DAY - 1)).toBe(DAILY_SCHEDULE[DAILY_SCHEDULE.length - 1]);
  });

  it('changes every day', () => {
    for (let day = DAILY_EPOCH_DAY; day < DAILY_EPOCH_DAY + 40; day++) {
      expect(dailyPuzzleId(day + 1)).not.toBe(dailyPuzzleId(day));
    }
  });
});
