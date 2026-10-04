import { describe, expect, it } from 'vitest';
import {
  currentStreak,
  dailySolvedToday,
  emptyProgress,
  isUnlocked,
  loadProgress,
  markConceptSeen,
  markDailySolved,
  markSolved,
  nextPracticePuzzle,
  parseProgress,
  practiceSolvedCount,
  PROGRESS_STORAGE_KEY,
  recordDailySolve,
  sanitizeProgress,
  saveProgress,
  serializeProgress,
  type DailyProgress,
  type KeyValueStorage,
} from './progress.js';
import { isPuzzleId, PRACTICE_ORDER } from './puzzles.js';

const DAY = 20_000;
const fresh: DailyProgress = { lastSolvedDay: null, streak: 0, best: 0 };

describe('daily streak', () => {
  it('starts at 1 and grows on consecutive days', () => {
    const one = recordDailySolve(fresh, DAY);
    expect(one).toEqual({ lastSolvedDay: DAY, streak: 1, best: 1 });
    const two = recordDailySolve(one, DAY + 1);
    expect(two).toEqual({ lastSolvedDay: DAY + 1, streak: 2, best: 2 });
  });

  it('solving twice on one day counts once', () => {
    const one = recordDailySolve(fresh, DAY);
    expect(recordDailySolve(one, DAY)).toBe(one);
  });

  it('a missed day starts again at 1 and keeps the best', () => {
    const three = [DAY, DAY + 1, DAY + 2].reduce(recordDailySolve, fresh);
    expect(recordDailySolve(three, DAY + 4)).toEqual({ lastSolvedDay: DAY + 4, streak: 1, best: 3 });
  });

  it('a clock or time zone moved back changes nothing', () => {
    const two = [DAY, DAY + 1].reduce(recordDailySolve, fresh);
    expect(recordDailySolve(two, DAY)).toBe(two);
    expect(currentStreak(two, DAY)).toBe(2);
  });

  it('shows the streak while it is alive and 0 after a missed day', () => {
    const two = [DAY, DAY + 1].reduce(recordDailySolve, fresh);
    expect(currentStreak(fresh, DAY)).toBe(0);
    expect(currentStreak(two, DAY + 1)).toBe(2);
    expect(currentStreak(two, DAY + 2)).toBe(2); // at risk, not broken yet
    expect(currentStreak(two, DAY + 3)).toBe(0);
    expect(dailySolvedToday(two, DAY + 1)).toBe(true);
    expect(dailySolvedToday(two, DAY + 2)).toBe(false);
  });

  it('only the daily counts toward the streak', () => {
    const progress = markSolved(emptyProgress(), 'shop-match', DAY, 0);
    expect(progress.daily).toEqual(fresh);
    expect(markDailySolved(progress, DAY).daily.streak).toBe(1);
  });
});

describe('solving and unlocking', () => {
  it('keeps the first solve record', () => {
    const first = markSolved(emptyProgress(), 'shop-match', DAY, 2);
    expect(markSolved(first, 'shop-match', DAY + 1, 0)).toBe(first);
    expect(first.solved['shop-match']).toEqual({ firstSolvedDay: DAY, hintsUsed: 2 });
  });

  it('unlocks strictly in order', () => {
    let progress = emptyProgress();
    expect(isUnlocked(progress, PRACTICE_ORDER[0], PRACTICE_ORDER)).toBe(true);
    expect(isUnlocked(progress, PRACTICE_ORDER[1], PRACTICE_ORDER)).toBe(false);
    progress = markSolved(progress, PRACTICE_ORDER[0], DAY, 0);
    expect(isUnlocked(progress, PRACTICE_ORDER[1], PRACTICE_ORDER)).toBe(true);
    expect(nextPracticePuzzle(progress, PRACTICE_ORDER)).toBe(PRACTICE_ORDER[1]);
  });

  it('solving a later puzzle as the daily unlocks nothing out of order', () => {
    const progress = markSolved(emptyProgress(), PRACTICE_ORDER[6], DAY, 0);
    expect(isUnlocked(progress, PRACTICE_ORDER[7], PRACTICE_ORDER)).toBe(false);
    expect(nextPracticePuzzle(progress, PRACTICE_ORDER)).toBe(PRACTICE_ORDER[0]);
    expect(practiceSolvedCount(progress, PRACTICE_ORDER)).toBe(1);
  });

  it('records each concept once', () => {
    const seen = markConceptSeen(emptyProgress(), 'left');
    expect(markConceptSeen(seen, 'left')).toBe(seen);
    expect(seen.seenConcepts).toEqual(['left']);
  });
});

describe('sanitizeProgress', () => {
  const PHASE_2 = PRACTICE_ORDER.slice(0, 3);

  it('keeps consistent progress unchanged', () => {
    let progress = markSolved(emptyProgress(), PRACTICE_ORDER[0], DAY, 0);
    progress = { ...markSolved(progress, PRACTICE_ORDER[1], DAY, 1), lastPuzzle: PRACTICE_ORDER[2] };
    expect(sanitizeProgress(progress, PHASE_2, PRACTICE_ORDER, true)).toBe(progress);
  });

  it('drops solves beyond the playable range, and a resume point there', () => {
    let progress = markSolved(emptyProgress(), PRACTICE_ORDER[0], DAY, 0);
    progress = markSolved(progress, PRACTICE_ORDER[1], DAY, 0);
    progress = markSolved(progress, PRACTICE_ORDER[2], DAY, 0);
    progress = { ...markSolved(progress, PRACTICE_ORDER[3], DAY, 0), lastPuzzle: PRACTICE_ORDER[3] };
    const clean = sanitizeProgress(progress, PHASE_2, PRACTICE_ORDER, true);
    expect(Object.keys(clean.solved).sort()).toEqual([...PHASE_2].sort());
    expect(clean.lastPuzzle).toBeNull();
    expect(nextPracticePuzzle(clean, PHASE_2)).toBeNull();
  });

  it('with in-order-only progress, drops solves after the first unsolved puzzle', () => {
    let progress = markSolved(emptyProgress(), PRACTICE_ORDER[0], DAY, 0);
    progress = markSolved(progress, PRACTICE_ORDER[2], DAY, 0);
    const clean = sanitizeProgress(progress, PHASE_2, PRACTICE_ORDER, true);
    expect(Object.keys(clean.solved)).toEqual([PRACTICE_ORDER[0]]);
    // With dailies, an out-of-order solve is legitimate and kept.
    expect(sanitizeProgress(progress, PRACTICE_ORDER, PRACTICE_ORDER, false)).toBe(progress);
  });
});

describe('parseProgress', () => {
  it('falls back to empty progress for missing or unreadable data', () => {
    for (const raw of [null, '', 'not json', '[]', '42', '{"version":2}', '{"solved":{}}']) {
      expect(parseProgress(raw, isPuzzleId)).toEqual(emptyProgress());
    }
  });

  it('keeps valid entries and drops the rest', () => {
    const raw = JSON.stringify({
      version: 1,
      solved: {
        'shop-match': { firstSolvedDay: DAY, hintsUsed: 1 },
        'no-such-puzzle': { firstSolvedDay: DAY, hintsUsed: 0 },
        'shop-every-customer': { firstSolvedDay: 'yesterday', hintsUsed: 0 },
        'shop-never-ordered': { firstSolvedDay: DAY, hintsUsed: 5 },
      },
      daily: { lastSolvedDay: DAY, streak: 4, best: 2 },
      seenConcepts: ['inner', 'teleport', 'inner', 'left'],
      lastPuzzle: 'no-such-puzzle',
    });
    const progress = parseProgress(raw, isPuzzleId);
    expect(progress.solved).toEqual({ 'shop-match': { firstSolvedDay: DAY, hintsUsed: 1 } });
    expect(progress.daily).toEqual({ lastSolvedDay: DAY, streak: 4, best: 4 });
    expect(progress.seenConcepts).toEqual(['inner', 'left']);
    expect(progress.lastPuzzle).toBeNull();
  });

  it('drops a malformed daily record', () => {
    const raw = JSON.stringify({ version: 1, daily: { lastSolvedDay: -3, streak: 1, best: 1 } });
    expect(parseProgress(raw, isPuzzleId).daily).toEqual(fresh);
  });

  it('round-trips', () => {
    let progress = markSolved(emptyProgress(), 'shop-match', DAY, 0);
    progress = markDailySolved(progress, DAY);
    progress = markConceptSeen(progress, 'inner');
    progress = { ...progress, lastPuzzle: 'shop-every-customer' };
    expect(parseProgress(serializeProgress(progress), isPuzzleId)).toEqual(progress);
  });
});

describe('loadProgress / saveProgress', () => {
  const memory = (): KeyValueStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
    };
  };
  const broken: KeyValueStorage = {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };

  it('saves under the versioned key and loads it back', () => {
    const storage = memory();
    const progress = markSolved(emptyProgress(), 'shop-match', DAY, 0);
    expect(saveProgress(storage, progress)).toBe(true);
    expect(storage.data.has(PROGRESS_STORAGE_KEY)).toBe(true);
    expect(loadProgress(storage, isPuzzleId)).toEqual(progress);
  });

  it('never throws when storage is missing or failing', () => {
    expect(loadProgress(null, isPuzzleId)).toEqual(emptyProgress());
    expect(loadProgress(broken, isPuzzleId)).toEqual(emptyProgress());
    expect(saveProgress(null, emptyProgress())).toBe(false);
    expect(saveProgress(broken, emptyProgress())).toBe(false);
  });
});
