/**
 * The welcome page's sizes at the Quest Browser's default window (1280 x 670
 * CSS px), where welcome.css's scale unit is 1 px: larger windows scale them
 * up to 1.3x (in one column, also no more than the window's height allows
 * for about 880 px of content), so these are the floor. Kept in step with
 * welcome.css by hand;
 * the copy width tests (card-fit.test.ts) measure against them.
 */

/** The Quest Browser's default window, CSS px (desktop mode). */
export const QUEST_WINDOW = { width: 1280, height: 670 } as const;

/** Two columns at the Quest default: the card is 980 wide, 36 padding, 40 between columns. */
const CARD_WIDTH = 980;
const CARD_PADDING = 36;
const COLUMN_GAP = 40;
const COLUMN = (CARD_WIDTH - 2 * CARD_PADDING - COLUMN_GAP) / 2;

export const WELCOME_LAYOUT = {
  /** The left column (brand, setup, Start, the secondary buttons). */
  columnPx: COLUMN,
  /** The right column's text width (its own 36 px left padding). */
  sidePx: COLUMN - 36,
  fontPx: { title: 58, tagline: 24, body: 22, start: 30, secondary: 22, link: 17 },
  /** The title row: the mark (76) and a 14 px gap before the title. */
  markPx: 76 + 14,
  /** Start: an icon (34) and a 12 px gap before the label, within 20 px of side room each way. */
  startIconPx: 34 + 12,
  /** A secondary button's padding, each side. */
  secondaryPaddingPx: 20,
  /** The streak line's flame (26) and gap (8). */
  flamePx: 26 + 8,
} as const;
