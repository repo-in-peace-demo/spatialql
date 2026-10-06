import { describe, expect, it } from 'vitest';
import { CARD, WELCOME } from './copy.js';
import { DAILY_EPOCH_DAY, dailyPuzzleId } from './daily.js';
import { nextPuzzle, startPuzzle, welcomeLines } from './daily-flow.js';
import {
  currentStreak,
  dailyCompletedToday,
  dailyRevealedToday,
  emptyProgress,
  isRevealed,
  isSolved,
  isUnlocked,
  markDailyRevealed,
  markDailySolved,
  markSolved,
  parseProgress,
  practiceRevealedCount,
  practiceSolvedCount,
  recordDailyReveal,
  recordDailySolve,
  recordSkip,
  serializeProgress,
  type DailyProgress,
} from './progress.js';
import { answerRevealed, sessionTransition, startSession } from './puzzle-session.js';
import { isPuzzleId, PRACTICE_ORDER } from './puzzles.js';
import { cardMessageLines } from '../card-metrics.js';

const D = DAILY_EPOCH_DAY + 10;
const fresh: DailyProgress = { lastSolvedDay: null, streak: 0, best: 0 };
const solvedThrough = (days: number[]) => days.reduce(recordDailySolve, fresh);

describe('practice: completed after "Show answer"', () => {
  it('is recorded as revealed, still unlocks the next puzzle, and counts separately', () => {
    const progress = markSolved(emptyProgress(), PRACTICE_ORDER[0], D, 3, true);
    expect(progress.solved[PRACTICE_ORDER[0]]).toEqual({ firstSolvedDay: D, hintsUsed: 3, revealed: true });
    expect(isSolved(progress, PRACTICE_ORDER[0])).toBe(true);
    expect(isRevealed(progress, PRACTICE_ORDER[0])).toBe(true);
    expect(isUnlocked(progress, PRACTICE_ORDER[1], PRACTICE_ORDER)).toBe(true);
    expect(practiceSolvedCount(progress, PRACTICE_ORDER)).toBe(1);
    expect(practiceRevealedCount(progress, PRACTICE_ORDER)).toBe(1);
  });

  it('a later solve without the answer upgrades it (keeping the first day); a reveal never downgrades a solve', () => {
    const revealed = markSolved(emptyProgress(), PRACTICE_ORDER[0], D, 3, true);
    const upgraded = markSolved(revealed, PRACTICE_ORDER[0], D + 2, 1);
    expect(upgraded.solved[PRACTICE_ORDER[0]]).toEqual({ firstSolvedDay: D, hintsUsed: 1 });
    expect(markSolved(upgraded, PRACTICE_ORDER[0], D + 3, 3, true)).toBe(upgraded);
  });

  it('old saves without the field load as solved; the field round-trips', () => {
    const old = JSON.stringify({ version: 1, solved: { 'shop-match': { firstSolvedDay: D, hintsUsed: 3 } } });
    expect(isRevealed(parseProgress(old, isPuzzleId), 'shop-match')).toBe(false);
    const saved = serializeProgress(markSolved(emptyProgress(), 'shop-match', D, 3, true));
    expect(isRevealed(parseProgress(saved, isPuzzleId), 'shop-match')).toBe(true);
  });
});

describe('daily streak: "Show answer" bridges one day', () => {
  it("doesn't extend the streak, but doesn't break it: the next solve continues it", () => {
    const two = solvedThrough([D, D + 1]);
    const bridged = recordDailyReveal(two, D + 2);
    expect(bridged.streak).toBe(2);
    expect(currentStreak(bridged, D + 2)).toBe(2);
    expect(currentStreak(bridged, D + 3)).toBe(2);
    expect(recordDailySolve(bridged, D + 3)).toEqual({ lastSolvedDay: D + 3, streak: 3, best: 3 });
  });

  it('two revealed days in a row break it', () => {
    const two = solvedThrough([D, D + 1]);
    const twice = recordDailyReveal(recordDailyReveal(two, D + 2), D + 3);
    expect(currentStreak(twice, D + 3)).toBe(0);
    expect(recordDailySolve(twice, D + 4).streak).toBe(1);
  });

  it('a reveal after a missed day bridges nothing (the streak is already gone)', () => {
    const one = solvedThrough([D]);
    const late = recordDailyReveal(one, D + 2);
    expect(late.bridgedDay).toBeUndefined();
    expect(currentStreak(late, D + 2)).toBe(0);
  });

  it('a revealed day is done: no second completion that day, and the clock moving back changes nothing', () => {
    const revealed = recordDailyReveal(solvedThrough([D]), D + 1);
    expect(recordDailySolve(revealed, D + 1)).toBe(revealed);
    expect(recordDailyReveal(revealed, D)).toBe(revealed);
    expect(dailyCompletedToday(revealed, D + 1)).toBe(true);
    expect(dailyRevealedToday(revealed, D + 1)).toBe(true);
    expect(dailyRevealedToday(revealed, D + 2)).toBe(false);
  });

  it('round-trips through storage, and drops an impossible bridge', () => {
    const progress = markDailyRevealed(markDailySolved(emptyProgress(), D), D + 1);
    expect(parseProgress(serializeProgress(progress), isPuzzleId).daily).toEqual(progress.daily);
    const bad = JSON.stringify({ version: 1, daily: { lastSolvedDay: D, streak: 1, best: 1, revealedDay: D + 3, bridgedDay: D + 3 } });
    expect(parseProgress(bad, isPuzzleId).daily.bridgedDay).toBeUndefined();
  });
});

describe('the daily flow after "Show answer"', () => {
  const firstThreeIds = PRACTICE_ORDER.slice(0, 3);
  const firstThree = firstThreeIds.reduce((progress, id) => markSolved(progress, id, D - 5, 0), emptyProgress());
  /** A day whose daily isn't one of practice 1-3 (those are already solved here). */
  const day = Array.from({ length: PRACTICE_ORDER.length }, (_, i) => DAILY_EPOCH_DAY + i).find(
    (d) => !firstThreeIds.includes(dailyPuzzleId(d)),
  ) as number;

  it('a revealed daily is done for today: the session resumes practice', () => {
    const progress = markDailyRevealed(markSolved(firstThree, dailyPuzzleId(day), day, 3, true), day);
    expect(startPuzzle(progress, day, PRACTICE_ORDER).reason).toBe('practice');
  });

  it('the welcome screen says so, and names puzzles completed with the answer', () => {
    const progress = markDailyRevealed(markSolved(firstThree, dailyPuzzleId(day), day, 3, true), day);
    const lines = welcomeLines(progress, day, PRACTICE_ORDER, true);
    expect(lines.daily).toBe(WELCOME.dailyRevealed);
    expect(lines.practice).toMatch(/\(1 with answer\)$/);
  });

  it('on a bridged day, the streak line has no "solve today" nudge', () => {
    const progress = markDailyRevealed(markDailySolved(firstThree, D - 1), D);
    expect(welcomeLines(progress, D, PRACTICE_ORDER, true).streak).toBe(WELCOME.streak(1));
  });
});

describe('Skip (Next after "Show answer", before the moves)', () => {
  it('records the puzzle as revealed and unlocks the next one; Next goes there', () => {
    const progress = recordSkip(emptyProgress(), PRACTICE_ORDER[0], D, 3, false);
    expect(isRevealed(progress, PRACTICE_ORDER[0])).toBe(true);
    expect(isUnlocked(progress, PRACTICE_ORDER[1], PRACTICE_ORDER)).toBe(true);
    expect(nextPuzzle(progress, PRACTICE_ORDER[0], D, PRACTICE_ORDER)).toBe(PRACTICE_ORDER[1]);
    expect(progress.daily).toEqual(emptyProgress().daily);
  });

  it("a skipped daily gets no streak credit, but bridges the day; it doesn't downgrade a solve", () => {
    const yesterday = markDailySolved(emptyProgress(), D - 1);
    const skipped = recordSkip(yesterday, 'shop-match', D, 3, true);
    expect(skipped.daily.streak).toBe(1);
    expect(currentStreak(skipped.daily, D)).toBe(1);
    expect(dailyCompletedToday(skipped.daily, D)).toBe(true);
    const solved = markSolved(emptyProgress(), 'shop-match', D, 0);
    expect(isRevealed(recordSkip(solved, 'shop-match', D, 3, false), 'shop-match')).toBe(false);
  });

  it('the instruction under the answer fits one card line (the answer and it together: card-fit.test.ts)', () => {
    expect(cardMessageLines(CARD.answerNext)).toBe(1);
  });
});

describe('the session', () => {
  it('counts as revealed once the third hint is shown, before and after the win', () => {
    let session = startSession('shop-match');
    for (let i = 0; i < 2; i++) {
      session = sessionTransition(session, { type: 'showHint' });
    }
    expect(answerRevealed(session)).toBe(false);
    session = sessionTransition(session, { type: 'showHint' });
    expect(answerRevealed(session)).toBe(true);
    expect(answerRevealed(sessionTransition(session, { type: 'evaluate', solved: true }))).toBe(true);
  });
});

describe('the new copy fits', () => {
  it('card lines and the welcome line', () => {
    expect(CARD.completedHeadline.length).toBeLessThanOrEqual(CARD.headline.length + 4);
    expect(CARD.streakNeedsSolve.length).toBeLessThanOrEqual(60);
    // The status lines now have their own card row (word-wrapped in card-fit.test.ts).
    expect(WELCOME.practiceProgressWithAnswers(20, 20, 20).length).toBeLessThanOrEqual(44);
    expect(WELCOME.dailyRevealed.length).toBeLessThanOrEqual(44);
  });
});
