import { describe, expect, it } from 'vitest';
import { CARD, CONCEPT_INTROS, WELCOME } from './copy.js';
import { DAILY_EPOCH_DAY, dailyPuzzleId } from './daily.js';
import {
  aheadConcepts,
  dailyOffered,
  isTodaysDaily,
  nextPuzzle,
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
/** The card's message and intro rows hold one line of this many characters (the takeaway limit). */
const CARD_LINE_MAX_CHARS = 60;
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

describe('where Next goes', () => {
  it('after a practice win, to the daily while it is open', () => {
    const progress = solved([...FIRST_THREE, 'library-fanout']);
    expect(nextPuzzle(progress, 'library-fanout', dayFor(LATE_DAILY), ORDER)).toBe(LATE_DAILY);
  });

  it('after the daily win, back to the first unsolved practice puzzle', () => {
    const today = dayFor(LATE_DAILY);
    const progress = markDailySolved(markSolved(solved(FIRST_THREE), LATE_DAILY, today, 0), today);
    expect(nextPuzzle(progress, LATE_DAILY, today, ORDER)).toBe('library-fanout');
  });

  it('with the daily solved, to the next practice puzzle in order', () => {
    const today = dayFor(LATE_DAILY);
    const progress = markDailySolved(solved([...FIRST_THREE, 'library-fanout', LATE_DAILY]), today);
    expect(nextPuzzle(progress, 'library-fanout', today, ORDER)).toBe('shop-every-order');
  });

  it('before the daily is offered, practice order only', () => {
    expect(nextPuzzle(solved(['shop-match']), 'shop-match', dayFor(LATE_DAILY), ORDER)).toBe('shop-every-customer');
  });

  it('a daily that is the next practice puzzle counts once, then practice goes on', () => {
    const today = dayFor('library-fanout');
    const progress = solved(FIRST_THREE);
    expect(startPuzzle(progress, today, ORDER).puzzleId).toBe('library-fanout');
    const after = markDailySolved(markSolved(progress, 'library-fanout', today, 0), today);
    expect(currentStreak(after.daily, today)).toBe(1);
    expect(nextPuzzle(after, 'library-fanout', today, ORDER)).toBe('shop-every-order');
  });

  it('nowhere after the last puzzle once everything is solved', () => {
    const today = dayFor('cafe-never-ordered');
    const progress = markDailySolved(solved(ORDER), today);
    expect(nextPuzzle(progress, 'cafe-never-ordered', today, ORDER)).toBeNull();
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

  it('every intro and the lead-in fit one card line', () => {
    for (const line of [CARD.dailyAhead, ...Object.values(CONCEPT_INTROS)]) {
      expect(line.length, line).toBeLessThanOrEqual(CARD_LINE_MAX_CHARS);
    }
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
      `${WELCOME.streak(365)}. ${WELCOME.streakAtRisk}`,
      ...DATASET_IDS.map((id) => WELCOME.dailyOpen(id)),
    ];
    for (const line of lines) {
      expect(line.length, line).toBeLessThanOrEqual(WELCOME_LINE_MAX_CHARS);
    }
  });
});
