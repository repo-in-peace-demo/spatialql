import { describe, expect, it } from 'vitest';
import { columnHeaderText } from './join-result.js';
import { getPuzzle, PUZZLES, runPuzzleQuery, type Puzzle } from './puzzles.js';
import {
  FANOUT_TAKEAWAY_MAX_CHARS,
  puzzleText,
  renderPuzzleText,
  resultHeaders,
  TAKEAWAY_MAX_CHARS,
} from './puzzle-text.js';

const allText = (puzzle: Puzzle): string[] => {
  const text = puzzleText(puzzle);
  return [text.goal, ...text.hints, text.takeaway];
};

describe('puzzle text', () => {
  it.each(PUZZLES.map((puzzle): [string, Puzzle] => [puzzle.id, puzzle]))(
    '%s: every placeholder resolves, and the result is plain ASCII',
    (_id, puzzle) => {
      for (const text of allText(puzzle)) {
        expect(text).not.toMatch(/[{}]/);
        expect(text).toMatch(/^[\x20-\x7e]*$/);
      }
    },
  );

  it.each(PUZZLES.map((puzzle): [string, Puzzle] => [puzzle.id, puzzle]))(
    '%s: every column a hint says to poke "under" is a header the result shows',
    (_id, puzzle) => {
      const headers = new Set(resultHeaders(puzzle));
      for (const hint of puzzleText(puzzle).hints) {
        for (const match of hint.matchAll(/under ([A-Z][A-Z0-9_. ]*[A-Z0-9])/g)) {
          expect(headers.has(match[1]), `"${match[1]}" in: ${hint}`).toBe(true);
        }
      }
    },
  );

  it.each(PUZZLES.map((puzzle): [string, Puzzle] => [puzzle.id, puzzle]))(
    '%s: the takeaway fits the card (one line; two for fan-out)',
    (_id, puzzle) => {
      const { takeaway } = puzzleText(puzzle);
      const limit = puzzle.concept === 'fanout' ? FANOUT_TAKEAWAY_MAX_CHARS : TAKEAWAY_MAX_CHARS;
      expect(takeaway.length).toBeGreaterThan(0);
      expect(takeaway.length, takeaway).toBeLessThanOrEqual(limit);
    },
  );

  it('the trap puzzle names its columns as shown', () => {
    expect(puzzleText(getPuzzle('cafe-never-ordered')).takeaway).toBe("The NULL under T.ID means no match; MILK's doesn't.");
  });

  it('result headers are the same in either join direction', () => {
    for (const puzzle of PUZZLES) {
      const [a, b] = puzzle.tables;
      const headers = (left: string, right: string) => {
        const { result } = runPuzzleQuery(puzzle, { left, right, joinType: 'left', filter: null });
        return result.columns.map((column) => columnHeaderText(result.table, column.key)).sort();
      };
      expect(headers(a, b), puzzle.id).toEqual(headers(b, a));
    }
  });

  it('names columns as the slabs show them', () => {
    expect(puzzleText(getPuzzle('shop-never-ordered')).hints[2]).toContain('poke the NULL under O.ID.');
    expect(puzzleText(getPuzzle('library-no-due')).hints[1]).toContain('under DUE.');
    expect(puzzleText(getPuzzle('cafe-never-ordered')).hints[1]).toContain('under T.ID, not one under MILK');
    // A foreign-key column only appears on its source slab.
    expect(puzzleText(getPuzzle('school-no-club')).hints[0]).toContain('the CLUB ID column');
    expect(puzzleText(getPuzzle('school-twice')).hints[1]).toContain('the ID column of the clubs table');
  });

  it('throws on a placeholder for a column that is not shown', () => {
    const puzzle = getPuzzle('shop-match');
    // The foreign key is dropped from the result.
    expect(() => renderPuzzleText(puzzle, '{orders.customerId}')).toThrow();
    expect(() => renderPuzzleText(puzzle, '{orders.nope}')).toThrow();
    expect(() => renderPuzzleText(puzzle, '{source:books.id}')).toThrow();
    expect(renderPuzzleText(puzzle, '{source:orders.customerId}')).toBe('CUST ID');
  });
});
