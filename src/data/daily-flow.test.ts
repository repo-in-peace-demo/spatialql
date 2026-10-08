import { describe, expect, it } from 'vitest';
import { CARD_MESSAGE_LINES, cardHeadlineFontCm, cardMessageLines, cardMetrics, wrappedLines } from '../card-metrics.js';
import { HEADER_METRICS } from '../slab-metrics.js';
import { CARD, COMPLETE, CONCEPT_INTROS, WELCOME } from './copy.js';
import { DAILY_EPOCH_DAY, dailyPuzzleId } from './daily.js';
import {
  advanceResume,
  aheadConcepts,
  allPuzzlesDone,
  completionLines,
  dailyOffered,
  finishAction,
  isTodaysDaily,
  nextPuzzle,
  prevPuzzle,
  puzzleTiles,
  startPuzzle,
  welcomeLines,
} from './daily-flow.js';
import { DATASET_IDS } from './datasets.js';
import {
  currentStreak,
  emptyProgress,
  isUnlocked,
  loadProgress,
  markDailySolved,
  markSolved,
  sanitizeProgress,
  saveProgress,
  type KeyValueStorage,
  type Progress,
} from './progress.js';
import { getPuzzle, isPuzzleId, PRACTICE_ORDER, type Concept, type PuzzleId } from './puzzles.js';

const ORDER = PRACTICE_ORDER;
/** The welcome panel's text width holds about this many characters at its line size. */
const WELCOME_LINE_MAX_CHARS = 44;

/** A day (in the first schedule cycle) whose daily is `id`. */
function dayFor(id: PuzzleId): number {
  for (let day = DAILY_EPOCH_DAY; day < DAILY_EPOCH_DAY + ORDER.length; day++) {
    if (dailyPuzzleId(day) === id) {
      return day;
    }
  }
  throw new Error(`${id} isn't in the daily schedule`);
}

/** Progress with these practice puzzles solved (and their concepts seen, as practice would). */
function solved(ids: readonly PuzzleId[], day = DAILY_EPOCH_DAY - 10): Progress {
  let progress = emptyProgress();
  const seen: Concept[] = [];
  for (const id of ids) {
    progress = markSolved(progress, id, day, 0);
    const concept = getPuzzle(id).concept;
    if (!seen.includes(concept)) {
      seen.push(concept);
    }
  }
  // No resume point: practice resumes at the first unsolved puzzle.
  return { ...progress, seenConcepts: seen, lastPuzzle: null };
}

const FIRST_THREE = ORDER.slice(0, 3);
/** A day whose daily is a later puzzle (not one of practice 1-4). */
const LATE_DAILY: PuzzleId = 'cafe-never-ordered';

describe('which puzzle a session starts on', () => {
  it('a first launch starts practice 1, whatever the daily', () => {
    expect(startPuzzle(emptyProgress(), dayFor(LATE_DAILY), ORDER)).toEqual({ puzzleId: 'shop-match', reason: 'practice' });
  });

  it('before practice 1-3 are solved, the daily is not offered', () => {
    const progress = solved(ORDER.slice(0, 2));
    expect(dailyOffered(progress, ORDER)).toBe(false);
    expect(startPuzzle(progress, dayFor(LATE_DAILY), ORDER)).toEqual({ puzzleId: 'shop-never-ordered', reason: 'practice' });
  });

  it('after practice 1-3, an unsolved daily comes first, even a locked one', () => {
    const progress = solved(FIRST_THREE);
    const today = dayFor(LATE_DAILY);
    expect(startPuzzle(progress, today, ORDER)).toEqual({ puzzleId: LATE_DAILY, reason: 'daily' });
    expect(isUnlocked(progress, LATE_DAILY, ORDER)).toBe(false);
    expect(isTodaysDaily(progress, LATE_DAILY, today, ORDER)).toBe(true);
  });

  it('once the daily is solved today, practice resumes', () => {
    const today = dayFor(LATE_DAILY);
    let progress = markSolved(solved(FIRST_THREE), LATE_DAILY, today, 1);
    progress = markDailySolved(progress, today);
    expect(startPuzzle(progress, today, ORDER)).toEqual({ puzzleId: 'library-fanout', reason: 'practice' });
    // Solving a locked daily unlocks nothing out of order.
    expect(isUnlocked(progress, 'library-fanout', ORDER)).toBe(true);
    expect(isUnlocked(progress, 'shop-every-order', ORDER)).toBe(false);
  });

  it('with all 20 solved, the daily still starts while it is open', () => {
    const progress = solved(ORDER);
    const today = dayFor('school-twice');
    expect(startPuzzle(progress, today, ORDER).puzzleId).toBe('school-twice');
  });
});

describe('where Next goes: the next puzzle number, if unlocked', () => {
  it('after a practice win, to the next number (no detour to the daily)', () => {
    const progress = solved([...FIRST_THREE, 'library-fanout']);
    expect(nextPuzzle(progress, 'library-fanout', ORDER)).toBe('shop-every-order');
  });

  it('from the daily, to the number after it if unlocked; nowhere if it is locked; from 20, the lowest open one', () => {
    const today = dayFor(LATE_DAILY);
    const progress = markDailySolved(markSolved(solved(FIRST_THREE), LATE_DAILY, today, 0), today);
    // The daily is puzzle 20: nothing after it, so the lowest open puzzle (practice's next, puzzle 4).
    expect(nextPuzzle(progress, LATE_DAILY, ORDER)).toBe('library-fanout');
    // A daily ahead of practice (puzzle 8 here): puzzle 9 is still locked.
    expect(nextPuzzle(markSolved(solved(FIRST_THREE), ORDER[7], today, 0), ORDER[7], ORDER)).toBeNull();
  });

  it('never to a locked number', () => {
    expect(nextPuzzle(solved(['shop-match']), 'shop-match', ORDER)).toBe('shop-every-customer');
    expect(nextPuzzle(solved(['shop-match']), 'shop-every-customer', ORDER)).toBeNull();
  });

  it('a daily that is the next practice puzzle counts once, then practice goes on', () => {
    const today = dayFor('library-fanout');
    const progress = solved(FIRST_THREE);
    expect(startPuzzle(progress, today, ORDER).puzzleId).toBe('library-fanout');
    const after = markDailySolved(markSolved(progress, 'library-fanout', today, 0), today);
    expect(currentStreak(after.daily, today)).toBe(1);
    expect(nextPuzzle(after, 'library-fanout', ORDER)).toBe('shop-every-order');
  });

  it('nowhere after the last puzzle once everything is solved', () => {
    const progress = markDailySolved(solved(ORDER), dayFor('cafe-never-ordered'));
    expect(nextPuzzle(progress, 'cafe-never-ordered', ORDER)).toBeNull();
  });

  it("whichever way it's reached, today's daily plays as the daily (its title, the streak)", () => {
    const today = dayFor(ORDER[4]);
    const progress = solved(ORDER.slice(0, 4));
    expect(nextPuzzle(progress, ORDER[3], ORDER)).toBe(ORDER[4]);
    expect(isTodaysDaily(progress, ORDER[4], today, ORDER)).toBe(true);
  });
});

describe('Prev: the previous puzzle number', () => {
  it('goes to N-1, and nowhere from puzzle 1', () => {
    const progress = solved(ORDER.slice(0, 5));
    expect(prevPuzzle(progress, ORDER[0], ORDER)).toBeNull();
    expect(prevPuzzle(progress, ORDER[1], ORDER)).toBe(ORDER[0]);
    expect(prevPuzzle(progress, ORDER[5], ORDER)).toBe(ORDER[4]);
  });

  it("from a daily ahead of practice, to the highest unlocked puzzle below (the numbers between are locked)", () => {
    // Practice 1-5 solved, so puzzle 6 is unlocked and 7-19 are locked; the daily is 20.
    const progress = solved(ORDER.slice(0, 5));
    expect(prevPuzzle(progress, LATE_DAILY, ORDER)).toBe(ORDER[5]);
    expect(prevPuzzle(solved(FIRST_THREE), LATE_DAILY, ORDER)).toBe(ORDER[3]);
  });
});

describe('the puzzle picker', () => {
  it('shows each puzzle as solved, done with the answer, open or locked, and marks today', () => {
    const today = dayFor(LATE_DAILY);
    const progress = markSolved(solved(FIRST_THREE), ORDER[3], DAILY_EPOCH_DAY, 3, true);
    const tiles = puzzleTiles(progress, today, ORDER);
    expect(tiles).toHaveLength(ORDER.length);
    expect(tiles[0]).toMatchObject({ number: 1, status: 'solved', selectable: true, today: false });
    expect(tiles[3]).toMatchObject({ number: 4, status: 'revealed', selectable: true });
    expect(tiles[4]).toMatchObject({ number: 5, status: 'open', selectable: true });
    expect(tiles[5]).toMatchObject({ number: 6, status: 'locked', selectable: false });
    // Today's daily (puzzle 20) is selectable although it's ahead of practice.
    expect(tiles[19]).toMatchObject({ number: 20, status: 'locked', today: true, selectable: true });
  });

  it('marks no daily before it is offered (practice 1-3 first)', () => {
    expect(puzzleTiles(emptyProgress(), dayFor(LATE_DAILY), ORDER).some((tile) => tile.today)).toBe(false);
  });

  it('its copy fits', () => {
    for (const label of [WELCOME.choosePuzzle, WELCOME.pickerBack, WELCOME.pickerToday, WELCOME.startPuzzle(20)]) {
      expect(label.length, label).toBeLessThanOrEqual(20);
      expect(label).toMatch(/^[\x20-\x7e]+$/);
    }
    for (const label of [WELCOME.resetLink, WELCOME.resetCancel, WELCOME.resetConfirm]) {
      expect(label.length, label).toBeLessThanOrEqual(20);
      expect(label).toMatch(/^[\x20-\x7e]+$/);
    }
    // The question wraps onto at most two welcome lines.
    expect(WELCOME.resetQuestion.length).toBeLessThanOrEqual(2 * WELCOME_LINE_MAX_CHARS);
    expect(WELCOME.resetQuestion).toMatch(/^[\x20-\x7e]+$/);
  });
});

describe('Prev and progress', () => {

  it('a replay never moves the resume point back; going forward does', () => {
    const onFifth = { ...solved(ORDER.slice(0, 5)), lastPuzzle: ORDER[4] };
    expect(advanceResume(onFifth, ORDER[2], ORDER)).toBe(onFifth);
    expect(advanceResume(onFifth, ORDER[5], ORDER).lastPuzzle).toBe(ORDER[5]);
    expect(advanceResume(emptyProgress(), ORDER[0], ORDER).lastPuzzle).toBe(ORDER[0]);
    expect(startPuzzle(advanceResume(onFifth, ORDER[2], ORDER), dayFor(LATE_DAILY), ORDER).puzzleId).not.toBe(ORDER[2]);
  });

  it('a replay changes no progress: a solve stays as it was; a puzzle done with the answer upgrades when solved', () => {
    const progress = markSolved(solved(ORDER.slice(0, 2)), ORDER[2], DAILY_EPOCH_DAY - 3, 1);
    expect(markSolved(progress, ORDER[2], DAILY_EPOCH_DAY, 3)).toBe(progress);
    expect(markSolved(progress, ORDER[2], DAILY_EPOCH_DAY, 3, true)).toBe(progress);
    const revealed = markSolved(emptyProgress(), ORDER[0], DAILY_EPOCH_DAY - 3, 3, true);
    expect(markSolved(revealed, ORDER[0], DAILY_EPOCH_DAY, 0).solved[ORDER[0]]).toEqual({
      firstSolvedDay: DAILY_EPOCH_DAY - 3,
      hintsUsed: 0,
    });
    // The streak only follows today's daily, never a replay.
    expect(progress.daily).toEqual(emptyProgress().daily);
  });

  it('the replay status lines fit the card', () => {
    for (const line of [CARD.solvedBefore, CARD.doneWithAnswerBefore]) {
      expect(cardMessageLines(line), line).toBe(1);
      expect(line).toMatch(/^[\x20-\x7e]+$/);
    }
  });
});

describe('a daily ahead of practice', () => {
  it('introduces its own concept and what it leans on, at most two', () => {
    const progress = solved(FIRST_THREE);
    expect(aheadConcepts(progress, getPuzzle('school-no-club'))).toEqual(['nullfk', 'direction']);
    expect(aheadConcepts(progress, getPuzzle('school-twice'))).toEqual(['fanout']);
    expect(aheadConcepts(progress, getPuzzle('cafe-no-milk'))).toEqual(['nullvalue']);
    expect(aheadConcepts(progress, getPuzzle('library-nothing-out'))).toEqual([]);
  });

  it('nothing once practice has introduced them', () => {
    const progress = solved(ORDER.slice(0, 6));
    expect(aheadConcepts(progress, getPuzzle('school-no-club'))).toEqual([]);
  });

  it('the lead-in and the two longest intros fit the message area together', () => {
    const intros = Object.values(CONCEPT_INTROS)
      .map((line) => cardMessageLines(line))
      .sort((a, b) => b - a);
    expect(cardMessageLines(CARD.dailyAhead) + intros[0] + intros[1]).toBeLessThanOrEqual(CARD_MESSAGE_LINES);
  });
});

describe('progress across days', () => {
  function memoryStorage(): KeyValueStorage {
    const map = new Map<string, string>();
    return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => void map.set(key, value) };
  }

  /** One session: load as the app does, solve today's daily, save. */
  function playDaily(storage: KeyValueStorage, today: number): Progress {
    const loaded = sanitizeProgress(loadProgress(storage, isPuzzleId), ORDER, ORDER, false);
    const daily = dailyPuzzleId(today);
    const progress = markDailySolved(markSolved(loaded, daily, today, 0), today);
    saveProgress(storage, progress);
    return progress;
  }

  it('the streak grows on consecutive days, ignores repeats and clock changes, and restarts after a gap', () => {
    const storage = memoryStorage();
    saveProgress(storage, solved(FIRST_THREE));
    const d = DAILY_EPOCH_DAY + 5;
    expect(playDaily(storage, d).daily.streak).toBe(1);
    expect(playDaily(storage, d + 1).daily.streak).toBe(2);
    expect(playDaily(storage, d + 1).daily.streak).toBe(2);
    expect(playDaily(storage, d + 2).daily.streak).toBe(3);
    // The clock moved back a day: no break, no increment.
    expect(playDaily(storage, d + 1).daily.streak).toBe(3);
    // A missed day: it shows 0, then the next solve starts again at 1.
    const reloaded = loadProgress(storage, isPuzzleId);
    expect(currentStreak(reloaded.daily, d + 4)).toBe(0);
    const after = playDaily(storage, d + 4);
    expect(after.daily.streak).toBe(1);
    expect(after.daily.best).toBe(3);
  });

  it('sanitizing keeps a daily solved out of practice order', () => {
    const today = dayFor(LATE_DAILY);
    const progress = markSolved(solved(FIRST_THREE), LATE_DAILY, today, 0);
    expect(sanitizeProgress(progress, ORDER, ORDER, false).solved[LATE_DAILY]).toBeDefined();
  });
});

describe('welcome screen lines', () => {
  it('before the daily is offered: start with practice, no streak', () => {
    expect(welcomeLines(solved(['shop-match']), DAILY_EPOCH_DAY, ORDER, true)).toEqual({
      daily: WELCOME.practiceFirst,
      streak: null,
      practice: 'Practice 1/20',
      save: null,
    });
  });

  it('daily open with a streak at risk, then solved', () => {
    const today = dayFor(LATE_DAILY);
    const yesterday = markDailySolved(solved(FIRST_THREE), today - 1);
    expect(welcomeLines(yesterday, today, ORDER, true)).toMatchObject({
      daily: "Today's puzzle: Cafe",
      streak: 'Streak: 1 day. Solve today to keep it.',
    });
    const solvedToday = markDailySolved(markSolved(yesterday, LATE_DAILY, today, 0), today);
    expect(welcomeLines(solvedToday, today, ORDER, true)).toMatchObject({
      daily: WELCOME.dailyDone,
      streak: 'Streak: 2 days',
      practice: 'Practice 4/20',
    });
  });

  it('says so when progress cannot be saved', () => {
    expect(welcomeLines(emptyProgress(), DAILY_EPOCH_DAY, ORDER, false).save).toBe(WELCOME.saveUnavailable);
  });

  it('every line fits the panel', () => {
    const lines = [
      WELCOME.title,
      WELCOME.description,
      WELCOME.descriptionPuzzles,
      WELCOME.descriptionFreePlay,
      WELCOME.freePlayHeading,
      WELCOME.startFreePlay,
      WELCOME.setup,
      WELCOME.practiceFirst,
      WELCOME.dailyDone,
      WELCOME.saveUnavailable,
      WELCOME.practiceProgress(20, 20),
      WELCOME.allDone(20),
      WELCOME.allDoneWithAnswers(20, 19),
      `${WELCOME.streak(365)}. ${WELCOME.streakAtRisk}`,
      ...DATASET_IDS.map((id) => WELCOME.dailyOpen(id)),
    ];
    for (const line of lines) {
      expect(line.length, line).toBeLessThanOrEqual(WELCOME_LINE_MAX_CHARS);
    }
  });
});

describe('finishing all 20 puzzles', () => {
  const LAST = ORDER[ORDER.length - 1];
  const all = solved(ORDER);
  /** All done, these after "Show answer". */
  const withAnswers = (ids: readonly PuzzleId[]) =>
    ids.reduce((progress, id) => ({ ...progress, solved: { ...progress.solved, [id]: { firstSolvedDay: 1, hintsUsed: 3, revealed: true as const } } }), all);
  /** A day whose daily isn't the last puzzle, so "today's daily" is a different one. */
  const today = dayFor('shop-every-customer');

  it('counts only when every puzzle is done (solved or with the answer)', () => {
    expect(allPuzzlesDone(all, ORDER)).toBe(true);
    expect(allPuzzlesDone(withAnswers(['library-no-due', 'cafe-no-milk']), ORDER)).toBe(true);
    expect(allPuzzlesDone(solved(ORDER.slice(0, 19)), ORDER)).toBe(false);
    // The last puzzle done (as a daily ahead of practice) with an earlier one open: not done.
    const gap = solved(ORDER.filter((id) => id !== 'school-twice'));
    expect(allPuzzlesDone(gap, ORDER)).toBe(false);
    expect(finishAction(gap, LAST, ORDER, today, false)).toBeNull();
  });

  it('Next on the last puzzle goes to the lowest open puzzle while one is open', () => {
    const gap = solved(ORDER.filter((id) => id !== 'school-twice' && id !== 'cafe-menu'));
    expect(nextPuzzle(gap, LAST, ORDER)).toBe('school-twice');
    expect(nextPuzzle(all, LAST, ORDER)).toBeNull();
  });

  it('Next says Finish, then Today (today\'s daily open) or Done', () => {
    expect(finishAction(all, LAST, ORDER, today, false)).toBe('finish');
    expect(finishAction(all, LAST, ORDER, today, true)).toBe('today');
    const dailyDone = markDailySolved(all, today);
    expect(finishAction(dailyDone, LAST, ORDER, today, true)).toBe('done');
    // Anywhere but the last puzzle: Next as usual.
    expect(finishAction(all, ORDER[5], ORDER, today, false)).toBeNull();
  });

  it('the completion state: summary, what next, the streak', () => {
    expect(completionLines(all, ORDER, today)).toEqual({
      headline: 'All 20 puzzles done!',
      summary: COMPLETE.allSolved,
      next: COMPLETE.dailyOpen,
      streak: null,
    });
    const mixed = markDailySolved(withAnswers(['library-no-due', 'cafe-no-milk']), today);
    expect(completionLines(mixed, ORDER, today)).toEqual({
      headline: 'All 20 puzzles done!',
      summary: 'Solved: 18. With the answer: 2.',
      next: COMPLETE.comeBackTomorrow,
      streak: 'Streak: 1 day',
    });
  });

  it('the welcome screen says so in place of the practice count', () => {
    expect(welcomeLines(all, today, ORDER, true).practice).toBe('All 20 puzzles done');
    expect(welcomeLines(withAnswers(['cafe-no-milk']), today, ORDER, true).practice).toBe('All 20 puzzles done (1 with answer)');
  });

  it('its copy fits the card: the headline on one line, bigger than the goal; the rest within the message area', () => {
    const m = cardMetrics();
    const headline = COMPLETE.headline(ORDER.length);
    const font = cardHeadlineFontCm(headline);
    expect(wrappedLines(headline, HEADER_METRICS, font, m.innerWidthCm)).toBe(1);
    expect(font).toBeGreaterThanOrEqual(1.2 * m.goalFont);
    // "Solved!" keeps its full size.
    expect(cardHeadlineFontCm(CARD.headline)).toBeCloseTo(cardHeadlineFontCm(''));
    const summaries = [COMPLETE.allSolved, COMPLETE.summary(10, 10)].map(cardMessageLines);
    const nexts = [COMPLETE.comeBackTomorrow, COMPLETE.dailyOpen].map(cardMessageLines);
    expect(Math.max(...summaries) + Math.max(...nexts)).toBeLessThanOrEqual(CARD_MESSAGE_LINES);
    for (const text of [headline, COMPLETE.allSolved, COMPLETE.summary(18, 2), COMPLETE.comeBackTomorrow, COMPLETE.dailyOpen, COMPLETE.badge]) {
      expect(text).toMatch(/^[\x20-\x7e]+$/);
    }
  });
});
