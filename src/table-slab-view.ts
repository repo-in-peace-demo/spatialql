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
import { columnHeaderText } from './data/join-result.js';
import type { Row, Table } from './data/types.js';
import {
  BASE_PANEL_BORDER_WIDTH,
  BASE_ROW_FONT_CM,
  CONTROL_OPTION_MIN_HEIGHT_CM,
  CONTROL_OPTION_MIN_WIDTH_CM,
  DATA_METRICS,
  displayValue,
  FIT_EPSILON_CM,
  FONT_FAMILIES,
  HEADER_METRICS,
  LINE_HEIGHT_FACTOR,
  measureTextCm,
  MONO_METRICS,
  slabMetrics,
  truncateToWidth,
  type SlabMetrics,
  type SlabTextSizes,
} from './slab-metrics.js';

export { DEFAULT_SLAB_TEXT_SIZES, FONT_FAMILIES, type SlabTextSizes } from './slab-metrics.js';

/** Source slabs show at most this many rows (the last becomes "+N more"). */
export const MAX_VISIBLE_ROWS = 8;
/** Join result slabs may show this many rows before overflowing. */
export const MAX_RESULT_ROWS = 12;

// Layout sizes and text measurement live in the pure slab-metrics.ts (so
// data tests can check that every cell fits). The control's border isn't
// scaled: it isn't a slab.
const PANEL_BORDER_WIDTH = BASE_PANEL_BORDER_WIDTH;

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
/** The dataset accent stripe on a slab's header bar, at the base font (~0.25 cm at the source size). */
const ACCENT_STRIPE_CM = 0.36;
/** The name tab's fill without a dataset accent (free play): dark, like the accents, for the same light text. */
const COLOR_TAB_NEUTRAL = '#4a4538';
const COLOR_TAB_TEXT = '#f7f4ee';
/** The tab's alias (after the name): lighter than the name, so it reads as secondary. */
const TAB_ALIAS_OPACITY = 0.72;
/** Name tab padding, as fractions of its font size. */
const TAB_PADDING_X_EM = 0.5;
const TAB_PADDING_Y_EM = 0.12;

/** Challenge win look for a result slab's border. */
export function slabBorderColor(win: boolean): string {
  return win ? COLOR_WIN_BORDER : COLOR_PANEL_BORDER;
}

/** Challenge win look for a result slab's SQL caption. */
export function captionColor(win: boolean): string {
  return win ? COLOR_CAPTION_WIN : COLOR_CAPTION;
}

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
  /** With `nullTargets`: per column holding a NULL, the outline layer that marks it pokeable. */
  nullOutlines: Map<number, Container> | null;
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
  /**
   * How far the name tab rises above the panel's top edge (meters; 0
   * without one). Not part of the panel's layout size or of `heightMeters`
   * (rows, docking and grab distances use the panel); view and band
   * placement add it (`slabVisualTopLocalY`).
   */
  tabHeightMeters: number;
  /** Challenge mode's result slab: its status badge (null without one). */
  badge: SlabBadgeView | null;
  /** With `nullTargets`: the NULL outline's width at rest (cm); hover and the cue draw it wider. */
  nullOutlineWidthCm: number;
  /** Panel height (meters) with `visibleRows` data rows displayed. */
  heightForRowsMeters: (visibleRows: number) => number;
};

export type SlabBuildOptions = {
  /** Row cap; defaults to MAX_VISIBLE_ROWS. */
  maxRows?: number;
  /** Rows the columns are fitted to, if not the rows built (a silhouette builds one row but fits every target row). */
  sizeRows?: Table['rows'];
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
  /** Challenge mode: the dataset's accent, as a thin stripe on the header bar (and the name tab's fill). */
  accent?: string;
  /**
   * Source slabs: a name tab on the top edge, left-aligned, showing the
   * table's name and (lighter) alias as the SQL caption writes them. It's
   * part of the slab's own document, so grabbing it grabs the slab.
   */
  title?: { name: string; alias: string };
  /**
   * Challenge mode's result slab: a status badge on the top edge,
   * right-aligned, mirroring the card ("Solved!", "Completed", "1 row
   * missing"), hidden until set (`setSlabBadge`). Its height is always
   * reserved (`tabHeightMeters`), so showing it never moves anything.
   */
  badge?: boolean;
  /**
   * Challenge mode's result slab: every NULL cell is a poke / ray target (it
   * filters), so it gets a thin outline that reads as a button, drawn
   * stronger on hover (`setNullCellHover`). Source slabs never get one.
   */
  nullTargets?: boolean;
};

const COLOR_NULL_TARGET = '#b3a58a';
const COLOR_NULL_TARGET_HOVER = '#5b4a8a';
/** The hovered (or cued) NULL outline's width, relative to its resting width. */
const NULL_HOVER_WIDTH_FACTOR = 2.5;

/**
 * A pokeable NULL cell's look: hovered (a fingertip or a hand's ray over it,
 * or the first-time cue) draws its outline wider and darker. Only on the
 * outline layer, so layout never changes.
 */
export function setNullCellHover(doc: TableSlabDocument, row: number, column: number, hovered: boolean): void {
  const outline = doc.rowViews.get(row)?.nullOutlines?.get(column);
  if (!outline) {
    return;
  }
  const width = doc.nullOutlineWidthCm * (hovered ? NULL_HOVER_WIDTH_FACTOR : 1);
  outline.setProperties({
    borderColor: hovered ? COLOR_NULL_TARGET_HOVER : COLOR_NULL_TARGET,
    borderTopWidth: width,
    borderLeftWidth: width,
    borderRightWidth: width,
    borderBottomWidth: width,
  });
}

/** The result slab's status badge (see `SlabBuildOptions.badge`). */
export type SlabBadgeView = { container: Container; text: Text };
export type SlabBadgeLook = 'won' | 'neutral';

const COLOR_BADGE_WON = '#d08a1e';
const COLOR_BADGE_WON_TEXT = '#1c1c1c';
const COLOR_BADGE_NEUTRAL = '#4a4538';
const COLOR_BADGE_NEUTRAL_TEXT = '#f7f4ee';

/** Shows the badge with `text` in a look ("Solved!" gold; anything else neutral), or hides it (null). */
export function setSlabBadge(doc: TableSlabDocument, text: string | null, look: SlabBadgeLook = 'neutral'): void {
  const badge = doc.badge;
  if (!badge) {
    return;
  }
  if (text === null || text === '') {
    badge.container.setProperties({ display: 'none' });
    return;
  }
  badge.text.setProperties({ text, color: look === 'won' ? COLOR_BADGE_WON_TEXT : COLOR_BADGE_NEUTRAL_TEXT });
  badge.container.setProperties({
    display: 'flex',
    backgroundColor: look === 'won' ? COLOR_BADGE_WON : COLOR_BADGE_NEUTRAL,
  });
}

const COLOR_POINTER_HOVER = '#5b4a8a';
/** A hovered button's outline width (cm); it sits inside the button's fixed size, so layout doesn't move. */
const POINTER_HOVER_BORDER_CM = 0.25;

/**
 * The hand pointer's hover look on a button (a control option, a bar button,
 * Recenter): a firm outline while the pointer is on it. `rest` restores a
 * button that has its own border (Clear); others go back to none.
 */
export function setTargetHover(
  container: { setProperties(properties: object): void },
  hovered: boolean,
  rest: { color: string; width: number } | null = null,
): void {
  const width = hovered ? POINTER_HOVER_BORDER_CM : (rest?.width ?? 0);
  container.setProperties({
    borderColor: hovered ? COLOR_POINTER_HOVER : (rest?.color ?? COLOR_POINTER_HOVER),
    borderTopWidth: width,
    borderLeftWidth: width,
    borderRightWidth: width,
    borderBottomWidth: width,
  });
}

/** Rows shown for `table` under `maxRows`, and whether a "+N more" row follows. */
function visibleRowLayout(table: Table, maxRows: number): { visibleRowCount: number; overflow: boolean } {
  const overflow = table.rows.length > maxRows;
  return { visibleRowCount: overflow ? maxRows - 1 : table.rows.length, overflow };
}

function captionHeightCmFor(options: SlabBuildOptions, m: SlabMetrics): number {
  return options.caption ? options.caption.lines.length * m.captionFont * LINE_HEIGHT_FACTOR + m.captionGapBelow : 0;
}

/**
 * A slab's columns and width (cm), as `startTableSlabBuild` lays them out:
 * from the data and the font metrics alone, nothing built.
 */
function slabWidthsCm(table: Table, options: SlabBuildOptions, m: SlabMetrics, visibleRows: Row[]) {
  // Columns fit every row given for sizing (a silhouette builds one row but fits them all).
  const columnWidths = computeColumnWidths(table, options.sizeRows ?? visibleRows, m);
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
  return { columnWidths, gutterWidthCm, gutterSpanCm, contentWidthCm, widthCm };
}

/**
 * The size (meters) a slab for `table` with `options` will have once built
 * (`widthMeters`, `heightMeters` of its document), computed without building
 * it: placement can plan for a slab still waiting in the build queue.
 */
export function tableSlabSizeMeters(table: Table, options: SlabBuildOptions = {}): { widthMeters: number; heightMeters: number } {
  const m = slabMetrics(options.text);
  const { visibleRowCount, overflow } = visibleRowLayout(table, options.maxRows ?? MAX_VISIBLE_ROWS);
  const visibleRows = table.rows.slice(0, visibleRowCount);
  const heightCm = panelHeightCm(options, m, Math.max(visibleRowCount, options.reserveRows ?? 0), overflow);
  return { widthMeters: slabWidthsCm(table, options, m, visibleRows).widthCm / 100, heightMeters: heightCm / 100 };
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

function headerLabel(table: Table, column: string): string {
  return columnHeaderText(table, column);
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
/** Local Y (meters) of the slab's highest visible point: the name tab's top, else the panel's top edge. */
export function slabVisualTopLocalY(doc: TableSlabDocument): number {
  return slabTopLocalY(doc) + doc.tabHeightMeters;
}

/** Height (cm) of a name tab at `fontCm` (one line, its vertical padding). */
function tabHeightCm(fontCm: number): number {
  return fontCm * LINE_HEIGHT_FACTOR + 2 * TAB_PADDING_Y_EM * fontCm;
}

/**
 * Builds the full UIKit tree for one table: optional caption, header row,
 * and up to `maxRows` data rows (maxRows - 1 data rows + one "N more"
 * indicator row if the table has more rows than fit).
 */
export function buildTableSlabDocument(table: Table, options: SlabBuildOptions = {}): TableSlabDocument {
  const build = startTableSlabBuild(table, options);
  build.step(Infinity);
  return build.doc;
}

/**
 * A slab document built a little at a time (see `startTableSlabBuild`): the
 * document exists from the start (its frame, caption and header); `step`
 * adds its rows, placeholders and overflow line until `deadlineMs`
 * (performance.now()), and says whether it's done. Use the document (its
 * rows, its size) only once it's done.
 */
export type SlabBuild = { readonly doc: TableSlabDocument; step(deadlineMs: number): boolean; readonly done: boolean };

/**
 * Starts building `table`'s slab: everything but its rows now (cheap), the
 * rows a few at a time from `step`. UIKit sets up each row as it's added to
 * the live document, so a build spread over frames never costs one long
 * frame (a whole result slab at once was 100-240 ms on the Quest).
 */
export function startTableSlabBuild(table: Table, options: SlabBuildOptions = {}): SlabBuild {
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

  const { columnWidths, gutterWidthCm, gutterSpanCm, contentWidthCm, widthCm } = slabWidthsCm(table, options, m, visibleRows);

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

  // The name tab: on an absolute layer above the top edge, so the panel's
  // layout (and its measured size) doesn't change. Header-sized text.
  let tabCm = 0;
  if (options.title) {
    const font = m.headerFont;
    tabCm = tabHeightCm(font);
    const tab = new UIKit.Container({
      positionType: 'absolute',
      positionTop: -tabCm,
      positionLeft: m.borderRadius,
      height: tabCm,
      flexDirection: 'row',
      alignItems: 'center',
      gapColumn: font * 0.45,
      paddingLeft: TAB_PADDING_X_EM * font,
      paddingRight: TAB_PADDING_X_EM * font,
      backgroundColor: options.accent ?? COLOR_TAB_NEUTRAL,
      borderTopLeftRadius: m.borderRadius,
      borderTopRightRadius: m.borderRadius,
      opacity: fade,
    });
    tab.add(
      new UIKit.Text({
        text: options.title.name,
        fontSize: font,
        fontWeight: 'bold',
        color: COLOR_TAB_TEXT,
        wordBreak: 'keep-all',
        flexShrink: 0,
        opacity: fade,
      }),
      new UIKit.Text({
        text: options.title.alias,
        fontSize: font,
        color: COLOR_TAB_TEXT,
        wordBreak: 'keep-all',
        flexShrink: 0,
        opacity: computed(() => TAB_ALIAS_OPACITY * fade.value),
      }),
    );
    root.add(tab);
  }
  // The status badge: the same kind of tab, right-aligned, hidden until set.
  let badge: SlabBadgeView | null = null;
  if (options.badge) {
    const font = m.rowFont;
    const badgeCm = tabHeightCm(font);
    tabCm = Math.max(tabCm, badgeCm);
    const container = new UIKit.Container({
      positionType: 'absolute',
      positionTop: -badgeCm,
      positionRight: m.borderRadius,
      height: badgeCm,
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: TAB_PADDING_X_EM * font,
      paddingRight: TAB_PADDING_X_EM * font,
      backgroundColor: COLOR_BADGE_NEUTRAL,
      borderTopLeftRadius: m.borderRadius,
      borderTopRightRadius: m.borderRadius,
      opacity: fade,
      pointerEvents: 'none',
      display: 'none',
    });
    const text = new UIKit.Text({
      text: '',
      fontSize: font,
      fontWeight: 'bold',
      color: COLOR_BADGE_NEUTRAL_TEXT,
      wordBreak: 'keep-all',
      flexShrink: 0,
      opacity: fade,
    });
    container.add(text);
    root.add(container);
    badge = { container, text };
  }

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
  const nullOutlineWidth = outlineWidth;
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
  if (options.accent) {
    // The dataset's accent: a thin stripe along the header's top edge, on an
    // absolute layer so it never changes the layout. Never on rows.
    header.add(
      new UIKit.Container({
        pointerEvents: 'none',
        positionType: 'absolute',
        positionTop: 0,
        positionLeft: 0,
        positionRight: 0,
        height: ACCENT_STRIPE_CM * (m.rowFont / BASE_ROW_FONT_CM),
        backgroundColor: options.accent,
        borderTopLeftRadius: m.borderRadius * 0.6,
        borderTopRightRadius: m.borderRadius * 0.6,
      }),
    );
  }
  // The header's cells join it one per step, like the rows' (see the steps below).
  const headerSteps: (() => void)[] = [
    ...(options.diffGutter ? [() => header.add(buildCell('', m.headerFont, gutterWidthCm, COLOR_TEXT, true, m))] : []),
    ...table.columns.map((column, columnIndex) => () => {
      const columnWidth = columnWidths[columnIndex];
      const label = truncateToWidth(headerLabel(table, column), HEADER_METRICS, m.headerFont, columnWidth - 2 * m.cellPaddingX);
      header.add(buildCell(label, m.headerFont, columnWidth, COLOR_TEXT, true, m));
    }),
  ];
  root.add(header);

  const rowViews = new Map<number, RowView>();
  // Dev only: values cut off with an ellipsis (a dataset test prevents these).
  const truncatedCells: string[] = [];

  /**
   * One row's build, as steps: the row itself (its layers and diff marker),
   * then one cell per step, then its view. The row joins the live document
   * first and its cells join it one by one, so no step is more than a cell.
   */
  const rowSteps = (dataRow: Table['rows'][number], rowIndex: number): (() => void)[] => {
    const rowBackground = rowIndex % 2 === 0 ? COLOR_ROW_BACKGROUND_EVEN : COLOR_ROW_BACKGROUND_ODD;
    const rowOpacity = signal(1);
    const offsetYCm = signal(0);
    const flight = options.cellSides ? { left: cellOffset(), right: cellOffset() } : null;
    const backgroundFade = signal(1);
    // A silhouette row is an empty outline (its text is laid out but invisible,
    // so its height matches a real row); the revealed row keeps its text.
    const revealed = !options.silhouette || options.silhouette.revealRow === rowIndex;
    // Cells of an unmatched LEFT JOIN row hold `null` and render as `NULL`,
    // exactly as a database would show them. The data layer's lineage still
    // records that they came from an unmatched join rather than a stored NULL.
    const nullOutlines = options.nullTargets ? new Map<number, Container>() : null;
    const cells: Container[] = [];
    let rowContainer: Container | null = null;
    let background: Container | null = null;
    let marker: Signal<number> | null = null;

    const startRow = () => {
      const row = new UIKit.Container({
        flexDirection: 'row',
        // Join results (and silhouettes) paint the background on a separate layer (below).
        ...(flight || options.silhouette ? {} : { backgroundColor: rowBackground }),
        gapColumn: m.columnGap,
        opacity: computed(() => rowOpacity.value * fade.value),
        transformTranslateY: offsetYCm,
        display: options.hiddenRows?.has(rowIndex) ? 'none' : 'flex',
      });
      rowContainer = row;
      // A background layer filling the row, behind its cells, with its own
      // fade: lets a join result's row background appear only as its flying
      // cells land, while the cells stay fully visible in flight.
      background = row;
      if (flight) {
        background = rowLayer({ backgroundColor: rowBackground, opacity: backgroundFade });
        row.add(background);
      }
      if (options.silhouette) {
        row.add(rowLayer(revealed ? { ...outline, backgroundColor: rowBackground } : outline));
      }
      if (options.diffGutter) {
        const markerOpacity = signal(0);
        marker = markerOpacity;
        // Its own opacity, so multiplied by the row's and the slab's explicitly.
        const shown = computed(() => markerOpacity.value * rowOpacity.value * fade.value);
        row.add(buildCell('+', m.rowFont, gutterWidthCm, COLOR_DIFF_MARKER, true, m, null, shown));
      }
      root.add(row);
    };

    const cellStep = (column: string, columnIndex: number) => () => {
      const columnWidth = columnWidths[columnIndex];
      const raw = dataRow[column];
      const truncated = truncateToWidth(displayValue(raw), DATA_METRICS, m.rowFont, columnWidth - 2 * m.cellPaddingX);
      if (import.meta.env.DEV && truncated !== displayValue(raw)) {
        truncatedCells.push(displayValue(raw));
      }
      const side = options.cellSides?.[columnIndex];
      const offset = flight && side ? flight[side] : null;
      const color = raw === null ? COLOR_TEXT_NULL : COLOR_TEXT;
      const cell = buildCell(truncated, m.rowFont, columnWidth, color, false, m, offset, revealed ? 1 : 0);
      if (nullOutlines && raw === null) {
        // A pokeable NULL: an outline on its own layer (no fill, so the text
        // stays readable; ignores pointers, so a press reaches the slab).
        const layer = new UIKit.Container({
          pointerEvents: 'none',
          positionType: 'absolute',
          positionTop: 0,
          positionLeft: 0,
          positionRight: 0,
          positionBottom: 0,
          borderColor: COLOR_NULL_TARGET,
          borderTopWidth: nullOutlineWidth,
          borderLeftWidth: nullOutlineWidth,
          borderRightWidth: nullOutlineWidth,
          borderBottomWidth: nullOutlineWidth,
          borderTopLeftRadius: m.borderRadius * 0.4,
          borderTopRightRadius: m.borderRadius * 0.4,
          borderBottomLeftRadius: m.borderRadius * 0.4,
          borderBottomRightRadius: m.borderRadius * 0.4,
        });
        cell.add(layer);
        nullOutlines.set(columnIndex, layer);
      }
      rowContainer!.add(cell);
      cells.push(cell);
    };

    const endRow = () => {
      rowViews.set(rowIndex, {
        row: rowContainer!,
        cells,
        opacity: rowOpacity,
        offsetYCm,
        flight,
        background: background!,
        backgroundFade,
        baseBackground: rowBackground,
        marker,
        nullOutlines,
      });
    };

    return [startRow, ...table.columns.map((column, columnIndex) => cellStep(column, columnIndex)), endRow];
  };

  // Placeholders for rows the answer still needs: a `?` in an outline, the
  // same height as a data row, hidden until shown.
  const placeholders: PlaceholderRowView[] = [];
  const buildPlaceholder = () => {
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
  };

  const buildOverflow = () => {
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
  };

  const firstRowTopCm = m.borderWidth + m.panelPadding + captionHeightCm + m.headerRowHeight;
  // The live document now (frame, caption, header); the rows join it step by step, in order.
  const document = new UIKitDocument(root);
  const steps: (() => void)[] = [
    ...headerSteps,
    ...visibleRows.flatMap((dataRow, rowIndex) => rowSteps(dataRow, rowIndex)),
    ...Array.from({ length: options.placeholderRows ?? 0 }, () => buildPlaceholder),
    ...(overflow ? [buildOverflow] : []),
  ];
  let next = 0;
  const finish = () => {
    if (import.meta.env.DEV && truncatedCells.length > 0) {
      console.warn(
        `[Slab] ${table.id}: ${truncatedCells.length} cell(s) cut off with an ellipsis: ${truncatedCells.slice(0, 4).join(', ')}`,
      );
    }
  };

  const doc: TableSlabDocument = {
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
    tabHeightMeters: tabCm / 100,
    badge,
    nullOutlineWidthCm: nullOutlineWidth,
  };
  const build = {
    doc,
    done: steps.length === 0,
    step(deadlineMs: number): boolean {
      // At least one step per call, so a build always moves forward.
      while (next < steps.length) {
        steps[next++]();
        if (performance.now() >= deadlineMs) {
          break;
        }
      }
      if (next >= steps.length && !build.done) {
        build.done = true;
        finish();
      }
      return build.done;
    },
  };
  if (build.done) {
    finish();
  }
  return build;
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

// Fingertip-sized targets (cm), shared with the puzzle bar; in slab-metrics.ts so tests can use them.
export { CONTROL_OPTION_MIN_HEIGHT_CM, CONTROL_OPTION_MIN_WIDTH_CM };
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
/** The join-type control's size (cm) at `labelFontCm`: the band's bars leave this much room for it at the top left. */
export function joinTypeControlSizeCm(labelFontCm = BASE_CONTROL_FONT_CM): {
  optionWidthCm: number;
  optionHeightCm: number;
  widthCm: number;
  heightCm: number;
} {
  const paddingX = BASE_CONTROL_OPTION_PADDING_X * (labelFontCm / BASE_CONTROL_FONT_CM);
  // Both options share one width, so the control is symmetric.
  const optionWidthCm = Math.max(
    CONTROL_OPTION_MIN_WIDTH_CM,
    measureTextCm('INNER', HEADER_METRICS, labelFontCm) + 2 * paddingX,
    measureTextCm('LEFT', HEADER_METRICS, labelFontCm) + 2 * paddingX,
  );
  const optionHeightCm = Math.max(CONTROL_OPTION_MIN_HEIGHT_CM, labelFontCm * LINE_HEIGHT_FACTOR);
  const inset = CONTROL_TRACK_PADDING + PANEL_BORDER_WIDTH;
  return {
    optionWidthCm,
    optionHeightCm,
    widthCm: 2 * optionWidthCm + CONTROL_TRACK_PADDING + 2 * inset,
    heightCm: optionHeightCm + 2 * inset,
  };
}

export function buildJoinTypeControl(labelFontCm = BASE_CONTROL_FONT_CM): JoinTypeControlView {
  const fade = signal(1);
  const { optionWidthCm, optionHeightCm, widthCm, heightCm } = joinTypeControlSizeCm(labelFontCm);

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
