/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Pure scene-layer rendering: builds a UIKit component tree from a `Table`.
 * No ECS imports here — `desk-placement.ts` / `join-system.ts` own entities.
 *
 * Built imperatively with `UIKit.Container`/`UIKit.Text` rather than static
 * UIKitML, because row count and cell text are runtime data (UIKitML is
 * parsed once from fixed markup). `UIKitDocument` accepts any root
 * `Component`, and the SDK's `PanelUISystem` ticks every `UIKitDocument` it
 * finds via `scene.traverse()` regardless of how it was constructed, so a
 * manually-built document works with no extra system.
 *
 * Animation hooks: every data row binds its `opacity` and
 * `transformTranslateY` to signals (`RowView.opacity` / `offsetYCm`), and the
 * whole slab to `fade`. Animations write `.value` on those signals, which
 * UIKit applies without re-running layout and without per-frame property
 * objects.
 */

import { computed, signal, UIKit, UIKitDocument, type Signal } from '@iwsdk/core';
import { firaCode } from '@pmndrs/msdfonts/firaCode';
import { inter } from '@pmndrs/msdfonts/inter';
import type { CellValue, Row, Table } from './data/types.js';

/** Source slabs show at most this many rows (the last becomes "+N more"). */
export const MAX_VISIBLE_ROWS = 8;
/** Join result slabs may show this many rows before overflowing. */
export const MAX_RESULT_ROWS = 12;

// All numeric sizes below are UIKit units == centimeters (pixelSize
// defaults to 0.01 in @pmndrs/uikit, i.e. 100 units = 1 meter).
const FONT_SIZE_HEADER = 1.8;
const FONT_SIZE_DATA = 1.6;
// Slightly smaller than row text (1.6), never smaller than this: a caption
// wider than the columns widens the slab instead of shrinking.
const FONT_SIZE_CAPTION = 1.4;
const PANEL_PADDING = 1.2;
const PANEL_BORDER_WIDTH = 0.15;
const PANEL_BORDER_RADIUS = 1.2;
const CELL_PADDING_X = 1.0;
const CELL_PADDING_Y = 0.6;
const COLUMN_MIN_WIDTH = 5;
const COLUMN_MAX_WIDTH = 14;
const COLUMN_GAP = 0.6;
const CAPTION_GAP_BELOW = 0.9;
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
const COLOR_CAPTION = '#3a362e';

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
const MONO_METRICS = buildGlyphMetrics(MONO_FONT_INFO);

type Container = InstanceType<typeof UIKit.Container>;
type Text = InstanceType<typeof UIKit.Text>;

export type RowView = {
  row: Container;
  cells: Container[];
  /** Row opacity (multiplied by the slab's `fade`). */
  opacity: Signal<number>;
  /** Vertical offset in cm, positive = down. Doesn't affect layout. */
  offsetYCm: Signal<number>;
  /** The row's own (zebra) background, restored when a key tint is cleared. */
  baseBackground: string;
};

/** Paints a row with a join-key tint, or restores its own background. */
export function setRowTint(rowView: RowView, tint: string | null): void {
  rowView.row.setProperties({ backgroundColor: tint ?? rowView.baseBackground });
}

export type TableSlabDocument = {
  document: UIKitDocument;
  root: Container;
  rowViews: Map<number, RowView>;
  widthMeters: number;
  /** Height with every row displayed (ghost rows included). */
  heightMeters: number;
  /** Where the document's origin sits on the panel. */
  anchor: 'center' | 'top';
  /** Panel top edge -> first data row top edge. */
  firstRowTopMeters: number;
  rowHeightMeters: number;
  /** Whole-slab opacity multiplier. */
  fade: Signal<number>;
  /** The SQL caption's Text nodes, one per line (empty without a caption). */
  captionLines: Text[];
};

export type SlabBuildOptions = {
  /** Row cap; defaults to MAX_VISIBLE_ROWS. */
  maxRows?: number;
  /** Rows that start with `display: 'none'`. */
  hiddenRows?: ReadonlySet<number>;
  /**
   * Monospace caption above the header. `fitLines` lists every variant the
   * caption may later show, so its font size fits all of them.
   */
  caption?: { lines: string[]; fitLines: string[] };
  /** Put the document origin at the panel's top edge instead of its center. */
  anchorTop?: boolean;
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

function cellContainer(columnWidthCm: number): Container {
  // Fixed width with no grow/shrink, so every cell in a column (header
  // included) is exactly the column width and can't drift out of alignment.
  return new UIKit.Container({
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
}

function buildCell(text: string, fontSizeCm: number, columnWidthCm: number, color: string, bold: boolean): Container {
  const cell = cellContainer(columnWidthCm);
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

/** Width of the caption's widest possible line at the (fixed) caption size. */
function captionWidthCm(fitLines: string[]): number {
  let widest = 0;
  for (const line of fitLines) {
    widest = Math.max(widest, measureTextCm(line, MONO_METRICS, FONT_SIZE_CAPTION));
  }
  return widest;
}

/** Local Y (meters) of a data row's center, in the slab document's frame. */
export function rowCenterLocalY(doc: TableSlabDocument, rowIndex: number): number {
  const fromTop = doc.firstRowTopMeters + (rowIndex + 0.5) * doc.rowHeightMeters;
  return doc.anchor === 'top' ? -fromTop : doc.heightMeters / 2 - fromTop;
}

/** Local Y (meters) of the panel's top and bottom edges. */
export function slabTopLocalY(doc: TableSlabDocument): number {
  return doc.anchor === 'top' ? 0 : doc.heightMeters / 2;
}
export function slabBottomLocalY(doc: TableSlabDocument): number {
  return doc.anchor === 'top' ? -doc.heightMeters : -doc.heightMeters / 2;
}

/**
 * Builds the full UIKit tree for one table: optional caption, header row,
 * and up to `maxRows` data rows (maxRows - 1 data rows + one "N more"
 * indicator row if the table has more rows than fit).
 */
export function buildTableSlabDocument(table: Table, options: SlabBuildOptions = {}): TableSlabDocument {
  const maxRows = options.maxRows ?? MAX_VISIBLE_ROWS;
  const overflow = table.rows.length > maxRows;
  const visibleRowCount = overflow ? maxRows - 1 : table.rows.length;
  const visibleRows = table.rows.slice(0, visibleRowCount);

  const columnWidths = computeColumnWidths(table, visibleRows);
  let contentWidthCm =
    columnWidths.reduce((sum, w) => sum + w, 0) + COLUMN_GAP * Math.max(0, table.columns.length - 1);
  // The caption never shrinks below its fixed size: if it's wider than the
  // columns, the last column absorbs the difference so rows still span the
  // full slab width.
  if (options.caption && columnWidths.length > 0) {
    const deficit = captionWidthCm(options.caption.fitLines) + FIT_EPSILON_CM - contentWidthCm;
    if (deficit > 0) {
      columnWidths[columnWidths.length - 1] += deficit;
      contentWidthCm += deficit;
    }
  }
  // Yoga sizes are border-box: the root's width must include its border as
  // well as its padding, or the rows get squeezed / spill past the edge.
  const widthCm = 2 * (PANEL_PADDING + PANEL_BORDER_WIDTH) + contentWidthCm;

  const fade = signal(1);
  const anchor = options.anchorTop ? 'top' : 'center';
  const root = new UIKit.Container({
    flexDirection: 'column',
    width: widthCm,
    anchorY: anchor,
    opacity: fade,
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

  let captionHeightCm = 0;
  const captionLines: Text[] = [];
  if (options.caption) {
    const fontSize = FONT_SIZE_CAPTION;
    const captionBlock = new UIKit.Container({
      flexDirection: 'column',
      paddingBottom: CAPTION_GAP_BELOW,
    });
    for (const line of options.caption.lines) {
      const text = new UIKit.Text({
        text: line,
        fontFamily: 'mono',
        fontSize,
        color: COLOR_CAPTION,
        wordBreak: 'keep-all',
        flexShrink: 0,
      });
      captionBlock.add(text);
      captionLines.push(text);
    }
    root.add(captionBlock);
    captionHeightCm = options.caption.lines.length * fontSize * LINE_HEIGHT_FACTOR + CAPTION_GAP_BELOW;
  }

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
    const rowOpacity = signal(1);
    const offsetYCm = signal(0);
    const rowContainer = new UIKit.Container({
      flexDirection: 'row',
      backgroundColor: rowBackground,
      gapColumn: COLUMN_GAP,
      opacity: computed(() => rowOpacity.value * fade.value),
      transformTranslateY: offsetYCm,
      display: options.hiddenRows?.has(rowIndex) ? 'none' : 'flex',
    });

    // Cells of an unmatched LEFT JOIN row hold `null` and render as `NULL`,
    // exactly as a database would show them. The data layer's lineage still
    // records that they came from an unmatched join rather than a stored NULL.
    const cells = table.columns.map((column, columnIndex) => {
      const columnWidth = columnWidths[columnIndex];
      const raw = dataRow[column];
      const truncated = truncateToWidth(
        displayValue(raw),
        DATA_METRICS,
        FONT_SIZE_DATA,
        columnWidth - 2 * CELL_PADDING_X,
      );
      const cell = buildCell(truncated, FONT_SIZE_DATA, columnWidth, raw === null ? COLOR_TEXT_NULL : COLOR_TEXT, false);
      rowContainer.add(cell);
      return cell;
    });

    root.add(rowContainer);
    rowViews.set(rowIndex, {
      row: rowContainer,
      cells,
      opacity: rowOpacity,
      offsetYCm,
      baseBackground: rowBackground,
    });
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
  const firstRowTopCm = PANEL_BORDER_WIDTH + PANEL_PADDING + captionHeightCm + headerRowHeightCm;
  const heightCm =
    firstRowTopCm + dataRowHeightCm * (visibleRowCount + (overflow ? 1 : 0)) + PANEL_PADDING + PANEL_BORDER_WIDTH;

  const document = new UIKitDocument(root);

  return {
    document,
    root,
    rowViews,
    widthMeters: widthCm / 100,
    heightMeters: heightCm / 100,
    anchor,
    firstRowTopMeters: firstRowTopCm / 100,
    rowHeightMeters: dataRowHeightCm / 100,
    fade,
    captionLines,
  };
}

/**
 * The INNER | LEFT pill, built as its own document so it can live on its
 * own non-grabbable entity (see join-system.ts for why).
 */
export type JoinTypePillView = {
  document: UIKitDocument;
  fade: Signal<number>;
  inner: Container;
  left: Container;
  widthMeters: number;
  heightMeters: number;
};

// Row-sized text and a ~4.5 cm tall target, so a fingertip poke lands easily.
const PILL_FONT_SIZE = 1.6;
const PILL_PADDING_X = 2.0;
const PILL_PADDING_Y = 1.1;
const PILL_RADIUS = 1.8;
const COLOR_PILL_TRACK = '#e2ddd0';
const COLOR_PILL_SELECTED = '#2f2b24';
const COLOR_PILL_TEXT_SELECTED = '#f5f3ef';

/** Selected/unselected look of one pill option; text inherits `color`. */
export function pillOptionStyle(selected: boolean): { backgroundColor: string; color: string } {
  return {
    backgroundColor: selected ? COLOR_PILL_SELECTED : COLOR_PILL_TRACK,
    color: selected ? COLOR_PILL_TEXT_SELECTED : COLOR_TEXT,
  };
}

export function buildJoinTypePill(): JoinTypePillView {
  const fade = signal(1);
  const root = new UIKit.Container({
    flexDirection: 'row',
    anchorY: 'bottom',
    opacity: fade,
    fontFamilies: FONT_FAMILIES,
    backgroundColor: COLOR_PILL_TRACK,
    borderColor: COLOR_PANEL_BORDER,
    borderTopWidth: PANEL_BORDER_WIDTH,
    borderLeftWidth: PANEL_BORDER_WIDTH,
    borderRightWidth: PANEL_BORDER_WIDTH,
    borderBottomWidth: PANEL_BORDER_WIDTH,
    borderTopLeftRadius: PILL_RADIUS,
    borderTopRightRadius: PILL_RADIUS,
    borderBottomLeftRadius: PILL_RADIUS,
    borderBottomRightRadius: PILL_RADIUS,
    paddingTop: 0.3,
    paddingBottom: 0.3,
    paddingLeft: 0.3,
    paddingRight: 0.3,
    gapColumn: 0.3,
  });
  const option = (label: string, selected: boolean) => {
    const style = pillOptionStyle(selected);
    const container = new UIKit.Container({
      paddingLeft: PILL_PADDING_X,
      paddingRight: PILL_PADDING_X,
      paddingTop: PILL_PADDING_Y,
      paddingBottom: PILL_PADDING_Y,
      borderTopLeftRadius: PILL_RADIUS - 0.3,
      borderTopRightRadius: PILL_RADIUS - 0.3,
      borderBottomLeftRadius: PILL_RADIUS - 0.3,
      borderBottomRightRadius: PILL_RADIUS - 0.3,
      backgroundColor: style.backgroundColor,
      color: style.color,
    });
    container.add(
      new UIKit.Text({
        text: label,
        fontSize: PILL_FONT_SIZE,
        fontWeight: 'bold',
        wordBreak: 'keep-all',
      }),
    );
    root.add(container);
    return container;
  };
  const inner = option('INNER', true);
  const left = option('LEFT', false);

  const optionWidth = (label: string) =>
    measureTextCm(label, HEADER_METRICS, PILL_FONT_SIZE) + 2 * PILL_PADDING_X;
  const widthCm = optionWidth('INNER') + optionWidth('LEFT') + 0.3 * 3 + 2 * PANEL_BORDER_WIDTH;
  const heightCm = PILL_FONT_SIZE * LINE_HEIGHT_FACTOR + 2 * PILL_PADDING_Y + 0.6 + 2 * PANEL_BORDER_WIDTH;

  return {
    document: new UIKitDocument(root),
    fade,
    inner,
    left,
    widthMeters: widthCm / 100,
    heightMeters: heightCm / 100,
  };
}
