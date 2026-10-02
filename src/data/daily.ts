/**
 * Calendar days and the daily puzzle.
 *
 * A "day" is the device's local calendar date, counted as whole days since
 * 1970-01-01 (`Date.UTC(y, m, d) / 86400000`). Counting calendar dates
 * rather than elapsed milliseconds keeps DST changes (23- and 25-hour days)
 * from skipping or repeating a day. Everyone on the same local date gets the
 * same daily puzzle.
 */

import { DAILY_SCHEDULE, type PuzzleId } from './puzzles.js';

const MS_PER_DAY = 86_400_000;

/** The local calendar date of `date`, as a day number. */
export function localDay(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY;
}

/** Parses `YYYY-MM-DD` (e.g. a dev `day=` override) to a day number, or null if invalid. */
export function dayFromIso(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    return null;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return ms / MS_PER_DAY;
}

/** Formats a day number as `YYYY-MM-DD`. */
export function isoFromDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Day 0 of the daily schedule. */
export const DAILY_EPOCH_ISO = '2026-10-01';
export const DAILY_EPOCH_DAY = dayFromIso(DAILY_EPOCH_ISO) as number;

/** The daily puzzle for a day; days before the epoch wrap backwards. */
export function dailyPuzzleId(day: number, schedule: readonly PuzzleId[] = DAILY_SCHEDULE): PuzzleId {
  const n = schedule.length;
  const index = (((day - DAILY_EPOCH_DAY) % n) + n) % n;
  return schedule[index];
}
