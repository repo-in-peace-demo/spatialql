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
import { columnHeaderText } from './data/join-result.js';
import type { CellValue, Row, Table } from './data/types.js';

/** Source slabs show at most this many rows (the last becomes "+N more"). */
export const MAX_VISIBLE_ROWS = 8;
/** Join result slabs may show this many rows before overflowing. */
export const MAX_RESULT_ROWS = 12;

// All numeric sizes below are UIKit units == centimeters (pixelSize
// defaults to 0.01 in @pmndrs/uikit, i.e. 100 units = 1 meter).
//
// Text is sized by angle, not by centimeters: callers pass the row and
// header font sizes (see `slabTextSizeAt` in view-comfort.ts), and every
// other layout size scales with the row font. The base layout below was
// designed at a 1.6 cm row font.
const BASE_ROW_FONT_CM = 1.6;
const BASE_HEADER_FONT_CM = 1.8;
// Slightly smaller than row text, never smaller than this: a caption wider
// than the columns widens the slab instead of shrinking.
const BASE_CAPTION_FONT_CM = 1.4;
const BASE_PANEL_PADDING = 1.2;
const BASE_PANEL_BORDER_WIDTH = 0.15;
const BASE_PANEL_BORDER_RADIUS = 1.2;
const BASE_CELL_PADDING_X = 1.0;
const BASE_CELL_PADDING_Y = 0.6;
const BASE_COLUMN_MIN_WIDTH = 5;
const BASE_COLUMN_MAX_WIDTH = 14;
const BASE_COLUMN_GAP = 0.6;
const BASE_CAPTION_GAP_BELOW = 0.9;
// UIKit's default `lineHeight` is '120%' of fontSize; a single-line Text is
// exactly one line tall, so every row's height is known before layout.
const LINE_HEIGHT_FACTOR = 1.2;
// The control's border (not scaled: it isn't a slab).
const PANEL_BORDER_WIDTH = BASE_PANEL_BORDER_WIDTH;

/** Physical font sizes (cm) a slab is built with. */
export type SlabTextSizes = { rowFontCm: number; headerFontCm: number };
/** The original fixed sizes, for callers that don't size by angle. */
export const DEFAULT_SLAB_TEXT_SIZES: SlabTextSizes = { rowFontCm: BASE_ROW_FONT_CM, headerFontCm: BASE_HEADER_FONT_CM };

/** Every layout size of one slab, in cm, derived from its font sizes. */
type SlabMetrics = {
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

function slabMetrics(text: SlabTextSizes = DEFAULT_SLAB_TEXT_SIZES): SlabMetrics {
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
const FIT_EPSILON_CM = 1e-3;

const COLOR_PANEL_BACKGROUND = '#f5f3ef';
const COLOR_PANEL_BORDER = '#c9c2b0';
const COLOR_HEADER_BACKGROUND = '#e2ddd0';
const COLOR_ROW_BACKGROUND_EVEN = '#f5f3ef';
const COLOR_ROW_BACKGROUND_ODD = '#ece7db';
const COLOR_TEXT = '#1c1c1c';
const COLOR_TEXT_NULL = '#8a8378';
const COLOR_CAPTION = '#3a362e';
// Challenge mode: the win look (a warm border and caption), the diff
// marker, and the outline of silhouette / placeholder rows.
const COLOR_WIN_BORDER = '#d08a1e';
const COLOR_CAPTION_WIN = '#8a4b00';
const COLOR_DIFF_MARKER = '#5b4a8a';
const COLOR_OUTLINE = '#a89f8c';
/** Width of the diff gutter (a narrow first column for the `+` marker), at the base font. */
const BASE_GUTTER_WIDTH = 2.2;
const BASE_OUTLINE_WIDTH = 0.12;

/** Challenge win look for a result slab's border. */
export function slabBorderColor(win: boolean): string {
  return win ? COLOR_WIN_BORDER : COLOR_PANEL_BORDER;
}

/** Challenge win look for a result slab's SQL caption. */
export function captionColor(win: boolean): string {
  return win ? COLOR_CAPTION_WIN : COLOR_CAPTION;
}

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
type ContainerProps = NonNullable<ConstructorParameters<typeof UIKit.Container>[0]>;
type Text = InstanceType<typeof UIKit.Text>;

/** A transform offset (cm, panel-local; +Y is down, +Z toward the viewer) for a group of cells. */
export type CellOffset = { x: Signal<number>; y: Signal<number>; z: Signal<number> };

export type RowView = {
  row: Container;
  cells: Container[];
  /** Row opacity (multiplied by the slab's `fade`). */
  opacity: Signal<number>;
  /** Vertical offset in cm, positive = down. Doesn't affect layout. */
  offsetYCm: Signal<number>;
  /**
   * With `cellSides`: one offset for the row's LEFT-table cells and one for
   * its RIGHT-table cells, so each group can fly in from its source row.
   */
  flight: { left: CellOffset; right: CellOffset } | null;
  /**
   * The element painting the row's background: the row itself, or (with
   * `cellSides`) a separate layer behind its cells, so the background can
   * fade on its own (`backgroundFade`) while the cells stay visible.
   */
  background: Container;
  /** Opacity of the background layer alone (1 when there's no separate layer). */
  backgroundFade: Signal<number>;
  /** The row's own (zebra) background, restored when a key tint is cleared. */
  baseBackground: string;
  /** With `diffGutter`: opacity of the row's `+` ("not in the answer") marker. */
  marker: Signal<number> | null;
};

/** A placeholder for a row the answer still needs (challenge mode); hidden until shown. */
export type PlaceholderRowView = {
  row: Container;
  opacity: Signal<number>;
};

/** A data column's horizontal extent in the document's frame (meters, origin at the panel center). */
export type ColumnSpan = { x0: number; x1: number };

function cellOffset(): CellOffset {
  return { x: signal(0), y: signal(0), z: signal(0) };
}

/** Paints a row with a join-key tint, or restores its own background. */
export function setRowTint(rowView: RowView, tint: string | null): void {
  rowView.background.setProperties({ backgroundColor: tint ?? rowView.baseBackground });
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
  /** Per caption line: its opacity (multiplied by `fade`), e.g. to hide a reserved line. */
  captionOpacity: Signal<number>[];
  /** Each data column's extent, for hit tests (pinch on a cell). */
  columnSpans: ColumnSpan[];
  /** With `placeholderRows`: the hidden placeholder rows, after the data rows. */
  placeholders: PlaceholderRowView[];
  /** Physical font sizes the slab was built with (meters). */
  rowFontMeters: number;
  headerFontMeters: number;
  /** Panel height in cm when built with `animatedHeight` (null otherwise). */
  panelHeightCm: Signal<number> | null;
  /** Panel height (meters) with `visibleRows` data rows displayed. */
  heightForRowsMeters: (visibleRows: number) => number;
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
  /** Physical font sizes; defaults to DEFAULT_SLAB_TEXT_SIZES. */
  text?: SlabTextSizes;
  /**
   * Drive the panel's height from `TableSlabDocument.panelHeightCm` (sized
   * to the rows currently shown) instead of letting it fit its content, so
   * callers can animate it as rows are shown or hidden.
   */
  animatedHeight?: boolean;
  /**
   * Which source table each column came from (join results). Gives every
   * row a `flight` offset per side, bound to its cells' transforms. Built
   * once with the slab, so animating it needs no new objects or layout.
   */
  cellSides?: ReadonlyArray<'left' | 'right'>;
  /** Challenge mode: a narrow first column holding each row's diff marker. */
  diffGutter?: boolean;
  /** Challenge mode: this many hidden placeholder rows after the data rows. */
  placeholderRows?: number;
  /**
   * Reserve the height of at least this many rows (`heightMeters`), so
   * placement keeps room for rows plus placeholders.
   */
  reserveRows?: number;
  /** Challenge silhouette: rows are empty outlines, except `revealRow`, which keeps its text. */
  silhouette?: { revealRow: number | null };
};

/** Rows shown for `table` under `maxRows`, and whether a "+N more" row follows. */
function visibleRowLayout(table: Table, maxRows: number): { visibleRowCount: number; overflow: boolean } {
  const overflow = table.rows.length > maxRows;
  return { visibleRowCount: overflow ? maxRows - 1 : table.rows.length, overflow };
}

function captionHeightCmFor(options: SlabBuildOptions, m: SlabMetrics): number {
  return options.caption ? options.caption.lines.length * m.captionFont * LINE_HEIGHT_FACTOR + m.captionGapBelow : 0;
}

/**
 * Height (meters) a slab for `table` needs with every row displayed, before
 * any `minHeightMeters` padding. Lets callers match slab heights up front.
 */
export function tableSlabNaturalHeightMeters(table: Table, options: SlabBuildOptions = {}): number {
  const { visibleRowCount, overflow } = visibleRowLayout(table, options.maxRows ?? MAX_VISIBLE_ROWS);
  const rows = Math.max(visibleRowCount, options.reserveRows ?? 0);
  return panelHeightCm(options, slabMetrics(options.text), rows, overflow) / 100;
}

/** Panel height (cm) with `rows` data rows (plus the "+N more" row if `overflow`). */
function panelHeightCm(options: SlabBuildOptions, m: SlabMetrics, rows: number, overflow: boolean): number {
  const firstRowTopCm = m.borderWidth + m.panelPadding + captionHeightCmFor(options, m) + m.headerRowHeight;
  return firstRowTopCm + m.dataRowHeight * (rows + (overflow ? 1 : 0)) + m.panelPadding + m.borderWidth;
}

function displayValue(value: CellValue): string {
  return value === null ? 'NULL' : String(value);
}

function headerLabel(table: Table, column: string): string {
  return columnHeaderText(table, column);
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
function computeColumnWidths(table: Table, visibleRows: Row[], m: SlabMetrics): number[] {
  return table.columns.map((column) => {
    let widestCm = measureTextCm(headerLabel(table, column), HEADER_METRICS, m.headerFont);
    for (const row of visibleRows) {
      const cellWidth = measureTextCm(displayValue(row[column]), DATA_METRICS, m.rowFont);
      widestCm = Math.max(widestCm, cellWidth);
    }
    const contentWidth = widestCm + 2 * m.cellPaddingX;
    return Math.min(m.columnMaxWidth, Math.max(m.columnMinWidth, contentWidth));
  });
}

function cellContainer(columnWidthCm: number, m: SlabMetrics): Container {
  // Fixed width with no grow/shrink, so every cell in a column (header
  // included) is exactly the column width and can't drift out of alignment.
  return new UIKit.Container({
    width: columnWidthCm,
    minWidth: columnWidthCm,
    maxWidth: columnWidthCm,
    flexGrow: 0,
    flexShrink: 0,
    paddingLeft: m.cellPaddingX,
    paddingRight: m.cellPaddingX,
    paddingTop: m.cellPaddingY,
    paddingBottom: m.cellPaddingY,
    justifyContent: 'flex-start',
    alignItems: 'center',
  });
}

function buildCell(
  text: string,
  fontSizeCm: number,
  columnWidthCm: number,
  color: string,
  bold: boolean,
  m: SlabMetrics,
  offset: CellOffset | null = null,
  /** A number, or a (computed) signal UIKit binds like any other property. */
  textOpacity: unknown = 1,
): Container {
  const cell = cellContainer(columnWidthCm, m);
  if (offset) {
    cell.setProperties({
      transformTranslateX: offset.x,
      transformTranslateY: offset.y,
      transformTranslateZ: offset.z,
    });
  }
  cell.add(
    new UIKit.Text({
      text,
      fontSize: fontSizeCm,
      fontWeight: bold ? 'bold' : 'normal',
      color,
      // Never break onto a second line; text is pre-truncated to fit.
      wordBreak: 'keep-all',
      flexShrink: 0,
      ...(textOpacity === 1 ? {} : { opacity: textOpacity as number }),
    }),
  );
  return cell;
}

/** Single-line width (cm) of `text` in the bold header font at `fontSizeCm`. */
export function measureHeaderTextCm(text: string, fontSizeCm: number): number {
  return measureTextCm(text, HEADER_METRICS, fontSizeCm);
}

/** Single-line width (cm) of `text` in the regular data font at `fontSizeCm`. */
export function measureDataTextCm(text: string, fontSizeCm: number): number {
  return measureTextCm(text, DATA_METRICS, fontSizeCm);
}

/** Width of the caption's widest possible line at the (fixed) caption size. */
function captionWidthCm(fitLines: string[], m: SlabMetrics): number {
  let widest = 0;
  for (const line of fitLines) {
    widest = Math.max(widest, measureTextCm(line, MONO_METRICS, m.captionFont));
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
  const m = slabMetrics(options.text);
  const maxRows = options.maxRows ?? MAX_VISIBLE_ROWS;
  const { visibleRowCount, overflow } = visibleRowLayout(table, maxRows);
  const visibleRows = table.rows.slice(0, visibleRowCount);
  // Height with every row displayed (hidden rows included), or the reserved
  // row count if larger: what placement reserves.
  const heightCm = panelHeightCm(options, m, Math.max(visibleRowCount, options.reserveRows ?? 0), overflow);
  const heightForRowsMeters = (rows: number) => panelHeightCm(options, m, rows, overflow) / 100;
  // With `animatedHeight`, the panel starts at the height of the rows shown now.
  const shownRows = visibleRows.filter((_, rowIndex) => !options.hiddenRows?.has(rowIndex)).length;
  const panelHeight = options.animatedHeight ? signal(heightForRowsMeters(shownRows) * 100) : null;

  const columnWidths = computeColumnWidths(table, visibleRows, m);
  // The diff gutter is a narrow column before the data columns.
  const gutterWidthCm = options.diffGutter ? BASE_GUTTER_WIDTH * (m.rowFont / BASE_ROW_FONT_CM) : 0;
  const gutterSpanCm = options.diffGutter ? gutterWidthCm + m.columnGap : 0;
  let contentWidthCm =
    gutterSpanCm +
    columnWidths.reduce((sum, w) => sum + w, 0) +
    m.columnGap * Math.max(0, table.columns.length - 1);
  // The caption never shrinks below its fixed size: if it's wider than the
  // columns, the last column absorbs the difference so rows still span the
  // full slab width.
  if (options.caption && columnWidths.length > 0) {
    const deficit = captionWidthCm(options.caption.fitLines, m) + FIT_EPSILON_CM - contentWidthCm;
    if (deficit > 0) {
      columnWidths[columnWidths.length - 1] += deficit;
      contentWidthCm += deficit;
    }
  }
  // Yoga sizes are border-box: the root's width must include its border as
  // well as its padding, or the rows get squeezed / spill past the edge.
  const widthCm = 2 * (m.panelPadding + m.borderWidth) + contentWidthCm;

  const fade = signal(1);
  const anchor = options.anchorTop ? 'top' : 'center';
  const root = new UIKit.Container({
    flexDirection: 'column',
    width: widthCm,
    ...(panelHeight ? { height: panelHeight } : {}),
    anchorY: anchor,
    opacity: fade,
    fontFamilies: FONT_FAMILIES,
    backgroundColor: COLOR_PANEL_BACKGROUND,
    borderColor: COLOR_PANEL_BORDER,
    borderTopWidth: m.borderWidth,
    borderLeftWidth: m.borderWidth,
    borderRightWidth: m.borderWidth,
    borderBottomWidth: m.borderWidth,
    borderTopLeftRadius: m.borderRadius,
    borderTopRightRadius: m.borderRadius,
    borderBottomLeftRadius: m.borderRadius,
    borderBottomRightRadius: m.borderRadius,
    paddingTop: m.panelPadding,
    paddingBottom: m.panelPadding,
    paddingLeft: m.panelPadding,
    paddingRight: m.panelPadding,
  });

  const captionHeightCm = captionHeightCmFor(options, m);
  const captionLines: Text[] = [];
  const captionOpacity: Signal<number>[] = [];
  if (options.caption) {
    const fontSize = m.captionFont;
    const captionBlock = new UIKit.Container({
      flexDirection: 'column',
      paddingBottom: m.captionGapBelow,
    });
    for (const line of options.caption.lines) {
      const lineOpacity = signal(1);
      const text = new UIKit.Text({
        text: line,
        fontFamily: 'mono',
        fontSize,
        color: COLOR_CAPTION,
        wordBreak: 'keep-all',
        flexShrink: 0,
        opacity: computed(() => lineOpacity.value * fade.value),
      });
      captionBlock.add(text);
      captionLines.push(text);
      captionOpacity.push(lineOpacity);
    }
    root.add(captionBlock);
  }

  // Each data column's extent, measured from the panel's left edge (cm),
  // then converted to the document frame (origin at the panel center).
  const columnSpans: ColumnSpan[] = [];
  let columnLeftCm = m.borderWidth + m.panelPadding + gutterSpanCm;
  for (const columnWidth of columnWidths) {
    columnSpans.push({
      x0: (columnLeftCm - widthCm / 2) / 100,
      x1: (columnLeftCm + columnWidth - widthCm / 2) / 100,
    });
    columnLeftCm += columnWidth + m.columnGap;
  }
  const outlineWidth = BASE_OUTLINE_WIDTH * (m.rowFont / BASE_ROW_FONT_CM);
  // An absolutely positioned layer filling a row (so it never affects layout).
  // It ignores pointers, so a poke or ray reaches the cell above it (and its
  // click listener) instead of stopping at the layer.
  const rowLayer = (properties: ContainerProps) =>
    new UIKit.Container({
      pointerEvents: 'none',
      positionType: 'absolute',
      positionTop: 0,
      positionLeft: 0,
      positionRight: 0,
      positionBottom: 0,
      ...properties,
    });
  const outline = {
    borderColor: COLOR_OUTLINE,
    borderTopWidth: outlineWidth,
    borderLeftWidth: outlineWidth,
    borderRightWidth: outlineWidth,
    borderBottomWidth: outlineWidth,
    borderTopLeftRadius: m.borderRadius * 0.4,
    borderTopRightRadius: m.borderRadius * 0.4,
    borderBottomLeftRadius: m.borderRadius * 0.4,
    borderBottomRightRadius: m.borderRadius * 0.4,
  };

  const header = new UIKit.Container({
    flexDirection: 'row',
    backgroundColor: COLOR_HEADER_BACKGROUND,
    gapColumn: m.columnGap,
    borderTopLeftRadius: m.borderRadius * 0.6,
    borderTopRightRadius: m.borderRadius * 0.6,
  });
  if (options.diffGutter) {
    header.add(buildCell('', m.headerFont, gutterWidthCm, COLOR_TEXT, true, m));
  }
  table.columns.forEach((column, columnIndex) => {
    const columnWidth = columnWidths[columnIndex];
    const label = truncateToWidth(
      headerLabel(table, column),
      HEADER_METRICS,
      m.headerFont,
      columnWidth - 2 * m.cellPaddingX,
    );
    header.add(buildCell(label, m.headerFont, columnWidth, COLOR_TEXT, true, m));
  });
  root.add(header);

  const rowViews = new Map<number, RowView>();

  visibleRows.forEach((dataRow, rowIndex) => {
    const rowBackground = rowIndex % 2 === 0 ? COLOR_ROW_BACKGROUND_EVEN : COLOR_ROW_BACKGROUND_ODD;
    const rowOpacity = signal(1);
    const offsetYCm = signal(0);
    const flight = options.cellSides ? { left: cellOffset(), right: cellOffset() } : null;
    const backgroundFade = signal(1);
    const rowContainer = new UIKit.Container({
      flexDirection: 'row',
      // Join results (and silhouettes) paint the background on a separate layer (below).
      ...(flight || options.silhouette ? {} : { backgroundColor: rowBackground }),
      gapColumn: m.columnGap,
      opacity: computed(() => rowOpacity.value * fade.value),
      transformTranslateY: offsetYCm,
      display: options.hiddenRows?.has(rowIndex) ? 'none' : 'flex',
    });
    // A background layer filling the row, behind its cells, with its own
    // fade: lets a join result's row background appear only as its flying
    // cells land, while the cells stay fully visible in flight.
    let background = rowContainer;
    if (flight) {
      background = rowLayer({ backgroundColor: rowBackground, opacity: backgroundFade });
      rowContainer.add(background);
    }
    // A silhouette row is an empty outline (its text is laid out but invisible,
    // so its height matches a real row); the revealed row keeps its text.
    const revealed = !options.silhouette || options.silhouette.revealRow === rowIndex;
    if (options.silhouette) {
      rowContainer.add(rowLayer(revealed ? { ...outline, backgroundColor: rowBackground } : outline));
    }

    let marker: Signal<number> | null = null;
    if (options.diffGutter) {
      const markerOpacity = signal(0);
      marker = markerOpacity;
      // Its own opacity, so multiplied by the row's and the slab's explicitly.
      const shown = computed(() => markerOpacity.value * rowOpacity.value * fade.value);
      rowContainer.add(buildCell('+', m.rowFont, gutterWidthCm, COLOR_DIFF_MARKER, true, m, null, shown));
    }

    // Cells of an unmatched LEFT JOIN row hold `null` and render as `NULL`,
    // exactly as a database would show them. The data layer's lineage still
    // records that they came from an unmatched join rather than a stored NULL.
    const cells = table.columns.map((column, columnIndex) => {
      const columnWidth = columnWidths[columnIndex];
      const raw = dataRow[column];
      const truncated = truncateToWidth(
        displayValue(raw),
        DATA_METRICS,
        m.rowFont,
        columnWidth - 2 * m.cellPaddingX,
      );
      const side = options.cellSides?.[columnIndex];
      const offset = flight && side ? flight[side] : null;
      const color = raw === null ? COLOR_TEXT_NULL : COLOR_TEXT;
      const cell = buildCell(truncated, m.rowFont, columnWidth, color, false, m, offset, revealed ? 1 : 0);
      rowContainer.add(cell);
      return cell;
    });

    root.add(rowContainer);
    rowViews.set(rowIndex, {
      row: rowContainer,
      cells,
      opacity: rowOpacity,
      offsetYCm,
      flight,
      background,
      backgroundFade,
      baseBackground: rowBackground,
      marker,
    });
  });

  // Placeholders for rows the answer still needs: a `?` in an outline, the
  // same height as a data row, hidden until shown.
  const placeholders: PlaceholderRowView[] = [];
  for (let i = 0; i < (options.placeholderRows ?? 0); i++) {
    const opacity = signal(0);
    const row = new UIKit.Container({
      flexDirection: 'row',
      justifyContent: 'center',
      gapColumn: m.columnGap,
      opacity: computed(() => opacity.value * fade.value),
      display: 'none',
    });
    row.add(rowLayer(outline));
    row.add(buildCell('?', m.rowFont, m.columnMinWidth, COLOR_TEXT_NULL, true, m));
    root.add(row);
    placeholders.push({ row, opacity });
  }

  if (overflow) {
    const remaining = table.rows.length - visibleRowCount;
    const indicator = new UIKit.Container({
      flexDirection: 'row',
      justifyContent: 'center',
      paddingTop: m.cellPaddingY,
      paddingBottom: m.cellPaddingY,
    });
    indicator.add(
      new UIKit.Text({
        text: `+ ${remaining} more row${remaining === 1 ? '' : 's'}`,
        fontSize: m.rowFont,
        color: COLOR_TEXT_NULL,
      }),
    );
    root.add(indicator);
  }

  const firstRowTopCm = m.borderWidth + m.panelPadding + captionHeightCm + m.headerRowHeight;

  const document = new UIKitDocument(root);

  return {
    document,
    root,
    rowViews,
    widthMeters: widthCm / 100,
    heightMeters: heightCm / 100,
    anchor,
    firstRowTopMeters: firstRowTopCm / 100,
    rowHeightMeters: m.dataRowHeight / 100,
    fade,
    captionLines,
    captionOpacity,
    columnSpans,
    placeholders,
    rowFontMeters: m.rowFont / 100,
    headerFontMeters: m.headerFont / 100,
    panelHeightCm: panelHeight,
    heightForRowsMeters,
  };
}

/**
 * The INNER | LEFT join-type control, built as its own document so it can
 * live on its own non-grabbable entity (see join-system.ts for why). The
 * document origin is the control's center.
 */
export type JoinTypeControlView = {
  document: UIKitDocument;
  fade: Signal<number>;
  inner: Container;
  left: Container;
  widthMeters: number;
  heightMeters: number;
  /** Each option's center X in the control's local frame (meters). */
  innerCenterX: number;
  leftCenterX: number;
  /** Size of one option (both are the same size), in meters. */
  optionWidthMeters: number;
  optionHeightMeters: number;
  /** Label font size it was built with (meters). */
  labelFontMeters: number;
};

/**
 * Fingertip-sized targets: each option is at least this wide and tall (cm).
 * A touch target, not text, so it doesn't scale with the label font.
 */
export const CONTROL_OPTION_MIN_WIDTH_CM = 4.0;
export const CONTROL_OPTION_MIN_HEIGHT_CM = 2.5;
const BASE_CONTROL_FONT_CM = 1.6;
const BASE_CONTROL_OPTION_PADDING_X = 1.0;
const CONTROL_TRACK_PADDING = 0.3;
const CONTROL_RADIUS = 1.4;
const COLOR_CONTROL_TRACK = '#e2ddd0';
const COLOR_CONTROL_SELECTED = '#2f2b24';
const COLOR_CONTROL_TEXT_SELECTED = '#f5f3ef';

/** Selected/unselected look of one control option; text inherits `color`. */
export function controlOptionStyle(selected: boolean): { backgroundColor: string; color: string } {
  return {
    backgroundColor: selected ? COLOR_CONTROL_SELECTED : COLOR_CONTROL_TRACK,
    color: selected ? COLOR_CONTROL_TEXT_SELECTED : COLOR_TEXT,
  };
}

/** `labelFontCm`: the label's physical font size (sized by angle by the caller). */
export function buildJoinTypeControl(labelFontCm = BASE_CONTROL_FONT_CM): JoinTypeControlView {
  const fade = signal(1);
  const paddingX = BASE_CONTROL_OPTION_PADDING_X * (labelFontCm / BASE_CONTROL_FONT_CM);
  // Both options share one width, so the control is symmetric about the seam.
  const optionWidthCm = Math.max(
    CONTROL_OPTION_MIN_WIDTH_CM,
    measureTextCm('INNER', HEADER_METRICS, labelFontCm) + 2 * paddingX,
    measureTextCm('LEFT', HEADER_METRICS, labelFontCm) + 2 * paddingX,
  );
  const optionHeightCm = Math.max(CONTROL_OPTION_MIN_HEIGHT_CM, labelFontCm * LINE_HEIGHT_FACTOR);
  const inset = CONTROL_TRACK_PADDING + PANEL_BORDER_WIDTH;
  const widthCm = 2 * optionWidthCm + CONTROL_TRACK_PADDING + 2 * inset;
  const heightCm = optionHeightCm + 2 * inset;

  const root = new UIKit.Container({
    flexDirection: 'row',
    width: widthCm,
    height: heightCm,
    anchorX: 'center',
    anchorY: 'center',
    opacity: fade,
    fontFamilies: FONT_FAMILIES,
    backgroundColor: COLOR_CONTROL_TRACK,
    borderColor: COLOR_PANEL_BORDER,
    borderTopWidth: PANEL_BORDER_WIDTH,
    borderLeftWidth: PANEL_BORDER_WIDTH,
    borderRightWidth: PANEL_BORDER_WIDTH,
    borderBottomWidth: PANEL_BORDER_WIDTH,
    borderTopLeftRadius: CONTROL_RADIUS,
    borderTopRightRadius: CONTROL_RADIUS,
    borderBottomLeftRadius: CONTROL_RADIUS,
    borderBottomRightRadius: CONTROL_RADIUS,
    paddingTop: CONTROL_TRACK_PADDING,
    paddingBottom: CONTROL_TRACK_PADDING,
    paddingLeft: CONTROL_TRACK_PADDING,
    paddingRight: CONTROL_TRACK_PADDING,
    gapColumn: CONTROL_TRACK_PADDING,
  });
  const option = (label: string, selected: boolean) => {
    const style = controlOptionStyle(selected);
    const container = new UIKit.Container({
      width: optionWidthCm,
      minWidth: optionWidthCm,
      height: optionHeightCm,
      flexShrink: 0,
      justifyContent: 'center',
      alignItems: 'center',
      borderTopLeftRadius: CONTROL_RADIUS - CONTROL_TRACK_PADDING,
      borderTopRightRadius: CONTROL_RADIUS - CONTROL_TRACK_PADDING,
      borderBottomLeftRadius: CONTROL_RADIUS - CONTROL_TRACK_PADDING,
      borderBottomRightRadius: CONTROL_RADIUS - CONTROL_TRACK_PADDING,
      backgroundColor: style.backgroundColor,
      color: style.color,
    });
    container.add(
      new UIKit.Text({
        text: label,
        fontSize: labelFontCm,
        fontWeight: 'bold',
        wordBreak: 'keep-all',
      }),
    );
    root.add(container);
    return container;
  };
  const inner = option('INNER', true);
  const left = option('LEFT', false);

  const optionOffsetCm = (optionWidthCm + CONTROL_TRACK_PADDING) / 2;
  return {
    document: new UIKitDocument(root),
    fade,
    inner,
    left,
    widthMeters: widthCm / 100,
    heightMeters: heightCm / 100,
    innerCenterX: -optionOffsetCm / 100,
    leftCenterX: optionOffsetCm / 100,
    optionWidthMeters: optionWidthCm / 100,
    optionHeightMeters: optionHeightCm / 100,
    labelFontMeters: labelFontCm / 100,
  };
}
