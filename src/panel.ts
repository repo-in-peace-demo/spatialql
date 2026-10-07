/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createSystem, RayInteractable, UIKit, UIKitMLAsset, VisibilityState } from '@iwsdk/core';
import { Check } from '@pmndrs/uikit-lucide/dist/Check.js';
import { Eye } from '@pmndrs/uikit-lucide/dist/Eye.js';
import { Lock } from '@pmndrs/uikit-lucide/dist/Lock.js';
import { CHALLENGE_MODE, reloadInMode } from './challenge-mode.js';
import { challengeStart, liveProgress, pickPuzzle, PLAYABLE, resetAllProgress } from './challenge-start.js';
import { WELCOME } from './data/copy.js';
import { DATASETS } from './data/datasets.js';
import { puzzleTiles, welcomeLines, type PuzzleTile } from './data/daily-flow.js';
import { getPuzzle, type PuzzleId } from './data/puzzles.js';
import { sounds } from './sound.js';

const WELCOME_PANEL_NODE_ID = 'welcome-panel';

// The puzzle picker: 4 rows of 5 tiles (the panel is 296 wide inside its padding).
const PICKER_COLUMNS = 5;
const TILE_SIZE = 52;
const TILE_GAP = 8;
const TILE_RADIUS = 8;
const TILE_STRIPE = 4;
const COLOR_TILE = '#f2efe8';
const COLOR_TILE_BORDER = '#d8d2c4';
const COLOR_TILE_SELECTED = '#3b4f9c';
const COLOR_TILE_TEXT = '#272727';
const COLOR_TILE_TEXT_SELECTED = '#ffffff';
const LOCKED_OPACITY = 0.45;

type Container = InstanceType<typeof UIKit.Container>;
type Text = InstanceType<typeof UIKit.Text>;

/** A tile's border, every side the same width. */
function tileBorder(width: number) {
  return { borderTopWidth: width, borderLeftWidth: width, borderRightWidth: width, borderBottomWidth: width };
}

/** One picker tile's parts, rebuilt in place when progress changes. */
type TileView = {
  tile: Container;
  number: Text;
  today: Text;
  icons: { solved: Container; revealed: Container; locked: Container };
  data: PuzzleTile;
};

/**
 * Sets an element's text and shows it, or hides it for null. A `div` with
 * text in UIKitML may be a container holding a Text: the text goes to that.
 */
function setLine(panel: UIKitMLAsset, id: string, text: string | null): void {
  const element = panel.getElementById(id);
  if (!element) {
    return;
  }
  element.setProperties({ display: text === null ? 'none' : 'flex' });
  if (text !== null) {
    setText(element, text);
  }
}

function setText(element: { setProperties(properties: object): void; children: unknown[] }, text: string): void {
  if (element instanceof UIKit.Text) {
    element.setProperties({ text });
    return;
  }
  const child = element.children.find((c): c is InstanceType<typeof UIKit.Text> => c instanceof UIKit.Text);
  (child ?? element).setProperties({ text });
}

/**
 * The welcome panel is the browser entry point (Enter XR). In XR it must not
 * render at all.
 *
 * It's a ScreenSpace panel: ScreenSpaceUISystem moves its UIKit document
 * under the camera in the browser and back under the panel's own object in
 * XR. So the ScreenSpace component stays on (removing it at XR entry left
 * the document stranded under the camera, still drawn), and `update()` keeps
 * the panel's object hidden while immersive. PanelSystem runs after
 * ScreenSpaceUISystem, so its hide wins before the frame renders. It only
 * flips `visible` and never re-parents anything -- detaching the panel each
 * frame is what flooded the console with "parented under active level root"
 * warnings before.
 */
export class PanelSystem extends createSystem({}) {
  private welcomePanel: UIKitMLAsset | null = null;
  private tiles: TileView[] = [];
  /** The puzzle picked in the picker (Start enters XR on it), or null. */
  private picked: PuzzleId | null = null;
  private pickerOpen = false;
  private confirmOpen = false;

  update(): void {
    const panel = this.welcomePanel;
    if (panel && panel.visible && this.world.visibilityState.peek() !== VisibilityState.NonImmersive) {
      panel.visible = false;
    }
  }

  init(): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>(WELCOME_PANEL_NODE_ID);
    const xrButton = panel?.getElementById('xr-button');
    const exitButton = panel?.getElementById('exit-button');
    if (panel == null || xrButton == null || exitButton == null) {
      // Without the panel (or its buttons) nothing here runs -- including the
      // XR hide -- so say so rather than failing silently.
      console.warn(
        `[PanelSystem] welcome panel setup skipped: ` +
          `${panel == null ? `scene object "${WELCOME_PANEL_NODE_ID}" not found` : 'xr-button / exit-button not found'}. ` +
          `It won't be hidden in XR.`,
      );
      return;
    }
    this.welcomePanel = panel;
    const modeButton = panel.getElementById('mode-button');
    this.fillWelcomeText(panel);
    if (!this.world.xrEnabled) {
      xrButton.setProperties({ display: 'none' });
      exitButton.setProperties({ display: 'none' });
      modeButton?.setProperties({ display: 'none' });
      return;
    }

    // The Start (Enter XR) tap is a user gesture: the moment browsers allow audio to start.
    const launchXR = () => {
      sounds.unlock();
      this.world.launchXR();
    };
    const exitXR = () => this.world.exitXR();
    // Free play and back reload the page: both modes build their slabs at startup.
    const switchMode = () => reloadInMode(CHALLENGE_MODE);
    xrButton.addEventListener('click', launchXR);
    exitButton.addEventListener('click', exitXR);
    modeButton?.addEventListener('click', switchMode);
    this.setUpPickerAndReset(panel);
    this.cleanupFuncs.push(
      () => xrButton.removeEventListener('click', launchXR),
      () => exitButton.removeEventListener('click', exitXR),
      () => modeButton?.removeEventListener('click', switchMode),
      // Driven by visibility state rather than the buttons, so leaving XR
      // through the platform (Quest system menu, emulator exit control)
      // restores the browser entry flow exactly like the old Exit button.
      this.world.visibilityState.subscribe((visibilityState) => {
        const is2D = visibilityState === VisibilityState.NonImmersive;
        xrButton.setProperties({ display: is2D && !this.confirmOpen ? 'flex' : 'none' });
        modeButton?.setProperties({ display: is2D && !this.confirmOpen ? 'flex' : 'none' });
        exitButton.setProperties({ display: is2D ? 'none' : 'flex' });
        if (is2D) {
          // A session may have solved the daily or extended the streak; the
          // puzzle it ended on is what Start resumes, so the pick is spent.
          this.picked = null;
          this.fillProgress(panel);
          this.refreshPicker(panel);
        }
        this.setWelcomePanelShown(panel, is2D);
      }),
    );
  }

  /** The welcome text, from `WELCOME` in copy.ts; the mode line and button depend on the mode. */
  private fillWelcomeText(panel: UIKitMLAsset): void {
    setLine(panel, 'title', WELCOME.title);
    setLine(panel, 'mode-line', CHALLENGE_MODE ? null : WELCOME.freePlayHeading);
    setLine(panel, 'description', WELCOME.description);
    setLine(panel, 'description-mode', CHALLENGE_MODE ? WELCOME.descriptionPuzzles : WELCOME.descriptionFreePlay);
    setLine(panel, 'setup-line', WELCOME.setup);
    const xrLabel = panel.getElementById('xr-label');
    const modeLabel = panel.getElementById('mode-label');
    if (xrLabel) {
      setText(xrLabel, CHALLENGE_MODE ? WELCOME.start : WELCOME.startFreePlay);
    }
    if (modeLabel) {
      setText(modeLabel, CHALLENGE_MODE ? WELCOME.freePlay : WELCOME.puzzles);
    }
    for (const [id, text] of [
      ['choose-label', WELCOME.choosePuzzle],
      ['picker-back-label', WELCOME.pickerBack],
      ['reset-link', WELCOME.resetLink],
      ['reset-question', WELCOME.resetQuestion],
      ['reset-cancel-label', WELCOME.resetCancel],
      ['reset-ok-label', WELCOME.resetConfirm],
    ] as const) {
      const element = panel.getElementById(id);
      if (element) {
        setText(element, text);
      }
    }
    if (!CHALLENGE_MODE) {
      // Free play: no puzzles to pick or reset; the last button keeps the panel's bottom margin.
      panel.getElementById('choose-button')?.setProperties({ display: 'none' });
      panel.getElementById('reset-link')?.setProperties({ display: 'none' });
      panel.getElementById('mode-button')?.setProperties({ marginBottom: 24 });
    }
    this.fillProgress(panel);
  }

  /** Today's puzzle, the streak and practice progress (challenge mode only). */
  private fillProgress(panel: UIKitMLAsset): void {
    if (!CHALLENGE_MODE) {
      panel.getElementById('progress')?.setProperties({ display: 'none' });
      return;
    }
    const today = challengeStart().today;
    const { progress, saveWorks } = liveProgress();
    const lines = welcomeLines(progress, today, PLAYABLE, saveWorks);
    setLine(panel, 'daily-line', lines.daily);
    setLine(panel, 'streak-line', lines.streak);
    setLine(panel, 'practice-line', lines.practice);
    setLine(panel, 'save-line', lines.save);
  }

  /**
   * Challenge mode's puzzle picker (behind "Choose puzzle") and "Reset
   * progress" (after a confirmation). Free play has neither.
   */
  private setUpPickerAndReset(panel: UIKitMLAsset): void {
    const choose = panel.getElementById('choose-button');
    const back = panel.getElementById('picker-back');
    const grid = panel.getElementById('picker-grid');
    const resetLink = panel.getElementById('reset-link');
    const cancel = panel.getElementById('reset-cancel');
    const confirm = panel.getElementById('reset-ok');
    if (!CHALLENGE_MODE || !choose || !back || !grid || !resetLink || !cancel || !confirm) {
      return;
    }
    this.buildTiles(grid as Container);
    this.refreshPicker(panel);
    const open = () => this.setPickerOpen(panel, true);
    const close = () => this.setPickerOpen(panel, false);
    const askReset = () => this.setConfirmOpen(panel, true);
    const cancelReset = () => this.setConfirmOpen(panel, false);
    const reset = () => resetAllProgress();
    const listeners = [
      [choose, open],
      [back, close],
      [resetLink, askReset],
      [cancel, cancelReset],
      [confirm, reset],
    ] as const;
    for (const [element, listener] of listeners) {
      element.addEventListener('click', listener);
      this.cleanupFuncs.push(() => element.removeEventListener('click', listener));
    }
  }

  /** The 20 tiles, 4 rows of 5, each with its number, a status icon, and today's mark. */
  private buildTiles(grid: Container): void {
    const tiles = puzzleTiles(liveProgress().progress, challengeStart().today, PLAYABLE);
    let row: Container | null = null;
    tiles.forEach((data, index) => {
      if (index % PICKER_COLUMNS === 0) {
        row = new UIKit.Container({ flexDirection: 'row', gapColumn: TILE_GAP });
        grid.add(row);
      }
      const accent = DATASETS[getPuzzle(data.id).datasetId].theme.accent;
      const tile = new UIKit.Container({
        width: TILE_SIZE,
        height: TILE_SIZE,
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: COLOR_TILE,
        borderColor: COLOR_TILE_BORDER,
        ...tileBorder(1),
        borderTopLeftRadius: TILE_RADIUS,
        borderTopRightRadius: TILE_RADIUS,
        borderBottomLeftRadius: TILE_RADIUS,
        borderBottomRightRadius: TILE_RADIUS,
      });
      // The dataset's accent, a thin stripe along the top.
      tile.add(
        new UIKit.Container({
          positionType: 'absolute',
          positionTop: 0,
          positionLeft: TILE_RADIUS,
          positionRight: TILE_RADIUS,
          height: TILE_STRIPE,
          backgroundColor: accent,
          pointerEvents: 'none',
        }),
      );
      const number = new UIKit.Text({ text: String(data.number), fontSize: 18, fontWeight: 'bold', color: COLOR_TILE_TEXT });
      const marks = new UIKit.Container({ flexDirection: 'row', alignItems: 'center', gapColumn: 3, height: 13 });
      const icon = (Icon: typeof Check | typeof Eye | typeof Lock) => {
        const wrapper = new UIKit.Container({ display: 'none' });
        wrapper.add(new Icon({ width: 12, height: 12, color: COLOR_TILE_TEXT }));
        marks.add(wrapper);
        return wrapper;
      };
      const icons = { solved: icon(Check), revealed: icon(Eye), locked: icon(Lock) };
      const today = new UIKit.Text({ text: WELCOME.pickerToday, fontSize: 9, fontWeight: 'bold', color: accent, display: 'none' });
      marks.add(today);
      tile.add(number, marks);
      (row as Container | null)?.add(tile);
      const view: TileView = { tile, number, today, icons, data };
      const onTap = () => this.pick(view);
      tile.addEventListener('click', onTap);
      this.cleanupFuncs.push(() => tile.removeEventListener('click', onTap));
      this.tiles.push(view);
    });
  }

  /** Each tile's look from the latest progress: status icon, today's mark and border, locked (dimmed), picked (filled). */
  private refreshPicker(panel: UIKitMLAsset): void {
    if (!CHALLENGE_MODE || this.tiles.length === 0) {
      return;
    }
    const tiles = puzzleTiles(liveProgress().progress, challengeStart().today, PLAYABLE);
    this.tiles.forEach((view, index) => {
      const data = tiles[index];
      view.data = data;
      const picked = this.picked === data.id;
      const accent = DATASETS[getPuzzle(data.id).datasetId].theme.accent;
      view.tile.setProperties({
        backgroundColor: picked ? COLOR_TILE_SELECTED : COLOR_TILE,
        borderColor: data.today ? accent : COLOR_TILE_BORDER,
        ...tileBorder(data.today ? 2 : 1),
        opacity: data.selectable ? 1 : LOCKED_OPACITY,
      });
      view.number.setProperties({ color: picked ? COLOR_TILE_TEXT_SELECTED : COLOR_TILE_TEXT });
      view.icons.solved.setProperties({ display: data.status === 'solved' ? 'flex' : 'none' });
      view.icons.revealed.setProperties({ display: data.status === 'revealed' ? 'flex' : 'none' });
      view.icons.locked.setProperties({ display: data.status === 'locked' && !data.today ? 'flex' : 'none' });
      view.today.setProperties({ display: data.today ? 'flex' : 'none', color: picked ? COLOR_TILE_TEXT_SELECTED : accent });
    });
    const xrLabel = panel.getElementById('xr-label');
    if (xrLabel) {
      const number = this.picked ? PLAYABLE.indexOf(this.picked) + 1 : 0;
      setText(xrLabel, number > 0 ? WELCOME.startPuzzle(number) : WELCOME.start);
    }
  }

  /** A tap on a tile: an unlocked puzzle (or today's daily) becomes the one Start enters XR on. */
  private pick(view: TileView): void {
    const panel = this.welcomePanel;
    if (!panel || !view.data.selectable) {
      return;
    }
    this.picked = view.data.id;
    // The challenge system loads it now (behind the panel), switching tables if needed.
    pickPuzzle(view.data.id);
    this.refreshPicker(panel);
  }

  /** The picker in place of the description and progress lines (the title stays). */
  private setPickerOpen(panel: UIKitMLAsset, open: boolean): void {
    this.pickerOpen = open;
    for (const id of ['description', 'description-mode', 'setup-line', 'progress']) {
      panel.getElementById(id)?.setProperties({ display: open ? 'none' : 'flex' });
    }
    panel.getElementById('picker')?.setProperties({ display: open ? 'flex' : 'none' });
    panel.getElementById('choose-button')?.setProperties({ display: open ? 'none' : 'flex' });
    panel.getElementById('picker-back')?.setProperties({ display: open ? 'flex' : 'none' });
    if (open) {
      this.refreshPicker(panel);
    }
  }

  /** "Reset all puzzles and your streak?" with Cancel / Reset, in place of the buttons. */
  private setConfirmOpen(panel: UIKitMLAsset, open: boolean): void {
    this.confirmOpen = open;
    panel.getElementById('reset-confirm')?.setProperties({ display: open ? 'flex' : 'none' });
    panel.getElementById('reset-link')?.setProperties({ display: open ? 'none' : 'flex' });
    for (const id of ['xr-button', 'mode-button']) {
      panel.getElementById(id)?.setProperties({ display: open ? 'none' : 'flex' });
    }
    panel.getElementById('choose-button')?.setProperties({ display: open || this.pickerOpen ? 'none' : 'flex' });
    panel.getElementById('picker-back')?.setProperties({ display: !open && this.pickerOpen ? 'flex' : 'none' });
  }

  /**
   * The welcome panel is the browser entry point only: in XR it would sit in
   * front of the table slabs, so it hides (and stops taking rays) until the
   * session ends. Exiting XR is left to the platform's own exit.
   */
  private setWelcomePanelShown(panel: UIKitMLAsset, shown: boolean): void {
    const entity = this.world.getSceneEntity(WELCOME_PANEL_NODE_ID);
    if (entity) {
      if (shown && !entity.hasComponent(RayInteractable)) {
        entity.addComponent(RayInteractable, {});
      } else if (!shown && entity.hasComponent(RayInteractable)) {
        entity.removeComponent(RayInteractable);
      }
    }
    panel.visible = shown;
  }
}
