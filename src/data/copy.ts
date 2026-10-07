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
 * - Tables are named as tables: "the customers table".
 * - Columns are never written by hand. Puzzle text names a column with a
 *   placeholder that `puzzle-text.ts` replaces with the header the player
 *   sees, from the same metadata the slabs use:
 *   - `{orders.id}`: the join result's header (`O.ID`), for "filter where
 *     ... is NULL" (the Filter chip shows the same header);
 *   - `{source:students.clubId}`: a source slab's header (`CLUB ID`), e.g.
 *     for a foreign-key column, which the result doesn't show.
 */

import type { DatasetId } from './datasets.js';
import type { Concept, PuzzleId } from './puzzles.js';

export type PuzzleCopy = {
  goal: string;
  hints: readonly [nudge: string, action: string, answer: string];
  /**
   * On a win, why it worked, in one plain line (at most 60 characters,
   * tested). The fan-out puzzles explain their surprise in up to two lines.
   */
  takeaway: string;
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
  antijoin: "New: poke a NULL in the result to keep only the rows where it's NULL.",
  fanout: 'New: one row can match several rows.',
  direction: 'New: which table stays put decides what LEFT keeps.',
  nullfk: 'New: some rows point to nothing, or to a missing row.',
  nullvalue: 'New: NULL can be stored in a table, too.',
};

/** Shown the first time a NULL appears in a result. */
export const NULL_EXPLAINER = 'NULL means "nothing here".';

export const PUZZLE_COPY: Readonly<Record<PuzzleId, PuzzleCopy>> = {
  'shop-match': {
    goal: 'Match each order to the customer who placed it.',
    takeaway: 'Each order found its customer. INNER keeps only matches.',
    hints: [
      'Bring the two tables together.',
      'Any join works here. INNER keeps the rows that match on both sides.',
      'Bring the orders table over to the customers table (or the other way) and let go.',
    ],
  },
  'shop-every-customer': {
    goal: 'Show every customer and their orders, even customers with no orders.',
    takeaway: 'LEFT kept Odalys, even with no orders.',
    hints: [
      'One customer has no orders. Which join keeps every customer?',
      'Try LEFT. It keeps every row of the table that stayed put.',
      'Leave the customers table where it is, bring the orders table over, let go, and choose LEFT.',
    ],
  },
  'shop-never-ordered': {
    goal: 'Which customer has never placed an order?',
    takeaway: 'LEFT kept Odalys; her NULL showed she never ordered.',
    hints: [
      'A LEFT join fills in NULL where nothing matched.',
      'Join with LEFT, then keep only the rows with no match: press Filter, or poke a NULL in the result.',
      'Keep the customers table still, bring the orders table over, choose LEFT, then filter where {orders.id} is NULL (press Filter, or poke that NULL in the result).',
    ],
  },
  'library-fanout': {
    goal: 'Show each borrower next to every book they have out.',
    hints: [
      'Count the rows: are there more than 5?',
      'Any join with INNER works. Watch who appears twice.',
      'Bring the books table over to the borrowers table (or the other way) and let go.',
    ],
    takeaway: 'Wren and Mirela each have two books out, so each appears twice. A join repeats a row once per match.',
  },
  'shop-every-order': {
    goal: 'Show every order and who placed it, even an order with no customer.',
    takeaway: 'Orders stayed put, so LEFT kept order 108.',
    hints: [
      'LEFT keeps every row of the table that stayed put. Which one should stay?',
      'This time, leave the orders table where it is and bring the customers table over.',
      'Leave the orders table where it is, bring the customers table over, let go, and choose LEFT.',
    ],
  },
  'library-on-shelf': {
    goal: 'Which books are still on the shelf?',
    takeaway: 'No borrower, so those books are still on the shelf.',
    hints: [
      'A book on the shelf has no borrower.',
      'Keep the books table still, bring the borrowers table over, choose LEFT, and look for NULL borrowers.',
      'Keep the books table still, bring the borrowers table over, choose LEFT, then filter where {borrowers.id} is NULL (press Filter, or poke that NULL in the result).',
    ],
  },
  'library-nothing-out': {
    goal: 'Which borrower has nothing checked out?',
    takeaway: 'No book matched, so this borrower has nothing out.',
    hints: [
      'A LEFT join fills in NULL where nothing matched.',
      'Keep the borrowers table still, choose LEFT, then filter on a book column: press Filter, or poke a NULL in the result.',
      'Keep the borrowers table still, bring the books table over, choose LEFT, then filter where {books.id} is NULL (press Filter, or poke that NULL in the result).',
    ],
  },
  'school-twice': {
    goal: 'Pair each student with their club. One student shows up twice: why?',
    hints: [
      'Bring one table to the other, then count the rows.',
      'Any join with INNER works. Then look at the {source:clubs.id} column of the clubs table.',
      'Bring the students table over to the clubs table (or the other way) and let go.',
    ],
    takeaway:
      'Choir and Drama share {source:clubs.id} 3, so Ines appears twice. A duplicated ID makes a join repeat rows.',
  },
  'library-every-book': {
    goal: 'List every book, and who has it, if anyone.',
    takeaway: 'Books stayed put, so LEFT kept every book.',
    hints: [
      'Some books have no borrower. Which table should stay put?',
      'Leave the books table where it is and choose LEFT.',
      'Leave the books table where it is, bring the borrowers table over, let go, and choose LEFT.',
    ],
  },
  'library-no-due': {
    goal: 'Which borrowed book has no due date?',
    takeaway: 'This NULL was in the table, not made by the join.',
    hints: [
      'NULL can be stored in a table, too. Look at the {books.due} column.',
      'INNER keeps only borrowed books. Then filter where {books.due} is NULL: press Filter, or poke that NULL in the result.',
      'Bring either table to the other, keep INNER, then filter where {books.due} is NULL (press Filter, or poke that NULL in the result).',
    ],
  },
  'shop-no-customer': {
    goal: 'Which order has no customer on file?',
    takeaway: 'Same trick, other side: order 108 has no customer.',
    hints: [
      'One order points to no customer.',
      'Keep the orders table still, choose LEFT, then filter on a customer column: press Filter, or poke a NULL in the result.',
      'Keep the orders table still, bring the customers table over, choose LEFT, then filter where {customers.id} is NULL (press Filter, or poke that NULL in the result).',
    ],
  },
  'school-every-club': {
    goal: 'Show every club with its members, including empty clubs.',
    takeaway: 'Clubs stayed put, so LEFT kept the empty club.',
    hints: [
      'One club has no members. Which join keeps every club?',
      'Leave the clubs table where it is and choose LEFT.',
      'Leave the clubs table where it is, bring the students table over, let go, and choose LEFT.',
    ],
  },
  'school-empty-club': {
    goal: 'Which club has no members yet?',
    takeaway: 'No student matched, so this club has no members.',
    hints: [
      'A LEFT join fills in NULL where nothing matched.',
      'Keep the clubs table still, choose LEFT, then filter on a student column: press Filter, or poke a NULL in the result.',
      'Keep the clubs table still, bring the students table over, choose LEFT, then filter where {students.id} is NULL (press Filter, or poke that NULL in the result).',
    ],
  },
  'school-every-student': {
    goal: 'Show every student and their club, even students without one.',
    takeaway: 'Students stayed put, so LEFT kept everyone.',
    hints: [
      'Some students have no club. Which table should stay put?',
      'Leave the students table where it is and choose LEFT.',
      'Leave the students table where it is, bring the clubs table over, let go, and choose LEFT.',
    ],
  },
  'school-no-club': {
    goal: "Which students aren't in any club we know of?",
    takeaway: 'A blank {source:students.clubId} and an unknown one both match nothing.',
    hints: [
      "Look at the {source:students.clubId} column: one is empty, and one points to a club that doesn't exist.",
      'Keep the students table still, choose LEFT, then filter on a club column: press Filter, or poke a NULL in the result.',
      'Keep the students table still, bring the clubs table over, choose LEFT, then filter where {clubs.id} is NULL (press Filter, or poke that NULL in the result).',
    ],
  },
  'cafe-menu': {
    goal: 'Show the whole menu with its tickets, including drinks nobody ordered.',
    takeaway: 'Drinks stayed put, so LEFT kept the unsold drink.',
    hints: [
      'Nobody ordered one of the drinks. Which join keeps every drink?',
      'Leave the drinks table where it is and choose LEFT.',
      'Leave the drinks table where it is, bring the tickets table over, let go, and choose LEFT.',
    ],
  },
  'cafe-missing-drink': {
    goal: 'Which ticket is missing its drink?',
    takeaway: 'This ticket points to no drink, so nothing matched.',
    hints: [
      'One ticket points to no drink.',
      'Keep the tickets table still, choose LEFT, then filter on a drink column: press Filter, or poke a NULL in the result.',
      'Keep the tickets table still, bring the drinks table over, choose LEFT, then filter where {drinks.id} is NULL (press Filter, or poke that NULL in the result).',
    ],
  },
  'cafe-no-milk': {
    goal: 'Which tickets were made without milk?',
    takeaway: 'These NULLs were in the table, not made by the join.',
    hints: [
      'NULL can be stored in a table, too. Look at the {tickets.milk} column.',
      'Join with INNER, then filter where {tickets.milk} is NULL: press Filter, or poke one of those NULLs in the result.',
      'Bring either table to the other, keep INNER, then filter where {tickets.milk} is NULL (press Filter, or poke one of those NULLs in the result).',
    ],
  },
  'cafe-every-ticket': {
    goal: 'Show every ticket and its drink, even one with no drink recorded.',
    takeaway: 'Tickets stayed put, so LEFT kept every ticket.',
    hints: [
      'One ticket has no drink. Which table should stay put?',
      'Leave the tickets table where it is and choose LEFT.',
      'Leave the tickets table where it is, bring the drinks table over, let go, and choose LEFT.',
    ],
  },
  'cafe-never-ordered': {
    goal: 'Which drink has never been ordered?',
    takeaway: "The NULL under {tickets.id} means no match; {tickets.milk}'s doesn't.",
    hints: [
      'A LEFT join fills in NULL where nothing matched. But {tickets.milk} can be NULL, too.',
      'Keep the drinks table still, choose LEFT, then filter where {tickets.id} is NULL, not {tickets.milk} (press Filter, or poke that NULL in the result).',
      'Keep the drinks table still, bring the tickets table over, choose LEFT, then filter where {tickets.id} is NULL (press Filter, or poke that NULL in the result).',
    ],
  },
};

// --- The card -------------------------------------------------------------------

export const CARD = {
  practiceTitle: (number: number, dataset: DatasetId) => `Puzzle ${number}: ${DATASET_TITLES[dataset]}`,
  dailyTitle: (dataset: DatasetId) => `Today's puzzle: ${DATASET_TITLES[dataset]}`,
  /** Win headline (large, gold): solved with at most two hints. */
  headline: 'Solved!',
  /** Headline after "Show answer" (large, neutral): completed, not solved. */
  completedHeadline: 'Completed',
  /** The title row's right-hand slot after "Show answer". */
  usedAllHints: 'You used all 3 hints.',
  /** A daily completed after "Show answer": why the streak didn't grow. */
  streakNeedsSolve: 'Streak needs a solve without the answer.',
  /** Next pressed before the puzzle is done (briefly, in the title row's right-hand slot). */
  solveFirst: 'Solve it first, or use Hint.',
  /** Under the answer (after "Show answer"): the moves still finish it, or Next (now Skip) moves on. */
  answerNext: 'Make these moves to finish, or skip.',
  /** Win query line, pointing to the highlighted caption on the result slab below. */
  win: 'Your moves wrote this query:',
  /** The query line when the full-answer hint was shown (honest: the moves were given). */
  winWithAnswer: "That's this query:",
  solvedWithHints: (count: number) => (count === 1 ? 'Solved with 1 hint.' : `Solved with ${count} hints.`),
  missingRows: (count: number) => (count === 1 ? '1 row missing' : `${count} rows missing`),
  extraRows: (count: number) => (count === 1 ? '1 row not in the answer' : `${count} rows not in the answer`),
  emptyResult: 'No rows',
  /** After the last available puzzle. */
  morePuzzlesSoon: 'More puzzles soon.',
  /** Next was pressed while a table is held: the switch waits for the release. */
  letGo: 'Let go of the table to continue.',
  /**
   * A daily ahead of practice: this lead-in, then one `CONCEPT_INTROS` line
   * per concept practice hasn't introduced yet (at most two).
   */
  dailyAhead: "Today's puzzle uses something new:",
  /**
   * A NULL in a source table was poked or pinched: only the result's NULLs
   * filter. Briefly, in the message area (no click).
   */
  wrongNull: 'Poke a NULL in the result above, or use Filter.',
  /**
   * The status line, before a join, when a table or desk was found but too
   * far away to use (the slabs float instead).
   */
  moveCloser: 'Move closer to your table to use it.',
  /** The status line, briefly, after the Recenter button brought the tables back in front of you. */
  recentered: 'Recentered',
  /** The status line on a replay (Prev) of a puzzle solved before; the takeaway shows again once it's re-solved. */
  solvedBefore: 'Solved before',
  /** The status line on a replay of a puzzle completed after "Show answer" (solving it now upgrades it). */
  doneWithAnswerBefore: 'Done with answer before',
};

// --- Every puzzle done (the card, after "Finish" on the last puzzle) --------------------

export const COMPLETE = {
  /** The headline, gold, in the win's place (fits one line, tested). */
  headline: (total: number) => `All ${total} puzzles done!`,
  /** How they were done, when some were completed after "Show answer". */
  summary: (solved: number, revealed: number) => `Solved: ${solved}. With the answer: ${revealed}.`,
  /** ...and when none were. */
  allSolved: 'All solved yourself!',
  /** What's next, once today's daily is done. */
  comeBackTomorrow: 'Come back tomorrow for a new daily puzzle.',
  /** What's next while today's daily is open (Next says "Today"). */
  dailyOpen: "Today's puzzle is still open.",
  /** The result slab's badge. */
  badge: 'All done!',
};

// --- The puzzle bar (next to INNER | LEFT) --------------------------------------------

export const BAR = {
  /**
   * The hint button says what it shows next: the first hint, another one,
   * then the full answer (`hints[0..2]`). Its width fits the longest, so
   * relabeling never resizes the bar (tested).
   */
  hintLabels: ['Hint', 'Another hint', 'Show answer'] as const,
  next: 'Next',
  /** Next after "Show answer", before the moves are made: moves on, recorded as revealed. */
  skip: 'Skip',
  /** Next on the last puzzle once every puzzle is done: shows the completion state. */
  finish: 'Finish',
  /** Then, while today's daily is open: loads it (`daily`, "Today"). Else: ends the session. */
  done: 'Done',
  /** Back to the previous puzzle in practice order (from today's daily: back to practice). Off on puzzle 1. */
  prev: 'Prev',
  /**
   * The Recenter icon button's label, shown above it while a fingertip or a
   * hand's ray hovers it (it brings the tables back in front of you).
   */
  recenter: 'Recenter',
  /**
   * The Exit icon button's label, shown above it on hover: a press does
   * nothing; held for a moment (a ring fills), it ends the session.
   */
  exit: 'Hold to exit',
  daily: 'Today',
  /** The filter chip's own button, after its WHERE clause. */
  clearFilter: 'Clear',
  /** Shown while the result has NULLs and no filter is set: opens one chip per column with a NULL. */
  filter: 'Filter',
  /** Closes the chips again, without filtering. */
  filterBack: 'Back',
  /** One chip: the column's header as the result slab shows it. */
  filterChip: (header: string) => `${header} is NULL`,
};

// --- The target outline (in the result's place, before a join) --------------------------

export const TARGET_OUTLINE = {
  /**
   * The outline's one label, where the result's SQL caption will be: how
   * many rows the answer has (the clue). The outline is the same for every
   * puzzle: headers, one empty row, this label.
   */
  answerRows: (count: number) =>
    count === 0 ? 'Answer: no rows' : count === 1 ? 'Answer: 1 row' : `Answer: ${count} rows`,
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
  title: 'SpatialQL',
  description: 'Join two tables with your hands.',
  descriptionPuzzles: 'A new SQL puzzle every day.',
  descriptionFreePlay: 'Free play: no puzzles, just tables.',
  /** Always shown, below the description. */
  setup: 'Sit at a desk. No controllers needed.',
  /** The Enter XR button. */
  start: 'Start',
  /** The Enter XR button in free play. */
  startFreePlay: 'Start free play',
  /** Free play only: shown prominently under the title. */
  freePlayHeading: 'Free play',
  freePlay: 'Free play',
  /** In free play: back to challenge mode. */
  puzzles: 'Puzzles',
  /** Before the daily is offered (practice 1-3 not all solved). */
  practiceFirst: 'Start with 3 short practice puzzles.',
  practiceProgress: (solved: number, total: number) => `Practice ${solved}/${total}`,
  /** When some were completed after "Show answer": they count in the total, and are named. */
  practiceProgressWithAnswers: (completed: number, total: number, revealed: number) =>
    `Practice ${completed}/${total} (${revealed} with answer)`,
  /** In place of the practice count once every puzzle is done. */
  allDone: (total: number) => `All ${total} puzzles done`,
  allDoneWithAnswers: (total: number, revealed: number) => `All ${total} puzzles done (${revealed} with answer)`,
  /** Today's daily, completed after "Show answer". */
  dailyRevealed: "Today's puzzle: done with the answer.",
  dailyOpen: (dataset: DatasetId) => `Today's puzzle: ${DATASET_TITLES[dataset]}`,
  dailyDone: "Today's puzzle: solved. New one tomorrow.",
  streak: (days: number) => (days === 1 ? 'Streak: 1 day' : `Streak: ${days} days`),
  streakAtRisk: 'Solve today to keep it.',
  saveUnavailable: "Progress can't be saved in this browser.",
  /** Opens the puzzle picker (a grid of 1-20) in place of the progress lines. */
  choosePuzzle: 'Choose puzzle',
  /** Closes the picker. */
  pickerBack: 'Back',
  /** Under today's daily's number in the picker. */
  pickerToday: 'Today',
  /** The Start button once a puzzle is picked. */
  startPuzzle: (number: number) => `Start puzzle ${number}`,
  /**
   * A small link at the bottom: clears all progress, after a confirmation.
   * (Not named `resetProgress`: that's the dev URL flag the dist grep looks for.)
   */
  resetLink: 'Reset progress',
  resetQuestion: "Reset all puzzles and your streak? This can't be undone.",
  resetCancel: 'Cancel',
  resetConfirm: 'Reset',
};
