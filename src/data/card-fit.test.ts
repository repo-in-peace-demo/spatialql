import { describe, expect, it } from 'vitest';
import {
  CARD_CLOCK_SCALE,
  CARD_GOAL_LINES,
  CARD_MESSAGE_LINES,
  cardGoalLines,
  cardMessageLines,
  cardMetrics,
  wrappedLines,
} from '../card-metrics.js';
import { DATA_METRICS, HEADER_METRICS, measureTextCm } from '../slab-metrics.js';
import { BROWSER_NOTICE, CARD, CONCEPT_INTROS, FREE_PLAY_DORMANT, NULL_EXPLAINER, SESSION, WELCOME } from './copy.js';
import { formatClock } from '../session-clock.js';
import { WELCOME_LAYOUT as L } from '../welcome-layout.js';
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

describe('the session clock above the card fits the card width', () => {
  it('the clock icon and the longest time, or "Solved in" and it, fit one line; plain ASCII', () => {
    const font = m.smallFont * CARD_CLOCK_SCALE;
    // The pill: padding each side, the icon (one font wide), a gap, the text.
    const chrome = 2 * font * 0.4 + font + font * 0.3;
    for (const text of [formatClock(9 * 3600 + 59 * 60 + 59), SESSION.solvedIn(formatClock(9 * 3600 + 59 * 60 + 59))]) {
      expect(measureTextCm(text, DATA_METRICS, font) + chrome, text).toBeLessThanOrEqual(m.innerWidthCm);
      expect(text).toMatch(/^[\x20-\x7e]+$/);
    }
    expect(SESSION.solvedIn('1:42')).toBe('Solved in 1:42');
  });
});

describe('the puzzle card fits its text', () => {
  it('every goal fits the goal area', () => {
    for (const puzzle of PUZZLES) {
      const goal = puzzleText(puzzle).goal;
      expect(cardGoalLines(goal), `${puzzle.id}: ${goal}`).toBeLessThanOrEqual(CARD_GOAL_LINES);
    }
  });

  it('every title fits one line beside the icon', () => {
    for (const id of DATASET_IDS) {
      for (const title of [CARD.practiceTitle(PRACTICE_ORDER.length, id), CARD.dailyTitle(PRACTICE_ORDER.length)]) {
        expect(oneLine(title, true), title).toBe(1);
      }
    }
  });

  it('every status fits its line', () => {
    const statuses = [
      CARD.diffStatus(12, 12),
      CARD.diffStatus(12, 0),
      CARD.diffStatus(0, 12),
      CARD.emptyResult,
      CARD.holdForAnswer,
      CARD.solvedWithHints(3),
      CARD.usedAllHints,
      CARD.solveFirst,
      CARD.tileLocked,
      CARD.morePuzzlesSoon,
      CARD.recentered,
      WELCOME.streak(365),
    ];
    for (const status of statuses) {
      expect(oneLine(status), status).toBe(1);
    }
  });

  it('the daily streak and its milestone lines fit the status line after the flame', () => {
    const flame = m.smallFont * 1.35;
    for (const days of [1, 2, 3, 7, 14, 30, 365]) {
      const text = CARD.streakMilestone(days) ?? WELCOME.streak(days);
      expect(measureTextCm(text, DATA_METRICS, m.smallFont) + flame, text).toBeLessThanOrEqual(m.innerWidthCm);
      expect(text).toMatch(/^[\x20-\x7e]+$/);
    }
    expect([3, 7, 14, 30].map((days) => CARD.streakMilestone(days))).toEqual([
      '3-day streak!',
      '7 days: a full week!',
      '14 days: two weeks strong!',
      '30-day streak!',
    ]);
    expect(CARD.streakMilestone(4)).toBeNull();
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

  it('"Poke a NULL in the result above, or use Filter." fits the message area on its own', () => {
    expect(cardMessageLines(CARD.wrongNull)).toBeLessThanOrEqual(2);
    expect(CARD.wrongNull).toMatch(/^[\x20-\x7e]+$/);
  });

  it('the streak explanation fits alone, and as the line after a daily-ahead intro', () => {
    expect(cardMessageLines(CARD.streakExplainer)).toBeLessThanOrEqual(2);
    for (const intro of Object.values(CONCEPT_INTROS)) {
      expect(cardMessageLines(CARD.dailyAhead) + cardMessageLines(intro) + cardMessageLines(CARD.streakExplainer), intro).toBeLessThanOrEqual(
        CARD_MESSAGE_LINES,
      );
    }
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

/**
 * The welcome page (HTML) at the Quest Browser's default window, where its
 * sizes are smallest (welcome-layout.ts). Measured with the slab fonts'
 * Inter metrics (light for regular text, bold for bold), with a margin for
 * the page's regular and extra-bold weights being a little wider.
 */
describe('the welcome page fits its text at the Quest default window', () => {
  const WEIGHT_MARGIN = 1.08;
  const regular = (text: string, px: number) => measureTextCm(text, DATA_METRICS, px) * WEIGHT_MARGIN;
  const bold = (text: string, px: number) => measureTextCm(text, HEADER_METRICS, px) * WEIGHT_MARGIN;
  const lines = (text: string, px: number, width: number, isBold = false) =>
    wrappedLines(text, isBold ? HEADER_METRICS : DATA_METRICS, px * WEIGHT_MARGIN, width);
  const f = L.fontPx;

  it('the title row, the tagline and the setup line each fit one line of the left column', () => {
    expect(bold(WELCOME.title, f.title) + L.markPx).toBeLessThanOrEqual(L.columnPx);
    expect(bold(WELCOME.description, f.tagline)).toBeLessThanOrEqual(L.columnPx);
    expect(regular(WELCOME.setup, f.body)).toBeLessThanOrEqual(L.columnPx);
    expect(regular(FREE_PLAY_DORMANT.description, f.body)).toBeLessThanOrEqual(L.columnPx);
  });

  it('every Start label fits the button beside its icon', () => {
    for (const label of [WELCOME.start, WELCOME.startPuzzle(20), FREE_PLAY_DORMANT.start]) {
      expect(bold(label, f.start) + L.startIconPx + 40, label).toBeLessThanOrEqual(L.columnPx);
    }
  });

  it('the secondary actions fit one row; the reset question at most two lines above Cancel and Reset', () => {
    const buttonWidth = (label: string) => bold(label, f.secondary) + 2 * L.secondaryPaddingPx + 4;
    const linkWidth = regular(WELCOME.resetLink, f.link) + 8;
    for (const label of [WELCOME.choosePuzzle, WELCOME.pickerBack]) {
      expect(buttonWidth(label) + 10 + linkWidth, label).toBeLessThanOrEqual(L.columnPx);
    }
    expect(buttonWidth(WELCOME.resetCancel) + 10 + buttonWidth(WELCOME.resetConfirm)).toBeLessThanOrEqual(L.columnPx);
    expect(lines(WELCOME.resetQuestion, 20, L.columnPx)).toBeLessThanOrEqual(2);
  });

  it('the progress lines fit the right column (at most two lines each), with the calendar', () => {
    const daily = [WELCOME.practiceFirst, WELCOME.dailyDone, WELCOME.dailyDoneAllDone, WELCOME.dailyRevealed, ...DATASET_IDS.map((id) => WELCOME.dailyOpen(id))];
    for (const text of daily) {
      expect(lines(text, f.body, L.sidePx, true), text).toBeLessThanOrEqual(2);
    }
    const plain = [
      WELCOME.practiceProgress(20, 20),
      WELCOME.practiceProgressWithAnswers(20, 20, 19),
      WELCOME.allDone(20),
      WELCOME.allDoneWithAnswers(20, 19),
      WELCOME.saveUnavailable,
    ];
    for (const text of plain) {
      expect(lines(text, f.body, L.sidePx), text).toBeLessThanOrEqual(2);
    }
    for (const text of [WELCOME.streakStart, WELCOME.streakAfterPractice, `${WELCOME.streak(365)}. ${WELCOME.streakAtRisk}`]) {
      expect(lines(text, f.body, L.sidePx - L.flamePx), text).toBeLessThanOrEqual(2);
    }
    // Seven 36 px days, 6 apart; the month's title between its two 36 px arrows.
    const calendarWidth = 7 * 36 + 6 * 6;
    expect(calendarWidth).toBeLessThanOrEqual(L.sidePx);
    for (let month = 1; month <= 12; month++) {
      const title = WELCOME.monthTitle(2026, month);
      expect(bold(title, 20) + 2 * 36 + 8, title).toBeLessThanOrEqual(calendarWidth);
    }
    expect(WELCOME.weekdays.join('')).toBe('MTWTFSS');
  });

  it('is plain ASCII, like the rest of the copy', () => {
    const all = [
      WELCOME.datasetsLabel,
      WELCOME.calendarLabel(WELCOME.monthTitle(2026, 9), 30, 30),
      ...WELCOME.monthNames,
      WELCOME.previousMonth,
      WELCOME.nextMonth,
      WELCOME.pickerLabel,
      WELCOME.tileLabel(20, 'revealed', true),
      ...Object.values(BROWSER_NOTICE),
      ...Object.values(FREE_PLAY_DORMANT),
    ];
    for (const text of all) {
      expect(text).toMatch(/^[\x20-\x7e]+$/);
    }
  });
});
