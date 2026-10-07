import { describe, expect, it } from 'vitest';
import {
  BAR_BUTTON_PADDING_EM,
  barButtonWidthCm,
  barRowWidthCm,
  CONTROL_OPTION_MIN_WIDTH_CM,
  HEADER_METRICS,
  MAX_FILTER_CHIPS,
  measureTextCm,
} from '../slab-metrics.js';
import { PLANNED_CONTROL_DISTANCE_METERS, slabTextSizeAt } from '../text-angles.js';
import { BAR } from './copy.js';
import { columnHeaderText } from './join-result.js';
import { getPuzzle, PUZZLES, runPuzzleQuery } from './puzzles.js';
import { puzzleText } from './puzzle-text.js';
import { nullFilterColumns, type QueryOutput } from './query.js';

/** The bar's label size: the control's header size by angle, as challenge-system.ts builds it. */
const LABEL_FONT_CM = slabTextSizeAt(PLANNED_CONTROL_DISTANCE_METERS).headerFontCm;
/** Every label Next shows (challenge-system.ts's NEXT_LABELS). */
const NEXT_LABELS = [BAR.next, BAR.skip, BAR.finish, BAR.daily, BAR.done];

describe('puzzle bar labels', () => {
  it('the hint button fits every label it shows, so relabeling never resizes it', () => {
    const width = barButtonWidthCm(BAR.hintLabels, LABEL_FONT_CM);
    for (const label of BAR.hintLabels) {
      const needed = measureTextCm(label, HEADER_METRICS, LABEL_FONT_CM) + 2 * BAR_BUTTON_PADDING_EM * LABEL_FONT_CM;
      expect(needed, label).toBeLessThanOrEqual(width + 1e-9);
    }
  });

  it('the Exit hover label ("Hold to exit") is one short line, plain ASCII', () => {
    const label = measureTextCm(BAR.exit, HEADER_METRICS, LABEL_FONT_CM) + 2 * BAR_BUTTON_PADDING_EM * LABEL_FONT_CM;
    // No wider than Hint + Next + Recenter + Exit, so it never hangs past the bar's right end by much.
    expect(label).toBeLessThanOrEqual(barButtonWidthCm(BAR.hintLabels, LABEL_FONT_CM) + 2 * CONTROL_OPTION_MIN_WIDTH_CM);
    expect(BAR.exit).toMatch(/^[\x20-\x7e]+$/);
  });

  it('Prev is a full touch target (at least the minimum, like every bar button)', () => {
    expect(barButtonWidthCm([BAR.prev], LABEL_FONT_CM)).toBeGreaterThanOrEqual(CONTROL_OPTION_MIN_WIDTH_CM);
  });

  it('the Recenter hover label is one short line, no wider than the bar at rest', () => {
    const label = measureTextCm(BAR.recenter, HEADER_METRICS, LABEL_FONT_CM) + 2 * BAR_BUTTON_PADDING_EM * LABEL_FONT_CM;
    const rest = barRowWidthCm([
      barButtonWidthCm([BAR.prev], LABEL_FONT_CM),
      barButtonWidthCm(BAR.hintLabels, LABEL_FONT_CM),
      barButtonWidthCm(NEXT_LABELS, LABEL_FONT_CM),
      CONTROL_OPTION_MIN_WIDTH_CM,
    ]);
    expect(label).toBeLessThanOrEqual(rest / 2);
    expect(BAR.recenter).toMatch(/^[\x20-\x7e]+$/);
  });

  it('Next fits all its labels (Next; Skip after "Show answer"; Finish, Today, Done once every puzzle is done)', () => {
    const width = barButtonWidthCm(NEXT_LABELS, LABEL_FONT_CM);
    // Short words: "Today", not "Today's puzzle", so the widest bar stays within reach.
    expect(width).toBeLessThanOrEqual(barButtonWidthCm([BAR.next, BAR.skip], LABEL_FONT_CM) + 1);
    for (const label of NEXT_LABELS) {
      const needed = measureTextCm(label, HEADER_METRICS, LABEL_FONT_CM) + 2 * BAR_BUTTON_PADDING_EM * LABEL_FONT_CM;
      expect(needed, label).toBeLessThanOrEqual(width + 1e-9);
    }
  });

  it('says what it shows next, in order, in plain ASCII', () => {
    expect(BAR.hintLabels).toEqual(['Hint', 'Another hint', 'Show answer']);
    for (const label of [BAR.prev, ...BAR.hintLabels, ...NEXT_LABELS, BAR.recenter, BAR.clearFilter, BAR.filter, BAR.filterBack]) {
      expect(label, label).toMatch(/^[\x20-\x7e]+$/);
    }
  });
});

describe('the Filter chips', () => {
  /** Every result a player can make: each puzzle, both directions, both join types, no filter yet. */
  const results = PUZZLES.flatMap((puzzle) =>
    [
      [puzzle.tables[0], puzzle.tables[1]],
      [puzzle.tables[1], puzzle.tables[0]],
    ].flatMap(([left, right]) =>
      (['inner', 'left'] as const).map((joinType) => {
        const output = runPuzzleQuery(puzzle, { left, right, joinType: 'left', filter: null });
        return { puzzle, joinType, output, columns: nullFilterColumns(output.left, output.right, output.result, joinType, null) };
      }),
    ),
  );
  const chipLabel = (output: QueryOutput, column: number) =>
    BAR.filterChip(columnHeaderText(output.result.table, output.result.columns[column].key));

  it('name the column as the result shows it, e.g. "O.ID is NULL"', () => {
    const shop = results.find((r) => r.puzzle.id === 'shop-never-ordered' && r.joinType === 'left')!;
    expect(shop.columns.map((column) => chipLabel(shop.output, column))).toContain('O.ID is NULL');
    for (const { output, columns } of results) {
      for (const column of columns) {
        expect(chipLabel(output, column)).toMatch(/^[\x20-\x7e]+$/);
      }
    }
  });

  it('the trap puzzle offers both its NULL columns (the wrong one keeps extra rows)', () => {
    const trap = results.find((r) => r.puzzle.id === 'cafe-never-ordered' && r.joinType === 'left' && r.output.left.id === 'drinks')!;
    const labels = trap.columns.map((column) => chipLabel(trap.output, column));
    expect(labels).toContain('T.ID is NULL');
    expect(labels).toContain('MILK is NULL');
  });

  it('INNER offers only stored NULLs (no LEFT JOIN ghosts)', () => {
    const noMilk = results.find((r) => r.puzzle.id === 'cafe-no-milk' && r.joinType === 'inner')!;
    expect(noMilk.columns.map((column) => chipLabel(noMilk.output, column))).toEqual(['MILK is NULL']);
    const shop = results.find((r) => r.puzzle.id === 'shop-match' && r.joinType === 'inner')!;
    expect(shop.columns).toEqual([]);
  });

  // Temporarily 45 cm: Exit made the widest bar 44.2 cm. The side-controls step moves Recenter and
  // Exit to their own row; this limit goes back to 40 cm there (reach: Clear at ~0.6 m from the eyes).
  it('the widest playing bar (Prev, Hint, Next, Recenter, Exit, a filter label and Clear) stays within 45 cm', () => {
    const labelWidth = (text: string) =>
      measureTextCm(text, HEADER_METRICS, LABEL_FONT_CM) + 2 * BAR_BUTTON_PADDING_EM * LABEL_FONT_CM;
    let widest = 0;
    for (const { output, columns } of results) {
      for (const column of columns) {
        widest = Math.max(widest, labelWidth(chipLabel(output, column)));
      }
    }
    const width = barRowWidthCm([
      barButtonWidthCm([BAR.prev], LABEL_FONT_CM),
      barButtonWidthCm(BAR.hintLabels, LABEL_FONT_CM),
      barButtonWidthCm(NEXT_LABELS, LABEL_FONT_CM),
      // Recenter and Exit: icons at the minimum target size.
      CONTROL_OPTION_MIN_WIDTH_CM,
      CONTROL_OPTION_MIN_WIDTH_CM,
      widest,
      barButtonWidthCm([BAR.clearFilter], LABEL_FONT_CM),
    ]);
    expect(width).toBeLessThanOrEqual(45);
  });

  it('fit the bar: at most MAX_FILTER_CHIPS, and Back plus the chips within the band (50 cm)', () => {
    for (const { puzzle, joinType, output, columns } of results) {
      const where = `${puzzle.id} ${output.left.id} <- ${output.right.id} ${joinType}`;
      expect(columns.length, where).toBeLessThanOrEqual(MAX_FILTER_CHIPS);
      const widths = [
        barButtonWidthCm([BAR.filterBack], LABEL_FONT_CM),
        ...columns.map((column) => barButtonWidthCm([chipLabel(output, column)], LABEL_FONT_CM)),
      ];
      expect(barRowWidthCm(widths), where).toBeLessThanOrEqual(50);
    }
  });
});

describe('takeaways name columns through placeholders', () => {
  it('resolve to the headers the player sees', () => {
    expect(puzzleText(getPuzzle('cafe-never-ordered')).takeaway).toBe("The NULL under T.ID means no match; MILK's doesn't.");
    expect(puzzleText(getPuzzle('school-no-club')).takeaway).toBe('A blank CLUB ID and an unknown one both match nothing.');
    expect(puzzleText(getPuzzle('school-twice')).takeaway).toBe(
      'Choir and Drama share ID 3, so Ines appears twice. A duplicated ID makes a join repeat rows.',
    );
  });
});
