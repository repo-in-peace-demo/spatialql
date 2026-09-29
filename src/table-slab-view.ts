/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Pure scene-layer rendering: builds a UIKit component tree from a `Table`.
 * No ECS imports here — `desk-placement.ts` owns entities/components.
 *
 * Built imperatively with `UIKit.Container`/`UIKit.Text` rather than static
 * UIKitML, because row count and cell text are runtime data (UIKitML is
 * parsed once from fixed markup). `UIKitDocument` accepts any root
 * `Component`, and the SDK's `PanelUISystem` ticks every `UIKitDocument` it
 * finds via `scene.traverse()` regardless of how it was constructed, so a
 * manually-built document works with no extra system.
 */

import { UIKit, UIKitDocument } from '@iwsdk/core';
import { inter } from '@pmndrs/msdfonts/inter';
import type { CellValue, Row, Table } from './data/types.js';

const MAX_VISIBLE_ROWS = 8;

// All numeric sizes below are UIKit units == centimeters (pixelSize
// defaults to 0.01 in @pmndrs/uikit, i.e. 100 units = 1 meter).
const FONT_SIZE_HEADER = 1.8;
const FONT_SIZE_DATA = 1.6;
const PANEL_PADDING = 1.2;
const PANEL_BORDER_WIDTH = 0.15;
const PANEL_BORDER_RADIUS = 1.2;
const CELL_PADDING_X = 1.0;
const CELL_PADDING_Y = 0.6;
const COLUMN_MIN_WIDTH = 5;
const COLUMN_MAX_WIDTH = 14;
const COLUMN_GAP = 0.6;
// UIKit's default `lineHeight` is '120%' of fontSize; a single-line Text is
// exactly one line tall, so every row's height is known before layout.
const LINE_HEIGHT_FACTOR = 1.2;

// Absorbs float rounding between this measurement and yoga's layout so a
// string that exactly fills its column isn't truncated.
const FIT_EPSILON_CM = 1e-3;

const COLOR_PANEL_BACKGROUND = '#f5f3ef';
const COLOR_PANEL_BORDER = '#c9c2b0';
const COLOR_HEADER_BACKGROUND = '#e2ddd0';
const COLOR_ROW_BACKGROUND_EVEN = '#f5f3ef';
const COLOR_ROW_BACKGROUND_ODD = '#ece7db';
const COLOR_TEXT = '#1c1c1c';
const COLOR_TEXT_NULL = '#8a8378';

// The exact MSDF font data UIKit renders with. UIKit's default family is this
// same Inter package, but it resolves `fontWeight` to the nearest available
// weight at runtime; pinning `fontFamilies` on the root to only these two
// entries guarantees the fonts we measure are the fonts that get drawn
// ('normal' = 400 resolves to light = 300, 'bold' = 700 to bold).
type MsdfFontInfo = typeof inter.light;
const DATA_FONT_INFO: MsdfFontInfo = inter.light;
const HEADER_FONT_INFO: MsdfFontInfo = inter.bold;
const FONT_FAMILIES = { inter: { light: DATA_FONT_INFO, bold: HEADER_FONT_INFO } };

// UIKit's advance for a glyph missing from the font (its MISSING_GLYPH), in ems.
const MISSING_GLYPH_ADVANCE_EM = 0.6;

type GlyphMetrics = Map<string, number>;

/** Per-glyph advance widths in ems, normalized exactly as UIKit's `Font` does. */
function buildGlyphMetrics(info: MsdfFontInfo): GlyphMetrics {
  const advances: GlyphMetrics = new Map();
  for (const glyph of info.chars) {
    advances.set(glyph.char, glyph.xadvance / info.info.size);
  }
  return advances;
}

const DATA_METRICS = buildGlyphMetrics(DATA_FONT_INFO);
const HEADER_METRICS = buildGlyphMetrics(HEADER_FONT_INFO);

export type RowView = {
  row: InstanceType<typeof UIKit.Container>;
  cells: InstanceType<typeof UIKit.Container>[];
};

export type TableSlabDocument = {
  document: UIKitDocument;
  rowViews: Map<number, RowView>;
  widthMeters: number;
  /** Panel height from the row structure; matches the laid-out root size. */
  heightMeters: number;
};

function displayValue(value: CellValue): string {
  return value === null ? 'NULL' : String(value);
}

function headerLabel(table: Table, column: string): string {
  return (table.columnLabels?.[column] ?? column).toUpperCase();
}

/**
 * Single-line text width, matching UIKit's own measurement: whitespace is
 * collapsed and trimmed (`whiteSpace: 'normal'`), then each glyph contributes
 * `xadvance * fontSize` (letterSpacing is 0; UIKit's measure ignores kerning).
 */
function measureTextCm(text: string, metrics: GlyphMetrics, fontSizeCm: number): number {
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

/** Returns `text` unchanged if it fits, else the longest prefix + ellipsis that does. */
function truncateToWidth(text: string, metrics: GlyphMetrics, fontSizeCm: number, maxWidthCm: number): string {
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

/**
 * Resolves each column's fixed width so it holds both its header (bold,
 * uppercase, header size) and its widest visible cell (data size), plus
 * horizontal cell padding, clamped to the column min/max.
 */
function computeColumnWidths(table: Table, visibleRows: Row[]): number[] {
  return table.columns.map((column) => {
    let widestCm = measureTextCm(headerLabel(table, column), HEADER_METRICS, FONT_SIZE_HEADER);
    for (const row of visibleRows) {
      const cellWidth = measureTextCm(displayValue(row[column]), DATA_METRICS, FONT_SIZE_DATA);
      widestCm = Math.max(widestCm, cellWidth);
    }
    const contentWidth = widestCm + 2 * CELL_PADDING_X;
    return Math.min(COLUMN_MAX_WIDTH, Math.max(COLUMN_MIN_WIDTH, contentWidth));
  });
}

function buildCell(
  text: string,
  fontSizeCm: number,
  columnWidthCm: number,
  color: string,
  bold: boolean,
): InstanceType<typeof UIKit.Container> {
  // Fixed width with no grow/shrink, so every cell in a column (header
  // included) is exactly the column width and can't drift out of alignment.
  const cell = new UIKit.Container({
    width: columnWidthCm,
    minWidth: columnWidthCm,
    maxWidth: columnWidthCm,
    flexGrow: 0,
    flexShrink: 0,
    paddingLeft: CELL_PADDING_X,
    paddingRight: CELL_PADDING_X,
    paddingTop: CELL_PADDING_Y,
    paddingBottom: CELL_PADDING_Y,
    justifyContent: 'flex-start',
    alignItems: 'center',
  });
  cell.add(
    new UIKit.Text({
      text,
      fontSize: fontSizeCm,
      fontWeight: bold ? 'bold' : 'normal',
      color,
      // Never break onto a second line; text is pre-truncated to fit.
      wordBreak: 'keep-all',
      flexShrink: 0,
    }),
  );
  return cell;
}

/**
 * Builds the full UIKit tree for one table: header row + up to
 * `MAX_VISIBLE_ROWS` data rows (7 data rows + one "N more" indicator row if
 * the table has more rows than fit).
 */
export function buildTableSlabDocument(table: Table): TableSlabDocument {
  const overflow = table.rows.length > MAX_VISIBLE_ROWS;
  const visibleRowCount = overflow ? MAX_VISIBLE_ROWS - 1 : table.rows.length;
  const visibleRows = table.rows.slice(0, visibleRowCount);

  const columnWidths = computeColumnWidths(table, visibleRows);
  // Yoga sizes are border-box: the root's width must include its border as
  // well as its padding, or the rows get squeezed / spill past the edge.
  const widthCm =
    2 * (PANEL_PADDING + PANEL_BORDER_WIDTH) +
    columnWidths.reduce((sum, w) => sum + w, 0) +
    COLUMN_GAP * Math.max(0, table.columns.length - 1);

  const root = new UIKit.Container({
    flexDirection: 'column',
    width: widthCm,
    fontFamilies: FONT_FAMILIES,
    backgroundColor: COLOR_PANEL_BACKGROUND,
    borderColor: COLOR_PANEL_BORDER,
    borderTopWidth: PANEL_BORDER_WIDTH,
    borderLeftWidth: PANEL_BORDER_WIDTH,
    borderRightWidth: PANEL_BORDER_WIDTH,
    borderBottomWidth: PANEL_BORDER_WIDTH,
    borderTopLeftRadius: PANEL_BORDER_RADIUS,
    borderTopRightRadius: PANEL_BORDER_RADIUS,
    borderBottomLeftRadius: PANEL_BORDER_RADIUS,
    borderBottomRightRadius: PANEL_BORDER_RADIUS,
    paddingTop: PANEL_PADDING,
    paddingBottom: PANEL_PADDING,
    paddingLeft: PANEL_PADDING,
    paddingRight: PANEL_PADDING,
  });

  const header = new UIKit.Container({
    flexDirection: 'row',
    backgroundColor: COLOR_HEADER_BACKGROUND,
    gapColumn: COLUMN_GAP,
    borderTopLeftRadius: PANEL_BORDER_RADIUS * 0.6,
    borderTopRightRadius: PANEL_BORDER_RADIUS * 0.6,
  });
  table.columns.forEach((column, columnIndex) => {
    const columnWidth = columnWidths[columnIndex];
    const label = truncateToWidth(
      headerLabel(table, column),
      HEADER_METRICS,
      FONT_SIZE_HEADER,
      columnWidth - 2 * CELL_PADDING_X,
    );
    header.add(buildCell(label, FONT_SIZE_HEADER, columnWidth, COLOR_TEXT, true));
  });
  root.add(header);

  const rowViews = new Map<number, RowView>();

  visibleRows.forEach((dataRow, rowIndex) => {
    const rowBackground = rowIndex % 2 === 0 ? COLOR_ROW_BACKGROUND_EVEN : COLOR_ROW_BACKGROUND_ODD;
    const rowContainer = new UIKit.Container({
      flexDirection: 'row',
      backgroundColor: rowBackground,
      gapColumn: COLUMN_GAP,
    });

    const cells = table.columns.map((column, columnIndex) => {
      const raw = dataRow[column];
      const columnWidth = columnWidths[columnIndex];
      const truncated = truncateToWidth(
        displayValue(raw),
        DATA_METRICS,
        FONT_SIZE_DATA,
        columnWidth - 2 * CELL_PADDING_X,
      );
      const cell = buildCell(
        truncated,
        FONT_SIZE_DATA,
        columnWidth,
        raw === null ? COLOR_TEXT_NULL : COLOR_TEXT,
        false,
      );
      rowContainer.add(cell);
      return cell;
    });

    root.add(rowContainer);
    rowViews.set(rowIndex, { row: rowContainer, cells });
  });

  if (overflow) {
    const remaining = table.rows.length - visibleRowCount;
    const indicator = new UIKit.Container({
      flexDirection: 'row',
      justifyContent: 'center',
      paddingTop: CELL_PADDING_Y,
      paddingBottom: CELL_PADDING_Y,
    });
    indicator.add(
      new UIKit.Text({
        text: `+ ${remaining} more row${remaining === 1 ? '' : 's'}`,
        fontSize: FONT_SIZE_DATA,
        color: COLOR_TEXT_NULL,
      }),
    );
    root.add(indicator);
  }

  const headerRowHeightCm = FONT_SIZE_HEADER * LINE_HEIGHT_FACTOR + 2 * CELL_PADDING_Y;
  const dataRowHeightCm = FONT_SIZE_DATA * LINE_HEIGHT_FACTOR + 2 * CELL_PADDING_Y;
  const heightCm =
    2 * (PANEL_PADDING + PANEL_BORDER_WIDTH) +
    headerRowHeightCm +
    dataRowHeightCm * (visibleRowCount + (overflow ? 1 : 0));

  const document = new UIKitDocument(root);

  return { document, rowViews, widthMeters: widthCm / 100, heightMeters: heightCm / 100 };
}
