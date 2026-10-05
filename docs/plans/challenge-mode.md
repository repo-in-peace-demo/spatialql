# Plan: challenge mode

Status: **approved** (with the decisions below). Phase 1 (the pure core
and its tests) is written; phases 2-5 aren't started.

## Decisions (from review)

- Ladder, view-only card with the bar, first launch at practice 1, strict
  unlock order, and the four datasets: as designed.
- No three-table datasets now (a future item in `STATUS.md`); the daily
  repeats every 20 days.
- The silhouette's row count stays as a clue.
- INNER stays the default. Fan-out puzzles (4 and 8) are won by the first
  join, so their win **explains the surprise**: the repeating rows and the
  key that caused it are highlighted briefly (`fanOutGroups`, with
  `fanOutHighlight` per puzzle), and the card shows a one-line note
  (`winNote` in `copy.ts`). Puzzle 1 is the tutorial; an instant win is fine.
- Win message (revised after phase 2 feedback), in the existing card height:
  the headline "Solved!" (large, gold) takes the goal's two-line slot while
  won; then a puzzle-specific `takeaway` (why it worked; at most 60
  characters, one line, tested; the fan-out takeaways use two lines); then
  the query line "Your moves wrote this query:" ("That's this query:" when
  the full-answer hint was shown). "Solved with N hints." sits in the title
  row's right-hand slot. The goal text is what's dropped while the win
  shows; the title still names the puzzle.
- Free play: a secondary button below the main Start button on the welcome
  panel.
- Streak: daily only, local calendar day, no freeze.
- All player-facing text lives in `src/data/copy.ts`, for review before
  phase 3. Copy rules (from the copy review): hints name tables as tables
  ("the customers table"), and never spell out a column. They use a
  placeholder (`{orders.id}`, or `{source:students.clubId}` for a source-slab
  header) that `src/data/puzzle-text.ts` resolves to the header the player
  sees (`O.ID`, `CLUB ID`), from the same `columnHeaderText` the slabs
  render with. Tests check that every placeholder resolves and every "poke
  the NULL under X" names a displayed result header.
- Phase 2's readout covers the bar's clearance and pinch distances, as it
  does for the control.
- **Phase 2 is a checkpoint:** stop and report after shop puzzles 1-3, for
  hands-on play in the emulator (and a headset if available) before phase 3.
- Every phase boundary: plan first, wait for approval. Work on `main`; the
  user commits after each phase.

Goal: make SpatialQL a place people come back to (the Productivity track's
"habits tied to a recurring context", and "Best Reason to Come Back"). It
must read as a spatial puzzle first and teach SQL as a side effect, so a
judge who has never written SQL can play it.

Where this pushes back on the brief, it says so. The pushback is collected in
§0.

## 0. Changes to the proposed design

1. **The ladder reaches the anti-join at puzzle 3, not 5.** A judge plays one
   session. The "aha" moment is *"Which customer has never ordered?"*, solved
   by poking a NULL. It should land within the first five minutes. Fan-out is
   already visible in puzzle 1 (Priya Shah and Marcus Webb share id 2). It
   gets its own puzzles at 4 and 8, and direction gets its own at 5.
2. **"Same columns" is always true today.** The result slab always shows
   every column except the foreign key, and both join directions show the
   same column set. The comparison still checks columns, keyed by source
   table, not by LEFT/RIGHT position, so that column selection can be added
   later. Order-insensitive comparison also means an INNER join is accepted in
   either direction. That is correct SQL and is worth teaching.
3. **The answer space per table pair is small.** With two tables, two join
   types and one IS NULL filter, a pair has about five distinct results. So
   each dataset carries about five puzzles, and 20 puzzles use most of what
   the four datasets can say. That is enough for the deadline. More variety
   later needs three-table datasets (§10).
4. **The puzzle card isn't touchable.** There's no room for it within reach
   (§5). It's a view-only card above the result slot. Hint, Next and the
   filter chip sit in a small **puzzle bar** next to the INNER | LEFT
   control, which is already within reach.
5. **The silhouette lives in the result slot.** It adds no height. Before the
   join it sits where the result will appear. After the join the real result
   takes its place, and the diff is drawn on the real result.
6. **The first launch starts at practice puzzle 1, not the daily.** After
   puzzle 3 (or from the welcome panel) the daily is offered. Day one's daily
   could be the hardest puzzle, which is the wrong first impression for a
   judge.

## 1. Player flow

**First launch (no stored progress)**

1. Browser welcome panel, as now. It keeps Enter XR and the WebXR notice
   (never remove them). It adds one line: *"Today's puzzle: #7 · Practice
   0/20"*.
2. Enter XR. The two shop tables rise onto the desk; a puzzle card appears
   above the empty result slot; the silhouette (10 empty outline rows under
   the result's column headers) sits in that slot.
3. Card: **Puzzle 1 · Match each order to the customer who placed it.** Coach
   line: *"Pinch a table, bring it to the other, let go."*
4. They join. Rows fly into the silhouette, which fills exactly. **Win:**
   chord, glow, the caption brightens, and the card says *"You just wrote
   this query."* The bar's Next pulses.
5. **Puzzle 2** (same tables; no switch): *"Show every customer and their
   orders, even customers with no orders."* They join. INNER is the default,
   so one dashed outline slot stays empty: *1 row missing*. The diff is the
   lesson. They tap Hint (*"One customer has no orders. Which join keeps
   every customer?"*) or try LEFT. Odalys slides in and the slab fills.
6. **Puzzle 3:** *"Which customer has never placed an order?"* The
   silhouette is a single row. With LEFT, the result has 11 rows. Ten are
   marked `+ not in the answer` and Odalys's row shows NULLs. A concept line
   appears: *"New: poke a NULL to keep only rows where it's NULL."* The NULL
   cells pulse once. A poke on any of them filters the result. The other 10
   rows fold away, the caption gains `WHERE o.id IS NULL`, and the puzzle is
   won.
7. Next offers **Today's puzzle** (or practice 4).

First session time: puzzle 1 ≈ 1 min, puzzle 2 ≈ 1 min, puzzle 3 ≈ 1.5 min.
That's under 5 minutes, all with the shop tables, so the first launch has no
table switch.

**What a judge with no SQL sees:** a sorting puzzle with two physical
tables. The card copy uses plain words: "customer", "row", "no orders". The
only jargon is the INNER/LEFT labels and "NULL". "NULL" is introduced in one
line when it first appears: *"NULL means 'nothing here'"*. The SQL shows up
as the reward ("You just wrote this query"), never as the instruction.

**Solving.** Every join, INNER/LEFT toggle, filter or separation updates
the diff once its animation settles. No buzzer, no fail state, no timer.
Separating and rejoining is how you change direction.

**Winning.** It triggers the first time the result matches. Play stays open
after a win (toggling more doesn't un-win). Next goes to the next unlocked
practice puzzle, or to the daily if it isn't solved yet.

**Choosing the next puzzle.** In XR the bar has Next and Prev, limited to
unlocked puzzles. In the browser, the welcome panel shows practice progress
and today's puzzle. A full picker is out of scope; it could be a later
welcome-panel list.

**Returning tomorrow.** The welcome panel: *"Today's puzzle · Streak: 3 days
· solve today to keep it."* Enter XR loads the daily directly if it isn't
solved yet; otherwise it loads the next practice puzzle.

**Free play** (today's sandbox) stays. It's a welcome-panel button and a
`mode=free` dev flag. It has no card and no silhouette, and works exactly as
now.

## 2. Data model (`src/data/`, pure, no three/IWSDK)

```ts
// datasets.ts
type Dataset = {
  id: 'shop' | 'library' | 'school' | 'cafe';
  title: string;            // "Corner shop"
  tables: Table[];          // 2 today; 3 later
};

// query.ts
type NullFilter = { tableId: string; column: string };   // WHERE alias.column IS NULL
type QuerySpec = {
  left: string;             // table id that stayed put
  right: string;            // table id brought over
  joinType: JoinType;
  filter: NullFilter | null;
};

// puzzles.ts
type Concept = 'inner' | 'left' | 'direction' | 'fanout' | 'antijoin' | 'nullfk' | 'nullvalue';
type Puzzle = {
  id: string;               // 'shop-never-ordered'
  datasetId: Dataset['id'];
  tables: [string, string]; // the two on the desk
  goal: string;             // card text, ≤ 2 lines (~70 chars)
  concept: Concept;
  intro?: string;           // shown the first time this concept appears
  solution: QuerySpec;      // one known solution; the target is computed from it
  expected: {               // hand-written, independent of the engine (tests)
    rowCount: number;
    rows: string[];         // a readable key per row, e.g. 'Odalys Ferreira'
  };
  revealRow?: number;       // index into the target to show in the silhouette
  hints: [nudge: string, action: string, answer: string];
};
// PRACTICE_ORDER: Puzzle['id'][]  (unlock order)
// DAILY_SCHEDULE: Puzzle['id'][]  (a fixed shuffle of all 20)

// progress.ts
type Progress = {
  version: 1;
  solved: Record<string, { firstSolvedDay: number; hintsUsed: number }>;
  daily: { lastSolvedDay: number | null; streak: number; best: number };
  seenConcepts: Concept[];
  lastPuzzle: string | null;  // resume
};
```

- **As built in phase 1:** the text fields (`goal`, `intro`, `hints`, and
  the fan-out `winNote`) live in `src/data/copy.ts`, keyed by puzzle id and
  concept, not on the puzzle. `expected` is a list of readable row labels
  (`"Odalys Ferreira / NULL"`), whose length is the row count. Puzzles also
  carry `fanOutHighlight`.
- **The target is defined by its solution query, run through the same join
  engine.** That alone would be circular. So each puzzle also carries a
  hand-written `expected` (row count and readable row keys), and a test
  asserts they agree. That is the "stated answer matches its target" check.
- **Stored under `spatialql.progress.v1`.** All reads and writes are in
  try/catch. Missing, unparseable or wrong-version data falls back to
  defaults; unknown puzzle ids are dropped. The in-memory copy is
  authoritative. If storage fails, progress lasts for the session only and
  nothing errors.

## 3. Pure logic and tests

| Module | Function | Tests |
| --- | --- | --- |
| `query.ts` | `runQuery(tables, spec)` → `JoinResultTable` + `visible: boolean[]` (the filter mask over the unfiltered rows) | stored NULL and ghost NULL both match `IS NULL`; the filter survives an INNER ↔ LEFT toggle (INNER + `o.id IS NULL` = 0 rows); a filter on a column with no NULLs = 0 rows |
| `compare.ts` | `compareToTarget(actual, target)` → `{ solved, rowStatus: ('match' \| 'extra')[], missing: number[] }` | order-insensitive; multiset (fan-out duplicates count twice); keyed by `tableId.column`, so either INNER direction matches; ghost NULL = stored NULL; exact match → `solved`; column-set mismatch → not solved |
| `solver.ts` | `reachableStates(puzzle)`: moving ∈ {A, B} × {INNER, LEFT} × filter ∈ {none, each result column} | used by the content tests below |
| `daily.ts` | `localDay(date)` → day number; `dailyPuzzleId(day)` | same day → same id; consecutive days differ in dataset; DST change dates give consecutive day numbers; the schedule holds every puzzle exactly once |
| `streak.ts` | `recordDailySolve(progress, day)`, `currentStreak(progress, today)` | first solve → 1; same day twice → unchanged; next day → +1; a gap → 1; current streak shows 0 after a missed day; clock or time zone moved back → no break, no increment; `best` tracks the max |
| `progress.ts` | `parseProgress`, `serializeProgress`, `isUnlocked` | empty, garbage, old version and unknown ids → defaults; puzzle n unlocks when n−1 is solved |
| `join-sql.ts` | `buildJoinSql(..., filter)` → third line `WHERE o.id IS NULL` | the existing two lines are unchanged without a filter |
| `join-state.ts` | `joined` gains `filter`; `setFilter` / `clearFilter` events | a toggle keeps the filter; `pullApart` clears it |

**Content tests** (`puzzles.test.ts`), for every puzzle:
- The solution solves it, and its target equals `expected`.
- `revealRow` is within the target.
- Every table has at most 8 rows (`MAX_VISIBLE_ROWS`).
- In every reachable state, actual + missing ≤ 12 rows (`MAX_RESULT_ROWS`).
- The default first state (either direction, INNER, no filter) is *not* a
  solution, unless the concept is `inner` or `fanout`.
- A snapshot of every solving state, so an accidental extra solution shows up
  in review.

**Daily selection.** `day` is the device's **local calendar date**, counted
as `Date.UTC(y, m, d) / 86400000`. That count is DST-safe: no 23- or 25-hour
days. Everyone on the same date gets the same puzzle, as Wordle does. The id
is `DAILY_SCHEDULE[(day − epochDay) mod 20]`, with the epoch at 2026-10-01.
The date is fixed when the puzzle loads, so solving it after midnight counts
for the day it was loaded.

**Streak rules:**
- Only solving the daily counts. Practice puzzles don't count, and hints are
  allowed.
- Missing a calendar day breaks the streak.
- There's no freeze (open question 9).
- A solve credited to a day already counted changes nothing.

## 4. The NULL filter

**Recommendation: poke a NULL cell in the result.** It means "keep only rows
where this column is NULL" (`WHERE alias.column IS NULL`).

- **Any NULL cell works:** the ghost cells of a LEFT row, or a NULL stored in
  the data. Rows that don't match fold away, the remaining rows close the
  gaps, the height animates, and the caption gains its `WHERE` line.
- **Clearing:**
  - poke a NULL cell in the filtered column again;
  - or poke the **filter chip** `WHERE o.id IS NULL ✕` that appears in the
    puzzle bar;
  - separating also clears.

  The chip matters: after INNER + filter the result may be empty, leaving no
  NULL cell to poke.
- **One filter at a time.** Poking a NULL in another column replaces it.
- **Input paths:** fingertip poke (primary), ray select, and a pinch whose
  pinch point lands on the cell. These are the same three paths as the
  control, and they use the same pinch-point check.
- **Hit targets.** One ghost row's right-side cells form one wide target
  (~15–25 cm × 2.2 cm), with a 1 cm margin above and below. Every cell in it
  is NULL in a different column; poking anywhere in it uses the column under
  the finger. A cell with a stored NULL is a single target of at least the
  column's width.
- **Priority.** If a pinch point is within the margins of both a bar button
  and a cell, the nearest target wins. Buttons win ties.

**Why poking a NULL is the right choice:**

| Option | Hands-first / reach | Unambiguous with grab | Teaches | Verdict |
| --- | --- | --- | --- | --- |
| **A. Poke a NULL cell** (recommended) | poke; ghost rows are the result's bottom rows, nearest the hands (~0.5 m) | poke never grabs; the result slab isn't grabbable | the WHERE clause, on the very value it tests; handles stored NULLs and the trap puzzle | ✓ |
| B. A third control option, "unmatched only" | reachable at 0.45 m | yes | a button, not a WHERE; can't express stored NULLs (puzzles 10 and 18) or the trap (20) | fallback only |
| C. A filter funnel on a column header | headers sit at the result's top, > 0.6 m | yes | WHERE, but you don't see the value you test | ✗ reach |
| D. Pull a NULL row out of the result | grab-like | conflicts: the result isn't grabbable on purpose | it's row picking, not a query | ✗ |
| E. Select rows on the source slabs | reachable | pinch there grabs the slab | hand-picking rows, not SQL | ✗ |

**Risk: a pinch on the bottom NULL row starting a grab.** The control sits
between the pair's top edge and the result, so the lowest result row is
about one control band above the pair. If the palm comes within the grab
radius of a source slab, a pinch there could grab it. Mitigations:
- poke is the primary gesture;
- phase 2 measures the palm-to-slab distance while pinching the lowest NULL
  cell (an extension of the existing pinch log);
- if that measures under 7 cm + 3 cm, widen the band for challenge mode.

## 5. Layout

All figures assume the seated emulator setup: eyes at 1.2 m, desk 0.45 m
below the eyes, slab bottoms 0.32 m forward. They're calculated from the
existing font and padding rules. **Phase 2 adds the card and the bar to the
existing placement/join readout, which will measure them**; the figures
below are estimates until then.

**The pieces:**

| Element | Where | Touch? | Distance | Size |
| --- | --- | --- | --- | --- |
| Source slabs | unchanged | grab | 0.55–0.60 m | unchanged |
| INNER \| LEFT control | unchanged | poke / pinch / ray | 0.45–0.47 m | unchanged |
| **Puzzle bar** (Hint · Next · Prev · filter chip) | same band as the control, to its right; same ≥ 10 cm clearance off the slab plane | poke / pinch / ray | ~0.45 m | buttons ≥ 3 × 2 cm, ~20 cm wide in all |
| **Silhouette** | the result slot, in place of the result slab before the join | no | ~0.56 m | the target's row count |
| **Puzzle card** | just above the result slot's top edge, centered on it, same yaw | no (view-only) | ~0.60 m | ≤ result width, ~7 cm tall |

**Card text** is sized by angle at a planned 0.60 m:
- goal at the header target, 1.3° → 1.36 cm, 2 lines;
- title (*Puzzle 3 · Corner shop*) at the row target, 1.15° → 1.2 cm.

So the card is 3.3 + 1.45 + 2 (padding) ≈ **6.8 cm tall**.

**Vertical budget** (80° window around the 18° gaze; today's group measures
56.5–59.2°):

| Added | Height | At | Degrees |
| --- | --- | --- | --- |
| Today's group (11-row LEFT result) | — | — | 59.2° |
| Third caption line (`WHERE …`), always reserved in challenge mode so it never relayouts | 1.2 cm | 0.56 m | +1.2° |
| 12th row (the content tests cap actual + missing at 12) | 2.2 cm | 0.56 m | +2.2° |
| Gap from card to result | 1.5 cm | 0.60 m | +1.4° |
| Puzzle card | 6.8 cm | 0.60 m | +6.5° |
| **Total** | | | **≈ 70.5° of 80°** (~9.5° spare) |

- **All of the addition is above the group.** Today's group top is about
  +20–22° above the gaze, so the card's top lands near +33°, under the +40°
  limit.
- **The bottom edge doesn't move.** Pair bottoms on the desk stay where they
  are.
- The puzzle shown is the shop data; the other datasets' results are at most
  8 rows, so they're shorter.

**Reach.** Everything touchable is in the control band (≤ 0.47 m) or on the
source slabs (≤ 0.60 m). The NULL cells, on the result's bottom rows, sit at
about 0.50–0.55 m. The card at ~0.60 m is beyond comfortable touch, which is
why nothing on it is interactive.

**Horizontal.**
- The card is no wider than the result slab (~40 cm at 0.56–0.60 m, ±19°).
- The bar adds ~22 cm to the control band, centered on the seam (±14° at
  0.45 m).
- Both stay inside the pair's current width.

**If the readout shows it doesn't fit**, in this order:
1. A one-line goal, with the title merged into it (−2°).
2. Move the card 3–5 cm farther away. It isn't touchable, so the reach limit
   doesn't apply to it.
3. Move the card to a side wing, toed in toward the eyes beside the right
   slab. That costs a ~35° head turn, so it's last.

## 6. Switching tables between puzzles

Today the source and result documents are built once at startup from module
constants. Challenge mode builds them per dataset.

1. **Leave.**
   - If joined: the result and control fade and the pair undocks (the
     existing separate path, shortened).
   - If a slab is held: `GrabSystem.forceRelease`.
   - Then both slabs sink 6 cm into the desk and fade over 0.35 s, with a
     soft descending sweep.
   - The card text cross-fades at the same time.
2. **Build.**
   - The new documents: 2 source slabs, plus 2 result slabs (one per
     direction) with their silhouette and diff layers.
   - Built **one document per frame**, so no frame does all four, and timed
     with the existing long-task readout.
   - The fonts come from the same planned distances.
   - The old documents are disposed (`entity.dispose()` wherever an entity
     goes, never `destroy()`).
   - The next puzzle's documents are prebuilt in idle frames after a win, so
     Next is usually instant.
3. **Swap.**
   - The two source entities are kept as "slots". Each gets its new document
     and its `TableSlab` table id.
   - Desk placement re-runs from the surface it already found (no new
     search) with the new sizes, under the same reach and view rules.
4. **Arrive.** The slabs rise 0.35 s, 0.08 s apart. The drop tap plays as
   each lands, and the silhouette fades in.

**Guards:**
- A puzzle-level state machine (`loading → playing → solved`) owns this.
- While `loading`, the join system ignores proximity and grabs. The join
  state is `idle` before the swap and starts `idle` after.
- Puzzles on the same dataset (e.g. shop 1 → 2 → 3) skip the leave and build
  steps: the tables stay, the join resets, and the card and silhouette
  update.

## 7. Effects on existing systems

| System | Changes | Stays |
| --- | --- | --- |
| `join-system.ts` | Tables come from the active puzzle (a small provider), not `SOURCE_TABLES`; result slabs are built per dataset; filter state, NULL-cell hit tests in the pinch path, row folding (offsets from rows hidden above, which the existing per-row offset signals can do); a diff and win check after each settle | LEFT/RIGHT rule, commit on release, dock, timeline, sounds, placement of the control |
| `join-state.ts` | `filter` on `joined`; `setFilter` / `clearFilter` | all existing transitions |
| Result slab (`table-slab-view.ts`) | prebuilt per row: a 1.5 cm gutter cell for the diff marker (`+` = not in the answer); trailing placeholder rows (dashed outline, `?`) for missing rows, shown by signal; silhouette mode (headers and outlines, the `revealRow` filled); a win glow (`EdgeGlow`) | key tints, flight signals, background fade, no relayout while animating |
| Caption | a reserved third line for `WHERE`; brightens on a win | the existing two lines |
| Control | none | everything; the bar is a separate, non-grabbable entity beside it (same reasons) |
| Placement | re-places on a dataset swap; the readout covers the card and bar | reach, view window, text sizing, bottoms aligned |
| `sound.ts` | `playWin` (a three-note rising arpeggio, at the resolve level), `playTablesOut/In`, `playHint` (soft chime); the filter reuses `click` + `slide` | volume, limiter, balance constants |
| `panel.ts` / welcome UI | the daily line, streak, practice progress, a Free play button | Enter XR, the WebXR notice, its XR hide |
| Debug (`join-debug.ts`) | `N` / `P` next/prev puzzle, `H` hint, `F` filter on the first NULL column, `I` print the diff; flags `puzzle=<id>`, `day=YYYY-MM-DD`, `resetProgress`, `mode=free` | `J`, `Shift+J`, `T`, `U`, `R` |

**Diff markers don't rely on color alone.**
- Extra rows get the `+` glyph and drop to 55% text opacity.
- Missing rows are dashed outlines with `?`.
- Matched rows look normal.

Key tints keep their meaning (which rows share a key), so the diff uses glyph,
opacity and outline, not hue.

## 8. Content

### Datasets

All names, places and products are invented. Wrinkles are marked ⚑.

**Corner shop** (existing data, unchanged): `customers` (c), `orders` (o, `customerId → customers.id`)

| id | name | city |
| --- | --- | --- |
| 1 | Alderly Finch | Rivermere |
| 2 | Priya Shah | Bridgeport |
| 3 | Tomas Reyes | Oakhaven |
| 2 | Marcus Webb | Fenwick ⚑ duplicate id |
| 5 | Odalys Ferreira | Millbrook ⚑ no orders |
| 6 | Jun Park | Cedar Falls |

| id | customerId | product | amount |
| --- | --- | --- | --- |
| 101 | 2 | Notebook Set | 12 |
| 102 | 2 | Water Bottle | 18 |
| 103 | 2 | Backpack | 45 |
| 104 | 1 | Desk Lamp | 24 |
| 105 | 3 | Headphones | 60 |
| 106 | 6 | Notebook Set | 12 |
| 107 | 1 | Water Bottle | 18 |
| 108 | NULL ⚑ | Desk Lamp | 24 |

Results: INNER 10 · customers LEFT orders 11 · orders LEFT customers 11.

**Library**: `borrowers` (br), `books` (bk, `borrowerId → borrowers.id`; NULL = on the shelf)

| id | name | branch |
| --- | --- | --- |
| 1 | Wren Halloway | North |
| 2 | Ikaika Dunn | South |
| 3 | Mirela Okafor | North |
| 4 | Basil Thorne | East ⚑ nothing out |
| 5 | Sunniva Lake | South |

| id | title | borrowerId | due |
| --- | --- | --- | --- |
| 201 | The Glass Orchard | 1 | Fri |
| 202 | Salt and Lantern | 3 | Mon |
| 203 | Paper Moons | NULL ⚑ | NULL |
| 204 | A Map of Rain | 1 | Tue |
| 205 | The Quiet Engine | 5 | Fri |
| 206 | Small Hours | NULL ⚑ | NULL |
| 207 | North of Nowhere | 2 | NULL ⚑ stored NULL |
| 208 | Tidewater | 3 | Wed |

Results: INNER 6 · borrowers LEFT books 7 · books LEFT borrowers 8.

**School**: `clubs` (cl), `students` (st, `clubId → clubs.id`)

| id | club | room |
| --- | --- | --- |
| 1 | Chess | B12 |
| 2 | Robotics | Lab 1 |
| 3 | Choir | Hall |
| 3 | Drama | Hall ⚑ duplicate id |
| 4 | Gardening | Yard ⚑ no members |

| id | name | clubId | grade |
| --- | --- | --- | --- |
| 301 | Ines Vale | 3 | 7 |
| 302 | Tobiah Marsh | 1 | 8 |
| 303 | Kemi Ardent | 2 | 7 |
| 304 | Lio Sandoval | NULL ⚑ | 8 |
| 305 | Hana Brook | 1 | 7 |
| 306 | Pell Quinn | 2 | 8 |
| 307 | Odette Rue | 9 ⚑ no such club | 7 |

Results: INNER 6 (Ines twice) · clubs LEFT students 7 · students LEFT clubs 8.

**Café**: `drinks` (d), `tickets` (t, `drinkId → drinks.id`)

| id | drink | price |
| --- | --- | --- |
| 1 | Flat White | 4 |
| 2 | Chai | 3 |
| 3 | Cold Brew | 5 |
| 4 | Matcha | 5 ⚑ never ordered |
| 5 | Cocoa | 3 |

| id | drinkId | milk |
| --- | --- | --- |
| 401 | 1 | Oat |
| 402 | 3 | NULL ⚑ stored NULL |
| 403 | 2 | Whole |
| 404 | 1 | Whole |
| 405 | 5 | Oat |
| 406 | 3 | NULL ⚑ stored NULL |
| 407 | NULL ⚑ | Oat |
| 408 | 2 | Oat |

Results: INNER 7 · drinks LEFT tickets 8 · tickets LEFT drinks 8.

Every table has at most 8 rows. The largest result in any reachable state
has 11 rows (shop), and that leaves room for one missing-row placeholder.

### Puzzles (practice order)

Solution notation: *A ← B* means bring B to A (A stays put, so A is LEFT).
An INNER solution works in either direction.

| # | id | Goal (card) | Concept | Solution | Target |
| --- | --- | --- | --- | --- | --- |
| 1 | shop-match | Match each order to the customer who placed it. | inner | any join, INNER | 10 rows |
| 2 | shop-every-customer | Show every customer and their orders, even customers with no orders. | left | customers ← orders, LEFT | 11 rows |
| 3 | shop-never-ordered | Which customer has never placed an order? | antijoin *(introduces the NULL poke)* | customers ← orders, LEFT, poke NULL in o.id | Odalys Ferreira |
| 4 | library-fanout | Show each borrower next to every book they have out. | fanout (one-to-many) | any, INNER | 6 rows: Wren ×2, Mirela ×2, Ikaika, Sunniva |
| 5 | shop-every-order | Show every order and who placed it, even an order with no customer. | direction | orders ← customers, LEFT | 11 rows |
| 6 | library-on-shelf | Which books are still on the shelf? | nullfk | books ← borrowers, LEFT, poke NULL in br.id | Paper Moons, Small Hours |
| 7 | library-nothing-out | Which borrower has nothing checked out? | antijoin | borrowers ← books, LEFT, poke NULL in bk.id | Basil Thorne |
| 8 | school-twice | Pair each student with their club. One student shows up twice: why? | fanout (duplicate key) | any, INNER | 6 rows (Ines in Choir and Drama) |
| 9 | library-every-book | List every book, and who has it, if anyone. | direction | books ← borrowers, LEFT | 8 rows |
| 10 | library-no-due | Which borrowed book has no due date? | nullvalue *(NULL can be stored, too)* | any, INNER, poke NULL in due | North of Nowhere |
| 11 | shop-no-customer | Which order has no customer on file? | nullfk | orders ← customers, LEFT, poke NULL in c.id | order 108 |
| 12 | school-every-club | Show every club with its members, including empty clubs. | left | clubs ← students, LEFT | 7 rows |
| 13 | school-empty-club | Which club has no members yet? | antijoin | clubs ← students, LEFT, poke NULL in st.id | Gardening |
| 14 | school-every-student | Show every student and their club, even students without one. | direction | students ← clubs, LEFT | 8 rows |
| 15 | school-no-club | Which students aren't in any club we know of? | nullfk (NULL and an unknown id) | students ← clubs, LEFT, poke NULL in cl.id | Lio Sandoval, Odette Rue |
| 16 | cafe-menu | Show the whole menu with its tickets, including drinks nobody ordered. | left | drinks ← tickets, LEFT | 8 rows |
| 17 | cafe-missing-drink | Which ticket is missing its drink? | nullfk | tickets ← drinks, LEFT, poke NULL in d.id | ticket 407 |
| 18 | cafe-no-milk | Which tickets were made without milk? | nullvalue | any INNER, or tickets ← drinks LEFT; poke NULL in milk | tickets 402, 406 |
| 19 | cafe-every-ticket | Show every ticket and its drink, even one with no drink recorded. | direction | tickets ← drinks, LEFT | 8 rows |
| 20 | cafe-never-ordered | Which drink has never been ordered? | antijoin (trap) | drinks ← tickets, LEFT, poke NULL in **t.id** | Matcha |

**Checks on the trickier puzzles** (to be repeated by tests):
- **Puzzle 10:** filtering on `due` in a LEFT result gives the wrong rows.
  books ← borrowers gives 203, 206 and 207 (3 rows); borrowers ← books gives
  Basil and 207. Only INNER gives just 207.
- **Puzzle 18:** drinks ← tickets with the milk filter adds Matcha, which is
  wrong. tickets ← drinks gives only 402 and 406; ticket 407 has Oat.
- **Puzzle 20 (the trap):** poking Matcha's NULL **milk** cell keeps 402 and
  406 too, so the diff shows two extra rows. Poking its NULL **t.id** keeps
  only Matcha. That's the lesson: test the key, not a nullable column.
- Every LEFT and anti-join puzzle fails in the default state, INNER with no
  filter.

**Hints** follow a template per concept, written out for each puzzle:

| Concept | Nudge | Action |
| --- | --- | --- |
| inner | "Bring one table to the other and let go." | "INNER keeps rows that match on both sides." |
| left | "One {parent} has no {children}. Which join keeps every {parent}?" | "Keep {parents} where they are; bring {children} over; choose LEFT." |
| direction | "LEFT keeps every row of the table that stayed put." | "Keep {children} still; bring {parents} to them; LEFT." |
| fanout | "Count the rows. Why are there more than {table} has?" | "One row matches two, so it appears twice. Just join." |
| antijoin | "A LEFT join fills NULL where nothing matched." | "Use LEFT, then poke a NULL in a {child} id to keep just those." |
| nullfk | "Some {children} point to no {parent}." | "Keep {children} still, LEFT, then poke a NULL {parent} cell." |
| nullvalue | "NULL can be stored in a table, too." | "Join, then poke the NULL in {column}." |

The answer tier is the puzzle's solution, written out ("Leave *customers*
where it is, bring *orders* over, pick LEFT, then poke a NULL under
ID."). Hints never lock anything; `hintsUsed` is recorded only for the card's
"solved with 2 hints" line.

**Silhouette reveals.** Only for puzzles 2, 5, 9, 12, 14, 16 and 19, which
are full-table results. There it shows one matched row: it shapes the target
without giving away the extra row. Anti-join and filter puzzles reveal
nothing; their row count is the clue.

## 9. Phased build plan (today Oct 3; challenge mode emulator-tested by Oct 24; deadline Nov 18)

| Phase | Dates | Delivers | Done when |
| --- | --- | --- | --- |
| 1. Pure core | Oct 6–9 | §2 types, the four datasets, 20 puzzles, query/filter, compare/diff, solver, daily, streak, progress, SQL `WHERE`, join-state filter | `npm test` proves every puzzle (§3); no scene change |
| 2. **Smallest playable** | Oct 10–15 | Shop puzzles 1–3 only (no table switch): card, silhouette, diff markers, NULL poke / ray / pinch + `F`, the filter chip, Hint / Next bar, win (sound, glow, caption), progress saved | in the emulator, play 1 → 3 by hand with the seated head; layout readout within 80° / 0.60 m; pinch-near-slab distance logged |
| 3. Table switching | Oct 16–20 | runtime document build, per-frame, prebuild on win; swap animation and sound; re-placement; all 4 datasets and 20 puzzles; unlock order; Prev / Next; `N` / `P`, `puzzle=` | every puzzle loads and is solvable with debug keys; no long task in a switch (readout); no grab or join state leaks across switches |
| 4. Daily and streak | Oct 21–23 | daily selection, streak on the card and welcome panel, Free play button, `day=`, `resetProgress` | daily changes with `day=`; streak +1 / reset is visible across reloads; storage blocked → still playable |
| 5. Test pass and docs | Oct 24 | full emulator run, screenshots, `STATUS.md`, `grab-debug.md` challenge section | report to you |
| After | Oct 25 – Nov 18 | headset feel (poke size, card readability, bar reach), copy edits, demo video path | — |

If phase 3 runs late, the fallback is a plain fade between datasets instead of
the sink and rise. If even that slips, ship the 5 shop puzzles plus the daily
(shop only), so the daily would repeat every 5 days.

## Phase 3 status (implemented; at the checkpoint)

Approved with: shorten the library titles (a test now fails any value that
would be cut off), include theming (four icons imported individually), and
wait for the release when Next is pressed while a table is held (the card
says "Let go of the table to continue." and Next looks pressed).

Changes from the plan below:

- **Dev key `G`, not `A`,** applies the solution: `A` is one of the
  emulator's WASD movement keys. `X` applies the wrong state as planned.
- **Text sizing and measurement** moved to pure modules
  (`src/text-angles.ts`, `src/slab-metrics.ts`) so the fit test runs in
  Node; `view-comfort.ts` and `table-slab-view.ts` import them.
- **Fan-out wins** now also pulse the rows that repeat (`fanOutGroups`),
  as decided in phase 2.

Emulator results (seated head; `X`, then `G`, then `N`, for 1-20):

- Every wrong state showed exactly its expected diff (§5's table) and lost;
  every solution won; the traps (10, 18, 20) lost on the trap.
- **Switch:** 0.80-0.81 s from the slabs leaving to the new ones landing
  (both new source documents and both result directions built one per
  frame); about 1.3 s from Next, including the separation. No long tasks in
  any switch; no truncated cells on any dataset.
- **Fit, per dataset** (group extent with card, control, bar and the result
  at its reserved 12-row height): shop 71.4 deg, library 70.9 deg, school
  69.7-72.1 deg, cafe 72.4-74.2 deg (top edge 39.2 deg of 40: the tightest).
  Slabs 0.56-0.58 m from the eyes; band targets 0.45-0.47 m, clearance
  10.1-11.6 cm; control-to-bar gap 1.5 cm.
- **Slab sizes:** customers 22.5 x 17.1 cm, orders 28.4 x 21.4, borrowers
  22.1 x 15.0, books 28.2 x 21.4, clubs 18.2 x 15.0, students 27.0 x 19.3,
  drinks 17.9 x 15.0, tickets 17.7 x 21.4.
- **Never-yank:** with a slab held, Next showed the let-go line and a
  pressed Next and the tables stayed; on release the switch ran.
- **Reload** mid-ladder resumed on the right dataset (the desk built the
  cafe tables directly).

Not yet verified: the fan-out row pulse on a live win (added after the
run); bundle size before and after the icons (needs a build).

## Phase 3 plan: all datasets and table switching (approved)

Scope: puzzles 1–20 in practice order on all four datasets, with the desk
switching tables between datasets. It ends at a checkpoint, like phase 2.

**1. A pure desk state, with tests** (`src/data/desk-session.ts`)

- **States:** `ready(dataset)`, `leaving(from, to)`, `building(to)`, and
  `arriving(to)`.
- **Events:** `request(to)` (a no-op for the dataset already loaded),
  `leftDone`, `built` and `arrived`.
- **`canEvaluate(desk, puzzle, joinedTables)`:** true only when the desk is
  `ready` on the puzzle's dataset *and* the joined tables are the puzzle's.
  `canActivatePuzzle` (phase 2's guard) gains the same desk condition.
- **`startupDataset(progress, playable)`:** after a reload, the desk first
  loads the resume puzzle's dataset, not always the shop.
- **Tests:**
  - phase 2's guard tests, kept;
  - mid-join: a request while joined is deferred until separated, and the
    old shop join can't be evaluated against the pending library puzzle;
  - during the animation: no activation or evaluation in `leaving`,
    `building` or `arriving`;
  - after a reload: the resume puzzle's dataset loads first, and nothing is
    evaluated before it's `ready`.

**2. Switching tables** (`desk-placement.ts`, `join-system.ts`, `challenge-system.ts`)

- **Order of events:** Next on a puzzle with another dataset:
  1. Separate if joined, and glide home (the existing path). Then wait until
     no slab is held and nothing is gliding or docking.
  2. **Leave:** the card cross-fades to the next puzzle, and Hint and Next go
     inactive. Both slabs lose `OneHandGrabbable`, sink 6 cm along their own
     up axis and fade out (0.35 s), with a soft descending sweep
     (`playTablesOut`). Then their entities are disposed with
     `entity.dispose()`.
  3. **Build:** the new source documents, one per frame. The join system
     builds the two result directions' documents from a queue, one per frame,
     instead of all at once on registration. That's four frames in all,
     timed with the long-task readout.
  4. **Arrive:** placement re-runs for the new slab sizes. It uses the
     surface and head pose it already committed (no new search), under the
     same reach and view rules. The slabs rise 6 cm and fade in, 0.08 s
     apart, with `playTablesIn` and a drop tap as each lands. They become
     grabbable once they land.
  5. **Activate:** the session starts, the silhouette is built for the new
     tables, and the bar comes back.
- **Same dataset:** the phase 2 home glide, unchanged.
- **Never-yank and grabs:**
  - a switch never starts while a slab is held, and waits for the release;
  - new slabs start un-touched, so placement places them;
  - after that, the existing never-yank rule applies as now.
- **Join system:**
  - tables come from a registry over all datasets (`tableById`), not
    `SOURCE_TABLES`;
  - a disposed source unregisters cleanly: its result views and their
    listeners, home poses and glides;
  - proximity and grab events are ignored while the desk isn't `ready`;
  - `J` / `Shift+J` act on the loaded dataset's parent and child tables.
- **Free play:** unchanged (shop only).

**3. Every dataset fits**

- The source slabs are at most 8 rows, the same as orders today. The
  result slab reserves the 12-row cap (`RESULT_ROW_CAP`) for every dataset.
  The card, control and bar don't change size. So each dataset's view
  extent should be at most the shop's measured 71.4° of 80°. The readout
  will confirm it, per dataset.
- The arrival readout logs, per dataset:
  - each slab's size, distance from the eyes and edge angles;
  - reach for the slabs and band targets;
  - the group extent with the card, control and bar, and the result slab at
    its reserved 12-row height (its largest).
- **New:** a dev warning for every cell truncated with an ellipsis.
- **Known risk: library titles.** Several are 16–17 characters ("The Glass
  Orchard", "North of Nowhere"). That's past what fits in the 9.7 cm column
  maximum at the source text size, about 15 characters, so they'd truncate.
  Options:
  - (a) **Shorten the titles** to at most 14 characters, e.g. "Glass
    Orchard", "Quiet Engine". Recommended: the layout limits stay as they
    are. The tests' expected rows change to match.
  - (b) Raise the column maximum for text columns by about 2 cm. That widens
    the library slabs and result.

**4. Copy:** all text already comes from `copy.ts`. The fan-out takeaways
(puzzles 4 and 8) will now render on their real tables.

**5. Verification support**

- **`src/data/puzzle-checks.ts`:** per puzzle, one authored *wrong* state
  and its expected diff (rows shown, extra, missing). For puzzles 10, 18 and
  20, the wrong state is the trap. Tests assert the expected diffs:

| # | Wrong state | Shown / extra / missing |
| --- | --- | --- |
| 1 | customers <- orders LEFT | 11 / 1 / 0 |
| 2 | INNER | 10 / 0 / 1 |
| 3 | customers <- orders LEFT, no filter | 11 / 10 / 0 |
| 4 | borrowers <- books LEFT | 7 / 1 / 0 |
| 5 | customers <- orders LEFT | 11 / 1 / 1 |
| 6 | books <- borrowers LEFT, no filter | 8 / 6 / 0 |
| 7 | borrowers <- books LEFT, no filter | 7 / 6 / 0 |
| 8 | students <- clubs LEFT | 8 / 2 / 0 |
| 9 | borrowers <- books LEFT | 7 / 1 / 2 |
| 10 | **trap:** books <- borrowers LEFT WHERE due IS NULL | 3 / 2 / 0 |
| 11 | orders <- customers LEFT, no filter | 11 / 10 / 0 |
| 12 | INNER | 6 / 0 / 1 |
| 13 | clubs <- students LEFT, no filter | 7 / 6 / 0 |
| 14 | clubs <- students LEFT | 7 / 1 / 2 |
| 15 | students <- clubs LEFT, no filter | 8 / 6 / 0 |
| 16 | INNER | 7 / 0 / 1 |
| 17 | tickets <- drinks LEFT, no filter | 8 / 7 / 0 |
| 18 | **trap:** drinks <- tickets LEFT WHERE milk IS NULL | 3 / 1 / 0 |
| 19 | drinks <- tickets LEFT | 8 / 1 / 1 |
| 20 | **trap:** drinks <- tickets LEFT WHERE milk IS NULL | 3 / 2 / 0 |

- **Dev keys** (with `debug`):
  - `A` applies the active puzzle's solution, through the same transitions
    as real input: separate, commit in the solution's direction, set the join
    type, set the filter;
  - `X` applies its wrong state;
  - `N` / `P` stay limited to unlocked puzzles.
- **Runtime run** (seated head):
  1. For each of the 20 puzzles: `X`, then check the logged diff against
     the table; then `A`, and check it's solved.
  2. Screenshots: the first puzzle of each dataset (1, 4, 8, 16), and the
     win cards of puzzles 4 and 8 on their tables.
  3. A switch while joined, and a reload mid-ladder (resumes on the right
     dataset).
  4. Long tasks during every switch.

**6. Optional: dataset theming**

- **Accent per dataset:** used only on the card border and as a 0.25 cm
  stripe on the slab header bars, never on rows.
  - The accents are deep tones (lightness at most 40%), against the key
    tints' pastels (at least 80%). So they differ by lightness and position,
    not by hue alone.
  - Proposed: shop indigo `#3b4f9c`, library plum `#7a3e8f`, school deep teal
    `#1f6f78`, café coffee `#8a5a2b`.
  - The win look's gold border still takes over the card on a win.
- **Icon on the card title:** a vector icon from `@pmndrs/uikit-lucide`,
  already a dependency (no image files): shopping bag, open book, school,
  coffee cup. It's sized to the title text.
- **Data:** `accent` and `icon` per dataset in the data layer, with a test
  that every dataset has both and that each accent is at least 2.5× darker
  (relative luminance) than every key tint.

**Decisions for you**

1. **Library titles:** shorten them (recommended) or widen text columns?
2. **Theming:** include it in phase 3 (recommended; about half a day)?
3. **Next while a slab is held:** wait for the release (recommended,
   never-yank), or force-release it?

## Phase 2 status (implemented; at the checkpoint)

Approved with: sandbox stays the production default, and `?challenge=1`
turns challenge mode on in any build (dev defaults to challenge mode;
`?mode=free` gives the sandbox there); Next glides the slabs home; after
puzzle 3 the card says "More puzzles soon." and Next is inactive.

Changes from the plan below:

- **Home glide:** each slab's pose is recorded before the puzzle first moves
  it (first grab or join) and Next eases it back there, instead of
  re-running desk placement (`replaceSlabs()` wasn't needed).
- **NULL cells:** UIKit clicks never reached the result slab in the
  emulator, so the join system tests ray selects (each input's target ray
  against the slab's plane), fingertip pokes (crossing the surface) and
  pinches against the cell geometry itself. One debounced path for all three.
- **The band (bar fix):** INNER | LEFT and the bar are one group centered on
  the seam, the bar laid out along the control's own axis with a fixed
  `BAR_CONTROL_GAP_METERS` (1.5 cm) gap, so they can't overlap. The bar is
  only as wide as its buttons; the filter chip appears with a filter and the
  bar resizes and re-centers. A pinch goes to the nearest target (control or
  bar) within its margin. Disabled Next: light fill with mid-dark text.
- **Dev:** `P` (previous puzzle) joins H / F / N / I.
- **Guards** (after a dev-only win-card preview key painted puzzle 4's win
  over the shop tables; the key is removed): a puzzle becomes active only
  through `canActivatePuzzle` (in the playable range, and on exactly the
  tables on the desk), whatever asks (Next, debug keys, saved progress,
  later the daily); otherwise the card says "More puzzles soon." The win
  check and diff run only when the active puzzle matches the joined tables
  (`puzzleMatchesTables`); a mismatch logs an error under `?debug=1` and
  shows no result state. Saved progress is sanitized on load
  (`sanitizeProgress`: solves outside the playable range or out of strict
  order, and an out-of-range resume point, are dropped). From phase 3,
  loading a puzzle loads its dataset first.
- **Filter chip:** the WHERE clause is a flat label (not a target), followed
  by its own bordered Clear pill (4 x 2.5 cm target).

Emulator results (seated head, debug keys plus controller rays):

- Puzzles 1-3 play through: 1 wins on the first join; 2 shows "1 row
  missing" with a placeholder after INNER and wins on LEFT; 3 shows 10
  extra rows and the NULL coach on LEFT, and wins when a NULL is poked (by
  `F`, and by a controller ray at the cell). Poking again restores all rows.
- Readout: group 71.4 deg of 80 (card top 38.0 deg); band targets INNER /
  LEFT 4.4 x 2.5 cm, Hint / Next 4.0 x 2.5 cm, all 0.46-0.47 m from the eyes
  and 10.1-10.6 cm clear of the slabs; control-to-bar gap 1.5 cm.
- Sounds: win -16.5 to -18.0 dBFS (resolve -16.1), hint -16.9 to -19.7.
- Join start 2-4 ms; no long tasks at join, filter or Next.
- Not yet verified: hand pinch on bar buttons and NULL cells (and the
  pinch-to-slab distance it logs), a pinch in the control/bar gap, free play
  with `?mode=free`, `?resetProgress`; typecheck, tests and the build.

## Phase 2 plan: smallest playable (approved)

Scope: shop puzzles 1–3 on the existing tables, so no table switching. It
ends at a checkpoint for hands-on play. Fan-out highlighting, other datasets,
the daily and the welcome panel come in later phases.

**New code**

| Where | What |
| --- | --- |
| `src/data/puzzle-session.ts` (pure, tested) | The session for one puzzle: hints shown (0–3), solved, and solved with the full answer. Events: `load`, `showHint`, `evaluate(comparison)`, `next`. A win is recorded on the first matching evaluation and kept. |
| `src/join-bridge.ts` | A narrow link between the join and challenge systems, so neither imports the other. The join system publishes its query state (`QuerySpec`, or none) and a "settled" pulse after each join sequence, toggle or filter animation. The challenge system calls `setFilter`, `clearFilter` and `reset`. |
| `src/challenge-system.ts` | Loads the puzzle, owns the card, bar and silhouette, evaluates on each settle (`compareToTarget`), applies the diff markers, handles Hint and Next, and saves progress (`progress.ts`, guarded localStorage). |
| `src/challenge-view.ts` | UIKit builders, sized by angle like the slabs: the **card** (title, a 2-line goal, a 2-line status line for the intro, diff summary or win line), the **bar** (Hint, Next and the filter chip `WHERE o.id IS NULL  Clear`, each ≥ 3 × 2 cm), and the **silhouette** (the target's headers and outline rows, with `revealRow` filled). |

**Changes to existing code**

- **`join-system.ts`:**
  - Handles the `setFilter` / `clearFilter` transitions. Filtered rows fade
    out (0.2 s). The rows that remain slide up to close the gaps and the
    height animates.
  - That takes one relayout per filter change: `display: none`, then the
    moved rows are offset back to where they were and tweened to 0. It's the
    same kind of discrete relayout the INNER/LEFT toggle already does, never
    one per frame.
  - Publishes state to the bridge, and a reset on Next. A reset separates;
    then the slabs glide back to their start poses through a new placement
    hook, `replaceSlabs()`, from the desk surface already found.
  - NULL cells become targets: a UIKit `click` from poke and ray (the result
    entity gets `PokeInteractable` / `RayInteractable`), plus pinch hit tests
    in `updatePinchSelect`, beside the control's. A poke on any cell of a
    ghost row uses the column under the finger.
- **`table-slab-view.ts`:**
  - A per-row diff gutter (`+`, opacity 0.55 for extra rows).
  - Prebuilt placeholder rows (dashed outline, `?`), up to the 12-row cap,
    shown by signal.
  - A reserved third caption line for `WHERE`.
  - The cell geometry the pinch hit test needs.
- **`desk-placement.ts`:** `replaceSlabs()`, as above.
- **`sound.ts`:** `playWin` (a rising three-note arpeggio, at the resolve
  level) and `playHint` (a soft chime). The filter reuses `click` + `slide`.
- **The win:**
  - The result slab's edge glows and the SQL caption brightens.
  - The card shows "You just wrote this query.", or "That's this query:" if
    the answer hint was shown.
  - Next pulses.
- **Coach (puzzle 3):** when a LEFT result first shows NULLs, the card shows
  the antijoin intro and the NULL explainer, and the ghost-row cells pulse
  once.
- **Debug** (with `debug`):
  - keys: `H` hint, `F` filter on the first NULL column (a simulated poke),
    `N` next, `I` print the diff (row labels and statuses);
  - flags: `puzzle=<id>`, `resetProgress`, `mode=free`.
- **Readout** (extending the join readout):
  - the card's and bar's edges against the 80° window;
  - the bar's distance and slab clearance;
  - pinch distances to each bar button;
  - palm-to-slab distance when pinching the lowest NULL row (the §4 risk).

**Verify (emulator, seated head)**

1. `typecheck` and `test` pass, including the new `puzzle-session.test.ts`.
2. Play 1 → 3 by hand: pinch-grab joins, the control, Hint, Next, and a NULL
   poke by ray and by pinch. Repeat with debug keys.
3. Screenshots:
   - the silhouette before the join;
   - puzzle 2's diff after an INNER join (1 missing);
   - puzzle 2 won;
   - puzzle 3 with LEFT (10 extra);
   - puzzle 3 filtered and won.
4. Readout within 80° and 0.60 m. The bar and NULL-row clearances are
   logged, with the fallback (a taller band) if a NULL-row pinch is within
   grab range.
   - The 2-line status line makes the card ~9.6 cm tall, not the 6.8 cm in
     §5: about +2.7°, so the estimated total is ≈ 73° of 80°.
5. No long tasks at join start, at a filter change, or at Next.
6. A reload resumes at the last puzzle; `resetProgress` starts over.
7. Free play (`mode=free`) is unchanged from today.

Then stop and report.

**Decisions for you**

1. **Production during phases 2–3:** I recommend keeping today's sandbox in
   production and turning challenge mode on only in dev (`mode=free` gives
   the sandbox in dev). Production switches over in phase 4, when the
   welcome panel gets Start and Free play. That way a push in between never
   ships a 3-puzzle game.
2. **Next on the same tables:** the slabs glide back to their start poses
   (recommended, a clean start), or stay where the player left them.
3. **After puzzle 3, phase 2 only:** the card says "More puzzles soon", and
   Next does nothing.

## 10. Risks and open questions for you

**Risks**

1. **Pinch vs grab on the lowest NULL row** (§4). Measured in phase 2; the
   fallback is a taller control band in challenge mode.
2. **Runtime document builds may cause a long task.** UIKit text layout on a
   Quest is slower than on desktop. Mitigations: one document per frame, and
   prebuild after a win. If a single document is still over 50 ms, build
   every dataset's documents during the welcome screen. That costs memory
   and startup time.
3. **The layout figures are estimates** until phase 2's readout. The
   fallbacks are listed in §5.
4. **localStorage gets cleared** (site data, a private window), which loses
   the streak. That's accepted for a static deploy; it never breaks play.

**Questions**

1. **Ladder order:** OK to move the anti-join to puzzle 3 and push direction
   and fan-out later (§0.1)?
2. **The variety ceiling:** ~5 puzzles per dataset, and the daily repeats
   every 20 days. Fine for the hackathon, or do you want three-table datasets
   now? That's +1 week, and needs a layout for three slabs.
3. **The row count as a clue:** the silhouette's "1 row" is a big hint for
   anti-join puzzles. Keep it? It's what makes them read as puzzles.
4. **Puzzles 1, 4 and 8 are solved by the first join** (INNER is the
   default). Fine for a tutorial and the fan-out lessons, or should the
   default join type become LEFT in challenge mode? I'd keep INNER.
5. **The card is view-only, and its buttons live in the bar by the control**
   (§0.4). OK?
6. **First launch goes to practice 1, not the daily** (§0.6). OK?
7. **Practice unlocks strictly in order.** Should Next allow skipping an
   unsolved puzzle? With the full-answer hint nobody is stuck, so I'd say no.
8. **Free play** stays as a welcome-panel button. Keep it, or hide it until
   the first 3 puzzles are done?
9. **Streak:** only the daily counts, local calendar day, no freeze. Add one
   free missed day a week?
10. **Names and themes:** OK with the four datasets and the invented names
    above? School's duplicate club id is framed as a data-entry mistake.
11. **Win line:** "You just wrote this query." Keep it, or "That's this
    query:" for puzzles solved with the full-answer hint?
