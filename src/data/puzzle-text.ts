/**
 * A puzzle's player-facing text with its column placeholders resolved to
 * the headers the player sees (see the rules in `copy.ts`):
 *
 * - `{table.column}` -> the join result's header, e.g. `{orders.id}` ->
 *   `O.ID`. Result labels are the same in either join direction (the same
 *   columns collide), so one lookup holds for the whole puzzle.
 * - `{source:table.column}` -> that source slab's header, e.g.
 *   `{source:students.clubId}` -> `CLUB ID`.
 *
 * Headers come from `columnHeaderText`, which the slabs also render with.
 * An unknown table or column throws, so a typo fails the tests rather than
 * reaching a player.
 */

import { PUZZLE_COPY } from './copy.js';
import { columnHeaderText } from './join-result.js';
import { puzzleTables, runPuzzleQuery, type Puzzle } from './puzzles.js';
import { filterColumnIndex } from './query.js';

const PLACEHOLDER = /\{(source:)?([A-Za-z_]\w*)\.([A-Za-z_]\w*)\}/g;

/** The result slab header for a source column, or null if the result doesn't show it. */
export function resultHeader(puzzle: Puzzle, tableId: string, column: string): string | null {
  const [a, b] = puzzle.tables;
  const { left, right, result } = runPuzzleQuery(puzzle, { left: a, right: b, joinType: 'left', filter: null });
  const index = filterColumnIndex(left, right, result, { tableId, column });
  return index < 0 ? null : columnHeaderText(result.table, result.columns[index].key);
}

/** A source slab's header, or null if that table has no such column. */
export function sourceHeader(puzzle: Puzzle, tableId: string, column: string): string | null {
  const table = puzzleTables(puzzle).find((t) => t.id === tableId);
  return table && table.columns.includes(column) ? columnHeaderText(table, column) : null;
}

/** Every header the result slab shows for this puzzle. */
export function resultHeaders(puzzle: Puzzle): string[] {
  const [a, b] = puzzle.tables;
  const { result } = runPuzzleQuery(puzzle, { left: a, right: b, joinType: 'left', filter: null });
  return result.columns.map((column) => columnHeaderText(result.table, column.key));
}

export function renderPuzzleText(puzzle: Puzzle, text: string): string {
  return text.replace(PLACEHOLDER, (placeholder, source: string | undefined, tableId: string, column: string) => {
    const header = source ? sourceHeader(puzzle, tableId, column) : resultHeader(puzzle, tableId, column);
    if (header === null) {
      throw new Error(`Puzzle "${puzzle.id}": no ${source ? 'source' : 'result'} column for ${placeholder}`);
    }
    return header;
  });
}

export type PuzzleText = {
  goal: string;
  hints: [string, string, string];
  winNote: string | null;
};

export function puzzleText(puzzle: Puzzle): PuzzleText {
  const copy = PUZZLE_COPY[puzzle.id];
  const render = (text: string) => renderPuzzleText(puzzle, text);
  return {
    goal: render(copy.goal),
    hints: [render(copy.hints[0]), render(copy.hints[1]), render(copy.hints[2])],
    winNote: copy.winNote === undefined ? null : render(copy.winNote),
  };
}
