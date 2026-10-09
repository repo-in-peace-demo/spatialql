import { describe, expect, it } from 'vitest';
import {
  COLUMN_LABEL_MIN_PADDING_EM,
  columnHalfCm,
  columnHeightCm,
  columnWidthCm,
  PICKER_COLUMNS,
  PICKER_ROWS,
  PICKER_TILE_GAP_CM,
  PICKER_TILE_WIDTH_CM,
  PICKER_WIDTH_CM,
  pickerColumnHeightCm,
} from '../challenge-view.js';
import {
  BAR_BUTTON_PADDING_EM,
  barButtonWidthCm,
  CONTROL_OPTION_MIN_HEIGHT_CM,
  CONTROL_OPTION_MIN_WIDTH_CM,
  DATA_METRICS,
  HEADER_METRICS,
  MAX_FILTER_CHIPS,
  measureTextCm,
} from '../slab-metrics.js';
import { PLANNED_CONTROL_DISTANCE_METERS, slabTextSizeAt } from '../text-angles.js';
import { joinTypeControlSizeCm } from '../table-slab-view.js';
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
    // Centered under the column: at most 2 cm past either side.
    expect(label).toBeLessThanOrEqual(11 + 4);
    expect(BAR.exit).toMatch(/^[\x20-\x7e]+$/);
  });

  it('Prev is a full touch target (at least the minimum, like every bar button)', () => {
    expect(barButtonWidthCm([BAR.prev], LABEL_FONT_CM)).toBeGreaterThanOrEqual(CONTROL_OPTION_MIN_WIDTH_CM);
  });

  it('the Recenter hover label is one short line, plain ASCII', () => {
    const label = measureTextCm(BAR.recenter, HEADER_METRICS, LABEL_FONT_CM) + 2 * BAR_BUTTON_PADDING_EM * LABEL_FONT_CM;
    expect(label).toBeLessThanOrEqual(11 + 4);
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

  /** The column as challenge-view.ts builds it. */
  const lead = joinTypeControlSizeCm(LABEL_FONT_CM);
  const width = columnWidthCm(
    LABEL_FONT_CM,
    {
      prev: BAR.prev,
      hint: BAR.hintLabels,
      next: NEXT_LABELS,
      clear: BAR.clearFilter,
      filter: BAR.filter,
      filterBack: BAR.filterBack,
      puzzles: BAR.puzzles,
    },
    lead,
  );
  const half = columnHalfCm(width);
  const padding = BAR_BUTTON_PADDING_EM * LABEL_FONT_CM;

  it('the column is about two buttons wide (at most 11.1 cm: ~12.7° at 0.5 m; INNER | LEFT sets it), its halves full touch targets', () => {
    expect(width).toBeLessThanOrEqual(11.1);
    expect(half).toBeGreaterThanOrEqual(CONTROL_OPTION_MIN_WIDTH_CM);
    // Prev and every Next label fit a half cell; Hint, Filter, Back and Clear the full width.
    for (const label of [BAR.prev, ...NEXT_LABELS]) {
      expect(measureTextCm(label, HEADER_METRICS, LABEL_FONT_CM) + 2 * padding, label).toBeLessThanOrEqual(half + 1e-9);
    }
    for (const label of [...BAR.hintLabels, BAR.filter, BAR.filterBack, BAR.clearFilter]) {
      expect(measureTextCm(label, HEADER_METRICS, LABEL_FONT_CM) + 2 * padding, label).toBeLessThanOrEqual(width + 1e-9);
    }
  });

  it('every chip (bold) and every WHERE label (regular) fits the column width, never cut', () => {
    const minPadding = COLUMN_LABEL_MIN_PADDING_EM * LABEL_FONT_CM;
    for (const { output, columns } of results) {
      for (const column of columns) {
        const label = chipLabel(output, column);
        expect(measureTextCm(label, HEADER_METRICS, LABEL_FONT_CM) + 2 * minPadding, label).toBeLessThanOrEqual(width + 1e-9);
        expect(measureTextCm(label, DATA_METRICS, LABEL_FONT_CM) + 2 * minPadding, label).toBeLessThanOrEqual(width + 1e-9);
      }
    }
  });

  it('the filter area adds at most 5 rows (the chips one per row, and Back), so the column stays under 33 cm', () => {
    let rows = 2;
    for (const { columns } of results) {
      rows = Math.max(rows, columns.length > 0 ? columns.length + 1 : 0);
    }
    expect(rows).toBeLessThanOrEqual(5);
    const buttonHeight = Math.max(CONTROL_OPTION_MIN_HEIGHT_CM, LABEL_FONT_CM * 1.2);
    expect(columnHeightCm(buttonHeight, lead.heightCm, rows)).toBeLessThanOrEqual(33);
  });

  describe('the in-XR puzzle picker', () => {
    const buttonHeight = Math.max(CONTROL_OPTION_MIN_HEIGHT_CM, LABEL_FONT_CM * 1.2);

    it('20 tiles (4 x 5), each a full touch target: at least 3 x 2 cm', () => {
      expect(PICKER_COLUMNS * PICKER_ROWS).toBe(20);
      expect(PICKER_TILE_WIDTH_CM).toBeGreaterThanOrEqual(3);
      expect(buttonHeight).toBeGreaterThanOrEqual(2);
      expect(PICKER_WIDTH_CM).toBeCloseTo(4 * 3.0 + 3 * 0.3, 6);
    });

    it('the grid is 12.9 cm wide: ~14.8° on the 0.5 m arc, extending the ~12.7° column ~2° to the left (to about -45°)', () => {
      const deg = (cm: number) => (cm / 50) * (180 / Math.PI);
      expect(deg(PICKER_WIDTH_CM)).toBeLessThanOrEqual(15);
      expect(deg(PICKER_WIDTH_CM) - deg(width)).toBeLessThanOrEqual(3);
    });

    it('Puzzles fits the column; Back fits the grid; every tile number with its mark, and "Today", fit a tile', () => {
      expect(measureTextCm(BAR.puzzles, HEADER_METRICS, LABEL_FONT_CM) + 2 * padding).toBeLessThanOrEqual(width + 1e-9);
      expect(measureTextCm(BAR.pickerBack, HEADER_METRICS, LABEL_FONT_CM) + 2 * padding).toBeLessThanOrEqual(PICKER_WIDTH_CM);
      // A tile: its number (as built, 0.9 label fonts) and, below it, an icon (0.7) or "Today" (0.7 x 0.85).
      const tilePadding = COLUMN_LABEL_MIN_PADDING_EM * LABEL_FONT_CM;
      for (let n = 1; n <= 20; n++) {
        expect(measureTextCm(String(n), HEADER_METRICS, LABEL_FONT_CM * 0.9) + 2 * tilePadding, String(n)).toBeLessThanOrEqual(PICKER_TILE_WIDTH_CM);
      }
      expect(measureTextCm(BAR.pickerToday, HEADER_METRICS, LABEL_FONT_CM * 0.7 * 0.85) + 2 * tilePadding).toBeLessThanOrEqual(PICKER_TILE_WIDTH_CM);
      // Height: the number's line and the mark's row within a button's height.
      expect(LABEL_FONT_CM * 0.9 * 1.2 + LABEL_FONT_CM * 0.7 * 1.1 + LABEL_FONT_CM * 0.05).toBeLessThanOrEqual(buttonHeight);
      for (const label of [BAR.puzzles, BAR.pickerBack, BAR.pickerToday]) {
        expect(label).toMatch(/^[\x20-\x7e]+$/);
      }
    });

    it('open, the column is at most 31 cm tall (its tallest with five filter rows is about the same)', () => {
      expect(pickerColumnHeightCm(buttonHeight, lead.heightCm)).toBeLessThanOrEqual(31);
      expect(PICKER_TILE_GAP_CM).toBeGreaterThan(0);
    });
  });

  it('at most MAX_FILTER_CHIPS', () => {
    for (const { puzzle, joinType, output, columns } of results) {
      expect(columns.length, `${puzzle.id} ${output.left.id} <- ${output.right.id} ${joinType}`).toBeLessThanOrEqual(MAX_FILTER_CHIPS);
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

