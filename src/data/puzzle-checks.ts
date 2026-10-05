/**
 * One authored *wrong* state per puzzle, with the diff it must show: the
 * tests assert it, and the dev key `X` applies it in the app (so a runtime
 * check can compare the logged diff with these numbers). For the trap
 * puzzles (10, 18, 20) the wrong state is the trap.
 *
 * "A <- B" in comments: B brought to A, so A stays put and is LEFT.
 */

import type { PuzzleId } from './puzzles.js';
import type { QuerySpec } from './query.js';

export type PuzzleCheck = {
  wrong: QuerySpec;
  /** Rows the wrong state shows, how many aren't in the answer, and how many it's missing. */
  expect: { shown: number; extra: number; missing: number };
  trap?: true;
};

const join = (
  left: string,
  right: string,
  joinType: 'inner' | 'left',
  filter: QuerySpec['filter'] = null,
): QuerySpec => ({ left, right, joinType, filter });

export const PUZZLE_CHECKS: Readonly<Record<PuzzleId, PuzzleCheck>> = {
  // LEFT keeps Odalys, who isn't in the INNER answer.
  'shop-match': { wrong: join('customers', 'orders', 'left'), expect: { shown: 11, extra: 1, missing: 0 } },
  'shop-every-customer': { wrong: join('customers', 'orders', 'inner'), expect: { shown: 10, extra: 0, missing: 1 } },
  'shop-never-ordered': { wrong: join('customers', 'orders', 'left'), expect: { shown: 11, extra: 10, missing: 0 } },
  'library-fanout': { wrong: join('borrowers', 'books', 'left'), expect: { shown: 7, extra: 1, missing: 0 } },
  // The wrong table stayed put: Odalys in, order 108 out.
  'shop-every-order': { wrong: join('customers', 'orders', 'left'), expect: { shown: 11, extra: 1, missing: 1 } },
  'library-on-shelf': { wrong: join('books', 'borrowers', 'left'), expect: { shown: 8, extra: 6, missing: 0 } },
  'library-nothing-out': { wrong: join('borrowers', 'books', 'left'), expect: { shown: 7, extra: 6, missing: 0 } },
  'school-twice': { wrong: join('students', 'clubs', 'left'), expect: { shown: 8, extra: 2, missing: 0 } },
  'library-every-book': { wrong: join('borrowers', 'books', 'left'), expect: { shown: 7, extra: 1, missing: 2 } },
  // Trap: filtering on due in a LEFT result also keeps the books on the shelf.
  'library-no-due': {
    wrong: join('books', 'borrowers', 'left', { tableId: 'books', column: 'due' }),
    expect: { shown: 3, extra: 2, missing: 0 },
    trap: true,
  },
  'shop-no-customer': { wrong: join('orders', 'customers', 'left'), expect: { shown: 11, extra: 10, missing: 0 } },
  'school-every-club': { wrong: join('clubs', 'students', 'inner'), expect: { shown: 6, extra: 0, missing: 1 } },
  'school-empty-club': { wrong: join('clubs', 'students', 'left'), expect: { shown: 7, extra: 6, missing: 0 } },
  'school-every-student': { wrong: join('clubs', 'students', 'left'), expect: { shown: 7, extra: 1, missing: 2 } },
  'school-no-club': { wrong: join('students', 'clubs', 'left'), expect: { shown: 8, extra: 6, missing: 0 } },
  'cafe-menu': { wrong: join('drinks', 'tickets', 'inner'), expect: { shown: 7, extra: 0, missing: 1 } },
  'cafe-missing-drink': { wrong: join('tickets', 'drinks', 'left'), expect: { shown: 8, extra: 7, missing: 0 } },
  // Trap: keeping every drink adds Matcha to the milk filter.
  'cafe-no-milk': {
    wrong: join('drinks', 'tickets', 'left', { tableId: 'tickets', column: 'milk' }),
    expect: { shown: 3, extra: 1, missing: 0 },
    trap: true,
  },
  'cafe-every-ticket': { wrong: join('drinks', 'tickets', 'left'), expect: { shown: 8, extra: 1, missing: 1 } },
  // Trap: the milk NULLs are stored; only the ticket id finds the unmatched drink.
  'cafe-never-ordered': {
    wrong: join('drinks', 'tickets', 'left', { tableId: 'tickets', column: 'milk' }),
    expect: { shown: 3, extra: 2, missing: 0 },
    trap: true,
  },
};
