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
import type { CellValue, Row, Table } from './data/types.js';

const MAX_VISIBLE_ROWS = 8;

// All numeric sizes below are UIKit units == centimeters (pixelSize
// defaults to 0.01 in @pmndrs/uikit, i.e. 100 units = 1 meter).
const FONT_SIZE_HEADER = 1.8;
const FONT_SIZE_DATA = 1.6;
const PANEL_PADDING = 1.2;
const PANEL_BORDER_RADIUS = 1.2;
const CELL_PADDING_X = 1.0;
const CELL_PADDING_Y = 0.6;
const COLUMN_MIN_WIDTH = 5;
const COLUMN_MAX_WIDTH = 11;
const COLUMN_GAP = 0.6;

// Average glyph advance width as a fraction of font size, for a proportional
// sans-serif font. A tunable approximation, not a measured metric -- the
// sample data is short single-line strings with no wrapping, so it only
// needs to be good enough to size columns and decide when to truncate.
const AVG_CHAR_WIDTH_FACTOR = 0.55;

const COLOR_PANEL_BACKGROUND = '#f5f3ef';
const COLOR_PANEL_BORDER = '#c9c2b0';
const COLOR_HEADER_BACKGROUND = '#e2ddd0';
const COLOR_ROW_BACKGROUND_EVEN = '#f5f3ef';
const COLOR_ROW_BACKGROUND_ODD = '#ece7db';
const COLOR_TEXT = '#1c1c1c';
const COLOR_TEXT_NULL = '#8a8378';

export type RowView = {
  row: InstanceType<typeof UIKit.Container>;
  cells: InstanceType<typeof UIKit.Container>[];
};

export type TableSlabDocument = {
  document: UIKitDocument;
  rowViews: Map<number, RowView>;
  widthMeters: number;
};

function displayValue(value: CellValue): string {
  return value === null ? 'NULL' : String(value);
}

function estimateTextWidthCm(text: string, fontSizeCm: number): number {
  return text.length * fontSizeCm * AVG_CHAR_WIDTH_FACTOR;
}

function truncateToWidth(text: string, fontSizeCm: number, maxWidthCm: number): string {
  if (estimateTextWidthCm(text, fontSizeCm) <= maxWidthCm) {
    return text;
  }
  const maxChars = Math.max(1, Math.floor(maxWidthCm / (fontSizeCm * AVG_CHAR_WIDTH_FACTOR)));
  if (maxChars <= 3) {
    return text.slice(0, maxChars);
  }
  return `${text.slice(0, maxChars - 3)}...`;
}

/** Resolves each column's authored width from its header and visible cell content. */
function computeColumnWidths(table: Table, visibleRows: Row[]): number[] {
  return table.columns.map((column) => {
    let widestCm = estimateTextWidthCm(column, FONT_SIZE_HEADER);
    for (const row of visibleRows) {
      const cellWidth = estimateTextWidthCm(displayValue(row[column]), FONT_SIZE_DATA);
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
  const cell = new UIKit.Container({
    width: columnWidthCm,
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
  const widthCm =
    2 * PANEL_PADDING +
    columnWidths.reduce((sum, w) => sum + w, 0) +
    COLUMN_GAP * Math.max(0, table.columns.length - 1);

  const root = new UIKit.Container({
    flexDirection: 'column',
    width: widthCm,
    backgroundColor: COLOR_PANEL_BACKGROUND,
    borderColor: COLOR_PANEL_BORDER,
    borderTopWidth: 0.15,
    borderLeftWidth: 0.15,
    borderRightWidth: 0.15,
    borderBottomWidth: 0.15,
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
    header.add(buildCell(column.toUpperCase(), FONT_SIZE_HEADER, columnWidths[columnIndex], COLOR_TEXT, true));
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
      const truncated = truncateToWidth(displayValue(raw), FONT_SIZE_DATA, columnWidth - 2 * CELL_PADDING_X);
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

  const document = new UIKitDocument(root);

  return { document, rowViews, widthMeters: widthCm / 100 };
}
