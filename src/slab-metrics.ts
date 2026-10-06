/**
 * A slab's layout sizes and text measurement, kept free of IWSDK imports so
 * the data-layer tests can check that every dataset's cells fit their
 * columns at the sizes the app really uses (`table-slab-view.ts` builds the
 * UIKit tree from these).
 *
 * All sizes are UIKit units == centimeters (pixelSize defaults to 0.01 in
 * @pmndrs/uikit, i.e. 100 units = 1 meter). Text is sized by angle, not by
 * centimeters: callers pass the row and header font sizes (see
 * `slabTextSizeAt`), and every other layout size scales with the row font.
 * The base layout was designed at a 1.6 cm row font.
 */

import { firaCode } from '@pmndrs/msdfonts/firaCode';
import { inter } from '@pmndrs/msdfonts/inter';
import type { CellValue } from './data/types.js';

export const BASE_ROW_FONT_CM = 1.6;
export const BASE_HEADER_FONT_CM = 1.8;
// Slightly smaller than row text, never smaller than this: a caption wider
// than the columns widens the slab instead of shrinking.
const BASE_CAPTION_FONT_CM = 1.4;
const BASE_PANEL_PADDING = 1.2;
export const BASE_PANEL_BORDER_WIDTH = 0.15;
const BASE_PANEL_BORDER_RADIUS = 1.2;
const BASE_CELL_PADDING_X = 1.0;
const BASE_CELL_PADDING_Y = 0.6;
const BASE_COLUMN_MIN_WIDTH = 5;
const BASE_COLUMN_MAX_WIDTH = 14;
const BASE_COLUMN_GAP = 0.6;
const BASE_CAPTION_GAP_BELOW = 0.9;
// UIKit's default `lineHeight` is '120%' of fontSize; a single-line Text is
// exactly one line tall, so every row's height is known before layout.
export const LINE_HEIGHT_FACTOR = 1.2;

/** Physical font sizes (cm) a slab is built with. */
export type SlabTextSizes = { rowFontCm: number; headerFontCm: number };
/** The original fixed sizes, for callers that don't size by angle. */
export const DEFAULT_SLAB_TEXT_SIZES: SlabTextSizes = { rowFontCm: BASE_ROW_FONT_CM, headerFontCm: BASE_HEADER_FONT_CM };

/** Every layout size of one slab, in cm, derived from its font sizes. */
export type SlabMetrics = {
  rowFont: number;
  headerFont: number;
  captionFont: number;
  panelPadding: number;
  borderWidth: number;
  borderRadius: number;
  cellPaddingX: number;
  cellPaddingY: number;
  columnMinWidth: number;
  columnMaxWidth: number;
  columnGap: number;
  captionGapBelow: number;
  headerRowHeight: number;
  dataRowHeight: number;
};

export function slabMetrics(text: SlabTextSizes = DEFAULT_SLAB_TEXT_SIZES): SlabMetrics {
  const s = text.rowFontCm / BASE_ROW_FONT_CM;
  const cellPaddingY = BASE_CELL_PADDING_Y * s;
  return {
    rowFont: text.rowFontCm,
    headerFont: text.headerFontCm,
    captionFont: BASE_CAPTION_FONT_CM * s,
    panelPadding: BASE_PANEL_PADDING * s,
    borderWidth: BASE_PANEL_BORDER_WIDTH * s,
    borderRadius: BASE_PANEL_BORDER_RADIUS * s,
    cellPaddingX: BASE_CELL_PADDING_X * s,
    cellPaddingY,
    columnMinWidth: BASE_COLUMN_MIN_WIDTH * s,
    columnMaxWidth: BASE_COLUMN_MAX_WIDTH * s,
    columnGap: BASE_COLUMN_GAP * s,
    captionGapBelow: BASE_CAPTION_GAP_BELOW * s,
    headerRowHeight: text.headerFontCm * LINE_HEIGHT_FACTOR + 2 * cellPaddingY,
    dataRowHeight: text.rowFontCm * LINE_HEIGHT_FACTOR + 2 * cellPaddingY,
  };
}

// Absorbs float rounding between this measurement and yoga's layout so a
// string that exactly fills its column isn't truncated.
export const FIT_EPSILON_CM = 1e-3;

// The exact MSDF font data UIKit renders with. UIKit's default family is this
// same Inter package, but it resolves `fontWeight` to the nearest available
// weight at runtime; pinning `fontFamilies` on the root to only these
// entries guarantees the fonts we measure are the fonts that get drawn
// ('normal' = 400 resolves to light = 300, 'bold' = 700 to bold). `inter`
// stays the first key so it remains the default family; the SQL caption
// opts into `mono` (a single weight, so every weight resolves to it).
type MsdfFontInfo = typeof inter.light;
const DATA_FONT_INFO: MsdfFontInfo = inter.light;
const HEADER_FONT_INFO: MsdfFontInfo = inter.bold;
const MONO_FONT_INFO: MsdfFontInfo = firaCode.light;
export const FONT_FAMILIES = {
  inter: { light: DATA_FONT_INFO, bold: HEADER_FONT_INFO },
  mono: { light: MONO_FONT_INFO },
};

// UIKit's advance for a glyph missing from the font (its MISSING_GLYPH), in ems.
const MISSING_GLYPH_ADVANCE_EM = 0.6;

export type GlyphMetrics = Map<string, number>;

/** Per-glyph advance widths in ems, normalized exactly as UIKit's `Font` does. */
function buildGlyphMetrics(info: MsdfFontInfo): GlyphMetrics {
  const advances: GlyphMetrics = new Map();
  for (const glyph of info.chars) {
    advances.set(glyph.char, glyph.xadvance / info.info.size);
  }
  return advances;
}

export const DATA_METRICS = buildGlyphMetrics(DATA_FONT_INFO);
export const HEADER_METRICS = buildGlyphMetrics(HEADER_FONT_INFO);
export const MONO_METRICS = buildGlyphMetrics(MONO_FONT_INFO);

export function displayValue(value: CellValue): string {
  return value === null ? 'NULL' : String(value);
}

/**
 * Single-line text width, matching UIKit's own measurement: whitespace is
 * collapsed and trimmed (`whiteSpace: 'normal'`), then each glyph contributes
 * `xadvance * fontSize` (letterSpacing is 0; UIKit's measure ignores kerning).
 */
export function measureTextCm(text: string, metrics: GlyphMetrics, fontSizeCm: number): number {
  const normalized = text.replace(/[\t\n ]+/g, ' ').trim();
  let widthEm = 0;
  for (const char of normalized) {
    widthEm += metrics.get(char) ?? MISSING_GLYPH_ADVANCE_EM;
  }
  return widthEm * fontSizeCm;
}

function ellipsisFor(metrics: GlyphMetrics): string {
  return metrics.has('…') ? '…' : '...';
}

/**
 * Fingertip-sized targets: every control and bar button is at least this
 * wide and tall (cm). A touch target, not text, so it doesn't scale with the
 * label font.
 */
export const CONTROL_OPTION_MIN_WIDTH_CM = 4.0;
export const CONTROL_OPTION_MIN_HEIGHT_CM = 2.5;
/** A bar button's horizontal padding around its label, in label-font ems. */
export const BAR_BUTTON_PADDING_EM = 0.6;

/**
 * A bar button's width: its widest label (bold, at `labelFontCm`) plus
 * padding, at least the touch-target minimum. A button whose label changes
 * (Hint) is sized for every label it shows, so relabeling never resizes it.
 */
export function barButtonWidthCm(labels: readonly string[], labelFontCm: number): number {
  let widest = 0;
  for (const label of labels) {
    widest = Math.max(widest, measureTextCm(label, HEADER_METRICS, labelFontCm));
  }
  return Math.max(CONTROL_OPTION_MIN_WIDTH_CM, widest + 2 * BAR_BUTTON_PADDING_EM * labelFontCm);
}

/** The Filter button's chips: at most this many (one per result column with a NULL; tested). */
export const MAX_FILTER_CHIPS = 6;

/** The puzzle bar's padding (also the gap between its buttons) and border, cm. */
export const BAR_PADDING_CM = 0.3;
export const BAR_BORDER_CM = 0.15;

/**
 * The puzzle bar's width (cm) holding these items side by side (button
 * widths, and the filter's WHERE label), with the gaps between them and the
 * bar's padding and border.
 */
export function barRowWidthCm(itemWidthsCm: readonly number[]): number {
  let width = 2 * (BAR_PADDING_CM + BAR_BORDER_CM) + BAR_PADDING_CM * Math.max(0, itemWidthsCm.length - 1);
  for (const item of itemWidthsCm) {
    width += item;
  }
  return width;
}

/** Whether `text` fits a column of at most `m.columnMaxWidth` (with cell padding) without an ellipsis. */
export function fitsColumn(text: string, metrics: GlyphMetrics, fontSizeCm: number, m: SlabMetrics): boolean {
  return measureTextCm(text, metrics, fontSizeCm) <= m.columnMaxWidth - 2 * m.cellPaddingX + FIT_EPSILON_CM;
}

/** Returns `text` unchanged if it fits, else the longest prefix + ellipsis that does. */
export function truncateToWidth(text: string, metrics: GlyphMetrics, fontSizeCm: number, maxWidthCm: number): string {
  if (measureTextCm(text, metrics, fontSizeCm) <= maxWidthCm + FIT_EPSILON_CM) {
    return text;
  }
  const ellipsis = ellipsisFor(metrics);
  const chars = Array.from(text);
  for (let length = chars.length - 1; length > 0; length--) {
    const candidate = chars.slice(0, length).join('').trimEnd() + ellipsis;
    if (measureTextCm(candidate, metrics, fontSizeCm) <= maxWidthCm + FIT_EPSILON_CM) {
      return candidate;
    }
  }
  return ellipsis;
}
