/**
 * The daily puzzle's place in a session, as pure functions: which puzzle a
 * session starts on, where Next goes, which concept intros a daily needs
 * when it's ahead of practice, and the welcome screen's lines.
 *
 * - The daily is offered once practice 1-3 are solved (a first launch is
 *   the tutorial, never day one's daily, which could be a trap puzzle).
 * - A session starts on today's daily while it's unsolved, else resumes
 *   practice.
 * - The daily may be any of the 20, locked or not: it's the one puzzle that
 *   ignores the unlock order. Solving it records it as solved and extends
 *   the streak, but unlocks nothing out of order (`isUnlocked`).
 * - `today` is fixed when the page loads, so a solve after midnight counts
 *   for the day it was loaded.
 */

import { WELCOME } from './copy.js';
import { dailyPuzzleId } from './daily.js';
import { resumePuzzle } from './desk-session.js';
import {
  currentStreak,
  dailyCompletedToday,
  dailyRevealedToday,
  dailySolvedToday,
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
 * Where Next goes from `current` (once it's solved), or null if nowhere yet:
 * - to today's daily, if it's offered, unsolved and not this puzzle;
 * - from the daily, back to practice (the first unsolved puzzle);
 * - otherwise to the next practice puzzle, if it's unlocked.
 */
export function nextPuzzle(progress: Progress, current: PuzzleId, today: number, order: readonly PuzzleId[]): PuzzleId | null {
  const daily = dailyPuzzleId(today);
  const offered = dailyOffered(progress, order);
  if (offered && !dailyCompletedToday(progress.daily, today) && daily !== current) {
    return daily;
  }
  if (offered && current === daily) {
    const resume = nextPracticePuzzle(progress, order);
    if (resume && resume !== current) {
      return resume;
    }
  }
  const following = order[order.indexOf(current) + 1];
  return following !== undefined && isUnlocked(progress, following, order) ? following : null;
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
};

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
      ? WELCOME.dailyDone
      : dailyRevealedToday(progress.daily, today)
        ? WELCOME.dailyRevealed
        : WELCOME.dailyOpen(getPuzzle(dailyPuzzleId(today)).datasetId);
  const streak = currentStreak(progress.daily, today);
  const completed = practiceSolvedCount(progress, order);
  const revealed = practiceRevealedCount(progress, order);
  return {
    daily,
    // Done today (solved, or revealed on a bridged day): nothing to nudge.
    streak: streak === 0 ? null : doneToday ? WELCOME.streak(streak) : `${WELCOME.streak(streak)}. ${WELCOME.streakAtRisk}`,
    practice:
      revealed > 0
        ? WELCOME.practiceProgressWithAnswers(completed, order.length, revealed)
        : WELCOME.practiceProgress(completed, order.length),
    save: saveWorks ? null : WELCOME.saveUnavailable,
  };
}
