/**
 * Challenge mode's UIKit pieces, built imperatively like the slabs and sized
 * by angle:
 *
 * - the **puzzle card**: view only, beside the result slot. A title line, a
 *   status line (the diff summary, hints used, the streak), the goal (up to
 *   3 lines) and a message (up to 5 lines: an intro, a hint, the answer, or
 *   the win's takeaway and query line). Fixed size (card-metrics.ts), so
 *   changing its text never changes its layout.
 * - the **puzzle bar**: Prev, Hint, Next and the filter (Filter while the result
 *   has NULLs, which opens one chip per column with a NULL; then `WHERE ...
 *   IS NULL Clear`), in the control band next to INNER | LEFT. Touch targets
 *   at least the control's option size.
 *
 * Origins are at their centers.
 */

import { computed, signal, UIKit, UIKitDocument, type Signal } from '@iwsdk/core';
// Only the icons used (four dataset icons, Recenter), each from its own module, so the bundle doesn't
// pull in the whole icon set.
import { BookOpen } from '@pmndrs/uikit-lucide/dist/BookOpen.js';
import { Coffee } from '@pmndrs/uikit-lucide/dist/Coffee.js';
import { LocateFixed } from '@pmndrs/uikit-lucide/dist/LocateFixed.js';
import { LogOut } from '@pmndrs/uikit-lucide/dist/LogOut.js';
import { School } from '@pmndrs/uikit-lucide/dist/School.js';
import { ShoppingBag } from '@pmndrs/uikit-lucide/dist/ShoppingBag.js';
import { arcPlace, BAND_ARC_RADIUS_METERS, type ArcPlacement } from './band-arc.js';
import { CARD_GOAL_LINES, CARD_MESSAGE_LINES, cardHeadlineFontCm, cardMetrics } from './card-metrics.js';
import type { DatasetIcon } from './data/datasets.js';
import {
  BAR_BORDER_CM,
  BAR_BUTTON_PADDING_EM,
  BAR_PADDING_CM,
  barButtonWidthCm,
  DATA_METRICS,
  HEADER_METRICS,
  MAX_FILTER_CHIPS,
  truncateToWidth,
} from './slab-metrics.js';
import {
  CONTROL_OPTION_MIN_HEIGHT_CM,
  CONTROL_OPTION_MIN_WIDTH_CM,
  controlOptionStyle,
  FONT_FAMILIES,
  measureHeaderTextCm,
  setTargetHover,
} from './table-slab-view.js';

type Container = InstanceType<typeof UIKit.Container>;
type Text = InstanceType<typeof UIKit.Text>;

const LINE_HEIGHT_FACTOR = 1.2;
const COLOR_CARD = '#f5f3ef';
const COLOR_CARD_WON = '#fbe7bf';
const COLOR_CARD_BORDER = '#c9c2b0';
const COLOR_CARD_BORDER_WON = '#d08a1e';
const COLOR_TEXT = '#1c1c1c';
const COLOR_TEXT_SECONDARY = '#4a4538';
const COLOR_BAR_TRACK = '#e2ddd0';
/** The win headline: the result slab's gold caption color. */
const COLOR_HEADLINE = '#8a4b00';
/** The dataset icon's size relative to the title text. */
const ICON_SCALE = 1.25;
// --- Puzzle card ------------------------------------------------------------------
// Narrow and tall: it sits beside the result slab (sizes in card-metrics.ts).

export type PuzzleCardView = {
  document: UIKitDocument;
  fade: Signal<number>;
  root: Container;
  title: Text;
  /** Short status (the diff summary, hints used, the streak), on its own line under the title. */
  status: Text;
  goal: Text;
  /** "Solved!", large, in the goal's slot while won. */
  headline: Text;
  /** An intro or hint while playing; the takeaway once won. */
  message: Text;
  /** Once won: the query line, then an optional note. */
  query: Text;
  note: Text;
  /** The four dataset icons; `setCardTheme` shows one. */
  icons: Record<DatasetIcon, InstanceType<typeof ShoppingBag>>;
  /** The current dataset accent (the border while not won). */
  accent: string;
  widthMeters: number;
  heightMeters: number;
};

export function buildPuzzleCard(): PuzzleCardView {
  const { goalFont, smallFont, padding, border, widthCm } = cardMetrics();
  const gap = smallFont * 0.4;
  const titleHeight = smallFont * LINE_HEIGHT_FACTOR;
  const goalHeight = CARD_GOAL_LINES * goalFont * LINE_HEIGHT_FACTOR;
  const messageHeight = CARD_MESSAGE_LINES * smallFont * LINE_HEIGHT_FACTOR;
  // Title, status, goal, message: the status has its own line at this width.
  const heightCm = 2 * (padding + border) + 2 * titleHeight + goalHeight + messageHeight + 3 * gap;

  const fade = signal(1);
  const root = new UIKit.Container({
    flexDirection: 'column',
    width: widthCm,
    height: heightCm,
    anchorX: 'center',
    anchorY: 'center',
    opacity: fade,
    fontFamilies: FONT_FAMILIES,
    backgroundColor: COLOR_CARD,
    borderColor: COLOR_CARD_BORDER,
    borderTopWidth: border,
    borderLeftWidth: border,
    borderRightWidth: border,
    borderBottomWidth: border,
    borderTopLeftRadius: padding,
    borderTopRightRadius: padding,
    borderBottomLeftRadius: padding,
    borderBottomRightRadius: padding,
    paddingTop: padding,
    paddingBottom: padding,
    paddingLeft: padding,
    paddingRight: padding,
    gapRow: gap,
  });

  const titleRow = new UIKit.Container({
    flexDirection: 'row',
    alignItems: 'center',
    height: titleHeight,
    flexShrink: 0,
    overflow: 'hidden',
  });
  // The dataset's icon (one of four, shown by `setCardTheme`), then the title.
  const titleGroup = new UIKit.Container({ flexDirection: 'row', alignItems: 'center', gapColumn: smallFont * 0.4 });
  const iconSize = smallFont * ICON_SCALE;
  const icons = {
    'shopping-bag': new ShoppingBag({ width: iconSize, height: iconSize, display: 'none' }),
    'book-open': new BookOpen({ width: iconSize, height: iconSize, display: 'none' }),
    school: new School({ width: iconSize, height: iconSize, display: 'none' }),
    coffee: new Coffee({ width: iconSize, height: iconSize, display: 'none' }),
  } satisfies Record<DatasetIcon, InstanceType<typeof ShoppingBag>>;
  for (const icon of Object.values(icons)) {
    titleGroup.add(icon);
  }
  const title = new UIKit.Text({
    text: '',
    fontSize: smallFont,
    fontWeight: 'bold',
    color: COLOR_TEXT_SECONDARY,
    wordBreak: 'keep-all',
  });
  titleGroup.add(title);
  const status = new UIKit.Text({
    text: '',
    fontSize: smallFont,
    color: COLOR_TEXT_SECONDARY,
    wordBreak: 'keep-all',
  });
  titleRow.add(titleGroup);

  const block = (height: number) =>
    new UIKit.Container({ flexDirection: 'column', height, flexShrink: 0, overflow: 'hidden' });
  const statusRow = block(titleHeight);
  statusRow.add(status);
  const goalBlock = block(goalHeight);
  const goal = new UIKit.Text({ text: '', fontSize: goalFont, fontWeight: 'bold', color: COLOR_TEXT });
  // On a win, the headline takes the goal's two-line slot (the card can't grow).
  const headline = new UIKit.Text({
    text: '',
    fontSize: cardHeadlineFontCm(''),
    fontWeight: 'bold',
    color: COLOR_HEADLINE,
    wordBreak: 'keep-all',
    display: 'none',
  });
  goalBlock.add(goal, headline);
  const messageBlock = block(messageHeight);
  const message = new UIKit.Text({ text: '', fontSize: smallFont, color: COLOR_TEXT });
  // On a win: the query line (pointing to the caption) and an optional note; they wrap if needed.
  const query = new UIKit.Text({ text: '', fontSize: smallFont, fontWeight: 'bold', color: COLOR_TEXT, display: 'none' });
  const note = new UIKit.Text({ text: '', fontSize: smallFont, color: COLOR_TEXT_SECONDARY, display: 'none' });
  messageBlock.add(message, query, note);

  root.add(titleRow, statusRow, goalBlock, messageBlock);
  return {
    document: new UIKitDocument(root),
    fade,
    root,
    title,
    status,
    goal,
    headline,
    message,
    query,
    note,
    icons,
    accent: COLOR_CARD_BORDER,
    widthMeters: widthCm / 100,
    heightMeters: heightCm / 100,
  };
}

/**
 * The dataset's identity on the card: its accent on the border (the win's
 * gold still takes over while won) and its icon before the title, in the
 * accent color.
 */
export function setCardTheme(card: PuzzleCardView, theme: { accent: string; icon: DatasetIcon }): void {
  card.accent = theme.accent;
  for (const [name, icon] of Object.entries(card.icons)) {
    icon.setProperties({ display: name === theme.icon ? 'flex' : 'none', color: theme.accent });
  }
  card.root.setProperties({ borderColor: theme.accent });
}

/**
 * The win's parts; `query` null hides the query line, `note` is an optional
 * extra line (e.g. "More puzzles soon."). `completed`: finished after "Show
 * answer" -- the neutral look, not the win's.
 */
export type CardWin = { headline: string; takeaway: string; query: string | null; note: string | null; completed?: boolean };

/**
 * The card's finished look, the headline in place of the goal, then the
 * takeaway and the query line. Solved: a warm fill, gold border and gold
 * headline (a coarse change, readable at a glance). Completed after "Show
 * answer": the normal card colors and a plain headline, so giving up never
 * looks like winning. Null restores the playing look (the goal; the message
 * empty).
 */
export function setCardWin(card: PuzzleCardView, win: CardWin | null): void {
  const won = !!win && !win.completed;
  card.root.setProperties({
    backgroundColor: won ? COLOR_CARD_WON : COLOR_CARD,
    borderColor: won ? COLOR_CARD_BORDER_WON : card.accent,
  });
  card.goal.setProperties({ display: win ? 'none' : 'flex' });
  card.headline.setProperties({
    display: win ? 'flex' : 'none',
    text: win?.headline ?? '',
    // Its full size, unless the text needs smaller to fit one line.
    ...(win ? { fontSize: cardHeadlineFontCm(win.headline) } : {}),
    color: won ? COLOR_HEADLINE : COLOR_TEXT,
  });
  card.message.setProperties({ text: win?.takeaway ?? '' });
  card.query.setProperties({
    display: win?.query ? 'flex' : 'none',
    text: win?.query ?? '',
    fontWeight: 'bold',
    color: COLOR_TEXT,
  });
  card.note.setProperties({
    display: win?.note ? 'flex' : 'none',
    text: win?.note ?? '',
    color: COLOR_TEXT_SECONDARY,
  });
}

/**
 * While playing, a lead-in in the message line and up to two one-line
 * intros below it (the daily ahead of practice), in the rows the win's
 * query and note use. Empty `lines` hides them. Call after `setCardWin(card, null)`.
 */
export function setCardIntro(card: PuzzleCardView, lead: string, lines: readonly string[]): void {
  card.message.setProperties({ text: lead });
  card.query.setProperties({
    display: lines[0] ? 'flex' : 'none',
    text: lines[0] ?? '',
    fontWeight: 'normal',
    color: COLOR_TEXT,
  });
  card.note.setProperties({ display: lines[1] ? 'flex' : 'none', text: lines[1] ?? '', color: COLOR_TEXT });
}

// --- Puzzle bar ---------------------------------------------------------------------

/**
 * The bar's touch targets. The filter's WHERE label isn't one; its Clear
 * button is. `filter` opens the chips (one per result column with a NULL),
 * `filterBack` closes them, `chip` is one of them (`BarButtonTarget.chip`).
 */
export type BarButton = 'prev' | 'hint' | 'next' | 'recenter' | 'exit' | 'clear' | 'filter' | 'filterBack' | 'chip';

/**
 * One bar button's target in the bar's frame (meters: its center, and its
 * width); all share `buttonHeightMeters`. `chip`: which chip (its index), or -1.
 */
export type BarButtonTarget = { name: BarButton; centerX: number; centerY: number; width: number; chip: number };

export { MAX_FILTER_CHIPS };

/**
 * What the bar shows. The bar is a compact column left of the result (two
 * buttons wide), its items on an arc around the eyes (see band-arc.ts).
 * Bottom-anchored, so its fixed rows never move; bottom to top:
 * - Recenter | Exit (icons);
 * - INNER | LEFT (the join system's own control, placed in the room left for it);
 * - Prev | Next;
 * - Hint (the full width);
 * - the filter area, growing upward: Filter (`filter`: the result has
 *   NULLs); or Clear under the filter's label (`where` set); or, with the
 *   chips open (`chips` not null), Back under the chips, one per row (the
 *   first on top).
 */
export type BarContents = { where: string | null; filter: boolean; chips: readonly string[] | null };

export type PuzzleBarView = ArcBand & {
  document: UIKitDocument;
  fade: Signal<number>;
  root: Container;
  /** Prev: the previous puzzle (off, and silent, on the first). */
  prev: Container;
  hint: Container;
  /** The hint button's label: what it shows next (see `setHintLabel`). */
  hintText: Text;
  next: Container;
  /** Next's label: "Next", or "Skip" after "Show answer" (see `setNextLabel`). */
  nextText: Text;
  /** The filter's label (the WHERE clause): not a target. */
  chip: Container;
  chipText: Text;
  /** The WHERE label's opacity (it pulses when a NULL in the filtered column is pressed again). */
  whereOpacity: Signal<number>;
  /** The filter's Clear button: its own pill and target. */
  clear: Container;
  /** Filter: opens the chips. */
  filter: Container;
  /** Back: closes the chips. */
  filterBack: Container;
  /** The filter chips (MAX_FILTER_CHIPS, hidden until the chips open). */
  filterChips: { container: Container; text: Text }[];
  /** Recenter: an icon button (brings the tables back in front of you); its label shows on hover. */
  recenter: RecenterButtonView;
  /** Exit: an icon button; held for a moment, it ends the session ("Hold to exit" on hover). */
  exit: RecenterButtonView;
  /** Opacity of the Next button (pulses once the puzzle is won). */
  nextOpacity: Signal<number>;
  /**
   * Current size, flat (see `setBarContents`); the origin is the left edge's
   * vertical middle. The width is fixed; the height grows with the filter area.
   */
  widthMeters: number;
  heightMeters: number;
  /** The INNER | LEFT row's middle, in the bar's frame (meters; it moves only as the origin does). */
  leadCenterYMeters: number;
  /**
   * The buttons shown, top to bottom, left to right. Updated in place. Each
   * center's x is its arc length from the left edge (see band-arc.ts: hit
   * tests unroll the arc), its y is in the bar's frame.
   */
  buttons: BarButtonTarget[];
  buttonHeightMeters: number;
  /** Internal sizing (cm). */
  sizes: {
    /** The column's width, and a half cell's (two buttons side by side). */
    width: number;
    half: number;
    buttonHeight: number;
    label: number;
    paddingX: number;
    /** The room left for INNER | LEFT (its size). */
    leadWidth: number;
    leadHeight: number;
  };
};

const BAR_PADDING = BAR_PADDING_CM;
const BAR_BORDER = BAR_BORDER_CM;
const BAR_RADIUS = 1.4;
// Next while unavailable: clearly off (light fill, no accent), but readable
// (mid-dark text, ~5:1 contrast on its fill).
const COLOR_DISABLED_FILL = '#ece7db';
const COLOR_DISABLED_TEXT = '#655d4f';
/** The chip's Clear pill: a light fill with a firm border, so it reads as its own button. */
const COLOR_CLEAR_BORDER = '#6b6355';
const NEXT_WAITING_OPACITY = 0.7;
const CLEAR_BORDER_WIDTH = 0.15;
/** Between the column's items in a row, and between its rows (cm). */
const COLUMN_GAP_CM = 0.6;

/** The band's arc radius, in UIKit units (cm). */
const ARC_RADIUS_CM = BAND_ARC_RADIUS_METERS * 100;

/**
 * A band bar's curved items (each turned onto the arc) and the band's lean:
 * how far it tilts back to face the eyes (the join system sets it when it
 * places the band; the arc is a level circle around the eyes, so it decides
 * where each item goes).
 */
export type ArcBand = { curved: { container: Container; sCm: number; yCm: number }[]; leanRad: number };

/**
 * Turns one band item onto the arc (band-arc.ts): its flat center sits
 * (`sCm`, `yCm`) in the band's frame (from its left edge's middle, + up); it
 * moves onto the level circle around the eyes and faces them, with no roll
 * (UIKit transforms: no relayout).
 */
function curveOntoArc(band: ArcBand, container: Container, sCm: number, yCm: number): void {
  band.curved.push({ container, sCm, yCm });
  applyCurve(container, sCm, yCm, band.leanRad);
}

function applyCurve(container: Container, sCm: number, yCm: number, leanRad: number): void {
  const place = arcPlace(sCm, yCm, ARC_RADIUS_CM, leanRad, _arcPlace);
  const deg = 180 / Math.PI;
  container.setProperties({
    transformTranslateX: place.x - sCm,
    // UIKit's translate Y points down.
    transformTranslateY: -(place.y - yCm),
    transformTranslateZ: place.z,
    transformRotateX: place.rx * deg,
    transformRotateY: place.ry * deg,
    transformRotateZ: place.rz * deg,
  });
}
const _arcPlace: ArcPlacement = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };

/** The band's lean (radians: the eyes' elevation seen from the band); re-levels every item when it changes. */
export function setArcLean(band: ArcBand, leanRad: number): void {
  if (Math.abs(leanRad - band.leanRad) < 1e-3) {
    return;
  }
  band.leanRad = leanRad;
  for (const item of band.curved) {
    applyCurve(item.container, item.sCm, item.yCm, leanRad);
  }
}

/**
 * The column's width (cm): two buttons side by side, or INNER | LEFT, or the
 * widest full-width button (Hint, Filter, Back, Clear), whichever is widest.
 * Exported for the label tests.
 */
export function columnWidthCm(
  labelFontCm: number,
  labels: { prev: string; hint: readonly string[]; next: readonly string[]; clear: string; filter: string; filterBack: string },
  lead: { widthCm: number },
): number {
  const pair = (a: number, b: number) => 2 * Math.max(a, b) + COLUMN_GAP_CM;
  return Math.max(
    lead.widthCm,
    pair(barButtonWidthCm([labels.prev], labelFontCm), barButtonWidthCm(labels.next, labelFontCm)),
    pair(CONTROL_OPTION_MIN_WIDTH_CM, CONTROL_OPTION_MIN_WIDTH_CM),
    barButtonWidthCm(labels.hint, labelFontCm),
    barButtonWidthCm([labels.filter], labelFontCm),
    barButtonWidthCm([labels.filterBack], labelFontCm),
    barButtonWidthCm([labels.clear], labelFontCm),
  );
}

/** A half cell's width (cm) in a column `widthCm` wide (Prev | Next, Recenter | Exit). */
export function columnHalfCm(widthCm: number): number {
  return (widthCm - COLUMN_GAP_CM) / 2;
}

/** A full-width label's side padding, at least (label-font ems): a chip or the WHERE label may use less than a button's. */
export const COLUMN_LABEL_MIN_PADDING_EM = 0.3;

/** Puts an absolutely positioned item's center at (`sCm`, `yCm`) from the root's left edge, vertical middle (+ up). */
function placeFlat(container: Container, sCm: number, yCm: number, widthCm: number, heightCm: number, rootHeightCm: number): void {
  container.setProperties({
    positionLeft: sCm - widthCm / 2,
    positionTop: rootHeightCm / 2 - yCm - heightCm / 2,
  });
}

/**
 * `labelFontCm`: the label size (the control's, sized by angle by the
 * caller). `labels.hint` and `labels.next` list every label those buttons
 * show; each starts on its first and is sized for the widest.
 */
export function buildPuzzleBar(
  labelFontCm: number,
  labels: {
    prev: string;
    hint: readonly string[];
    next: readonly string[];
    recenter: string;
    exit: string;
    clear: string;
    filter: string;
    filterBack: string;
  },
  /** INNER | LEFT's size (cm): the column leaves a row for it. */
  lead: { widthCm: number; heightCm: number },
): PuzzleBarView {
  const paddingX = labelFontCm * BAR_BUTTON_PADDING_EM;
  const buttonHeight = Math.max(CONTROL_OPTION_MIN_HEIGHT_CM, labelFontCm * LINE_HEIGHT_FACTOR);
  const width = columnWidthCm(labelFontCm, labels, lead);
  const half = columnHalfCm(width);

  const fade = signal(1);
  const nextOpacity = signal(1);
  // No track (each button is its own pill on the arc); every item is placed
  // absolutely (setBarContents), the origin the left edge's vertical middle.
  const root = new UIKit.Container({
    width,
    anchorX: 'left',
    anchorY: 'center',
    opacity: fade,
    fontFamilies: FONT_FAMILIES,
  });
  const button = (label: string, buttonWidth: number, selected: boolean, opacity: Signal<number> | null) => {
    const style = controlOptionStyle(selected);
    const container = new UIKit.Container({
      positionType: 'absolute',
      width: buttonWidth,
      minWidth: buttonWidth,
      height: buttonHeight,
      flexShrink: 0,
      justifyContent: 'center',
      alignItems: 'center',
      borderTopLeftRadius: BAR_RADIUS - BAR_PADDING,
      borderTopRightRadius: BAR_RADIUS - BAR_PADDING,
      borderBottomLeftRadius: BAR_RADIUS - BAR_PADDING,
      borderBottomRightRadius: BAR_RADIUS - BAR_PADDING,
      backgroundColor: style.backgroundColor,
      color: style.color,
      ...(opacity ? { opacity: computed(() => opacity.value * fade.value) } : {}),
    });
    const text = new UIKit.Text({ text: label, fontSize: labelFontCm, fontWeight: 'bold', wordBreak: 'keep-all' });
    container.add(text);
    root.add(container);
    return { container, text };
  };
  const prev = button(labels.prev, half, false, null);
  const next = button(labels.next[0] ?? '', half, true, nextOpacity);
  const hint = button(labels.hint[0] ?? '', width, false, null);
  // The filter chip: the WHERE clause as a flat label (a soft pill, regular
  // weight: it reads as the filter's text, not a button), then its own Clear
  // button, a bordered pill.
  const whereOpacity = signal(1);
  const chip = button('', width, false, whereOpacity);
  chip.container.setProperties({ display: 'none', backgroundColor: COLOR_BAR_TRACK, color: COLOR_TEXT_SECONDARY });
  chip.text.setProperties({ fontWeight: 'normal' });
  const clear = button(labels.clear, width, false, null);
  clear.container.setProperties({
    display: 'none',
    backgroundColor: COLOR_CARD,
    borderColor: COLOR_CLEAR_BORDER,
    borderTopWidth: CLEAR_BORDER_WIDTH,
    borderLeftWidth: CLEAR_BORDER_WIDTH,
    borderRightWidth: CLEAR_BORDER_WIDTH,
    borderBottomWidth: CLEAR_BORDER_WIDTH,
  });
  // Filter, then (while open) Back and the chips: plain buttons like Hint.
  const filter = button(labels.filter, width, false, null);
  filter.container.setProperties({ display: 'none' });
  const back = button(labels.filterBack, width, false, null);
  back.container.setProperties({ display: 'none' });
  const filterChips: { container: Container; text: Text }[] = [];
  for (let i = 0; i < MAX_FILTER_CHIPS; i++) {
    const chipButton = button('', width, false, null);
    chipButton.container.setProperties({ display: 'none' });
    filterChips.push(chipButton);
  }
  // Recenter and Exit: icons, their labels below them on hover.
  const recenter = recenterButton(root, root, labelFontCm, buttonHeight, labels.recenter, fade, LocateFixed, half);
  // Exit: held for a moment, it ends the session.
  const exit = recenterButton(root, root, labelFontCm, buttonHeight, labels.exit, fade, LogOut, half);

  const bar: PuzzleBarView = {
    curved: [],
    leanRad: 0,
    document: new UIKitDocument(root),
    fade,
    root,
    prev: prev.container,
    hint: hint.container,
    hintText: hint.text,
    next: next.container,
    nextText: next.text,
    chip: chip.container,
    chipText: chip.text,
    whereOpacity,
    clear: clear.container,
    filter: filter.container,
    filterBack: back.container,
    filterChips,
    recenter,
    exit,
    nextOpacity,
    widthMeters: width / 100,
    heightMeters: 0,
    leadCenterYMeters: 0,
    buttons: [],
    buttonHeightMeters: buttonHeight / 100,
    sizes: {
      width,
      half,
      buttonHeight,
      label: labelFontCm,
      paddingX,
      leadWidth: lead.widthCm,
      leadHeight: lead.heightCm,
    },
  };
  setBarContents(bar, { where: null, filter: false, chips: null });
  return bar;
}

/** The hint button's label (its width already fits every label, so nothing resizes). */
export function setHintLabel(bar: PuzzleBarView, label: string): void {
  bar.hintText.setProperties({ text: label });
}

/** Next's label, "Next" or "Skip" (sized for both, so nothing resizes). */
export function setNextLabel(bar: PuzzleBarView, label: string): void {
  bar.nextText.setProperties({ text: label });
}

/**
 * The column's height (cm) holding the filter area's rows (`filterRows`)
 * above its fixed rows. Exported for the label tests.
 */
export function columnHeightCm(buttonHeightCm: number, leadHeightCm: number, filterRows: number): number {
  const rows = 3 + filterRows;
  return leadHeightCm + rows * buttonHeightCm + rows * COLUMN_GAP_CM;
}

/**
 * Shows `contents` (see `BarContents`) and resizes the bar to them; updates
 * `heightMeters`, `leadCenterYMeters` and `buttons` in place. Runs only when
 * the contents change, never per frame. The caller re-places the bar
 * afterwards (its bottom stays put; its origin moves with its height).
 */
export function setBarContents(bar: PuzzleBarView, contents: BarContents): void {
  const { width, half, buttonHeight, label, paddingX, leadHeight } = bar.sizes;
  const open = contents.chips !== null;
  // The targets change: no hover outline survives (the pointer re-hovers next frame).
  for (const container of [bar.prev, bar.hint, bar.next, bar.recenter.container, bar.exit.container, bar.filter, bar.filterBack]) {
    setTargetHover(container, false);
  }
  for (const chipButton of bar.filterChips) {
    setTargetHover(chipButton.container, false);
  }
  setTargetHover(bar.clear, false, { color: COLOR_CLEAR_BORDER, width: CLEAR_BORDER_WIDTH });
  const where = open ? null : contents.where;
  const showFilter = !open && where === null && contents.filter;
  const chips = contents.chips ?? [];
  const chipCount = Math.min(chips.length, bar.filterChips.length);

  if (where === null) {
    bar.chip.setProperties({ display: 'none' });
    bar.clear.setProperties({ display: 'none' });
  } else {
    // The WHERE label: its own text, cut to the column if ever too long (the label tests keep it from happening).
    bar.chipText.setProperties({
      text: truncateToWidth(where, DATA_METRICS, label, width - 2 * COLUMN_LABEL_MIN_PADDING_EM * label),
    });
    bar.chip.setProperties({ display: 'flex' });
    bar.clear.setProperties({ display: 'flex' });
  }
  bar.filter.setProperties({ display: showFilter ? 'flex' : 'none' });
  bar.filterBack.setProperties({ display: open ? 'flex' : 'none' });

  // Rows, bottom to top: [items, height]. Each item: its button (null: not a
  // target), container, width and chip index; laid out left to right.
  type Item = { name: BarButton | null; container: Container | null; width: number; chip: number };
  const pair = (left: Item, right: Item): Item[] => [left, right];
  const rows: [Item[], number][] = [
    [
      pair(
        { name: 'recenter', container: bar.recenter.container, width: half, chip: -1 },
        { name: 'exit', container: bar.exit.container, width: half, chip: -1 },
      ),
      buttonHeight,
    ],
    // The room for INNER | LEFT (the join system places the control there).
    [[{ name: null, container: null, width, chip: -1 }], leadHeight],
    [
      pair({ name: 'prev', container: bar.prev, width: half, chip: -1 }, { name: 'next', container: bar.next, width: half, chip: -1 }),
      buttonHeight,
    ],
    [[{ name: 'hint', container: bar.hint, width, chip: -1 }], buttonHeight],
  ];
  if (where !== null) {
    rows.push([[{ name: 'clear', container: bar.clear, width, chip: -1 }], buttonHeight]);
    rows.push([[{ name: null, container: bar.chip, width, chip: -1 }], buttonHeight]);
  } else if (showFilter) {
    rows.push([[{ name: 'filter', container: bar.filter, width, chip: -1 }], buttonHeight]);
  } else if (open) {
    rows.push([[{ name: 'filterBack', container: bar.filterBack, width, chip: -1 }], buttonHeight]);
    // The chips above Back, one per row, the first on top.
    for (let i = chipCount - 1; i >= 0; i--) {
      rows.push([[{ name: 'chip', container: bar.filterChips[i].container, width, chip: i }], buttonHeight]);
    }
  }
  bar.filterChips.forEach((chipButton, i) => {
    const text = i < chips.length ? chips[i] : null;
    chipButton.container.setProperties({ display: text === null ? 'none' : 'flex' });
    if (text !== null) {
      chipButton.text.setProperties({ text: truncateToWidth(text, HEADER_METRICS, label, width - 2 * COLUMN_LABEL_MIN_PADDING_EM * label) });
    }
  });

  const heightCm = columnHeightCm(buttonHeight, leadHeight, rows.length - 3);
  bar.root.setProperties({ height: heightCm });
  bar.heightMeters = heightCm / 100;

  bar.curved.length = 0;
  // Each item onto the arc, and the targets: x is the arc length of its
  // center from the left edge, y its row's middle (origin: the column's middle).
  // Listed top to bottom (reading order).
  bar.buttons.length = 0;
  const targets: BarButtonTarget[] = [];
  let bottom = 0;
  for (const [items, rowHeight] of rows) {
    const rowY = bottom + rowHeight / 2 - heightCm / 2;
    if (items.length === 1 && items[0].container === null) {
      bar.leadCenterYMeters = rowY / 100;
    }
    items.forEach((item, i) => {
      const center = i === 0 ? item.width / 2 : width - item.width / 2;
      if (item.container) {
        placeFlat(item.container, center, rowY, item.width, rowHeight, heightCm);
        curveOntoArc(bar, item.container, center, rowY);
      }
      if (item.name !== null) {
        targets.push({ name: item.name, centerX: center / 100, centerY: rowY / 100, width: item.width / 100, chip: item.chip });
      }
    });
    bottom += rowHeight + COLUMN_GAP_CM;
  }
  targets.sort((p, q) => q.centerY - p.centerY || p.centerX - q.centerX);
  bar.buttons.push(...targets);
  // Recenter's and Exit's hover labels: just below the column, centered under it, on the arc too.
  placeIconLabels(bar, bar.recenter, bar.exit, width, heightCm);
}

/** Recenter's and Exit's hover labels: centered just below the column (toward the slabs, never over the result). */
function placeIconLabels(band: ArcBand, recenter: RecenterButtonView, exit: RecenterButtonView, widthCm: number, heightCm: number): void {
  for (const view of [recenter, exit]) {
    const y = -heightCm / 2 - COLUMN_GAP_CM - view.labelHeightCm / 2;
    placeFlat(view.label, widthCm / 2, y, view.labelWidthCm, view.labelHeightCm, heightCm);
    curveOntoArc(band, view.label, widthCm / 2, y);
  }
}

// --- Recenter (the bar's icon button, and free play's one-button bar) ---------------

/** The Recenter icon button and its hover label (absolute, above the button; never a target). */
export type RecenterButtonView = {
  container: Container;
  label: Container;
  labelWidthCm: number;
  labelHeightCm: number;
};

const COLOR_RECENTER_LABEL = '#4a4538';
const COLOR_RECENTER_LABEL_TEXT = '#f7f4ee';

/** An icon component class (Lucide), as the icon buttons take it. */
type IconClass = typeof LocateFixed;

/**
 * Builds an icon button (Recenter, Exit) into `parent` (a row) and its hover
 * label as an absolute layer of `root` (placed by `placeRecenterLabel`).
 */
function recenterButton(
  parent: Container,
  root: Container,
  labelFontCm: number,
  buttonHeight: number,
  label: string,
  fade: Signal<number>,
  Icon: IconClass = LocateFixed,
  width = CONTROL_OPTION_MIN_WIDTH_CM,
): RecenterButtonView {
  const style = controlOptionStyle(false);
  const container = new UIKit.Container({
    positionType: 'absolute',
    width,
    minWidth: width,
    height: buttonHeight,
    flexShrink: 0,
    justifyContent: 'center',
    alignItems: 'center',
    borderTopLeftRadius: BAR_RADIUS - BAR_PADDING,
    borderTopRightRadius: BAR_RADIUS - BAR_PADDING,
    borderBottomLeftRadius: BAR_RADIUS - BAR_PADDING,
    borderBottomRightRadius: BAR_RADIUS - BAR_PADDING,
    backgroundColor: style.backgroundColor,
    color: style.color,
  });
  const iconSize = labelFontCm * 1.3;
  container.add(new Icon({ width: iconSize, height: iconSize, color: style.color }));
  parent.add(container);

  const labelWidthCm = measureHeaderTextCm(label, labelFontCm) + 2 * labelFontCm * BAR_BUTTON_PADDING_EM;
  const labelHeightCm = labelFontCm * LINE_HEIGHT_FACTOR + labelFontCm * 0.3;
  const tag = new UIKit.Container({
    positionType: 'absolute',
    positionTop: 0,
    positionLeft: 0,
    width: labelWidthCm,
    height: labelHeightCm,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLOR_RECENTER_LABEL,
    borderTopLeftRadius: labelHeightCm / 2,
    borderTopRightRadius: labelHeightCm / 2,
    borderBottomLeftRadius: labelHeightCm / 2,
    borderBottomRightRadius: labelHeightCm / 2,
    pointerEvents: 'none',
    opacity: fade,
    display: 'none',
  });
  tag.add(
    new UIKit.Text({
      text: label,
      fontSize: labelFontCm,
      fontWeight: 'bold',
      color: COLOR_RECENTER_LABEL_TEXT,
      wordBreak: 'keep-all',
      opacity: fade,
    }),
  );
  root.add(tag);
  return { container, label: tag, labelWidthCm, labelHeightCm };
}

/** Shows or hides the Recenter label (a fingertip or a hand's ray over the button). */
export function setRecenterHover(view: RecenterButtonView, hovered: boolean): void {
  view.label.setProperties({ display: hovered ? 'flex' : 'none' });
}

/**
 * Free play's bar: the column with only its two bottom rows (there's no
 * puzzle bar): Recenter | Exit, and the room for INNER | LEFT above them, on
 * the same arc. Origin: the left edge's vertical middle.
 */
export type RecenterBarView = ArcBand & {
  document: UIKitDocument;
  fade: Signal<number>;
  recenter: RecenterButtonView;
  exit: RecenterButtonView;
  widthMeters: number;
  heightMeters: number;
  buttonWidthMeters: number;
  buttonHeightMeters: number;
  /** Each button's center (meters): x its arc length from the left edge, y in the bar's frame. */
  recenterCenterX: number;
  exitCenterX: number;
  centerY: number;
  /** The INNER | LEFT row's middle, in the bar's frame (meters). */
  leadCenterYMeters: number;
};

export function buildRecenterBar(
  labelFontCm: number,
  label: string,
  exitLabel: string,
  lead: { widthCm: number; heightCm: number },
): RecenterBarView {
  const buttonHeight = Math.max(CONTROL_OPTION_MIN_HEIGHT_CM, labelFontCm * LINE_HEIGHT_FACTOR);
  const widthCm = Math.max(lead.widthCm, 2 * CONTROL_OPTION_MIN_WIDTH_CM + COLUMN_GAP_CM);
  const half = columnHalfCm(widthCm);
  const heightCm = buttonHeight + COLUMN_GAP_CM + lead.heightCm;
  const fade = signal(1);
  const root = new UIKit.Container({
    width: widthCm,
    height: heightCm,
    anchorX: 'left',
    anchorY: 'center',
    opacity: fade,
    fontFamilies: FONT_FAMILIES,
  });
  const recenter = recenterButton(root, root, labelFontCm, buttonHeight, label, fade, LocateFixed, half);
  const exit = recenterButton(root, root, labelFontCm, buttonHeight, exitLabel, fade, LogOut, half);
  const rowY = -heightCm / 2 + buttonHeight / 2;
  const recenterCenter = half / 2;
  const exitCenter = widthCm - half / 2;
  const band: ArcBand = { curved: [], leanRad: 0 };
  placeFlat(recenter.container, recenterCenter, rowY, half, buttonHeight, heightCm);
  placeFlat(exit.container, exitCenter, rowY, half, buttonHeight, heightCm);
  curveOntoArc(band, recenter.container, recenterCenter, rowY);
  curveOntoArc(band, exit.container, exitCenter, rowY);
  placeIconLabels(band, recenter, exit, widthCm, heightCm);
  return {
    ...band,
    document: new UIKitDocument(root),
    fade,
    recenter,
    exit,
    widthMeters: widthCm / 100,
    heightMeters: heightCm / 100,
    buttonWidthMeters: half / 100,
    buttonHeightMeters: buttonHeight / 100,
    recenterCenterX: recenterCenter / 100,
    exitCenterX: exitCenter / 100,
    centerY: rowY / 100,
    leadCenterYMeters: (heightCm / 2 - lead.heightCm / 2) / 100,
  };
}

/**
 * Next while its switch waits for the player to let go of a table: shown
 * pressed (the accent fill, held dimmer, no pulse), so it reads as "working
 * on it", not as broken.
 */
export function setNextWaiting(bar: PuzzleBarView): void {
  bar.next.setProperties(controlOptionStyle(true));
  bar.nextOpacity.value = NEXT_WAITING_OPACITY;
}

/** The container of a shown bar target (`bar.buttons[index]`), or null. */
function barTargetContainer(bar: PuzzleBarView, index: number): Container | null {
  const target = bar.buttons[index];
  if (!target) {
    return null;
  }
  switch (target.name) {
    case 'prev':
      return bar.prev;
    case 'hint':
      return bar.hint;
    case 'next':
      return bar.next;
    case 'recenter':
      return bar.recenter.container;
    case 'exit':
      return bar.exit.container;
    case 'clear':
      return bar.clear;
    case 'filter':
      return bar.filter;
    case 'filterBack':
      return bar.filterBack;
    case 'chip':
      return bar.filterChips[target.chip]?.container ?? null;
  }
}

/**
 * The hand pointer's hover on the bar: outlines `bar.buttons[index]` (-1:
 * none), restoring the one outlined before. Only on a change.
 */
export function setBarHover(bar: PuzzleBarView, index: number, previous: number): void {
  if (index === previous) {
    return;
  }
  const rest = (i: number) => (bar.buttons[i]?.name === 'clear' ? { color: COLOR_CLEAR_BORDER, width: CLEAR_BORDER_WIDTH } : null);
  const before = barTargetContainer(bar, previous);
  if (before) {
    setTargetHover(before, false, rest(previous));
  }
  const now = barTargetContainer(bar, index);
  if (now) {
    setTargetHover(now, true, rest(index));
  }
}

/** Prev's look: a normal button while there's a previous puzzle; Next's clearly-off style on the first. */
export function setPrevAvailable(bar: PuzzleBarView, available: boolean): void {
  bar.prev.setProperties(
    available ? controlOptionStyle(false) : { backgroundColor: COLOR_DISABLED_FILL, color: COLOR_DISABLED_TEXT },
  );
}

/** Next's look: the accent style while available; a light, clearly-off but readable style while not. */
export function setNextAvailable(bar: PuzzleBarView, available: boolean): void {
  bar.next.setProperties(
    available ? controlOptionStyle(true) : { backgroundColor: COLOR_DISABLED_FILL, color: COLOR_DISABLED_TEXT },
  );
  if (!available) {
    bar.nextOpacity.value = 1;
  }
}
