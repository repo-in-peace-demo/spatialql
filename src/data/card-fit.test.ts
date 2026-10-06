import { describe, expect, it } from 'vitest';
import {
  CARD_GOAL_LINES,
  CARD_MESSAGE_LINES,
  cardGoalLines,
  cardMessageLines,
  cardMetrics,
  wrappedLines,
} from '../card-metrics.js';
import { DATA_METRICS, HEADER_METRICS } from '../slab-metrics.js';
import { CARD, CONCEPT_INTROS, NULL_EXPLAINER, WELCOME } from './copy.js';
import { DATASET_IDS } from './datasets.js';
import { PRACTICE_ORDER, PUZZLES } from './puzzles.js';
import { puzzleText } from './puzzle-text.js';

/**
 * Every line the puzzle card shows, word-wrapped against the card's real
 * width (it sits beside the result slab: narrow and tall).
 */
const m = cardMetrics();
/** The title shares its row with the dataset icon and a gap. */
const titleWidth = m.innerWidthCm - m.smallFont * (1.25 + 0.4);
const oneLine = (text: string, bold = false) =>
  wrappedLines(text, bold ? HEADER_METRICS : DATA_METRICS, m.smallFont, bold ? titleWidth : m.innerWidthCm);

describe('the puzzle card fits its text', () => {
  it('every goal fits the goal area', () => {
    for (const puzzle of PUZZLES) {
      const goal = puzzleText(puzzle).goal;
      expect(cardGoalLines(goal), `${puzzle.id}: ${goal}`).toBeLessThanOrEqual(CARD_GOAL_LINES);
    }
  });

  it('every title fits one line beside the icon', () => {
    for (const id of DATASET_IDS) {
      for (const title of [CARD.practiceTitle(PRACTICE_ORDER.length, id), CARD.dailyTitle(id)]) {
        expect(oneLine(title, true), title).toBe(1);
      }
    }
  });

  it('every status fits its line', () => {
    const statuses = [
      `${CARD.missingRows(12)}, ${CARD.extraRows(12)}`,
      CARD.emptyResult,
      CARD.solvedWithHints(3),
      CARD.usedAllHints,
      CARD.solveFirst,
      WELCOME.streak(365),
    ];
    for (const status of statuses) {
      expect(oneLine(status), status).toBe(1);
    }
  });

  it('every hint, intro and coach line fits the message area', () => {
    for (const puzzle of PUZZLES) {
      for (const hint of puzzleText(puzzle).hints) {
        expect(cardMessageLines(hint), `${puzzle.id}: ${hint}`).toBeLessThanOrEqual(CARD_MESSAGE_LINES);
      }
    }
    for (const intro of Object.values(CONCEPT_INTROS)) {
      expect(cardMessageLines(intro), intro).toBeLessThanOrEqual(CARD_MESSAGE_LINES);
    }
    expect(cardMessageLines(`${CONCEPT_INTROS.antijoin} ${NULL_EXPLAINER}`)).toBeLessThanOrEqual(CARD_MESSAGE_LINES);
  });

  it('a daily ahead of practice: the lead-in and two intros fit together', () => {
    const intros = Object.values(CONCEPT_INTROS).map(cardMessageLines).sort((a, b) => b - a);
    expect(cardMessageLines(CARD.dailyAhead) + intros[0] + intros[1]).toBeLessThanOrEqual(CARD_MESSAGE_LINES);
  });

  it('the answer and "Make these moves to finish, or skip." fit together', () => {
    for (const puzzle of PUZZLES) {
      const answer = puzzleText(puzzle).hints[2];
      expect(cardMessageLines(answer) + cardMessageLines(CARD.answerNext), `${puzzle.id}: ${answer}`).toBeLessThanOrEqual(
        CARD_MESSAGE_LINES,
      );
    }
  });

  it('a win: the takeaway, the query line and a note fit together', () => {
    const queryLines = Math.max(...[CARD.win, CARD.winWithAnswer].map(cardMessageLines));
    const noteLines = Math.max(...[CARD.morePuzzlesSoon, CARD.streakNeedsSolve].map(cardMessageLines));
    for (const puzzle of PUZZLES) {
      const takeaway = puzzleText(puzzle).takeaway;
      expect(cardMessageLines(takeaway) + queryLines + noteLines, `${puzzle.id}: ${takeaway}`).toBeLessThanOrEqual(
        CARD_MESSAGE_LINES,
      );
    }
  });
});
