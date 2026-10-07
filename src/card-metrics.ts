/**
 * The puzzle card's text sizes and width, kept pure (no IWSDK imports) so
 * the copy tests can word-wrap every line against the card the app really
 * builds (`challenge-view.ts` builds from these).
 *
 * The card sits beside the result slab (not above it), so it's narrow and
 * tall: CARD_WIDTH_EM goal-font ems wide, the goal on up to CARD_GOAL_LINES
 * lines and the message (intro, hint, answer, or the win's takeaway, query
 * line and note) on up to CARD_MESSAGE_LINES lines.
 */

import { HEADER_METRICS, DATA_METRICS, measureTextCm, type GlyphMetrics } from './slab-metrics.js';
import {
  CARD_GOAL_TEXT_TARGET_DEG,
  CARD_ROW_TEXT_TARGET_DEG,
  fontCmForAngle,
  MIN_ROW_FONT_CM,
  PLANNED_CARD_DISTANCE_METERS,
} from './text-angles.js';

/** Card width, in goal-font ems (~38 cm at the planned distance, ~29° wide). */
export const CARD_WIDTH_EM = 20;
export const CARD_GOAL_LINES = 3;
export const CARD_MESSAGE_LINES = 5;
/** The card border's width (cm): thicker than a slab's, so the dataset accent reads. */
export const CARD_BORDER_CM = 0.3;
const PHASE2_CARD_BORDER_CM = 0.15;

export type CardMetrics = {
  /** The goal's font (bold) and the card's small font (title, status, message), cm. */
  goalFont: number;
  smallFont: number;
  padding: number;
  border: number;
  widthCm: number;
  /** Width available to text inside the padding and border, cm. */
  innerWidthCm: number;
};

export function cardMetrics(): CardMetrics {
  const goalFont = Math.max(MIN_ROW_FONT_CM, fontCmForAngle(CARD_GOAL_TEXT_TARGET_DEG, PLANNED_CARD_DISTANCE_METERS));
  const smallFont = Math.max(MIN_ROW_FONT_CM, fontCmForAngle(CARD_ROW_TEXT_TARGET_DEG, PLANNED_CARD_DISTANCE_METERS));
  // The padding gives up the border's extra width, so its thickness doesn't change the card's size.
  const padding = smallFont * 0.8 - (CARD_BORDER_CM - PHASE2_CARD_BORDER_CM);
  const widthCm = CARD_WIDTH_EM * goalFont;
  return {
    goalFont,
    smallFont,
    padding,
    border: CARD_BORDER_CM,
    widthCm,
    innerWidthCm: widthCm - 2 * (padding + CARD_BORDER_CM),
  };
}

/**
 * How many lines `text` takes when word-wrapped (like UIKit: greedy, at
 * spaces) into `widthCm` at `fontCm` in `metrics` (DATA_METRICS for regular
 * text, HEADER_METRICS for bold).
 */
export function wrappedLines(text: string, metrics: GlyphMetrics, fontCm: number, widthCm: number): number {
  let lines = 1;
  let line = '';
  for (const word of text.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measureTextCm(candidate, metrics, fontCm) > widthCm) {
      lines++;
      line = word;
    } else {
      line = candidate;
    }
  }
  return lines;
}

/** Lines `text` takes in the card's message area (regular small font). */
export function cardMessageLines(text: string): number {
  const m = cardMetrics();
  return wrappedLines(text, DATA_METRICS, m.smallFont, m.innerWidthCm);
}

/** Lines `text` takes as the card's goal (bold goal font). */
export function cardGoalLines(text: string): number {
  const m = cardMetrics();
  return wrappedLines(text, HEADER_METRICS, m.goalFont, m.innerWidthCm);
}

/** Lines `text` takes in the card's bold small font (the title). */
export function cardTitleLines(text: string): number {
  const m = cardMetrics();
  return wrappedLines(text, HEADER_METRICS, m.smallFont, m.innerWidthCm);
}
