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
 * Streak rules: only solving the daily counts (hints allowed, but not the
 * full answer). Solving on the next calendar day extends the streak; missing
 * a day starts again at 1. Solving again on a day already counted changes
 * nothing, and so does a day earlier than the last one counted (clock or
 * time zone moved back).
 *
 * Completing a daily after "Show answer" ("revealed") doesn't extend the
 * streak, but it bridges that one day: the streak neither grows nor breaks.
 * Only one day in a row: two revealed dailies in a row break it (otherwise
 * revealing every day would keep a streak forever without solving).
 *
 * A practice puzzle completed after "Show answer" is recorded as `revealed`.
 * It still unlocks the next one (hints never block progress), and a later
 * solve without the answer upgrades it to solved.
 */

import { CONCEPTS, type Concept, type PuzzleId } from './puzzles.js';

export const PROGRESS_STORAGE_KEY = 'spatialql.progress.v1';
const PROGRESS_VERSION = 1;

export type SolvedRecord = {
  /** The day (daily.ts) it was first solved. */
  firstSolvedDay: number;
  /** Hint tiers shown on that first solve (0-3). */
  hintsUsed: number;
  /** Completed after "Show answer", not solved (absent = solved; old saves have no field). */
  revealed?: true;
};

export type DailyProgress = {
  lastSolvedDay: number | null;
  streak: number;
  best: number;
  /** The last day the daily was completed after "Show answer" (absent if not since the last solve). */
  revealedDay?: number;
  /** A revealed day that bridges the streak: always the day after `lastSolvedDay`. */
  bridgedDay?: number;
};

export type Progress = {
  version: typeof PROGRESS_VERSION;
  solved: Partial<Record<PuzzleId, SolvedRecord>>;
  daily: DailyProgress;
  seenConcepts: Concept[];
  /** The puzzle to resume. */
  lastPuzzle: PuzzleId | null;
  /** The card has explained the streak once (on the first daily with a free message slot); Reset clears it. */
  streakExplained?: true;
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

/** The latest day the daily was completed at all (solved or revealed), or null. */
function lastCompletedDay(daily: DailyProgress): number | null {
  const revealed = daily.revealedDay ?? null;
  if (daily.lastSolvedDay === null) {
    return revealed;
  }
  return revealed === null ? daily.lastSolvedDay : Math.max(daily.lastSolvedDay, revealed);
}

export function recordDailySolve(daily: DailyProgress, day: number): DailyProgress {
  const last = daily.lastSolvedDay;
  const completed = lastCompletedDay(daily);
  if (completed !== null && day <= completed) {
    return daily;
  }
  // The next day, or the day after a bridged (revealed) one.
  const continues = last !== null && (day === last + 1 || (daily.bridgedDay === last + 1 && day === last + 2));
  const streak = continues ? daily.streak + 1 : 1;
  return { lastSolvedDay: day, streak, best: Math.max(daily.best, streak) };
}

/**
 * A daily completed after "Show answer": no streak credit, but the day right
 * after the last solve bridges the streak (once in a row).
 */
export function recordDailyReveal(daily: DailyProgress, day: number): DailyProgress {
  const completed = lastCompletedDay(daily);
  if (completed !== null && day <= completed) {
    return daily;
  }
  const bridges = daily.lastSolvedDay !== null && day === daily.lastSolvedDay + 1;
  return {
    lastSolvedDay: daily.lastSolvedDay,
    streak: daily.streak,
    best: daily.best,
    revealedDay: day,
    ...(bridges ? { bridgedDay: day } : {}),
  };
}

/**
 * The streak to show today: still alive if the last daily was solved (or
 * bridged) today or yesterday (or "later" than today, after a clock change),
 * otherwise 0. A daily revealed today that doesn't bridge has broken it:
 * there's no solving today's daily any more.
 */
export function currentStreak(daily: DailyProgress, today: number): number {
  if (daily.lastSolvedDay === null) {
    return 0;
  }
  if (daily.revealedDay === today && daily.bridgedDay !== today) {
    return 0;
  }
  const anchor = daily.bridgedDay ?? daily.lastSolvedDay;
  return today <= anchor + 1 ? daily.streak : 0;
}

export function dailySolvedToday(daily: DailyProgress, today: number): boolean {
  return daily.lastSolvedDay !== null && daily.lastSolvedDay >= today;
}

/** Today's daily is done: solved, or completed after "Show answer". It isn't offered again today. */
export function dailyCompletedToday(daily: DailyProgress, today: number): boolean {
  const completed = lastCompletedDay(daily);
  return completed !== null && completed >= today;
}

/** Today's daily was completed after "Show answer" (and not solved). */
export function dailyRevealedToday(daily: DailyProgress, today: number): boolean {
  return !dailySolvedToday(daily, today) && (daily.revealedDay ?? -Infinity) >= today;
}

// --- Solving and unlocking ----------------------------------------------------

/**
 * Records a completion: a solve, or (`revealed`) a completion after "Show
 * answer". The first record is kept, except that a solve upgrades a revealed
 * record (keeping its first day).
 */
export function markSolved(
  progress: Progress,
  id: PuzzleId,
  day: number,
  hintsUsed: number,
  revealed = false,
): Progress {
  const existing = progress.solved[id];
  if (existing && !(existing.revealed && !revealed)) {
    return progress;
  }
  const record: SolvedRecord = revealed
    ? { firstSolvedDay: day, hintsUsed, revealed: true }
    : { firstSolvedDay: existing?.firstSolvedDay ?? day, hintsUsed };
  return { ...progress, solved: { ...progress.solved, [id]: record } };
}

export function markDailySolved(progress: Progress, day: number): Progress {
  const daily = recordDailySolve(progress.daily, day);
  return daily === progress.daily ? progress : { ...progress, daily };
}

/** Today's daily completed after "Show answer": no streak credit (see `recordDailyReveal`). */
export function markDailyRevealed(progress: Progress, day: number): Progress {
  const daily = recordDailyReveal(progress.daily, day);
  return daily === progress.daily ? progress : { ...progress, daily };
}

/**
 * Skip (Next after "Show answer", before the moves): recorded like a
 * completion after the answer -- revealed, so it unlocks the next puzzle --
 * and, for today's daily, no streak credit (it only bridges one day).
 */
export function recordSkip(progress: Progress, id: PuzzleId, day: number, hintsUsed: number, isDaily: boolean): Progress {
  const skipped = markSolved(progress, id, day, hintsUsed, true);
  return isDaily ? markDailyRevealed(skipped, day) : skipped;
}

/** Completed after "Show answer" (and not solved since). */
export function isRevealed(progress: Progress, id: PuzzleId): boolean {
  return progress.solved[id]?.revealed === true;
}

export function markConceptSeen(progress: Progress, concept: Concept): Progress {
  return progress.seenConcepts.includes(concept)
    ? progress
    : { ...progress, seenConcepts: [...progress.seenConcepts, concept] };
}

/** Completed: solved, or completed after "Show answer" (both unlock the next puzzle). */
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

/** Practice puzzles completed (the "n/20" shown), revealed ones included. */
export function practiceSolvedCount(progress: Progress, order: readonly PuzzleId[]): number {
  return order.filter((id) => isSolved(progress, id)).length;
}

/** Of those, how many were completed after "Show answer". */
export function practiceRevealedCount(progress: Progress, order: readonly PuzzleId[]): number {
  return order.filter((id) => isRevealed(progress, id)).length;
}

/**
 * Drops progress that the current build can't have produced: solves of
 * puzzles outside `playable` (e.g. beyond phase 2's range), and, with
 * `inOrderOnly` (no daily yet, so every solve came from strict practice
 * order), solves after the first unsolved puzzle. A resume point outside
 * `playable` is dropped too. Returns the same object when nothing changes.
 */
export function sanitizeProgress(
  progress: Progress,
  playable: readonly PuzzleId[],
  order: readonly PuzzleId[],
  inOrderOnly: boolean,
): Progress {
  const solved: Progress['solved'] = {};
  let changed = false;
  let gap = false;
  for (const id of order) {
    const record = progress.solved[id];
    if (!record) {
      gap = true;
      continue;
    }
    if (!playable.includes(id) || (inOrderOnly && gap)) {
      changed = true;
      continue;
    }
    solved[id] = record;
  }
  for (const id of Object.keys(progress.solved)) {
    if (!order.includes(id as PuzzleId)) {
      changed = true;
    }
  }
  const lastPuzzle = progress.lastPuzzle && playable.includes(progress.lastPuzzle) ? progress.lastPuzzle : null;
  if (lastPuzzle !== progress.lastPuzzle) {
    changed = true;
  }
  return changed ? { ...progress, solved, lastPuzzle } : progress;
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
        // Old saves have no `revealed`: they load as solved.
        progress.solved[id] =
          record.revealed === true
            ? { firstSolvedDay: record.firstSolvedDay, hintsUsed: record.hintsUsed, revealed: true }
            : { firstSolvedDay: record.firstSolvedDay, hintsUsed: record.hintsUsed };
      }
    }
  }

  if (isRecord(data.daily)) {
    const { lastSolvedDay, streak, best, revealedDay, bridgedDay } = data.daily;
    if ((lastSolvedDay === null || isDayNumber(lastSolvedDay)) && isCount(streak) && isCount(best)) {
      progress.daily =
        lastSolvedDay === null
          ? { lastSolvedDay: null, streak: 0, best }
          : { lastSolvedDay, streak, best: Math.max(best, streak) };
      // A revealed day only after the last solve; a bridge only the day right after it.
      if (isDayNumber(revealedDay) && (lastSolvedDay === null || revealedDay > lastSolvedDay)) {
        progress.daily.revealedDay = revealedDay;
        if (lastSolvedDay !== null && bridgedDay === lastSolvedDay + 1 && revealedDay === bridgedDay) {
          progress.daily.bridgedDay = bridgedDay;
        }
      }
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
  if (data.streakExplained === true) {
    progress.streakExplained = true;
  }
  return progress;
}

/** The streak has been explained (shown once; `emptyProgress`, i.e. Reset, forgets it). */
export function markStreakExplained(progress: Progress): Progress {
  return progress.streakExplained ? progress : { ...progress, streakExplained: true };
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
