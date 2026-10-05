import { describe, expect, it } from 'vitest';
import { BAR_BUTTON_PADDING_EM, barButtonWidthCm, HEADER_METRICS, measureTextCm } from '../slab-metrics.js';
import { PLANNED_CONTROL_DISTANCE_METERS, slabTextSizeAt } from '../text-angles.js';
import { BAR } from './copy.js';
import { getPuzzle } from './puzzles.js';
import { puzzleText } from './puzzle-text.js';

/** The bar's label size: the control's header size by angle, as challenge-system.ts builds it. */
const LABEL_FONT_CM = slabTextSizeAt(PLANNED_CONTROL_DISTANCE_METERS).headerFontCm;

describe('puzzle bar labels', () => {
  it('the hint button fits every label it shows, so relabeling never resizes it', () => {
    const width = barButtonWidthCm(BAR.hintLabels, LABEL_FONT_CM);
    for (const label of BAR.hintLabels) {
      const needed = measureTextCm(label, HEADER_METRICS, LABEL_FONT_CM) + 2 * BAR_BUTTON_PADDING_EM * LABEL_FONT_CM;
      expect(needed, label).toBeLessThanOrEqual(width + 1e-9);
    }
  });

  it('says what it shows next, in order, in plain ASCII', () => {
    expect(BAR.hintLabels).toEqual(['Hint', 'Another hint', 'Show answer']);
    for (const label of [...BAR.hintLabels, BAR.next, BAR.clearFilter]) {
      expect(label, label).toMatch(/^[\x20-\x7e]+$/);
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
