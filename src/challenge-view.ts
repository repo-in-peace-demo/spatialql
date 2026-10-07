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
import { School } from '@pmndrs/uikit-lucide/dist/School.js';
import { ShoppingBag } from '@pmndrs/uikit-lucide/dist/ShoppingBag.js';
import { CARD_GOAL_LINES, CARD_MESSAGE_LINES, cardMetrics } from './card-metrics.js';
import type { DatasetIcon } from './data/datasets.js';
import {
  BAR_BORDER_CM,
  BAR_BUTTON_PADDING_EM,
  BAR_PADDING_CM,
  barButtonWidthCm,
  barRowWidthCm,
  MAX_FILTER_CHIPS,
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
/** The headline's size relative to the goal font (capped to fit the goal's two-line slot). */
const HEADLINE_SCALE = 1.8;
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
    fontSize: Math.min(goalFont * HEADLINE_SCALE, goalHeight / LINE_HEIGHT_FACTOR),
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
export type BarButton = 'prev' | 'hint' | 'next' | 'recenter' | 'clear' | 'filter' | 'filterBack' | 'chip';

/**
 * One bar button's target in the bar's frame (meters); all share
 * `buttonHeightMeters`. `chip`: which chip (its index), or -1.
 */
export type BarButtonTarget = { name: BarButton; centerX: number; width: number; chip: number };

export { MAX_FILTER_CHIPS };

/**
 * What the bar shows:
 * - playing: Prev, Hint, Next, Recenter (an icon), then either the filter's label and Clear
 *   (`where` set), or Filter (`filter`: the result has NULLs), or nothing;
 * - the chips open (`chips` not null): Back, then one chip per label.
 */
export type BarContents = { where: string | null; filter: boolean; chips: readonly string[] | null };

export type PuzzleBarView = {
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
  /** Opacity of the Next button (pulses once the puzzle is won). */
  nextOpacity: Signal<number>;
  /** Current size: the bar is only as wide as its buttons (see `setBarContents`). */
  widthMeters: number;
  heightMeters: number;
  /** The buttons shown, left to right. Updated in place. */
  buttons: BarButtonTarget[];
  buttonHeightMeters: number;
  /** Internal sizing (cm). */
  sizes: {
    prev: number;
    hint: number;
    next: number;
    recenter: number;
    clear: number;
    filter: number;
    back: number;
    label: number;
    paddingX: number;
  };
};

const BAR_PADDING = BAR_PADDING_CM;
const BAR_BORDER = BAR_BORDER_CM;
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
    clear: string;
    filter: string;
    filterBack: string;
  },
): PuzzleBarView {
  const paddingX = labelFontCm * BAR_BUTTON_PADDING_EM;
  const buttonHeight = Math.max(CONTROL_OPTION_MIN_HEIGHT_CM, labelFontCm * LINE_HEIGHT_FACTOR);
  const prevWidth = barButtonWidthCm([labels.prev], labelFontCm);
  const hintWidth = barButtonWidthCm(labels.hint, labelFontCm);
  const nextWidth = barButtonWidthCm(labels.next, labelFontCm);
  const clearWidth = barButtonWidthCm([labels.clear], labelFontCm);
  const filterWidth = barButtonWidthCm([labels.filter], labelFontCm);
  const backWidth = barButtonWidthCm([labels.filterBack], labelFontCm);
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
  // Prev first (left end), so the bar reads Prev, Hint, Next.
  const prev = button(labels.prev, prevWidth, false, null);
  const hint = button(labels.hint[0] ?? '', hintWidth, false, null);
  const next = button(labels.next[0] ?? '', nextWidth, true, nextOpacity);
  // Recenter: an icon at the minimum target size, its label above it on hover.
  const recenter = recenterButton(root, labelFontCm, buttonHeight, labels.recenter, fade);
  // The filter chip: the WHERE clause as a flat label on the track (no fill,
  // regular weight: it reads as the filter's text, not a button), then its
  // own Clear button, a bordered pill.
  const whereOpacity = signal(1);
  const chip = button('', CONTROL_OPTION_MIN_WIDTH_CM, false, whereOpacity);
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
  // Filter, then (while open) Back and the chips: plain buttons like Hint.
  const filter = button(labels.filter, filterWidth, false, null);
  filter.container.setProperties({ display: 'none' });
  const back = button(labels.filterBack, backWidth, false, null);
  back.container.setProperties({ display: 'none' });
  const filterChips: { container: Container; text: Text }[] = [];
  for (let i = 0; i < MAX_FILTER_CHIPS; i++) {
    const chipButton = button('', CONTROL_OPTION_MIN_WIDTH_CM, false, null);
    chipButton.container.setProperties({ display: 'none' });
    filterChips.push(chipButton);
  }

  const bar: PuzzleBarView = {
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
    nextOpacity,
    widthMeters: 0,
    heightMeters: heightCm / 100,
    buttons: [],
    buttonHeightMeters: buttonHeight / 100,
    sizes: {
      prev: prevWidth,
      hint: hintWidth,
      next: nextWidth,
      recenter: CONTROL_OPTION_MIN_WIDTH_CM,
      clear: clearWidth,
      filter: filterWidth,
      back: backWidth,
      label: labelFontCm,
      paddingX,
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
 * Shows `contents` (see `BarContents`) and resizes the bar to them; updates
 * `widthMeters` and `buttons` in place. Runs only when the contents change,
 * never per frame. The caller re-places the bar afterwards (its center moves
 * with its width).
 */
export function setBarContents(bar: PuzzleBarView, contents: BarContents): void {
  const { prev, hint, next, recenter, clear, filter, back, label, paddingX } = bar.sizes;
  const open = contents.chips !== null;
  // The targets change: no hover outline survives (the pointer re-hovers next frame).
  for (const container of [bar.prev, bar.hint, bar.next, bar.recenter.container, bar.filter, bar.filterBack]) {
    setTargetHover(container, false);
  }
  for (const chipButton of bar.filterChips) {
    setTargetHover(chipButton.container, false);
  }
  setTargetHover(bar.clear, false, { color: COLOR_CLEAR_BORDER, width: CLEAR_BORDER_WIDTH });
  const where = open ? null : contents.where;
  const showFilter = !open && where === null && contents.filter;
  const chips = contents.chips ?? [];

  bar.prev.setProperties({ display: open ? 'none' : 'flex' });
  bar.hint.setProperties({ display: open ? 'none' : 'flex' });
  bar.next.setProperties({ display: open ? 'none' : 'flex' });
  bar.recenter.container.setProperties({ display: open ? 'none' : 'flex' });
  if (open) {
    setRecenterHover(bar.recenter, false);
  }
  // The WHERE label needs no minimum width (it isn't a target), only its padding.
  const labelWidth = where === null ? 0 : measureHeaderTextCm(where, label) + 2 * paddingX;
  if (where === null) {
    bar.chip.setProperties({ display: 'none' });
    bar.clear.setProperties({ display: 'none' });
  } else {
    bar.chipText.setProperties({ text: where });
    bar.chip.setProperties({ display: 'flex', width: labelWidth, minWidth: labelWidth });
    bar.clear.setProperties({ display: 'flex' });
  }
  bar.filter.setProperties({ display: showFilter ? 'flex' : 'none' });
  bar.filterBack.setProperties({ display: open ? 'flex' : 'none' });

  // The items shown, left to right, in the children's order (hidden ones take no space or gap).
  const items: { name: BarButton | null; width: number; chip: number }[] = [];
  if (!open) {
    items.push(
      { name: 'prev', width: prev, chip: -1 },
      { name: 'hint', width: hint, chip: -1 },
      { name: 'next', width: next, chip: -1 },
      { name: 'recenter', width: recenter, chip: -1 },
    );
    if (where !== null) {
      items.push({ name: null, width: labelWidth, chip: -1 }, { name: 'clear', width: clear, chip: -1 });
    } else if (showFilter) {
      items.push({ name: 'filter', width: filter, chip: -1 });
    }
  } else {
    items.push({ name: 'filterBack', width: back, chip: -1 });
  }
  bar.filterChips.forEach((chipButton, i) => {
    const text = i < chips.length ? chips[i] : null;
    if (text === null) {
      chipButton.container.setProperties({ display: 'none' });
      return;
    }
    const width = barButtonWidthCm([text], label);
    chipButton.text.setProperties({ text });
    chipButton.container.setProperties({ display: 'flex', width, minWidth: width });
    items.push({ name: 'chip', width, chip: i });
  });

  const widthCm = barRowWidthCm(items.map((item) => item.width));
  bar.root.setProperties({ width: widthCm });
  bar.widthMeters = widthCm / 100;

  // Target centers, left to right, in the bar's frame (origin at its center).
  let cursor = -widthCm / 2 + BAR_INSET;
  bar.buttons.length = 0;
  for (const item of items) {
    if (item.name !== null) {
      bar.buttons.push({ name: item.name, centerX: (cursor + item.width / 2) / 100, width: item.width / 100, chip: item.chip });
    }
    if (item.name === 'recenter') {
      // Its hover label, centered above it (offsets from the bar's padding box).
      placeRecenterLabel(bar.recenter, cursor + item.width / 2 + widthCm / 2 - BAR_BORDER);
    }
    cursor += item.width + BAR_PADDING;
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

/** Builds the icon button into `root` (a row) and its label as an absolute layer of `root`. */
function recenterButton(
  root: Container,
  labelFontCm: number,
  buttonHeight: number,
  label: string,
  fade: Signal<number>,
): RecenterButtonView {
  const style = controlOptionStyle(false);
  const container = new UIKit.Container({
    width: CONTROL_OPTION_MIN_WIDTH_CM,
    minWidth: CONTROL_OPTION_MIN_WIDTH_CM,
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
  container.add(new LocateFixed({ width: iconSize, height: iconSize, color: style.color }));
  root.add(container);

  const labelWidthCm = measureHeaderTextCm(label, labelFontCm) + 2 * labelFontCm * BAR_BUTTON_PADDING_EM;
  const labelHeightCm = labelFontCm * LINE_HEIGHT_FACTOR + labelFontCm * 0.3;
  const tag = new UIKit.Container({
    positionType: 'absolute',
    positionTop: -labelHeightCm - BAR_PADDING,
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

/** Centers the hover label over the button whose center is `centerFromLeftCm` from the parent's padding box's left edge. */
function placeRecenterLabel(view: RecenterButtonView, centerFromLeftCm: number): void {
  view.label.setProperties({ positionLeft: centerFromLeftCm - view.labelWidthCm / 2 });
}

/** Shows or hides the Recenter label (a fingertip or a hand's ray over the button). */
export function setRecenterHover(view: RecenterButtonView, hovered: boolean): void {
  view.label.setProperties({ display: hovered ? 'flex' : 'none' });
}

/** Free play's one-button bar: only Recenter (there's no puzzle bar). Origin at its center. */
export type RecenterBarView = {
  document: UIKitDocument;
  fade: Signal<number>;
  recenter: RecenterButtonView;
  widthMeters: number;
  heightMeters: number;
  buttonWidthMeters: number;
  buttonHeightMeters: number;
};

export function buildRecenterBar(labelFontCm: number, label: string): RecenterBarView {
  const buttonHeight = Math.max(CONTROL_OPTION_MIN_HEIGHT_CM, labelFontCm * LINE_HEIGHT_FACTOR);
  const widthCm = barRowWidthCm([CONTROL_OPTION_MIN_WIDTH_CM]);
  const heightCm = buttonHeight + 2 * BAR_INSET;
  const fade = signal(1);
  const root = new UIKit.Container({
    flexDirection: 'row',
    width: widthCm,
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
  });
  const recenter = recenterButton(root, labelFontCm, buttonHeight, label, fade);
  placeRecenterLabel(recenter, widthCm / 2 - BAR_BORDER);
  return {
    document: new UIKitDocument(root),
    fade,
    recenter,
    widthMeters: widthCm / 100,
    heightMeters: heightCm / 100,
    buttonWidthMeters: CONTROL_OPTION_MIN_WIDTH_CM / 100,
    buttonHeightMeters: buttonHeight / 100,
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
