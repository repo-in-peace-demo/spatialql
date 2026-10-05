/**
 * Challenge mode's UIKit pieces, built imperatively like the slabs and sized
 * by angle:
 *
 * - the **puzzle card**: view only, above the result slot. A title line
 *   (with a short diff summary on the right), the goal (2 lines), and a
 *   message (up to 3 lines: an intro, a hint, or the win line). Fixed size,
 *   so changing its text never changes its layout.
 * - the **puzzle bar**: Hint, Next and the filter chip (`WHERE ... IS NULL
 *   Clear`), in the control band next to INNER | LEFT. Touch targets at
 *   least the control's option size.
 *
 * Origins are at their centers.
 */

import { computed, signal, UIKit, UIKitDocument, type Signal } from '@iwsdk/core';
// Only the four icons used, each from its own module, so the bundle doesn't
// pull in the whole icon set.
import { BookOpen } from '@pmndrs/uikit-lucide/dist/BookOpen.js';
import { Coffee } from '@pmndrs/uikit-lucide/dist/Coffee.js';
import { School } from '@pmndrs/uikit-lucide/dist/School.js';
import { ShoppingBag } from '@pmndrs/uikit-lucide/dist/ShoppingBag.js';
import type { DatasetIcon } from './data/datasets.js';
import {
  CONTROL_OPTION_MIN_HEIGHT_CM,
  CONTROL_OPTION_MIN_WIDTH_CM,
  controlOptionStyle,
  FONT_FAMILIES,
  measureHeaderTextCm,
} from './table-slab-view.js';
import {
  fontCmForAngle,
  HEADER_TEXT_TARGET_DEG,
  MIN_ROW_FONT_CM,
  PLANNED_CARD_DISTANCE_METERS,
  ROW_TEXT_TARGET_DEG,
} from './view-comfort.js';

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
/** The headline's size relative to the goal font (capped to fit the goal's two-line slot). */
const HEADLINE_SCALE = 1.8;
/** The dataset icon's size relative to the title text. */
const ICON_SCALE = 1.25;
/**
 * The card border's width: thicker than a slab's, so the dataset accent
 * reads. The padding gives up the same amount, so the card's height (and its
 * place in the view budget) doesn't change.
 */
const CARD_BORDER_CM = 0.3;
const PHASE2_CARD_BORDER_CM = 0.15;

// --- Puzzle card ------------------------------------------------------------------

/** Card width, in goal-font ems (~41 cm at the planned distance). */
const CARD_WIDTH_EM = 30;
const CARD_GOAL_LINES = 2;
const CARD_MESSAGE_LINES = 3;

export type PuzzleCardView = {
  document: UIKitDocument;
  fade: Signal<number>;
  root: Container;
  title: Text;
  /** Short diff summary, right of the title. */
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
  const goalFont = Math.max(MIN_ROW_FONT_CM, fontCmForAngle(HEADER_TEXT_TARGET_DEG, PLANNED_CARD_DISTANCE_METERS));
  const smallFont = Math.max(MIN_ROW_FONT_CM, fontCmForAngle(ROW_TEXT_TARGET_DEG, PLANNED_CARD_DISTANCE_METERS));
  const border = CARD_BORDER_CM;
  const padding = smallFont * 0.8 - (CARD_BORDER_CM - PHASE2_CARD_BORDER_CM);
  const gap = smallFont * 0.4;
  const widthCm = CARD_WIDTH_EM * goalFont;
  const titleHeight = smallFont * LINE_HEIGHT_FACTOR;
  const goalHeight = CARD_GOAL_LINES * goalFont * LINE_HEIGHT_FACTOR;
  const messageHeight = CARD_MESSAGE_LINES * smallFont * LINE_HEIGHT_FACTOR;
  const heightCm = 2 * (padding + border) + titleHeight + goalHeight + messageHeight + 2 * gap;

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
    justifyContent: 'space-between',
    alignItems: 'center',
    height: titleHeight,
    flexShrink: 0,
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
  titleRow.add(titleGroup, status);

  const block = (height: number) =>
    new UIKit.Container({ flexDirection: 'column', height, flexShrink: 0, overflow: 'hidden' });
  const goalBlock = block(goalHeight);
  const goal = new UIKit.Text({ text: '', fontSize: goalFont, fontWeight: 'bold', color: COLOR_TEXT });
  // On a win, the headline takes the goal's two-line slot (the card can't grow).
  const headline = new UIKit.Text({
    text: '',
    fontSize: Math.min(goalFont * HEADLINE_SCALE, goalHeight / LINE_HEIGHT_FACTOR),
    fontWeight: 'bold',
    color: COLOR_HEADLINE,
    wordBreak: 'keep-all',
    display: 'none',
  });
  goalBlock.add(goal, headline);
  const messageBlock = block(messageHeight);
  const message = new UIKit.Text({ text: '', fontSize: smallFont, color: COLOR_TEXT });
  // On a win: the query line (pointing to the caption) and an optional note, each one line.
  const query = new UIKit.Text({ text: '', fontSize: smallFont, fontWeight: 'bold', color: COLOR_TEXT, display: 'none' });
  const note = new UIKit.Text({ text: '', fontSize: smallFont, color: COLOR_TEXT_SECONDARY, display: 'none' });
  messageBlock.add(message, query, note);

  root.add(titleRow, goalBlock, messageBlock);
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

/** The win's three parts; `note` is an optional extra line (e.g. "More puzzles soon."). */
export type CardWin = { headline: string; takeaway: string; query: string; note: string | null };

/**
 * The card's won look: a warm fill and border (a coarse change, readable at
 * a glance), the headline in place of the goal, then the takeaway and the
 * query line. Null restores the playing look (the goal; the message empty).
 */
export function setCardWin(card: PuzzleCardView, win: CardWin | null): void {
  card.root.setProperties({
    backgroundColor: win ? COLOR_CARD_WON : COLOR_CARD,
    borderColor: win ? COLOR_CARD_BORDER_WON : card.accent,
  });
  card.goal.setProperties({ display: win ? 'none' : 'flex' });
  card.headline.setProperties({ display: win ? 'flex' : 'none', text: win?.headline ?? '' });
  card.message.setProperties({ text: win?.takeaway ?? '' });
  card.query.setProperties({ display: win ? 'flex' : 'none', text: win?.query ?? '' });
  card.note.setProperties({ display: win?.note ? 'flex' : 'none', text: win?.note ?? '' });
}

// --- Puzzle bar ---------------------------------------------------------------------

/** The bar's touch targets. The filter chip's WHERE label isn't one; its Clear button is. */
export type BarButton = 'hint' | 'next' | 'clear';

/** One bar button's target in the bar's frame (meters); all share `buttonHeightMeters`. */
export type BarButtonTarget = { name: BarButton; centerX: number; width: number };

export type PuzzleBarView = {
  document: UIKitDocument;
  fade: Signal<number>;
  root: Container;
  hint: Container;
  next: Container;
  /** The filter chip's label (the WHERE clause): not a target. */
  chip: Container;
  chipText: Text;
  /** The chip's Clear button: its own pill and target. */
  clear: Container;
  /** Opacity of the Next button (pulses once the puzzle is won). */
  nextOpacity: Signal<number>;
  /** Current size: the bar is only as wide as its buttons (see `setBarChip`). */
  widthMeters: number;
  heightMeters: number;
  /** The buttons shown, left to right (Clear only while a filter is set). Updated in place. */
  buttons: BarButtonTarget[];
  buttonHeightMeters: number;
  /** Internal sizing (cm). */
  sizes: { hint: number; next: number; clear: number; label: number; paddingX: number };
};

const BAR_PADDING = 0.3;
const BAR_BORDER = 0.15;
const BAR_RADIUS = 1.4;
const BAR_INSET = BAR_PADDING + BAR_BORDER;
// Next while unavailable: clearly off (light fill, no accent), but readable
// (mid-dark text, ~5:1 contrast on its fill).
const COLOR_DISABLED_FILL = '#ece7db';
const COLOR_DISABLED_TEXT = '#655d4f';
/** The chip's Clear pill: a light fill with a firm border, so it reads as its own button. */
const COLOR_CLEAR_BORDER = '#6b6355';
const NEXT_WAITING_OPACITY = 0.7;
const CLEAR_BORDER_WIDTH = 0.15;

/** `labelFontCm`: the label size (the control's, sized by angle by the caller). */
export function buildPuzzleBar(
  labelFontCm: number,
  labels: { hint: string; next: string; clear: string },
): PuzzleBarView {
  const paddingX = labelFontCm * 0.6;
  const buttonHeight = Math.max(CONTROL_OPTION_MIN_HEIGHT_CM, labelFontCm * LINE_HEIGHT_FACTOR);
  const hintWidth = barButtonWidth(labels.hint, labelFontCm, paddingX);
  const nextWidth = barButtonWidth(labels.next, labelFontCm, paddingX);
  const clearWidth = barButtonWidth(labels.clear, labelFontCm, paddingX);
  const heightCm = buttonHeight + 2 * BAR_INSET;

  const fade = signal(1);
  const nextOpacity = signal(1);
  const root = new UIKit.Container({
    flexDirection: 'row',
    width: hintWidth + nextWidth + BAR_PADDING + 2 * BAR_INSET,
    height: heightCm,
    anchorX: 'center',
    anchorY: 'center',
    opacity: fade,
    fontFamilies: FONT_FAMILIES,
    backgroundColor: COLOR_BAR_TRACK,
    borderColor: COLOR_CARD_BORDER,
    borderTopWidth: BAR_BORDER,
    borderLeftWidth: BAR_BORDER,
    borderRightWidth: BAR_BORDER,
    borderBottomWidth: BAR_BORDER,
    borderTopLeftRadius: BAR_RADIUS,
    borderTopRightRadius: BAR_RADIUS,
    borderBottomLeftRadius: BAR_RADIUS,
    borderBottomRightRadius: BAR_RADIUS,
    paddingTop: BAR_PADDING,
    paddingBottom: BAR_PADDING,
    paddingLeft: BAR_PADDING,
    paddingRight: BAR_PADDING,
    gapColumn: BAR_PADDING,
  });
  const button = (label: string, width: number, selected: boolean, opacity: Signal<number> | null) => {
    const style = controlOptionStyle(selected);
    const container = new UIKit.Container({
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
      ...(opacity ? { opacity: computed(() => opacity.value * fade.value) } : {}),
    });
    const text = new UIKit.Text({ text: label, fontSize: labelFontCm, fontWeight: 'bold', wordBreak: 'keep-all' });
    container.add(text);
    root.add(container);
    return { container, text };
  };
  const hint = button(labels.hint, hintWidth, false, null);
  const next = button(labels.next, nextWidth, true, nextOpacity);
  // The filter chip: the WHERE clause as a flat label on the track (no fill,
  // regular weight: it reads as the filter's text, not a button), then its
  // own Clear button, a bordered pill.
  const chip = button('', CONTROL_OPTION_MIN_WIDTH_CM, false, null);
  chip.container.setProperties({ display: 'none', backgroundColor: COLOR_BAR_TRACK, color: COLOR_TEXT_SECONDARY });
  chip.text.setProperties({ fontWeight: 'normal' });
  const clear = button(labels.clear, clearWidth, false, null);
  clear.container.setProperties({
    display: 'none',
    backgroundColor: COLOR_CARD,
    borderColor: COLOR_CLEAR_BORDER,
    borderTopWidth: CLEAR_BORDER_WIDTH,
    borderLeftWidth: CLEAR_BORDER_WIDTH,
    borderRightWidth: CLEAR_BORDER_WIDTH,
    borderBottomWidth: CLEAR_BORDER_WIDTH,
  });

  const bar: PuzzleBarView = {
    document: new UIKitDocument(root),
    fade,
    root,
    hint: hint.container,
    next: next.container,
    chip: chip.container,
    chipText: chip.text,
    clear: clear.container,
    nextOpacity,
    widthMeters: 0,
    heightMeters: heightCm / 100,
    buttons: [],
    buttonHeightMeters: buttonHeight / 100,
    sizes: { hint: hintWidth, next: nextWidth, clear: clearWidth, label: labelFontCm, paddingX },
  };
  setBarChip(bar, null);
  return bar;
}

function barButtonWidth(label: string, labelFontCm: number, paddingX: number): number {
  return Math.max(CONTROL_OPTION_MIN_WIDTH_CM, measureHeaderTextCm(label, labelFontCm) + 2 * paddingX);
}

/**
 * Shows the filter chip with the WHERE clause `where` and its Clear button
 * (or hides both with null) and resizes the bar to its contents; updates
 * `widthMeters` and `buttons` in place. The caller re-places the bar
 * afterwards (its center moves with its width).
 */
export function setBarChip(bar: PuzzleBarView, where: string | null): void {
  const { hint, next, clear, label, paddingX } = bar.sizes;
  // The label needs no minimum width (it isn't a target), only its padding.
  const labelWidth = where === null ? 0 : measureHeaderTextCm(where, label) + 2 * paddingX;
  if (where === null) {
    bar.chip.setProperties({ display: 'none' });
    bar.clear.setProperties({ display: 'none' });
  } else {
    bar.chipText.setProperties({ text: where });
    bar.chip.setProperties({ display: 'flex', width: labelWidth, minWidth: labelWidth });
    bar.clear.setProperties({ display: 'flex' });
  }
  const chipSpan = where === null ? 0 : 2 * BAR_PADDING + labelWidth + clear;
  const widthCm = hint + next + BAR_PADDING + chipSpan + 2 * BAR_INSET;
  bar.root.setProperties({ width: widthCm });
  bar.widthMeters = widthCm / 100;

  // Target centers, left to right, in the bar's frame (origin at its center).
  const left = -widthCm / 2 + BAR_INSET;
  bar.buttons.length = 0;
  bar.buttons.push(
    { name: 'hint', centerX: (left + hint / 2) / 100, width: hint / 100 },
    { name: 'next', centerX: (left + hint + BAR_PADDING + next / 2) / 100, width: next / 100 },
  );
  if (where !== null) {
    bar.buttons.push({
      name: 'clear',
      centerX: (left + hint + next + labelWidth + 3 * BAR_PADDING + clear / 2) / 100,
      width: clear / 100,
    });
  }
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

/** Next's look: the accent style while available; a light, clearly-off but readable style while not. */
export function setNextAvailable(bar: PuzzleBarView, available: boolean): void {
  bar.next.setProperties(
    available ? controlOptionStyle(true) : { backgroundColor: COLOR_DISABLED_FILL, color: COLOR_DISABLED_TEXT },
  );
  if (!available) {
    bar.nextOpacity.value = 1;
  }
}
