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
import { Check } from '@pmndrs/uikit-lucide/dist/Check.js';
import { Eye } from '@pmndrs/uikit-lucide/dist/Eye.js';
import { Flame } from '@pmndrs/uikit-lucide/dist/Flame.js';
import { Lock } from '@pmndrs/uikit-lucide/dist/Lock.js';
import { Clock } from '@pmndrs/uikit-lucide/dist/Clock.js';
import { Coffee } from '@pmndrs/uikit-lucide/dist/Coffee.js';
import { LocateFixed } from '@pmndrs/uikit-lucide/dist/LocateFixed.js';
import { LogOut } from '@pmndrs/uikit-lucide/dist/LogOut.js';
import { School } from '@pmndrs/uikit-lucide/dist/School.js';
import { ShoppingBag } from '@pmndrs/uikit-lucide/dist/ShoppingBag.js';
import { arcPlace, BAND_ARC_RADIUS_METERS, type ArcPlacement } from './band-arc.js';
import { CARD_CLOCK_SCALE, CARD_GOAL_LINES, CARD_MESSAGE_LINES, cardHeadlineFontCm, cardMetrics } from './card-metrics.js';
import { BAR } from './data/copy.js';
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
  measureDataTextCm,
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
/** The session clock above the card: quiet, on a card-colored pill so it reads over passthrough. */
const COLOR_CLOCK_TEXT = '#6e6759';

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
  /** Before the status line while it shows the daily streak (hidden otherwise). */
  statusFlame: InstanceType<typeof Flame>;
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
  /** The session clock (or "Solved in" on a win), just above the card's top edge at its left. */
  clockText: Text;
  widthMeters: number;
  heightMeters: number;
  /** How far the clock rises above the card's top edge (meters): counted in the view checks. */
  topExtraMeters: number;
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
  statusRow.setProperties({ flexDirection: 'row', alignItems: 'center', gapColumn: smallFont * 0.35 });
  const statusFlame = new Flame({ width: smallFont, height: smallFont, color: COLOR_STREAK_FLAME, display: 'none', flexShrink: 0 });
  statusRow.add(statusFlame, status);
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

  // The session clock: a small pill just above the card, aligned with its left edge; never a target.
  const clockFont = smallFont * CARD_CLOCK_SCALE;
  const clockPadX = clockFont * 0.4;
  const clockHeight = clockFont * LINE_HEIGHT_FACTOR + clockFont * 0.2;
  const clockGap = smallFont * 0.3;
  const clock = new UIKit.Container({
    positionType: 'absolute',
    // Offsets from the card's padding box: past its border, then the gap.
    positionTop: -(border + clockGap + clockHeight),
    positionLeft: -border,
    height: clockHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gapColumn: clockFont * 0.3,
    paddingLeft: clockPadX,
    paddingRight: clockPadX,
    backgroundColor: COLOR_CARD,
    borderTopLeftRadius: clockHeight / 2,
    borderTopRightRadius: clockHeight / 2,
    borderBottomLeftRadius: clockHeight / 2,
    borderBottomRightRadius: clockHeight / 2,
    pointerEvents: 'none',
  });
  const clockText = new UIKit.Text({ text: '0:00', fontSize: clockFont, color: COLOR_CLOCK_TEXT, wordBreak: 'keep-all' });
  clock.add(new Clock({ width: clockFont, height: clockFont, color: COLOR_CLOCK_TEXT, flexShrink: 0 }), clockText);
  root.add(clock);

  return {
    document: new UIKitDocument(root),
    fade,
    root,
    title,
    status,
    statusFlame,
    goal,
    headline,
    message,
    query,
    note,
    icons,
    accent: COLOR_CARD_BORDER,
    clockText,
    widthMeters: widthCm / 100,
    heightMeters: heightCm / 100,
    topExtraMeters: (clockGap + clockHeight) / 100,
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
export type BarButton =
  | 'prev'
  | 'hint'
  | 'next'
  | 'recenter'
  | 'exit'
  | 'clear'
  | 'filter'
  | 'filterBack'
  | 'filterMore'
  | 'chip'
  | 'puzzles'
  | 'pickerBack'
  | 'tile';

/**
 * One bar button's target in the bar's frame (meters: its center, and its
 * width); all share `buttonHeightMeters`. `chip`: which chip (its index), or -1.
 */
export type BarButtonTarget = { name: BarButton; centerX: number; centerY: number; width: number; chip: number };

/**
 * One tile of the in-XR puzzle picker (the welcome grid's status data,
 * `puzzleTiles`): its number, status mark, today's daily, whether a press
 * selects it, whether it's the puzzle on the desk, and its dataset accent.
 */
export type PickerTileView = {
  number: number;
  status: 'solved' | 'revealed' | 'open' | 'locked';
  today: boolean;
  selectable: boolean;
  current: boolean;
  accent: string;
};

/** The picker grid: 4 tiles across, 5 down (puzzles 1-20 in order), each a full touch target. */
export const PICKER_COLUMNS = 4;
export const PICKER_ROWS = 5;
/** A tile's width (cm, at least the 3 cm touch minimum) and the gap between tiles; its height is a button's. */
export const PICKER_TILE_WIDTH_CM = 3.0;
export const PICKER_TILE_GAP_CM = 0.3;
/** The grid's width (cm): wider than the column, it extends the column to the left while open. */
export const PICKER_WIDTH_CM = PICKER_COLUMNS * PICKER_TILE_WIDTH_CM + (PICKER_COLUMNS - 1) * PICKER_TILE_GAP_CM;
const PICKER_TODAY_BORDER_CM = 0.2;
const PICKER_LOCKED_OPACITY = 0.45;
/** The legend's text, relative to the column's label size (as the tiles' "Today"). */
export const PICKER_LEGEND_FONT_SCALE = 0.6;
/** A legend mark's size, its gap to its words, and the gap between items (all in ems of the legend's text). */
const LEGEND_MARK_EM = 1.1;
const LEGEND_MARK_GAP_EM = 0.35;
export const LEGEND_ITEM_GAP_EM = 1;
const LEGEND_LINE_HEIGHT_EM = 1.45;
const LEGEND_PADDING_EM = 0.45;
/** The current tile's dot, relative to the tile's mark size. */
const CURRENT_DOT_SCALE = 0.45;

/** UIKit's four corner radii, all `r` (cm). */
function roundedCm(r: number) {
  return { borderTopLeftRadius: r, borderTopRightRadius: r, borderBottomLeftRadius: r, borderBottomRightRadius: r };
}

/**
 * The picker's legend: two lines under the grid, each mark as the tiles show
 * it, then what it means -- the puzzle on the desk (filled, a dot), today's
 * daily (outlined; its accent set by setPickerLegendAccent), solved, answer
 * shown, locked. On the column's track color, so it reads over passthrough.
 */
function buildPickerLegend(labelFontCm: number, lines: readonly (readonly string[])[]): { container: Container; today: Container } {
  const font = labelFontCm * PICKER_LEGEND_FONT_SCALE;
  const mark = font * LEGEND_MARK_EM;
  const idle = controlOptionStyle(false);
  const selected = controlOptionStyle(true);
  // The grid's width (as Back's above it), its lines centered.
  const container = new UIKit.Container({
    positionType: 'absolute',
    display: 'none',
    width: PICKER_WIDTH_CM,
    height: pickerLegendHeightCm(labelFontCm),
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    padding: font * LEGEND_PADDING_EM,
    backgroundColor: idle.backgroundColor,
    ...roundedCm(BAR_RADIUS - BAR_PADDING),
  });
  const swatch = (props: Record<string, unknown>) =>
    new UIKit.Container({ width: mark, height: mark, flexShrink: 0, justifyContent: 'center', alignItems: 'center', ...roundedCm(mark * 0.25), ...props });
  // The marks, in the copy's order: current, today's daily, solved; answer shown, locked.
  const current = swatch({ backgroundColor: selected.backgroundColor });
  const dot = mark * CURRENT_DOT_SCALE;
  current.add(new UIKit.Container({ width: dot, height: dot, ...roundedCm(dot / 2), backgroundColor: selected.color }));
  const today = swatch({ backgroundColor: '#ffffff', borderWidth: font * 0.18, borderColor: idle.color });
  const icon = (Icon: typeof Check) => {
    const wrapper = swatch({});
    wrapper.add(new Icon({ width: mark * 0.9, height: mark * 0.9, color: idle.color }));
    return wrapper;
  };
  const marks = [current, today, icon(Check), icon(Eye), icon(Lock)];
  let next = 0;
  for (const words of lines) {
    const line = new UIKit.Container({ flexDirection: 'row', alignItems: 'center', height: font * LEGEND_LINE_HEIGHT_EM, gapColumn: font * LEGEND_ITEM_GAP_EM });
    for (const text of words) {
      const item = new UIKit.Container({ flexDirection: 'row', alignItems: 'center', gapColumn: font * LEGEND_MARK_GAP_EM });
      const markView = marks[next++];
      if (markView) {
        item.add(markView);
      }
      item.add(new UIKit.Text({ text, fontSize: font, color: idle.color, wordBreak: 'keep-all' }));
      line.add(item);
    }
    container.add(line);
  }
  return { container, today };
}

/** The legend's "Today's daily" mark, outlined in today's daily's accent (as its tile). */
export function setPickerLegendAccent(bar: PuzzleBarView, accent: string): void {
  bar.pickerLegendToday.setProperties({ borderColor: accent });
}

/** One legend line's width (cm): each item a mark and its words, with gaps between items. Exported for the tests. */
export function pickerLegendLineWidthCm(words: readonly string[], labelFontCm: number): number {
  const font = labelFontCm * PICKER_LEGEND_FONT_SCALE;
  const items = words.map((text) => font * (LEGEND_MARK_EM + LEGEND_MARK_GAP_EM) + measureDataTextCm(text, font));
  return items.reduce((sum, w) => sum + w, 0) + Math.max(0, words.length - 1) * font * LEGEND_ITEM_GAP_EM + 2 * font * LEGEND_PADDING_EM;
}

/** The legend's height (cm): two lines and its padding. */
export function pickerLegendHeightCm(labelFontCm: number): number {
  const font = labelFontCm * PICKER_LEGEND_FONT_SCALE;
  return 2 * font * LEGEND_LINE_HEIGHT_EM + 2 * font * LEGEND_PADDING_EM;
}

export { MAX_FILTER_CHIPS };

/**
 * What the bar shows. The bar is a compact column left of the result (two
 * buttons wide), its items on an arc around the eyes (see band-arc.ts).
 * Bottom-anchored, so its fixed rows never move; bottom to top:
 * - Recenter | Exit (icons);
 * - INNER | LEFT (the join system's own control, placed in the room left for it);
 * - Puzzles (opens the picker; it stays in this row while the picker is open);
 * - Prev | Next;
 * - Hint (the full width);
 * - the filter area, growing upward: Filter (`filter`: the result has
 *   NULLs); or Clear under the filter's label (`where` set); or, with the
 *   chips open (`chips` not null), Back under the chips, one per row (the
 *   first on top).
 */
export type BarContents = {
  where: string | null;
  filter: boolean;
  /** The open chips' column headers as the result shows them ("D.ID"), this page's; null: closed. */
  chips: readonly string[] | null;
  /** More's label while the chips are on pages ("More (1/2)"); null or absent: one page. */
  chipsMore?: string | null;
  /** The puzzle picker, open (its tiles, in order) in place of Prev | Next, Hint and the filter area; null: closed. */
  picker?: readonly PickerTileView[] | null;
};

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
  /** More: the next page of chips (only when there are more than fit at once); its label says which page. */
  filterMore: Container;
  filterMoreText: Text;
  /** The filter chips (MAX_FILTER_CHIPS, hidden until the chips open). */
  filterChips: { container: Container; text: Text }[];
  /** Puzzles: opens (and closes) the picker; Back on top of the open grid closes it too. */
  puzzles: Container;
  pickerBack: Container;
  /** The picker's tiles (20), hidden until it opens. */
  pickerTiles: {
    container: Container;
    number: Text;
    today: Container;
    /** The puzzle on the desk's dot (beside its status mark; its fill says it too). */
    dot: Container;
    icons: { solved: Container; revealed: Container; locked: Container };
    data: PickerTileView | null;
  }[];
  /** The picker's legend under the grid (two lines: each mark and what it means); hidden while closed. */
  pickerLegend: Container;
  /** Its "Today's daily" mark, outlined in today's daily's accent (setPickerLegendAccent). */
  pickerLegendToday: Container;
  /**
   * While the picker is open, how much wider than the column the bar is
   * (meters): the grid extends to the left, the column's own items stay put.
   */
  extendLeftMeters: number;
  /** Recenter: an icon button (brings the tables back in front of you); its label shows on hover. */
  recenter: RecenterButtonView;
  /** Exit: an icon button; held for a moment, it ends the session ("Hold to exit" on hover). */
  exit: RecenterButtonView;
  /** "Hold to show the answer": while Show answer acts only when held, shown on hover and while held. */
  answerLabel: HoverLabelView;
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

/** The daily streak's flame on the card (as on the welcome screen). */
const COLOR_STREAK_FLAME = '#d97a1e';
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
  labels: {
    prev: string;
    hint: readonly string[];
    next: readonly string[];
    clear: string;
    filter: string;
    filterBack: string;
    puzzles?: string;
  },
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
    labels.puzzles ? barButtonWidthCm([labels.puzzles], labelFontCm) : 0,
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
    /** Show answer's hover label while it acts only when held. */
    answerHold: string;
    clear: string;
    filter: string;
    filterBack: string;
    puzzles: string;
    pickerBack: string;
    /** The picker's legend: two lines of mark labels (current, today's daily, solved; answer shown, locked). */
    legend: readonly (readonly string[])[];
    today: string;
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
  const more = button(BAR.filterMore(1, 2), width, false, null);
  more.container.setProperties({ display: 'none' });
  const filterChips: { container: Container; text: Text }[] = [];
  for (let i = 0; i < MAX_FILTER_CHIPS; i++) {
    const chipButton = button('', width, false, null);
    chipButton.container.setProperties({ display: 'none' });
    filterChips.push(chipButton);
  }
  // Puzzles, and the picker: Back on top, then the tiles (number, status mark, "Today").
  const puzzles = button(labels.puzzles, width, false, null);
  const pickerBack = button(labels.pickerBack, PICKER_WIDTH_CM, false, null);
  pickerBack.container.setProperties({ display: 'none' });
  const markSize = labelFontCm * 0.7;
  const pickerTiles: PuzzleBarView['pickerTiles'] = [];
  for (let i = 0; i < PICKER_COLUMNS * PICKER_ROWS; i++) {
    const tile = button('', PICKER_TILE_WIDTH_CM, false, null);
    tile.container.setProperties({ display: 'none', flexDirection: 'column', gapRow: labelFontCm * 0.05 });
    tile.text.setProperties({ fontSize: labelFontCm * 0.9 });
    const marks = new UIKit.Container({ flexDirection: 'row', alignItems: 'center', height: markSize * 1.1 });
    const icon = (Icon: typeof Check) => {
      const wrapper = new UIKit.Container({ display: 'none' });
      wrapper.add(new Icon({ width: markSize, height: markSize, color: controlOptionStyle(false).color }));
      marks.add(wrapper);
      return wrapper;
    };
    // The puzzle on the desk: a dot before its mark (light, on its dark fill).
    const dotSize = markSize * CURRENT_DOT_SCALE;
    const dot = new UIKit.Container({
      display: 'none',
      width: dotSize,
      height: dotSize,
      marginRight: markSize * 0.25,
      ...roundedCm(dotSize / 2),
      backgroundColor: controlOptionStyle(true).color,
    });
    marks.add(dot);
    const icons = { solved: icon(Check), revealed: icon(Eye), locked: icon(Lock) };
    const today = new UIKit.Container({ display: 'none' });
    today.add(new UIKit.Text({ text: labels.today, fontSize: markSize * 0.85, fontWeight: 'bold', wordBreak: 'keep-all' }));
    marks.add(today);
    tile.container.add(marks);
    pickerTiles.push({ container: tile.container, number: tile.text, today, dot, icons, data: null });
  }
  const legend = buildPickerLegend(labelFontCm, labels.legend);
  root.add(legend.container);
  // Recenter and Exit: icons, their labels below them on hover.
  const recenter = recenterButton(root, root, labelFontCm, buttonHeight, labels.recenter, fade, LocateFixed, half);
  // Exit: held for a moment, it ends the session.
  const exit = recenterButton(root, root, labelFontCm, buttonHeight, labels.exit, fade, LogOut, half);
  const answerLabel = hoverLabel(root, labels.answerHold, labelFontCm, fade);

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
    filterMore: more.container,
    filterMoreText: more.text,
    filterChips,
    puzzles: puzzles.container,
    pickerBack: pickerBack.container,
    pickerTiles,
    pickerLegend: legend.container,
    pickerLegendToday: legend.today,
    extendLeftMeters: 0,
    recenter,
    exit,
    answerLabel,
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
  setBarContents(bar, { where: null, filter: false, chips: null, picker: null });
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
  // Recenter | Exit, Prev | Next, Puzzles, Hint, and the filter rows (each with the gap above it), and INNER | LEFT.
  const rows = 4 + filterRows;
  return leadHeightCm + rows * buttonHeightCm + rows * COLUMN_GAP_CM;
}

/**
 * The column's height (cm) with the picker open: Recenter | Exit, INNER |
 * LEFT, Puzzles, the legend, the tiles' rows, and Back on top. Exported for the tests.
 */
export function pickerColumnHeightCm(buttonHeightCm: number, leadHeightCm: number, labelFontCm: number): number {
  const grid = PICKER_ROWS * buttonHeightCm + (PICKER_ROWS - 1) * PICKER_TILE_GAP_CM;
  return leadHeightCm + 3 * buttonHeightCm + grid + pickerLegendHeightCm(labelFontCm) + 5 * COLUMN_GAP_CM;
}

/**
 * Shows `contents` (see `BarContents`) and resizes the bar to them; updates
 * `heightMeters`, `leadCenterYMeters` and `buttons` in place. Runs only when
 * the contents change, never per frame. The caller re-places the bar
 * afterwards (its bottom stays put; its origin moves with its height).
 */
export function setBarContents(bar: PuzzleBarView, contents: BarContents): void {
  const { width, half, buttonHeight, label, paddingX, leadHeight } = bar.sizes;
  const picker = contents.picker ?? null;
  const open = contents.chips !== null && picker === null;
  // The targets change: no hover outline survives (the pointer re-hovers next frame).
  for (const container of [
    bar.prev,
    bar.hint,
    bar.next,
    bar.recenter.container,
    bar.exit.container,
    bar.filter,
    bar.filterBack,
    bar.puzzles,
    bar.pickerBack,
  ]) {
    setTargetHover(container, false);
  }
  for (const chipButton of bar.filterChips) {
    setTargetHover(chipButton.container, false);
  }
  bar.pickerTiles.forEach((tile) => setTargetHover(tile.container, false, tileRest(tile.data)));
  setTargetHover(bar.clear, false, { color: COLOR_CLEAR_BORDER, width: CLEAR_BORDER_WIDTH });
  const where = open || picker ? null : contents.where;
  const showFilter = !open && !picker && where === null && contents.filter;
  const chips = picker ? [] : (contents.chips ?? []);
  const chipCount = Math.min(chips.length, bar.filterChips.length);

  // Chips on pages (more than fit at once): More, under them, turns the page.
  const more = open ? (contents.chipsMore ?? null) : null;
  bar.filterMore.setProperties({ display: more === null ? 'none' : 'flex' });
  if (more !== null) {
    bar.filterMoreText.setProperties({ text: more });
  }
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

  // The picker open: the bar is the grid's width, extended to the left; the
  // column's own items keep their places (shifted right by the extension).
  const totalWidth = picker ? Math.max(width, PICKER_WIDTH_CM) : width;
  const shift = totalWidth - width;
  bar.extendLeftMeters = shift / 100;
  bar.widthMeters = totalWidth / 100;
  bar.root.setProperties({ width: totalWidth });
  for (const container of [bar.prev, bar.next, bar.hint]) {
    container.setProperties({ display: picker ? 'none' : 'flex' });
  }
  bar.puzzles.setProperties(controlOptionStyle(picker !== null));
  bar.pickerBack.setProperties({ display: picker ? 'flex' : 'none' });
  bar.pickerLegend.setProperties({ display: picker ? 'flex' : 'none' });
  bar.pickerTiles.forEach((tile, i) => {
    const data = picker?.[i] ?? null;
    tile.data = data;
    tile.container.setProperties({ display: data ? 'flex' : 'none' });
    if (data) {
      applyTileLook(tile, data);
    }
  });

  // Rows, bottom to top: [items, height, gap above]. Each item: its button
  // (null: not a target), container, width, chip index and left edge (null:
  // the column's own left half or right half / full width); laid out left to right.
  type Item = { name: BarButton | null; container: Container | null; width: number; chip: number; left?: number };
  const pair = (left: Item, right: Item): Item[] => [left, right];
  const rows: [Item[], number, number][] = [
    [
      pair(
        { name: 'recenter', container: bar.recenter.container, width: half, chip: -1 },
        { name: 'exit', container: bar.exit.container, width: half, chip: -1 },
      ),
      buttonHeight,
      COLUMN_GAP_CM,
    ],
    // The room for INNER | LEFT (the join system places the control there).
    [[{ name: null, container: null, width, chip: -1 }], leadHeight, COLUMN_GAP_CM],
  ];
  if (picker) {
    rows.push([[{ name: 'puzzles', container: bar.puzzles, width, chip: -1 }], buttonHeight, COLUMN_GAP_CM]);
    // The legend, under the grid, its width.
    rows.push([[{ name: null, container: bar.pickerLegend, width: PICKER_WIDTH_CM, chip: -1, left: 0 }], pickerLegendHeightCm(label), COLUMN_GAP_CM]);
    // The tiles, bottom row first (17-20), four across from the bar's left edge; Back on top.
    for (let row = PICKER_ROWS - 1; row >= 0; row--) {
      const items: Item[] = [];
      for (let column = 0; column < PICKER_COLUMNS; column++) {
        const index = row * PICKER_COLUMNS + column;
        items.push({
          name: 'tile',
          container: bar.pickerTiles[index].container,
          width: PICKER_TILE_WIDTH_CM,
          chip: index,
          left: column * (PICKER_TILE_WIDTH_CM + PICKER_TILE_GAP_CM),
        });
      }
      rows.push([items, buttonHeight, row === 0 ? COLUMN_GAP_CM : PICKER_TILE_GAP_CM]);
    }
    rows.push([[{ name: 'pickerBack', container: bar.pickerBack, width: PICKER_WIDTH_CM, chip: -1, left: 0 }], buttonHeight, COLUMN_GAP_CM]);
  } else {
    // Puzzles right above INNER | LEFT, as when the picker is open: it never moves.
    rows.push(
      [[{ name: 'puzzles', container: bar.puzzles, width, chip: -1 }], buttonHeight, COLUMN_GAP_CM],
      [
        pair({ name: 'prev', container: bar.prev, width: half, chip: -1 }, { name: 'next', container: bar.next, width: half, chip: -1 }),
        buttonHeight,
        COLUMN_GAP_CM,
      ],
      [[{ name: 'hint', container: bar.hint, width, chip: -1 }], buttonHeight, COLUMN_GAP_CM],
    );
  }
  if (where !== null) {
    rows.push([[{ name: 'clear', container: bar.clear, width, chip: -1 }], buttonHeight, COLUMN_GAP_CM]);
    rows.push([[{ name: null, container: bar.chip, width, chip: -1 }], buttonHeight, COLUMN_GAP_CM]);
  } else if (showFilter) {
    rows.push([[{ name: 'filter', container: bar.filter, width, chip: -1 }], buttonHeight, COLUMN_GAP_CM]);
  } else if (open) {
    rows.push([[{ name: 'filterBack', container: bar.filterBack, width, chip: -1 }], buttonHeight, COLUMN_GAP_CM]);
    if (more !== null) {
      rows.push([[{ name: 'filterMore', container: bar.filterMore, width, chip: -1 }], buttonHeight, COLUMN_GAP_CM]);
    }
    // The page's chips above Back (and More), one per row, the first on top.
    for (let i = chipCount - 1; i >= 0; i--) {
      rows.push([[{ name: 'chip', container: bar.filterChips[i].container, width, chip: i }], buttonHeight, COLUMN_GAP_CM]);
    }
  }
  bar.filterChips.forEach((chipButton, i) => {
    const header = i < chipCount ? chips[i] : null;
    chipButton.container.setProperties({ display: header === null ? 'none' : 'flex' });
    if (header !== null) {
      chipButton.text.setProperties({
        text: truncateToWidth(BAR.filterChip(header), HEADER_METRICS, label, width - 2 * COLUMN_LABEL_MIN_PADDING_EM * label),
      });
    }
  });

  // Each row's height, and the gap between it and the row below.
  const heightCm = rows.reduce((sum, [, rowHeight, gap], i) => sum + rowHeight + (i > 0 ? gap : 0), 0);
  bar.root.setProperties({ height: heightCm });
  bar.heightMeters = heightCm / 100;

  bar.curved.length = 0;
  // Each item onto the arc, and the targets: x is the arc length of its
  // center from the left edge, y its row's middle (origin: the column's middle).
  // Listed top to bottom (reading order).
  bar.buttons.length = 0;
  const targets: BarButtonTarget[] = [];
  let bottom = 0;
  rows.forEach(([items, rowHeight, gap], rowIndex) => {
    if (rowIndex > 0) {
      bottom += gap;
    }
    const rowY = bottom + rowHeight / 2 - heightCm / 2;
    if (items.length === 1 && items[0].container === null) {
      bar.leadCenterYMeters = rowY / 100;
    }
    items.forEach((item, i) => {
      const center =
        item.left !== undefined ? item.left + item.width / 2 : shift + (i === 0 ? item.width / 2 : width - item.width / 2);
      if (item.container) {
        placeFlat(item.container, center, rowY, item.width, rowHeight, heightCm);
        curveOntoArc(bar, item.container, center, rowY);
      }
      if (item.name !== null) {
        targets.push({ name: item.name, centerX: center / 100, centerY: rowY / 100, width: item.width / 100, chip: item.chip });
      }
    });
    bottom += rowHeight;
  });
  targets.sort((p, q) => q.centerY - p.centerY || p.centerX - q.centerX);
  bar.buttons.push(...targets);
  // The hover labels: just below the column, centered under it, on the arc too.
  placeIconLabels(bar, [bar.recenter, bar.exit, bar.answerLabel], width, heightCm, shift);
}

/** A tile's resting border: today's daily keeps its accent outline (hover replaces it while hovered). */
function tileRest(data: PickerTileView | null): { color: string; width: number } | null {
  return data?.today ? { color: data.accent, width: PICKER_TODAY_BORDER_CM } : null;
}

/** A picker tile's look: the puzzle on the desk filled, with a dot; its status mark or "Today"; locked dimmed. */
function applyTileLook(tile: PuzzleBarView['pickerTiles'][number], data: PickerTileView): void {
  const style = controlOptionStyle(data.current);
  tile.container.setProperties({ ...style, opacity: data.selectable ? 1 : PICKER_LOCKED_OPACITY });
  setTargetHover(tile.container, false, tileRest(data));
  tile.number.setProperties({ text: String(data.number) });
  // The fill says "current" too; beside "Today" there's no room for the dot.
  tile.dot.setProperties({ display: data.current && !data.today ? 'flex' : 'none' });
  tile.icons.solved.setProperties({ display: !data.today && data.status === 'solved' ? 'flex' : 'none' });
  tile.icons.revealed.setProperties({ display: !data.today && data.status === 'revealed' ? 'flex' : 'none' });
  tile.icons.locked.setProperties({ display: !data.today && data.status === 'locked' ? 'flex' : 'none' });
  tile.today.setProperties({ display: data.today ? 'flex' : 'none' });
}

/** The hover labels (Recenter's, Exit's, Show answer's): centered just below the column (toward the slabs, never over the result). */
function placeIconLabels(band: ArcBand, views: readonly HoverLabelView[], widthCm: number, heightCm: number, shiftCm = 0): void {
  for (const view of views) {
    const y = -heightCm / 2 - COLUMN_GAP_CM - view.labelHeightCm / 2;
    placeFlat(view.label, shiftCm + widthCm / 2, y, view.labelWidthCm, view.labelHeightCm, heightCm);
    curveOntoArc(band, view.label, shiftCm + widthCm / 2, y);
  }
}

// --- Recenter (the bar's icon button, and free play's one-button bar) ---------------

/** The Recenter icon button and its hover label (absolute, above the button; never a target). */
/** A hover label: a dark pill just below the column, shown while its button is hovered (or held). */
export type HoverLabelView = {
  label: Container;
  labelWidthCm: number;
  labelHeightCm: number;
};

export type RecenterButtonView = HoverLabelView & {
  container: Container;
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
  return { container, ...hoverLabel(root, label, labelFontCm, fade) };
}

/** A hover label for `text`, as an absolute layer of `root` (hidden; placed by `placeIconLabels`). */
function hoverLabel(root: Container, label: string, labelFontCm: number, fade: Signal<number>): HoverLabelView {
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
  return { label: tag, labelWidthCm, labelHeightCm };
}

/** Shows or hides a hover label (Recenter's, Exit's, Show answer's: a fingertip or a hand's ray over the button, or held). */
export function setRecenterHover(view: HoverLabelView, hovered: boolean): void {
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
  placeIconLabels(band, [recenter, exit], widthCm, heightCm);
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
  return target ? barButtonContainer(bar, target.name, target.chip) : null;
}

/** A bar button's container by name (`index`: which chip or tile), for press feedback. */
export function barButtonContainer(bar: PuzzleBarView, name: BarButton, index: number): Container | null {
  const target = { name, chip: index };
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
    case 'filterMore':
      return bar.filterMore;
    case 'chip':
      return bar.filterChips[target.chip]?.container ?? null;
    case 'puzzles':
      return bar.puzzles;
    case 'pickerBack':
      return bar.pickerBack;
    case 'tile':
      return bar.pickerTiles[target.chip]?.container ?? null;
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
  const rest = (i: number) => {
    const target = bar.buttons[i];
    if (target?.name === 'tile') {
      return tileRest(bar.pickerTiles[target.chip]?.data ?? null);
    }
    return target?.name === 'clear' ? { color: COLOR_CLEAR_BORDER, width: CLEAR_BORDER_WIDTH } : null;
  };
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
