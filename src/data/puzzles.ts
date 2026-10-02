/**
 * Challenge-mode puzzles, authored as data. Structure only: the goal text,
 * hints and win notes live in `copy.ts`, keyed by puzzle id.
 *
 * A puzzle's target is defined by running its `solution` query on the same
 * engine the scene uses. Since that alone would be circular, every puzzle
 * also lists its `expected` rows by hand, as readable labels, and the tests
 * check that the two agree. The tests also prove each puzzle is solvable
 * with the available actions and fits the row caps.
 *
 * Solution notation in comments: "A <- B" means B is brought to A, so A
 * stays put and is the LEFT table.
 */

import { DATASETS, type DatasetId } from './datasets.js';
import type { FanOutCause } from './compare.js';
import { runQuery, type QueryOutput, type QuerySpec } from './query.js';

/** Source slabs show at most this many rows (mirrors MAX_VISIBLE_ROWS in table-slab-view.ts). */
export const SOURCE_ROW_CAP = 8;
/** A result slab shows at most this many rows (mirrors MAX_RESULT_ROWS in table-slab-view.ts). */
export const RESULT_ROW_CAP = 12;

export const CONCEPTS = ['inner', 'left', 'direction', 'fanout', 'antijoin', 'nullfk', 'nullvalue'] as const;
export type Concept = (typeof CONCEPTS)[number];

export type PuzzleId =
  | 'shop-match'
  | 'shop-every-customer'
  | 'shop-never-ordered'
  | 'library-fanout'
  | 'shop-every-order'
  | 'library-on-shelf'
  | 'library-nothing-out'
  | 'school-twice'
  | 'library-every-book'
  | 'library-no-due'
  | 'shop-no-customer'
  | 'school-every-club'
  | 'school-empty-club'
  | 'school-every-student'
  | 'school-no-club'
  | 'cafe-menu'
  | 'cafe-missing-drink'
  | 'cafe-no-milk'
  | 'cafe-every-ticket'
  | 'cafe-never-ordered';

export type Puzzle = {
  id: PuzzleId;
  datasetId: DatasetId;
  /**
   * The two tables on the desk, parent (referenced) first. This order is
   * also the order of the parts of a readable row label.
   */
  tables: readonly [string, string];
  concept: Concept;
  /** One known solution; the target is its result. */
  solution: QuerySpec;
  /**
   * The target's rows, written by hand as `"<parent label> / <child label>"`
   * (`NULL` for a side with no source row), in any order.
   */
  expected: readonly string[];
  /** Index into the target's rows to show filled in the silhouette. */
  revealRow?: number;
  /** On a win, highlight rows that repeat for this reason (fan-out puzzles). */
  fanOutHighlight?: FanOutCause;
};

const inner = (left: string, right: string): QuerySpec => ({ left, right, joinType: 'inner', filter: null });
const leftJoin = (left: string, right: string): QuerySpec => ({ left, right, joinType: 'left', filter: null });
const antiJoin = (left: string, right: string, tableId: string, column: string): QuerySpec => ({
  left,
  right,
  joinType: 'left',
  filter: { tableId, column },
});

// Expected rows shared by several puzzles of a dataset.
const SHOP_MATCHED = [
  'Alderly Finch / 104',
  'Alderly Finch / 107',
  'Priya Shah / 101',
  'Priya Shah / 102',
  'Priya Shah / 103',
  'Marcus Webb / 101',
  'Marcus Webb / 102',
  'Marcus Webb / 103',
  'Tomas Reyes / 105',
  'Jun Park / 106',
];
const LIBRARY_MATCHED = [
  'Wren Halloway / The Glass Orchard',
  'Wren Halloway / A Map of Rain',
  'Mirela Okafor / Salt and Lantern',
  'Mirela Okafor / Tidewater',
  'Ikaika Dunn / North of Nowhere',
  'Sunniva Lake / The Quiet Engine',
];
const SCHOOL_MATCHED = [
  'Choir / Ines Vale',
  'Drama / Ines Vale',
  'Chess / Tobiah Marsh',
  'Chess / Hana Brook',
  'Robotics / Kemi Ardent',
  'Robotics / Pell Quinn',
];
const CAFE_MATCHED = [
  'Flat White / 401',
  'Flat White / 404',
  'Chai / 403',
  'Chai / 408',
  'Cold Brew / 402',
  'Cold Brew / 406',
  'Cocoa / 405',
];

const SHOP = ['customers', 'orders'] as const;
const LIBRARY = ['borrowers', 'books'] as const;
const SCHOOL = ['clubs', 'students'] as const;
const CAFE = ['drinks', 'tickets'] as const;

/** Every puzzle, in practice (unlock) order. */
export const PUZZLES: readonly Puzzle[] = [
  // 1. The tutorial: any join wins.
  {
    id: 'shop-match',
    datasetId: 'shop',
    tables: SHOP,
    concept: 'inner',
    solution: inner('customers', 'orders'),
    expected: SHOP_MATCHED,
  },
  // 2. customers <- orders, LEFT.
  {
    id: 'shop-every-customer',
    datasetId: 'shop',
    tables: SHOP,
    concept: 'left',
    solution: leftJoin('customers', 'orders'),
    expected: [...SHOP_MATCHED, 'Odalys Ferreira / NULL'],
    revealRow: 0,
  },
  // 3. customers <- orders, LEFT, WHERE o.id IS NULL. Introduces the NULL poke.
  {
    id: 'shop-never-ordered',
    datasetId: 'shop',
    tables: SHOP,
    concept: 'antijoin',
    solution: antiJoin('customers', 'orders', 'orders', 'id'),
    expected: ['Odalys Ferreira / NULL'],
  },
  // 4. Any INNER; Wren and Mirela each appear twice (one-to-many).
  {
    id: 'library-fanout',
    datasetId: 'library',
    tables: LIBRARY,
    concept: 'fanout',
    solution: inner('borrowers', 'books'),
    expected: LIBRARY_MATCHED,
    fanOutHighlight: 'oneToMany',
  },
  // 5. orders <- customers, LEFT.
  {
    id: 'shop-every-order',
    datasetId: 'shop',
    tables: SHOP,
    concept: 'direction',
    solution: leftJoin('orders', 'customers'),
    expected: [...SHOP_MATCHED, 'NULL / 108'],
    revealRow: 0,
  },
  // 6. books <- borrowers, LEFT, WHERE br.id IS NULL.
  {
    id: 'library-on-shelf',
    datasetId: 'library',
    tables: LIBRARY,
    concept: 'nullfk',
    solution: antiJoin('books', 'borrowers', 'borrowers', 'id'),
    expected: ['NULL / Paper Moons', 'NULL / Small Hours'],
  },
  // 7. borrowers <- books, LEFT, WHERE bk.id IS NULL.
  {
    id: 'library-nothing-out',
    datasetId: 'library',
    tables: LIBRARY,
    concept: 'antijoin',
    solution: antiJoin('borrowers', 'books', 'books', 'id'),
    expected: ['Basil Thorne / NULL'],
  },
  // 8. Any INNER; Ines appears twice because two clubs share id 3.
  {
    id: 'school-twice',
    datasetId: 'school',
    tables: SCHOOL,
    concept: 'fanout',
    solution: inner('clubs', 'students'),
    expected: SCHOOL_MATCHED,
    fanOutHighlight: 'duplicateKey',
  },
  // 9. books <- borrowers, LEFT.
  {
    id: 'library-every-book',
    datasetId: 'library',
    tables: LIBRARY,
    concept: 'direction',
    solution: leftJoin('books', 'borrowers'),
    expected: [...LIBRARY_MATCHED, 'NULL / Paper Moons', 'NULL / Small Hours'],
    revealRow: 0,
  },
  // 10. Any INNER, WHERE bk.due IS NULL. In a LEFT result the same filter also keeps unmatched rows.
  {
    id: 'library-no-due',
    datasetId: 'library',
    tables: LIBRARY,
    concept: 'nullvalue',
    solution: { ...inner('borrowers', 'books'), filter: { tableId: 'books', column: 'due' } },
    expected: ['Ikaika Dunn / North of Nowhere'],
  },
  // 11. orders <- customers, LEFT, WHERE c.id IS NULL.
  {
    id: 'shop-no-customer',
    datasetId: 'shop',
    tables: SHOP,
    concept: 'nullfk',
    solution: antiJoin('orders', 'customers', 'customers', 'id'),
    expected: ['NULL / 108'],
  },
  // 12. clubs <- students, LEFT.
  {
    id: 'school-every-club',
    datasetId: 'school',
    tables: SCHOOL,
    concept: 'left',
    solution: leftJoin('clubs', 'students'),
    expected: [...SCHOOL_MATCHED, 'Gardening / NULL'],
    revealRow: 0,
  },
  // 13. clubs <- students, LEFT, WHERE st.id IS NULL.
  {
    id: 'school-empty-club',
    datasetId: 'school',
    tables: SCHOOL,
    concept: 'antijoin',
    solution: antiJoin('clubs', 'students', 'students', 'id'),
    expected: ['Gardening / NULL'],
  },
  // 14. students <- clubs, LEFT.
  {
    id: 'school-every-student',
    datasetId: 'school',
    tables: SCHOOL,
    concept: 'direction',
    solution: leftJoin('students', 'clubs'),
    expected: [...SCHOOL_MATCHED, 'NULL / Lio Sandoval', 'NULL / Odette Rue'],
    revealRow: 0,
  },
  // 15. students <- clubs, LEFT, WHERE cl.id IS NULL. A NULL club id and an unknown one (9) both miss.
  {
    id: 'school-no-club',
    datasetId: 'school',
    tables: SCHOOL,
    concept: 'nullfk',
    solution: antiJoin('students', 'clubs', 'clubs', 'id'),
    expected: ['NULL / Lio Sandoval', 'NULL / Odette Rue'],
  },
  // 16. drinks <- tickets, LEFT.
  {
    id: 'cafe-menu',
    datasetId: 'cafe',
    tables: CAFE,
    concept: 'left',
    solution: leftJoin('drinks', 'tickets'),
    expected: [...CAFE_MATCHED, 'Matcha / NULL'],
    revealRow: 0,
  },
  // 17. tickets <- drinks, LEFT, WHERE d.id IS NULL.
  {
    id: 'cafe-missing-drink',
    datasetId: 'cafe',
    tables: CAFE,
    concept: 'nullfk',
    solution: antiJoin('tickets', 'drinks', 'drinks', 'id'),
    expected: ['NULL / 407'],
  },
  // 18. Any INNER (or tickets <- drinks, LEFT), WHERE t.milk IS NULL.
  {
    id: 'cafe-no-milk',
    datasetId: 'cafe',
    tables: CAFE,
    concept: 'nullvalue',
    solution: { ...inner('drinks', 'tickets'), filter: { tableId: 'tickets', column: 'milk' } },
    expected: ['Cold Brew / 402', 'Cold Brew / 406'],
  },
  // 19. tickets <- drinks, LEFT.
  {
    id: 'cafe-every-ticket',
    datasetId: 'cafe',
    tables: CAFE,
    concept: 'direction',
    solution: leftJoin('tickets', 'drinks'),
    expected: [...CAFE_MATCHED, 'NULL / 407'],
    revealRow: 0,
  },
  // 20. drinks <- tickets, LEFT, WHERE t.id IS NULL. The trap: filtering on milk also keeps 402 and 406.
  {
    id: 'cafe-never-ordered',
    datasetId: 'cafe',
    tables: CAFE,
    concept: 'antijoin',
    solution: antiJoin('drinks', 'tickets', 'tickets', 'id'),
    expected: ['Matcha / NULL'],
  },
];

/** Unlock order (the order of `PUZZLES`). */
export const PRACTICE_ORDER: readonly PuzzleId[] = PUZZLES.map((puzzle) => puzzle.id);

/**
 * Which puzzle is the daily, by day since `DAILY_EPOCH` (daily.ts). Every
 * puzzle once; datasets rotate shop -> library -> school -> cafe so two
 * consecutive days (including the wrap-around) never share tables.
 */
export const DAILY_SCHEDULE: readonly PuzzleId[] = [
  'shop-every-customer',
  'library-fanout',
  'school-empty-club',
  'cafe-no-milk',
  'shop-never-ordered',
  'library-every-book',
  'school-twice',
  'cafe-missing-drink',
  'shop-match',
  'library-no-due',
  'school-every-student',
  'cafe-never-ordered',
  'shop-every-order',
  'library-on-shelf',
  'school-every-club',
  'cafe-menu',
  'shop-no-customer',
  'library-nothing-out',
  'school-no-club',
  'cafe-every-ticket',
];

const PUZZLES_BY_ID = new Map<string, Puzzle>(PUZZLES.map((puzzle) => [puzzle.id, puzzle]));

export function isPuzzleId(id: string): id is PuzzleId {
  return PUZZLES_BY_ID.has(id);
}

export function getPuzzle(id: PuzzleId): Puzzle {
  const puzzle = PUZZLES_BY_ID.get(id);
  if (!puzzle) {
    throw new Error(`No puzzle "${id}"`);
  }
  return puzzle;
}

/** The first puzzle in practice order with this concept: where its intro shows. */
export function introducesConcept(puzzle: Puzzle): boolean {
  return PUZZLES.find((candidate) => candidate.concept === puzzle.concept) === puzzle;
}

export function puzzleTables(puzzle: Puzzle) {
  const dataset = DATASETS[puzzle.datasetId];
  return puzzle.tables.map((id) => {
    const table = dataset.tables.find((t) => t.id === id);
    if (!table) {
      throw new Error(`Puzzle "${puzzle.id}": dataset "${dataset.id}" has no table "${id}"`);
    }
    return table;
  });
}

/** Runs a query on this puzzle's tables. */
export function runPuzzleQuery(puzzle: Puzzle, spec: QuerySpec): QueryOutput {
  return runQuery(puzzleTables(puzzle), spec);
}

/** The puzzle's target: its solution's result. */
export function puzzleTarget(puzzle: Puzzle): QueryOutput {
  return runPuzzleQuery(puzzle, puzzle.solution);
}

/**
 * A readable label for one result row, `"<parent label> / <child label>"`
 * in the puzzle's table order, with `NULL` for a side with no value.
 */
export function rowLabel(puzzle: Puzzle, output: QueryOutput, rowIndex: number): string {
  const { left, right, result } = output;
  const labelColumns = DATASETS[puzzle.datasetId].labelColumns;
  const row = result.table.rows[rowIndex];
  return puzzle.tables
    .map((tableId) => {
      const source = tableId === left.id ? 'left' : tableId === right.id ? 'right' : null;
      const column = result.columns.find((c) => c.source === source && c.sourceColumn === labelColumns[tableId]);
      const value = column ? row[column.key] : null;
      return value === null || value === undefined ? 'NULL' : String(value);
    })
    .join(' / ');
}

/**
 * Every query the player can reach: either table stays put, INNER or LEFT,
 * and no filter or an `IS NULL` filter on any result column. (A filter set
 * in LEFT survives a switch to INNER, so every column counts for both.)
 */
export function reachableSpecs(puzzle: Puzzle): QuerySpec[] {
  const [a, b] = puzzle.tables;
  const specs: QuerySpec[] = [];
  for (const [left, right] of [
    [a, b],
    [b, a],
  ] as const) {
    const columns = runPuzzleQuery(puzzle, { left, right, joinType: 'left', filter: null });
    for (const joinType of ['inner', 'left'] as const) {
      specs.push({ left, right, joinType, filter: null });
      columns.result.columns.forEach((column) => {
        specs.push({
          left,
          right,
          joinType,
          filter: { tableId: column.source === 'left' ? left : right, column: column.sourceColumn },
        });
      });
    }
  }
  return specs;
}
