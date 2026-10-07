import { describe, expect, it } from 'vitest';
import { compareToTarget, fanOutGroups } from './compare.js';
import { measureTextCm, MONO_METRICS, slabMetrics } from '../slab-metrics.js';
import { PLANNED_RESULT_DISTANCE_METERS, slabTextSizeAt } from '../text-angles.js';
import { CONCEPT_INTROS, DATASET_TITLES, PUZZLE_COPY, TARGET_OUTLINE } from './copy.js';
import { DATASETS } from './datasets.js';
import {
  canActivatePuzzle,
  DAILY_SCHEDULE,
  introducesConcept,
  puzzleMatchesTables,
  PRACTICE_ORDER,
  PUZZLES,
  puzzleTables,
  puzzleTarget,
  reachableSpecs,
  RESULT_ROW_CAP,
  rowLabel,
  runPuzzleQuery,
  SOURCE_ROW_CAP,
  getPuzzle,
  type Puzzle,
} from './puzzles.js';
import { visibleRowIndices, type QueryOutput, type QuerySpec } from './query.js';

const GOAL_MAX_CHARS = 72;

const labels = (puzzle: Puzzle, output: QueryOutput): string[] =>
  visibleRowIndices(output)
    .map((index) => rowLabel(puzzle, output, index))
    .sort();

const describeSpec = (spec: QuerySpec): string =>
  `${spec.left} <- ${spec.right} ${spec.joinType.toUpperCase()}` +
  (spec.filter ? ` WHERE ${spec.filter.tableId}.${spec.filter.column} IS NULL` : '');

const solves = (puzzle: Puzzle, spec: QuerySpec): boolean =>
  compareToTarget(runPuzzleQuery(puzzle, spec), puzzleTarget(puzzle)).solved;

describe.each(PUZZLES.map((puzzle): [string, Puzzle] => [puzzle.id, puzzle]))('puzzle %s', (_id, puzzle) => {
  const target = puzzleTarget(puzzle);

  it('its solution gives the hand-written answer', () => {
    expect(labels(puzzle, target)).toEqual([...puzzle.expected].sort());
    expect(compareToTarget(target, target).solved).toBe(true);
  });

  it('fits the row caps in every reachable state', () => {
    for (const table of puzzleTables(puzzle)) {
      expect(table.rows.length).toBeLessThanOrEqual(SOURCE_ROW_CAP);
    }
    for (const spec of reachableSpecs(puzzle)) {
      const output = runPuzzleQuery(puzzle, spec);
      const comparison = compareToTarget(output, target);
      expect(output.result.table.rows.length, describeSpec(spec)).toBeLessThanOrEqual(RESULT_ROW_CAP);
      // Shown rows plus placeholders for missing ones.
      expect(comparison.visibleCount + comparison.missing.length, describeSpec(spec)).toBeLessThanOrEqual(
        RESULT_ROW_CAP,
      );
    }
  });

  it('its target outline says how many rows the answer has, and the label never widens the outline', () => {
    const count = visibleRowIndices(target).length;
    const label = TARGET_OUTLINE.answerRows(count);
    expect(label).toMatch(/^[\x20-\x7e]+$/);
    expect(label).toContain(count === 1 ? '1 row' : count === 0 ? 'no rows' : `${count} rows`);
    // The outline is at least its columns at their minimum width; the label (the caption's font) fits inside that.
    const m = slabMetrics(slabTextSizeAt(PLANNED_RESULT_DISTANCE_METERS));
    const columns = target.result.table.columns.length;
    const narrowest = columns * m.columnMinWidth + (columns - 1) * m.columnGap;
    expect(measureTextCm(label, MONO_METRICS, m.captionFont)).toBeLessThanOrEqual(narrowest);
  });

  it('the first join (INNER, no filter) solves it only when that is the lesson', () => {
    const [a, b] = puzzle.tables;
    const firstJoins: QuerySpec[] = [
      { left: a, right: b, joinType: 'inner', filter: null },
      { left: b, right: a, joinType: 'inner', filter: null },
    ];
    const expected = puzzle.concept === 'inner' || puzzle.concept === 'fanout';
    for (const spec of firstJoins) {
      expect(solves(puzzle, spec), describeSpec(spec)).toBe(expected);
    }
  });

  it('fan-out puzzles have repeats to highlight (their takeaway explains them)', () => {
    expect(puzzle.fanOutHighlight !== undefined).toBe(puzzle.concept === 'fanout');
    if (puzzle.fanOutHighlight) {
      const groups = fanOutGroups(target).filter((group) => group.cause === puzzle.fanOutHighlight);
      expect(groups.length).toBeGreaterThan(0);
    }
  });

  it('has its copy', () => {
    const copy = PUZZLE_COPY[puzzle.id];
    expect(copy.goal.length).toBeGreaterThan(0);
    expect(copy.goal.length).toBeLessThanOrEqual(GOAL_MAX_CHARS);
    expect(copy.hints).toHaveLength(3);
    for (const text of [copy.goal, ...copy.hints, copy.takeaway]) {
      // Plain ASCII only (see copy.ts).
      expect(text).toMatch(/^[\x20-\x7e]*$/);
    }
  });
});

describe('the trickier puzzles', () => {
  it('library-no-due: filtering on due in a LEFT result keeps unmatched rows too', () => {
    const puzzle = getPuzzle('library-no-due');
    const due = { tableId: 'books', column: 'due' };
    expect(solves(puzzle, { left: 'books', right: 'borrowers', joinType: 'left', filter: due })).toBe(false);
    expect(solves(puzzle, { left: 'borrowers', right: 'books', joinType: 'left', filter: due })).toBe(false);
    expect(solves(puzzle, { left: 'books', right: 'borrowers', joinType: 'inner', filter: due })).toBe(true);
  });

  it('cafe-no-milk: keeping every drink adds Matcha; keeping every ticket does not', () => {
    const puzzle = getPuzzle('cafe-no-milk');
    const milk = { tableId: 'tickets', column: 'milk' };
    expect(solves(puzzle, { left: 'drinks', right: 'tickets', joinType: 'left', filter: milk })).toBe(false);
    expect(solves(puzzle, { left: 'tickets', right: 'drinks', joinType: 'left', filter: milk })).toBe(true);
  });

  it('cafe-never-ordered: filtering on milk instead of the ticket id leaves two extra rows', () => {
    const puzzle = getPuzzle('cafe-never-ordered');
    const target = puzzleTarget(puzzle);
    const wrong = runPuzzleQuery(puzzle, {
      left: 'drinks',
      right: 'tickets',
      joinType: 'left',
      filter: { tableId: 'tickets', column: 'milk' },
    });
    const comparison = compareToTarget(wrong, target);
    expect(comparison.solved).toBe(false);
    expect(comparison.rowStatus.filter((status) => status === 'extra')).toHaveLength(2);
    expect(comparison.missing).toEqual([]);
  });

  it('school-twice: Ines appears once per club sharing id 3', () => {
    const puzzle = getPuzzle('school-twice');
    const ines = labels(puzzle, puzzleTarget(puzzle)).filter((label) => label.endsWith('Ines Vale'));
    expect(ines).toEqual(['Choir / Ines Vale', 'Drama / Ines Vale']);
  });

  it('records every solving state, for review when content changes', () => {
    const solving = Object.fromEntries(
      PUZZLES.map((puzzle) => [
        puzzle.id,
        reachableSpecs(puzzle)
          .filter((spec) => solves(puzzle, spec))
          .map(describeSpec),
      ]),
    );
    for (const [id, states] of Object.entries(solving)) {
      expect(states.length, id).toBeGreaterThan(0);
    }
    expect(solving).toMatchSnapshot();
  });
});

describe('puzzle activation guards', () => {
  const PHASE_2 = PRACTICE_ORDER.slice(0, 3);
  const SHOP_DESK = ['customers', 'orders'];

  it('a puzzle matches only its own tables, in either order', () => {
    expect(puzzleMatchesTables(getPuzzle('shop-match'), ['orders', 'customers'])).toBe(true);
    expect(puzzleMatchesTables(getPuzzle('library-fanout'), SHOP_DESK)).toBe(false);
    expect(puzzleMatchesTables(getPuzzle('shop-match'), ['customers'])).toBe(false);
    expect(puzzleMatchesTables(getPuzzle('shop-match'), ['customers', 'orders', 'books'])).toBe(false);
  });

  it('loading is rejected for a puzzle on other tables, or outside the playable range', () => {
    expect(canActivatePuzzle('shop-never-ordered', PHASE_2, SHOP_DESK)).toBe(true);
    // Puzzle 4 is on the library tables, and beyond phase 2's range.
    expect(canActivatePuzzle('library-fanout', PHASE_2, SHOP_DESK)).toBe(false);
    expect(canActivatePuzzle('library-fanout', PRACTICE_ORDER, SHOP_DESK)).toBe(false);
    expect(canActivatePuzzle('library-fanout', PRACTICE_ORDER, ['borrowers', 'books'])).toBe(true);
    // A shop puzzle beyond the range (puzzle 5) is rejected too.
    expect(canActivatePuzzle('shop-every-order', PHASE_2, SHOP_DESK)).toBe(false);
    expect(canActivatePuzzle('no-such-puzzle', PRACTICE_ORDER, SHOP_DESK)).toBe(false);
  });

  it('evaluating a result against a puzzle on other tables is rejected', () => {
    // The shop result that solves puzzle 3, checked against puzzle 4 (library).
    const shopResult = runPuzzleQuery(getPuzzle('shop-never-ordered'), getPuzzle('shop-never-ordered').solution);
    expect(puzzleMatchesTables(getPuzzle('library-fanout'), [shopResult.left.id, shopResult.right.id])).toBe(false);
  });
});

describe('puzzle order and schedule', () => {
  it('practice order holds every puzzle once', () => {
    expect(PRACTICE_ORDER).toHaveLength(20);
    expect(new Set(PRACTICE_ORDER).size).toBe(20);
  });

  it('the daily schedule holds every puzzle once', () => {
    expect([...DAILY_SCHEDULE].sort()).toEqual([...PRACTICE_ORDER].sort());
  });

  it('consecutive dailies (wrapping around) never use the same tables', () => {
    for (let i = 0; i < DAILY_SCHEDULE.length; i++) {
      const today = getPuzzle(DAILY_SCHEDULE[i]);
      const tomorrow = getPuzzle(DAILY_SCHEDULE[(i + 1) % DAILY_SCHEDULE.length]);
      expect(tomorrow.datasetId, `${today.id} -> ${tomorrow.id}`).not.toBe(today.datasetId);
    }
  });

  it('the ladder starts inner -> left -> anti-join', () => {
    expect(PUZZLES.slice(0, 3).map((puzzle) => puzzle.concept)).toEqual(['inner', 'left', 'antijoin']);
  });

  it('each concept is introduced exactly once, and has an intro line', () => {
    const introducers = PUZZLES.filter(introducesConcept);
    expect(introducers.map((puzzle) => puzzle.concept).sort()).toEqual(Object.keys(CONCEPT_INTROS).sort());
    expect(introducesConcept(getPuzzle('shop-never-ordered'))).toBe(true);
    expect(introducesConcept(getPuzzle('library-nothing-out'))).toBe(false);
  });

  it('every dataset has a title and five puzzles', () => {
    for (const id of Object.keys(DATASETS) as (keyof typeof DATASETS)[]) {
      expect(DATASET_TITLES[id].length).toBeGreaterThan(0);
      expect(PUZZLES.filter((puzzle) => puzzle.datasetId === id)).toHaveLength(5);
    }
  });
});
