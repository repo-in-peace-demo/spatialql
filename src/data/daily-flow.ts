/**
 * The daily puzzle's place in a session, as pure functions: which puzzle a
 * session starts on, where Next goes, which concept intros a daily needs
 * when it's ahead of practice, and the welcome screen's lines.
 *
 * - The daily is offered once practice 1-3 are solved (a first launch is
 *   the tutorial, never day one's daily, which could be a trap puzzle).
 * - A session starts on today's daily while it's unsolved, else resumes
 *   practice. Prev and Next move through the puzzle numbers 1-20 (the daily
 *   is one of them); the welcome screen's picker can jump to any unlocked
 *   puzzle, or to today's daily.
 * - The daily may be any of the 20, locked or not: it's the one puzzle that
 *   ignores the unlock order. Solving it records it as solved and extends
 *   the streak, but unlocks nothing out of order (`isUnlocked`).
 * - `today` is fixed when the page loads, so a solve after midnight counts
 *   for the day it was loaded.
 */

import { COMPLETE, WELCOME } from './copy.js';
import { dailyPuzzleId } from './daily.js';
import { resumePuzzle } from './desk-session.js';
import {
  currentStreak,
  dailyCompletedToday,
  dailyRevealedToday,
  dailySolvedToday,
  isRevealed,
  isSolved,
  isUnlocked,
  nextPracticePuzzle,
  practiceRevealedCount,
  practiceSolvedCount,
  type Progress,
} from './progress.js';
import { getPuzzle, type Concept, type Puzzle, type PuzzleId } from './puzzles.js';

/** The daily is offered once this many practice puzzles (the first ones) are solved. */
export const DAILY_AFTER_PRACTICE = 3;

/** A daily ahead of practice shows at most this many concept intros (the card's message block fits a lead-in plus two). */
export const MAX_AHEAD_INTROS = 2;

/**
 * Concepts a puzzle leans on besides its own: the missing-parent puzzles
 * ("keep the child table still, choose LEFT") use the direction idea.
 */
export const CONCEPT_PREREQUISITES: Readonly<Partial<Record<Concept, readonly Concept[]>>> = {
  nullfk: ['direction'],
};

/** Whether the daily is offered yet: the first DAILY_AFTER_PRACTICE practice puzzles are solved. */
export function dailyOffered(progress: Progress, order: readonly PuzzleId[]): boolean {
  return order.slice(0, DAILY_AFTER_PRACTICE).every((id) => isSolved(progress, id));
}

/** Whether `id` is played as today's daily (title, streak): it's today's puzzle, and the daily is offered. */
export function isTodaysDaily(progress: Progress, id: PuzzleId, today: number, order: readonly PuzzleId[]): boolean {
  return dailyOffered(progress, order) && id === dailyPuzzleId(today);
}

export type StartChoice = { puzzleId: PuzzleId; reason: 'daily' | 'practice' };

/**
 * The puzzle a session starts on: today's daily while it's offered and not
 * done (solved, or completed after "Show answer"), else practice.
 */
export function startPuzzle(progress: Progress, today: number, order: readonly PuzzleId[]): StartChoice {
  if (dailyOffered(progress, order) && !dailyCompletedToday(progress.daily, today)) {
    return { puzzleId: dailyPuzzleId(today), reason: 'daily' };
  }
  return { puzzleId: resumePuzzle(progress, order), reason: 'practice' };
}

/**
 * Where Next goes from `current` (once it's done): the next puzzle number,
 * if it's unlocked (strict order), else null. Prev and Next always move
 * through the numbers 1-20; today's daily is just one of them (with its
 * "Today's puzzle" title), reached at session start or from the picker.
 */
export function nextPuzzle(progress: Progress, current: PuzzleId, order: readonly PuzzleId[]): PuzzleId | null {
  const following = order[order.indexOf(current) + 1];
  if (following === undefined) {
    // The last puzzle (finished as the daily, say, ahead of practice): on to the lowest open one.
    const open = nextPracticePuzzle(progress, order);
    return open !== null && open !== current ? open : null;
  }
  return isUnlocked(progress, following, order) ? following : null;
}

/** Every puzzle done: solved, or completed after "Show answer". */
export function allPuzzlesDone(progress: Progress, order: readonly PuzzleId[]): boolean {
  return order.every((id) => isSolved(progress, id));
}

/** How the puzzles were done: solved without the answer, and completed after "Show answer". */
export function doneCounts(progress: Progress, order: readonly PuzzleId[]): { solved: number; revealed: number } {
  const revealed = order.filter((id) => isRevealed(progress, id)).length;
  const done = order.filter((id) => isSolved(progress, id)).length;
  return { solved: done - revealed, revealed };
}

/**
 * Next on the last puzzle once every puzzle is done: "Finish" (shows the
 * completion state on the card), then "Today" while today's daily is still
 * open (it loads it), else "Done" (ends the XR session). Null anywhere else:
 * Next as usual.
 */
export type FinishAction = 'finish' | 'today' | 'done';

export function finishAction(
  progress: Progress,
  current: PuzzleId,
  order: readonly PuzzleId[],
  today: number,
  completionShowing: boolean,
): FinishAction | null {
  if (current !== order[order.length - 1] || !allPuzzlesDone(progress, order)) {
    return null;
  }
  if (!completionShowing) {
    return 'finish';
  }
  return dailyCompletedToday(progress.daily, today) ? 'done' : 'today';
}

/** The completion state's lines: the summary, what's next, and the streak (null at 0). */
export function completionLines(
  progress: Progress,
  order: readonly PuzzleId[],
  today: number,
): { headline: string; summary: string; next: string; streak: string | null } {
  const { solved, revealed } = doneCounts(progress, order);
  const streak = currentStreak(progress.daily, today);
  return {
    headline: COMPLETE.headline(order.length),
    summary: revealed === 0 ? COMPLETE.allSolved : COMPLETE.summary(solved, revealed),
    next: dailyCompletedToday(progress.daily, today) ? COMPLETE.comeBackTomorrow : COMPLETE.dailyOpen,
    streak: streak > 0 ? WELCOME.streak(streak) : null,
  };
}

/**
 * Where Prev goes from `current`: the previous puzzle number, or null on
 * puzzle 1. Only a daily ahead of practice can have a locked number below
 * it; then Prev goes to the highest unlocked puzzle below. Going back
 * changes no progress; see `advanceResume`.
 */
export function prevPuzzle(progress: Progress, current: PuzzleId, order: readonly PuzzleId[]): PuzzleId | null {
  for (let index = order.indexOf(current) - 1; index >= 0; index--) {
    if (isUnlocked(progress, order[index], order)) {
      return order[index];
    }
  }
  return null;
}

export type PuzzleTileStatus = 'solved' | 'revealed' | 'open' | 'locked';

/** One tile of the welcome screen's puzzle picker. */
export type PuzzleTile = {
  id: PuzzleId;
  /** Its puzzle number (1-based). */
  number: number;
  status: PuzzleTileStatus;
  /** Today's daily (marked, and selectable even ahead of practice once the daily is offered). */
  today: boolean;
  selectable: boolean;
};

/** The picker's tiles, in puzzle order: status, today's daily, and whether a tap selects it. */
export function puzzleTiles(progress: Progress, today: number, order: readonly PuzzleId[]): PuzzleTile[] {
  const daily = dailyOffered(progress, order) ? dailyPuzzleId(today) : null;
  return order.map((id, index) => {
    const unlocked = isUnlocked(progress, id, order);
    const status: PuzzleTileStatus = isRevealed(progress, id)
      ? 'revealed'
      : isSolved(progress, id)
        ? 'solved'
        : unlocked
          ? 'open'
          : 'locked';
    return { id, number: index + 1, status, today: id === daily, selectable: unlocked || id === daily };
  });
}

/**
 * The resume point after a practice puzzle loads: it moves forward only,
 * so replaying an earlier puzzle (Prev) never sends the next session back
 * to it.
 */
export function advanceResume(progress: Progress, id: PuzzleId, order: readonly PuzzleId[]): Progress {
  const last = progress.lastPuzzle;
  if (last && order.indexOf(id) < order.indexOf(last)) {
    return progress;
  }
  return last === id ? progress : { ...progress, lastPuzzle: id };
}

/**
 * For a daily ahead of practice: the concepts it uses that practice hasn't
 * introduced yet (its own first, then what it leans on), at most
 * MAX_AHEAD_INTROS. Empty when nothing is new.
 */
export function aheadConcepts(progress: Progress, puzzle: Puzzle): Concept[] {
  const wanted = [puzzle.concept, ...(CONCEPT_PREREQUISITES[puzzle.concept] ?? [])];
  const unseen: Concept[] = [];
  for (const concept of wanted) {
    if (!progress.seenConcepts.includes(concept) && !unseen.includes(concept)) {
      unseen.push(concept);
    }
  }
  return unseen.slice(0, MAX_AHEAD_INTROS);
}

export type WelcomeLines = {
  /** Today's puzzle: open (its dataset), solved, or "start with practice" before it's offered. */
  daily: string;
  /** The streak, with a nudge while today's daily is open; null while there's no streak. */
  streak: string | null;
  practice: string;
  /** Shown only when progress can't be saved. */
  save: string | null;
  /** The streak's days now (the flame is grey at 0). */
  streakDays: number;
  /** The calendar: this month, then the earlier months the history covers (calendarMonths). */
  months: CalendarMonth[];
};

/**
 * One calendar square: a day of the month and its daily (solved, with the
 * answer or skipped, missed), a day before the history starts or today with
 * nothing yet (plain), a day still to come this month (future), or a cell
 * outside the month (blank, day null).
 */
export type CalendarCell = {
  day: number | null;
  state: 'solved' | 'revealed' | 'missed' | 'plain' | 'future' | 'blank';
  today: boolean;
};

/** One month of the welcome calendar: its year, month (1-12) and cells in whole Monday-first weeks. */
export type CalendarMonth = { year: number; month: number; cells: CalendarCell[] };

/** Monday = 0 ... Sunday = 6, for a day number (days count UTC calendar dates: see daily.ts). */
export function weekdayIndex(day: number): number {
  return (new Date(day * 86_400_000).getUTCDay() + 6) % 7;
}

/** The day number of `year`-`month`-`date` (month 1-12). */
function dayOf(year: number, month: number, date: number): number {
  return Date.UTC(year, month - 1, date) / 86_400_000;
}

/** The year and month (1-12) a day number falls in. */
export function monthOfDay(day: number): { year: number; month: number } {
  const date = new Date(day * 86_400_000);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

/** The first day with a recorded daily, or null with no history. */
function firstHistoryDay(progress: Progress): number | null {
  let first: number | null = null;
  for (const key of Object.keys(progress.dailyHistory)) {
    const day = Number(key);
    if (first === null || day < first) {
      first = day;
    }
  }
  return first;
}

/**
 * A wall calendar for `year`-`month` (1-12): Monday-first weeks (4 to 6),
 * the cells before the 1st and after the last day blank. Days before the
 * history starts (or with no history) are plain, not missed; today is
 * ringed, plain until its daily is done; later days are future.
 */
export function monthCells(progress: Progress, year: number, month: number, today: number): CalendarCell[] {
  const first = dayOf(year, month, 1);
  const length = dayOf(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1) - first;
  const offset = weekdayIndex(first);
  const weeks = Math.ceil((offset + length) / 7);
  const historyStart = firstHistoryDay(progress);
  return Array.from({ length: weeks * 7 }, (_, i): CalendarCell => {
    const date = i - offset;
    if (date < 0 || date >= length) {
      return { day: null, state: 'blank', today: false };
    }
    const day = first + date;
    const outcome = progress.dailyHistory[day];
    const state: CalendarCell['state'] =
      day > today
        ? 'future'
        : (outcome ?? (day === today || historyStart === null || day < historyStart ? 'plain' : 'missed'));
    return { day, state, today: day === today };
  });
}

/**
 * The months the welcome calendar can show, this month first: then each
 * earlier month while it has a recorded daily (the history keeps
 * DAILY_HISTORY_DAYS days, so one or two back at most).
 */
export function calendarMonths(progress: Progress, today: number): CalendarMonth[] {
  const months: CalendarMonth[] = [];
  let { year, month } = monthOfDay(today);
  for (;;) {
    months.push({ year, month, cells: monthCells(progress, year, month, today) });
    [year, month] = month === 1 ? [year - 1, 12] : [year, month - 1];
    const first = dayOf(year, month, 1);
    const end = dayOf(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1);
    const covered = Object.keys(progress.dailyHistory).some((key) => Number(key) >= first && Number(key) < end);
    if (!covered) {
      return months;
    }
  }
}

/** The welcome screen's progress lines (challenge mode). */
export function welcomeLines(
  progress: Progress,
  today: number,
  order: readonly PuzzleId[],
  saveWorks: boolean,
): WelcomeLines {
  const solvedToday = dailySolvedToday(progress.daily, today);
  const doneToday = dailyCompletedToday(progress.daily, today);
  const daily = !dailyOffered(progress, order)
    ? WELCOME.practiceFirst
    : solvedToday
      ? allPuzzlesDone(progress, order)
        ? WELCOME.dailyDoneAllDone
        : WELCOME.dailyDone
      : dailyRevealedToday(progress.daily, today)
        ? WELCOME.dailyRevealed
        : WELCOME.dailyOpen(getPuzzle(dailyPuzzleId(today)).datasetId);
  const streak = currentStreak(progress.daily, today);
  const completed = practiceSolvedCount(progress, order);
  const revealed = practiceRevealedCount(progress, order);
  return {
    daily,
    // Done today (solved, or revealed on a bridged day): nothing to nudge.
    streak:
      streak === 0
        ? dailyOffered(progress, order)
          ? doneToday
            ? null
            : WELCOME.streakStart
          : WELCOME.streakAfterPractice
        : doneToday
          ? WELCOME.streak(streak)
          : `${WELCOME.streak(streak)}. ${WELCOME.streakAtRisk}`,
    streakDays: streak,
    months: calendarMonths(progress, today),
    practice: allPuzzlesDone(progress, order)
      ? revealed > 0
        ? WELCOME.allDoneWithAnswers(order.length, revealed)
        : WELCOME.allDone(order.length)
      : revealed > 0
        ? WELCOME.practiceProgressWithAnswers(completed, order.length, revealed)
        : WELCOME.practiceProgress(completed, order.length),
    save: saveWorks ? null : WELCOME.saveUnavailable,
  };
}
