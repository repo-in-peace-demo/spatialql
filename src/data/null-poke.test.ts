import { describe, expect, it } from 'vitest';
import { getPuzzle, runPuzzleQuery } from './puzzles.js';
import { filterForColumn, nullFilterMask, nullPokeEvent } from './query.js';

describe('a press on a NULL cell', () => {
  const due = { tableId: 'books', column: 'due' };
  const borrower = { tableId: 'borrowers', column: 'id' };

  it('sets the filter, switches it, or does nothing; it never clears it', () => {
    expect(nullPokeEvent(null, due)).toBe('set');
    expect(nullPokeEvent(due, borrower)).toBe('switch');
    expect(nullPokeEvent(due, { ...due })).toBe('none');
  });

  it('filters by column: one press keeps every row with a NULL there', () => {
    const puzzle = getPuzzle('library-on-shelf');
    const output = runPuzzleQuery(puzzle, { left: 'books', right: 'borrowers', joinType: 'left', filter: null });
    const dueColumn = output.result.columns.findIndex((column) => column.source === 'left' && column.sourceColumn === 'due');
    const filter = filterForColumn(output.left, output.right, output.result, dueColumn);
    const kept = nullFilterMask(output.left, output.right, output.result, filter).filter(Boolean).length;
    const nullDue = output.result.table.rows.filter((row) => row[output.result.columns[dueColumn].key] === null).length;
    expect(kept).toBe(nullDue);
    expect(kept).toBeGreaterThan(1);
  });
});
