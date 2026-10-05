import { describe, expect, it } from 'vitest';
import { compareToTarget } from './compare.js';
import { PUZZLE_CHECKS } from './puzzle-checks.js';
import { PUZZLES, puzzleTarget, runPuzzleQuery, type Puzzle } from './puzzles.js';

describe.each(PUZZLES.map((puzzle): [string, Puzzle] => [puzzle.id, puzzle]))('puzzle %s', (_id, puzzle) => {
  const check = PUZZLE_CHECKS[puzzle.id];
  const target = puzzleTarget(puzzle);

  it('its wrong state shows the expected diff and loses', () => {
    const comparison = compareToTarget(runPuzzleQuery(puzzle, check.wrong), target);
    expect({
      shown: comparison.visibleCount,
      extra: comparison.rowStatus.filter((status) => status === 'extra').length,
      missing: comparison.missing.length,
    }).toEqual(check.expect);
    expect(comparison.solved).toBe(false);
  });

  it('its solution wins', () => {
    expect(compareToTarget(runPuzzleQuery(puzzle, puzzle.solution), target).solved).toBe(true);
  });
});

describe('trap puzzles', () => {
  it('are exactly 10, 18 and 20, and each trap is a filter', () => {
    const traps = PUZZLES.filter((puzzle) => PUZZLE_CHECKS[puzzle.id].trap).map((puzzle) => puzzle.id);
    expect(traps).toEqual(['library-no-due', 'cafe-no-milk', 'cafe-never-ordered']);
    for (const id of traps) {
      expect(PUZZLE_CHECKS[id].wrong.filter).not.toBeNull();
    }
  });
});
