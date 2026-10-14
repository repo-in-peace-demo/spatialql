/**
 * The welcome page: plain HTML over the canvas (styles in welcome.css), so
 * its text is drawn by the browser at the display's resolution, crisp in the
 * Quest Browser, and it lays itself out for the window. It shows outside XR
 * only; PanelSystem owns when, and what its buttons do.
 *
 * Challenge mode: the brand (mark, title, tagline, dataset icons), the setup
 * line, Start, then today's puzzle, the streak and its four-week calendar and
 * practice progress, and quieter Choose puzzle and Reset progress. Choose
 * puzzle shows the picker in place of the progress lines. Free play is
 * dormant (dev only, `?mode=free`): the brand, Start and a Puzzles button.
 */

import './welcome.css';
import { FREE_PLAY_DORMANT, WELCOME } from './data/copy.js';
import { DATASET_IDS, DATASETS } from './data/datasets.js';
import type { CalendarCell, CalendarMonth, PuzzleTile, WelcomeLines } from './data/daily-flow.js';
import type { DatasetIcon } from './data/datasets.js';
import { getPuzzle, type PuzzleId } from './data/puzzles.js';
import { WELCOME_ICONS, WELCOME_MARK_SVG, type WelcomeIcon } from './welcome-icons.js';


const DATASET_ICON: Record<DatasetIcon, WelcomeIcon> = {
  'shopping-bag': 'shop',
  'book-open': 'library',
  school: 'school',
  coffee: 'cafe',
};

/** An element with a class and, optionally, text. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

/** A Lucide icon (aria-hidden) from welcome-icons.ts. */
function icon(name: WelcomeIcon): Element {
  const holder = document.createElement('span');
  holder.innerHTML = WELCOME_ICONS[name];
  return holder.firstElementChild as Element;
}

function button(className: string, text: string): HTMLButtonElement {
  const element = el('button', className, text);
  element.type = 'button';
  return element;
}

/** Shows or hides an element (the `hidden` attribute; welcome.css keeps it hidden). */
function show(element: HTMLElement, shown: boolean): void {
  element.hidden = !shown;
}

export type WelcomeActions = {
  start(): void;
  pick(id: PuzzleId): void;
  /** The picked tile tapped again: no pick (Start opens what it would have). */
  unpick(): void;
  reset(): void;
  /** Dormant free play (dev only): back to the puzzles. */
  puzzles(): void;
};

type TileView = { button: HTMLButtonElement; number: HTMLElement; marks: HTMLElement; data: PuzzleTile | null };

export class WelcomePage {
  readonly root = el('div', 'wl-root');
  private readonly card = el('main', 'wl-card');
  private readonly startButton = button('wl-start', WELCOME.start);
  private readonly startLabel = el('span', '', WELCOME.start);
  private readonly side = el('section', 'wl-side');
  private readonly progress = el('div', 'wl-progress');
  private readonly daily = el('p', 'wl-daily');
  private readonly streak = el('p', 'wl-streak');
  private readonly streakText = el('span', '');
  private readonly calendar = el('div', 'wl-cal');
  private readonly monthTitle = el('span', 'wl-month');
  private readonly prevMonth = button('wl-arrow', '');
  private readonly nextMonth = button('wl-arrow', '');
  private readonly weeks = el('div', 'wl-weeks');
  /** This month first, then earlier ones (calendarMonths); the one shown. */
  private months: readonly CalendarMonth[] = [];
  private monthIndex = 0;
  private readonly practice = el('p', 'wl-practice');
  private readonly save = el('p', 'wl-save');
  private readonly picker = el('div', 'wl-picker');
  /** Under the picker: each tile mark and what it means (as the in-XR picker's legend). */
  private readonly legend = el('div', 'wl-legend');
  private readonly tiles: TileView[] = [];
  private readonly more = el('nav', 'wl-more');
  private readonly chooseButton = button('', WELCOME.choosePuzzle);
  private readonly backButton = button('', WELCOME.pickerBack);
  private readonly resetLink = button('wl-link', WELCOME.resetLink);
  private readonly confirmText = el('p', 'wl-confirm-text', WELCOME.resetQuestion);
  private readonly cancelButton = button('', WELCOME.resetCancel);
  private readonly confirmButton = button('wl-danger', WELCOME.resetConfirm);
  private pickerOpen = false;
  private confirmOpen = false;

  constructor(
    private readonly challenge: boolean,
    private readonly actions: WelcomeActions,
  ) {
    this.root.id = 'spatialql-welcome';
    this.card.setAttribute('aria-label', WELCOME.title);
    this.buildBrand();
    const setup = el('p', 'wl-setup', challenge ? WELCOME.setup : FREE_PLAY_DORMANT.description);
    this.startButton.textContent = '';
    this.startButton.append(icon('goggles'), this.startLabel);
    this.startButton.addEventListener('click', () => this.actions.start());
    this.card.append(setup, this.startButton);
    if (challenge) {
      this.card.classList.add('wl-two');
      this.buildSide();
      this.buildMore();
      this.card.append(this.side, this.more);
    } else {
      this.startLabel.textContent = FREE_PLAY_DORMANT.start;
      const puzzles = button('', FREE_PLAY_DORMANT.puzzles);
      puzzles.addEventListener('click', () => this.actions.puzzles());
      this.more.append(puzzles);
      this.card.append(this.more);
    }
    this.root.append(this.card);
  }

  /** Adds the page to the document (once). */
  mount(): void {
    if (!this.root.isConnected) {
      document.body.append(this.root);
    }
  }

  setShown(shown: boolean): void {
    show(this.root, shown);
  }

  /** No XR (the unsupported notice covers the page): the brand only, no buttons. */
  setXrAvailable(available: boolean): void {
    show(this.startButton, available);
    show(this.more, available);
  }

  private buildBrand(): void {
    const brand = el('section', 'wl-brand');
    const row = el('div', 'wl-brandrow');
    row.innerHTML = WELCOME_MARK_SVG;
    row.append(el('h1', 'wl-title', WELCOME.title));
    brand.append(row);
    if (!this.challenge) {
      brand.append(el('p', 'wl-tagline', FREE_PLAY_DORMANT.heading));
    }
    brand.append(el('p', 'wl-tagline', WELCOME.description));
    const datasets = el('div', 'wl-datasets');
    datasets.setAttribute('role', 'img');
    datasets.setAttribute('aria-label', WELCOME.datasetsLabel);
    for (const id of DATASET_IDS) {
      const tile = el('span', 'wl-ds');
      tile.style.background = DATASETS[id].theme.accent;
      tile.append(icon(DATASET_ICON[DATASETS[id].theme.icon]));
      datasets.append(tile);
    }
    brand.append(datasets);
    this.card.append(brand);
  }

  /** Today's puzzle, the streak, the calendar, practice; and the picker in their place when open. */
  private buildSide(): void {
    this.streak.append(icon('flame'), this.streakText);
    // The month, with arrows to an earlier month the history covers and back.
    const monthRow = el('div', 'wl-monthrow');
    this.prevMonth.append(icon('prev'));
    this.nextMonth.append(icon('next'));
    this.prevMonth.setAttribute('aria-label', WELCOME.previousMonth);
    this.nextMonth.setAttribute('aria-label', WELCOME.nextMonth);
    this.prevMonth.addEventListener('click', () => this.showMonth(this.monthIndex + 1));
    this.nextMonth.addEventListener('click', () => this.showMonth(this.monthIndex - 1));
    monthRow.append(this.prevMonth, this.monthTitle, this.nextMonth);
    const header = el('div', 'wl-calrow');
    for (const initial of WELCOME.weekdays) {
      header.append(el('span', 'wl-wd', initial));
    }
    header.setAttribute('aria-hidden', 'true');
    this.weeks.setAttribute('role', 'img');
    this.calendar.append(monthRow, header, this.weeks);
    this.progress.append(this.daily, this.streak, this.calendar, this.practice, this.save);
    this.picker.setAttribute('role', 'group');
    this.picker.setAttribute('aria-label', WELCOME.pickerLabel);
    show(this.picker, false);
    this.buildLegend();
    show(this.legend, false);
    this.side.append(this.progress, this.picker, this.legend);
  }

  private buildMore(): void {
    show(this.backButton, false);
    show(this.confirmText, false);
    show(this.cancelButton, false);
    show(this.confirmButton, false);
    this.confirmText.setAttribute('role', 'alert');
    this.chooseButton.addEventListener('click', () => this.setPickerOpen(true));
    this.backButton.addEventListener('click', () => this.setPickerOpen(false));
    this.resetLink.addEventListener('click', () => this.setConfirmOpen(true));
    this.cancelButton.addEventListener('click', () => this.setConfirmOpen(false));
    this.confirmButton.addEventListener('click', () => this.actions.reset());
    this.more.append(this.confirmText, this.chooseButton, this.backButton, this.resetLink, this.cancelButton, this.confirmButton);
  }

  /** The progress lines and calendar, from welcomeLines (challenge mode). */
  fillProgress(lines: WelcomeLines): void {
    this.daily.textContent = lines.daily;
    show(this.streak, lines.streak !== null);
    this.streakText.textContent = lines.streak ?? '';
    this.streak.classList.toggle('wl-on', lines.streakDays > 0);
    this.months = lines.months;
    this.showMonth(0);
    this.practice.textContent = lines.practice;
    show(this.save, lines.save !== null);
    this.save.textContent = lines.save ?? '';
  }

  /**
   * Shows month `index` (0: this month). The back arrow is always there,
   * greyed out and disabled while no earlier month has history; the forward
   * arrow only on an earlier month (never past this one).
   */
  private showMonth(index: number): void {
    const month = this.months[index];
    if (!month) {
      return;
    }
    this.monthIndex = index;
    this.prevMonth.disabled = index + 1 >= this.months.length;
    this.nextMonth.style.visibility = index > 0 ? 'visible' : 'hidden';
    const title = WELCOME.monthTitle(month.year, month.month);
    this.monthTitle.textContent = title;
    this.fillWeeks(month.cells, title);
  }

  /**
   * Each day: solved (accent fill, a check), done with the answer (a light
   * fill, an eye), missed (an outline and its date), before the history or
   * today with nothing yet (plain: its date), still to come (a faint date);
   * today ringed; cells outside the month empty. Shapes and marks, not
   * colour alone.
   */
  private fillWeeks(cells: readonly CalendarCell[], title: string): void {
    let solved = 0;
    let revealed = 0;
    const rows: HTMLElement[] = [];
    cells.forEach((cell, index) => {
      if (index % 7 === 0) {
        rows.push(el('div', 'wl-calrow'));
      }
      const day = el('span', `wl-day wl-${cell.state}${cell.today ? ' wl-today' : ''}`);
      if (cell.state === 'solved') {
        solved++;
        day.append(icon('check'));
      } else if (cell.state === 'revealed') {
        revealed++;
        day.append(icon('eye'));
      } else if (cell.day !== null) {
        day.textContent = String(new Date(cell.day * 86_400_000).getUTCDate());
      }
      rows[rows.length - 1].append(day);
    });
    this.weeks.replaceChildren(...rows);
    this.weeks.setAttribute('aria-label', WELCOME.calendarLabel(title, solved, revealed));
  }

  /** The picker's tiles from the latest progress; `picked` is filled and names Start. */
  fillPicker(tiles: readonly PuzzleTile[], picked: PuzzleId | null): void {
    tiles.forEach((data, index) => {
      const view = this.tiles[index] ?? this.addTile();
      view.data = data;
      const accent = DATASETS[getPuzzle(data.id).datasetId].theme.accent;
      const isPicked = picked === data.id;
      view.button.style.setProperty('--wl-tile-accent', accent);
      view.button.classList.toggle('wl-today-tile', data.today);
      view.button.classList.toggle('wl-picked', isPicked);
      view.button.disabled = !data.selectable;
      view.button.setAttribute('aria-pressed', String(isPicked));
      view.button.setAttribute('aria-label', WELCOME.tileLabel(data.number, data.status, data.today));
      view.number.textContent = String(data.number);
      view.marks.replaceChildren();
      // The picked tile: a dot before its mark (its fill says it too; beside "Today" there's no room).
      if (isPicked && !data.today) {
        view.marks.append(el('span', 'wl-dot'));
      }
      if (data.today) {
        this.legend.style.setProperty('--wl-legend-today', accent);
        view.marks.textContent = WELCOME.pickerToday;
      } else if (data.status === 'solved') {
        view.marks.append(icon('check'));
      } else if (data.status === 'revealed') {
        view.marks.append(icon('eye'));
      } else if (data.status === 'locked') {
        view.marks.append(icon('lock'));
      }
    });
    const number = picked ? tiles.findIndex((tile) => tile.id === picked) + 1 : 0;
    this.startLabel.textContent = number > 0 ? WELCOME.startPuzzle(number) : WELCOME.start;
  }

  /** The legend's two lines: each mark as the tiles show it, then its words (copy.ts). */
  private buildLegend(): void {
    const marks: (() => Element)[] = [
      () => {
        const swatch = el('span', 'wl-swatch wl-swatch-selected');
        swatch.append(el('span', 'wl-dot'));
        return swatch;
      },
      () => el('span', 'wl-swatch wl-swatch-today'),
      () => icon('check'),
      () => icon('eye'),
      () => icon('lock'),
    ];
    let next = 0;
    for (const words of WELCOME.pickerLegend) {
      const line = el('div', 'wl-legend-line');
      for (const text of words) {
        const item = el('span', 'wl-legend-item');
        const mark = marks[next++];
        if (mark) {
          item.append(mark());
        }
        item.append(el('span', '', text));
        line.append(item);
      }
      this.legend.append(line);
    }
  }

  private addTile(): TileView {
    const tile = button('wl-tile', '');
    const number = el('span', '');
    const marks = el('span', 'wl-mark-row');
    tile.append(number, marks);
    const view: TileView = { button: tile, number, marks, data: null };
    tile.addEventListener('click', () => {
      if (!view.data?.selectable) {
        return;
      }
      // The picked tile again clears the pick (a toggle, as aria-pressed says).
      if (view.button.getAttribute('aria-pressed') === 'true') {
        this.actions.unpick();
      } else {
        this.actions.pick(view.data.id);
      }
    });
    this.picker.append(tile);
    this.tiles.push(view);
    return view;
  }

  /** The picker in place of the progress lines; Back in place of Choose puzzle. */
  setPickerOpen(open: boolean): void {
    this.pickerOpen = open;
    show(this.picker, open);
    show(this.legend, open);
    show(this.progress, !open);
    this.updateButtons();
    (open ? this.backButton : this.chooseButton).focus({ preventScroll: true });
  }

  /** "Reset all puzzles and your streak?" with Cancel and Reset, in place of the buttons and Start. */
  setConfirmOpen(open: boolean): void {
    this.confirmOpen = open;
    this.updateButtons();
    (open ? this.cancelButton : this.resetLink).focus({ preventScroll: true });
  }

  /** Closes the picker and the confirmation without moving focus (on leaving XR). */
  closeOverlays(): void {
    this.pickerOpen = false;
    this.confirmOpen = false;
    show(this.picker, false);
    show(this.legend, false);
    show(this.progress, true);
    this.updateButtons();
  }

  private updateButtons(): void {
    const confirm = this.confirmOpen;
    show(this.startButton, !confirm);
    show(this.chooseButton, !confirm && !this.pickerOpen);
    show(this.backButton, !confirm && this.pickerOpen);
    show(this.resetLink, !confirm);
    show(this.confirmText, confirm);
    show(this.cancelButton, confirm);
    show(this.confirmButton, confirm);
  }
}
