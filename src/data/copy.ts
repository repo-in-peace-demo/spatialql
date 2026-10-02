/**
 * Every player-facing string in challenge mode, in one place for review:
 * card goals, concept intros, hints, win lines, the puzzle bar, the diff
 * markers and the welcome panel.
 *
 * Writing rules:
 * - Plain words first; SQL appears only as the reward (the caption).
 * - Plain ASCII punctuation only (straight quotes, no em dashes): the
 *   bundled fonts may not have other glyphs.
 * - Goals fit the card's two lines: at most 72 characters (tested).
 * - Hints: tier 1 nudges, tier 2 names the action, tier 3 is the full
 *   answer. Using them never blocks winning.
 */

import type { DatasetId } from './datasets.js';
import type { Concept, PuzzleId } from './puzzles.js';

export type PuzzleCopy = {
  goal: string;
  hints: readonly [nudge: string, action: string, answer: string];
  /** Shown on the card after a win (the fan-out puzzles explain the surprise). */
  winNote?: string;
};

export const DATASET_TITLES: Readonly<Record<DatasetId, string>> = {
  shop: 'Corner shop',
  library: 'Library',
  school: 'School clubs',
  cafe: 'Cafe',
};

/** Shown on the card the first time a concept appears. */
export const CONCEPT_INTROS: Readonly<Record<Concept, string>> = {
  inner: 'Pinch a table, bring it to the other one, and let go.',
  left: 'New: LEFT keeps every row of the table that stayed put.',
  antijoin: "New: poke a NULL to keep only the rows where it's NULL.",
  fanout: 'New: one row can match several rows.',
  direction: 'New: which table stays put decides what LEFT keeps.',
  nullfk: 'New: a row can point to nothing.',
  nullvalue: 'New: NULL can be stored in a table, too.',
};

/** Shown the first time a NULL appears in a result. */
export const NULL_EXPLAINER = 'NULL means "nothing here".';

export const PUZZLE_COPY: Readonly<Record<PuzzleId, PuzzleCopy>> = {
  'shop-match': {
    goal: 'Match each order to the customer who placed it.',
    hints: [
      'Pinch a table, bring it to the other one, and let go.',
      'Any join works here. INNER keeps the rows that match on both sides.',
      'Bring orders over to customers (or customers to orders) and let go.',
    ],
  },
  'shop-every-customer': {
    goal: 'Show every customer and their orders, even customers with no orders.',
    hints: [
      'One customer has no orders. Which join keeps every customer?',
      'Try LEFT. It keeps every row of the table that stayed put.',
      'Leave customers where it is, bring orders over, let go, and choose LEFT.',
    ],
  },
  'shop-never-ordered': {
    goal: 'Which customer has never placed an order?',
    hints: [
      'A LEFT join fills in NULL where nothing matched.',
      'Join with LEFT, then poke a NULL to keep only the rows with no match.',
      'Leave customers where it is, bring orders over, choose LEFT, then poke a NULL under the order ID.',
    ],
  },
  'library-fanout': {
    goal: 'Show each borrower next to every book they have out.',
    hints: [
      'Bring one table to the other. Count the rows: more than 5 borrowers?',
      'Any join with INNER works. Watch who appears twice.',
      'Bring books over to borrowers (or the other way) and let go.',
    ],
    winNote:
      'Wren and Mirela each have two books out, so each appears twice. A join repeats a row once per match.',
  },
  'shop-every-order': {
    goal: 'Show every order and who placed it, even an order with no customer.',
    hints: [
      'LEFT keeps every row of the table that stayed put. Which one should stay?',
      'This time, leave orders where it is and bring customers over.',
      'Leave orders where it is, bring customers over, let go, and choose LEFT.',
    ],
  },
  'library-on-shelf': {
    goal: 'Which books are still on the shelf?',
    hints: [
      'A book on the shelf has no borrower.',
      'Keep books still, bring borrowers over, choose LEFT, and look for NULL borrowers.',
      'Leave books where it is, bring borrowers over, choose LEFT, then poke a NULL under the borrower ID.',
    ],
  },
  'library-nothing-out': {
    goal: 'Which borrower has nothing checked out?',
    hints: [
      'A LEFT join fills in NULL where nothing matched.',
      'Keep borrowers still, choose LEFT, then poke a NULL in a book column.',
      'Leave borrowers where it is, bring books over, choose LEFT, then poke a NULL under the book ID.',
    ],
  },
  'school-twice': {
    goal: 'Pair each student with their club. One student shows up twice: why?',
    hints: [
      'Bring one table to the other, then count the rows.',
      'Any join with INNER works. Then look at the club IDs.',
      'Bring students over to clubs (or the other way) and let go.',
    ],
    winNote: 'Choir and Drama share club id 3, so Ines appears twice. A data-entry mistake makes a join multiply rows.',
  },
  'library-every-book': {
    goal: 'List every book, and who has it, if anyone.',
    hints: [
      'Some books have no borrower. Which table should stay put?',
      'Leave books where it is and choose LEFT.',
      'Leave books where it is, bring borrowers over, let go, and choose LEFT.',
    ],
  },
  'library-no-due': {
    goal: 'Which borrowed book has no due date?',
    hints: [
      'NULL can be stored in a table, too. Look at the due dates.',
      'INNER keeps only borrowed books. Then poke the NULL due date.',
      'Join with INNER (either way), then poke the NULL under Due.',
    ],
  },
  'shop-no-customer': {
    goal: 'Which order has no customer on file?',
    hints: [
      'One order points to no customer.',
      'Keep orders still, choose LEFT, then poke a NULL in a customer column.',
      'Leave orders where it is, bring customers over, choose LEFT, then poke a NULL under the customer ID.',
    ],
  },
  'school-every-club': {
    goal: 'Show every club with its members, including empty clubs.',
    hints: [
      'One club has no members. Which join keeps every club?',
      'Leave clubs where it is and choose LEFT.',
      'Leave clubs where it is, bring students over, let go, and choose LEFT.',
    ],
  },
  'school-empty-club': {
    goal: 'Which club has no members yet?',
    hints: [
      'A LEFT join fills in NULL where nothing matched.',
      'Keep clubs still, choose LEFT, then poke a NULL in a student column.',
      'Leave clubs where it is, bring students over, choose LEFT, then poke a NULL under the student ID.',
    ],
  },
  'school-every-student': {
    goal: 'Show every student and their club, even students without one.',
    hints: [
      'Some students have no club. Which table should stay put?',
      'Leave students where it is and choose LEFT.',
      'Leave students where it is, bring clubs over, let go, and choose LEFT.',
    ],
  },
  'school-no-club': {
    goal: "Which students aren't in any club we know of?",
    hints: [
      "Look at the club IDs: one is empty, and one points to a club that doesn't exist.",
      'Keep students still, choose LEFT, then poke a NULL in a club column.',
      'Leave students where it is, bring clubs over, choose LEFT, then poke a NULL under the club ID.',
    ],
  },
  'cafe-menu': {
    goal: 'Show the whole menu with its tickets, including drinks nobody ordered.',
    hints: [
      'Nobody ordered one of the drinks. Which join keeps every drink?',
      'Leave drinks where it is and choose LEFT.',
      'Leave drinks where it is, bring tickets over, let go, and choose LEFT.',
    ],
  },
  'cafe-missing-drink': {
    goal: 'Which ticket is missing its drink?',
    hints: [
      'One ticket points to no drink.',
      'Keep tickets still, choose LEFT, then poke a NULL in a drink column.',
      'Leave tickets where it is, bring drinks over, choose LEFT, then poke a NULL under the drink ID.',
    ],
  },
  'cafe-no-milk': {
    goal: 'Which tickets were made without milk?',
    hints: [
      'NULL can be stored in a table, too. Look at the milk column.',
      'Join, then poke a NULL under Milk.',
      'Join with INNER (either way), then poke a NULL under Milk.',
    ],
  },
  'cafe-every-ticket': {
    goal: 'Show every ticket and its drink, even one with no drink recorded.',
    hints: [
      'One ticket has no drink. Which table should stay put?',
      'Leave tickets where it is and choose LEFT.',
      'Leave tickets where it is, bring drinks over, let go, and choose LEFT.',
    ],
  },
  'cafe-never-ordered': {
    goal: 'Which drink has never been ordered?',
    hints: [
      'A LEFT join fills in NULL where nothing matched. But milk can be NULL, too.',
      'Keep drinks still, choose LEFT, then poke a NULL ticket ID, not a NULL milk.',
      'Leave drinks where it is, bring tickets over, choose LEFT, then poke the NULL under the ticket ID.',
    ],
  },
};

// --- The card -------------------------------------------------------------------

export const CARD = {
  practiceTitle: (number: number, dataset: DatasetId) => `Puzzle ${number}: ${DATASET_TITLES[dataset]}`,
  dailyTitle: (dataset: DatasetId) => `Today's puzzle: ${DATASET_TITLES[dataset]}`,
  /** Win line, normally. */
  win: 'You just wrote this query.',
  /** Win line when the full-answer hint was shown. */
  winWithAnswer: "That's this query:",
  solvedWithHints: (count: number) => (count === 1 ? 'Solved with 1 hint.' : `Solved with ${count} hints.`),
  missingRows: (count: number) => (count === 1 ? '1 row missing' : `${count} rows missing`),
  extraRows: (count: number) => (count === 1 ? '1 row not in the answer' : `${count} rows not in the answer`),
  emptyResult: 'No rows',
};

// --- The puzzle bar (next to INNER | LEFT) --------------------------------------------

export const BAR = {
  hint: 'Hint',
  next: 'Next',
  prev: 'Prev',
  daily: 'Today',
  /** The filter chip: the WHERE clause, then this. */
  clearFilter: 'Clear',
};

// --- Diff markers on the result slab ---------------------------------------------------

export const DIFF = {
  /** Gutter glyph on a row that isn't in the answer. */
  extraMarker: '+',
  /** Text in a placeholder row the answer still needs. */
  missingMarker: '?',
};

// --- Welcome panel (browser) -----------------------------------------------------------

export const WELCOME = {
  start: 'Start',
  freePlay: 'Free play',
  practiceProgress: (solved: number, total: number) => `Practice ${solved}/${total}`,
  dailyOpen: (dataset: DatasetId) => `Today's puzzle: ${DATASET_TITLES[dataset]}`,
  dailyDone: "Today's puzzle: solved",
  streak: (days: number) => (days === 1 ? 'Streak: 1 day' : `Streak: ${days} days`),
  streakAtRisk: 'Solve today to keep it.',
  saveUnavailable: "Progress can't be saved in this browser.",
};
