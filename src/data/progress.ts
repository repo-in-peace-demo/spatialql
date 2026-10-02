/**
 * Per-device challenge progress: solved puzzles, the daily streak, and
 * which concepts have been introduced. Pure functions plus a guarded
 * load/save over a `Storage`-like object (localStorage in the app, a fake in
 * tests).
 *
 * Storage is best-effort: it may be missing, empty, full, blocked (private
 * windows, cleared site data) or hold something unexpected. Every read and
 * write is wrapped, bad data falls back to defaults, and a failed save only
 * means progress lasts for this session.
 *
 * Streak rules: only solving the daily counts (hints allowed). Solving on
 * the next calendar day extends the streak; missing a day starts again at
 * 1. Solving again on a day already counted changes nothing, and so does a
 * day earlier than the last one counted (clock or time zone moved back).
 */

import { CONCEPTS, type Concept, type PuzzleId } from './puzzles.js';

export const PROGRESS_STORAGE_KEY = 'spatialql.progress.v1';
const PROGRESS_VERSION = 1;

export type SolvedRecord = {
  /** The day (daily.ts) it was first solved. */
  firstSolvedDay: number;
  /** Hint tiers shown on that first solve (0-3). */
  hintsUsed: number;
};

export type DailyProgress = {
  lastSolvedDay: number | null;
  streak: number;
  best: number;
};

export type Progress = {
  version: typeof PROGRESS_VERSION;
  solved: Partial<Record<PuzzleId, SolvedRecord>>;
  daily: DailyProgress;
  seenConcepts: Concept[];
  /** The puzzle to resume. */
  lastPuzzle: PuzzleId | null;
};

export function emptyProgress(): Progress {
  return {
    version: PROGRESS_VERSION,
    solved: {},
    daily: { lastSolvedDay: null, streak: 0, best: 0 },
    seenConcepts: [],
    lastPuzzle: null,
  };
}

// --- Streak -----------------------------------------------------------------

export function recordDailySolve(daily: DailyProgress, day: number): DailyProgress {
  const last = daily.lastSolvedDay;
  if (last !== null && day <= last) {
    return daily;
  }
  const streak = last !== null && day === last + 1 ? daily.streak + 1 : 1;
  return { lastSolvedDay: day, streak, best: Math.max(daily.best, streak) };
}

/**
 * The streak to show today: still alive if the last daily was solved today
 * or yesterday (or "later" than today, after a clock change), otherwise 0.
 */
export function currentStreak(daily: DailyProgress, today: number): number {
  if (daily.lastSolvedDay === null) {
    return 0;
  }
  return today <= daily.lastSolvedDay + 1 ? daily.streak : 0;
}

export function dailySolvedToday(daily: DailyProgress, today: number): boolean {
  return daily.lastSolvedDay !== null && daily.lastSolvedDay >= today;
}

// --- Solving and unlocking ----------------------------------------------------

/** Records a solve; the first solve's record is kept. */
export function markSolved(progress: Progress, id: PuzzleId, day: number, hintsUsed: number): Progress {
  if (progress.solved[id]) {
    return progress;
  }
  return { ...progress, solved: { ...progress.solved, [id]: { firstSolvedDay: day, hintsUsed } } };
}

export function markDailySolved(progress: Progress, day: number): Progress {
  const daily = recordDailySolve(progress.daily, day);
  return daily === progress.daily ? progress : { ...progress, daily };
}

export function markConceptSeen(progress: Progress, concept: Concept): Progress {
  return progress.seenConcepts.includes(concept)
    ? progress
    : { ...progress, seenConcepts: [...progress.seenConcepts, concept] };
}

export function isSolved(progress: Progress, id: PuzzleId): boolean {
  return progress.solved[id] !== undefined;
}

/**
 * Strict order: a practice puzzle is unlocked when every puzzle before it is
 * solved. Solving a later puzzle as the daily records it, but unlocks
 * nothing out of order.
 */
export function isUnlocked(progress: Progress, id: PuzzleId, order: readonly PuzzleId[]): boolean {
  const index = order.indexOf(id);
  if (index < 0) {
    return false;
  }
  for (let i = 0; i < index; i++) {
    if (!isSolved(progress, order[i])) {
      return false;
    }
  }
  return true;
}

/** The first unsolved practice puzzle, or null when all are solved. */
export function nextPracticePuzzle(progress: Progress, order: readonly PuzzleId[]): PuzzleId | null {
  return order.find((id) => !isSolved(progress, id)) ?? null;
}

/** Practice puzzles solved in order (the "n/20" shown). */
export function practiceSolvedCount(progress: Progress, order: readonly PuzzleId[]): number {
  return order.filter((id) => isSolved(progress, id)).length;
}

// --- Parsing and storage ------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDayNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Reads stored progress, keeping only what's valid: unknown puzzle ids,
 * malformed records and unknown concepts are dropped, and anything
 * unreadable (or another version) gives empty progress.
 */
export function parseProgress(raw: string | null, isKnownPuzzle: (id: string) => id is PuzzleId): Progress {
  const progress = emptyProgress();
  if (raw === null || raw === '') {
    return progress;
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return progress;
  }
  if (!isRecord(data) || data.version !== PROGRESS_VERSION) {
    return progress;
  }

  if (isRecord(data.solved)) {
    for (const [id, record] of Object.entries(data.solved)) {
      if (
        isKnownPuzzle(id) &&
        isRecord(record) &&
        isDayNumber(record.firstSolvedDay) &&
        isCount(record.hintsUsed) &&
        record.hintsUsed <= 3
      ) {
        progress.solved[id] = { firstSolvedDay: record.firstSolvedDay, hintsUsed: record.hintsUsed };
      }
    }
  }

  if (isRecord(data.daily)) {
    const { lastSolvedDay, streak, best } = data.daily;
    if ((lastSolvedDay === null || isDayNumber(lastSolvedDay)) && isCount(streak) && isCount(best)) {
      progress.daily =
        lastSolvedDay === null
          ? { lastSolvedDay: null, streak: 0, best }
          : { lastSolvedDay, streak, best: Math.max(best, streak) };
    }
  }

  if (Array.isArray(data.seenConcepts)) {
    for (const concept of data.seenConcepts) {
      if ((CONCEPTS as readonly unknown[]).includes(concept) && !progress.seenConcepts.includes(concept as Concept)) {
        progress.seenConcepts.push(concept as Concept);
      }
    }
  }

  if (typeof data.lastPuzzle === 'string' && isKnownPuzzle(data.lastPuzzle)) {
    progress.lastPuzzle = data.lastPuzzle;
  }
  return progress;
}

export function serializeProgress(progress: Progress): string {
  return JSON.stringify(progress);
}

/** The subset of `Storage` used here. */
export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/** Never throws: missing or failing storage gives empty progress. */
export function loadProgress(
  storage: KeyValueStorage | null,
  isKnownPuzzle: (id: string) => id is PuzzleId,
): Progress {
  if (!storage) {
    return emptyProgress();
  }
  try {
    return parseProgress(storage.getItem(PROGRESS_STORAGE_KEY), isKnownPuzzle);
  } catch {
    return emptyProgress();
  }
}

/** Never throws; returns whether the save went through. */
export function saveProgress(storage: KeyValueStorage | null, progress: Progress): boolean {
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(PROGRESS_STORAGE_KEY, serializeProgress(progress));
    return true;
  } catch {
    return false;
  }
}
