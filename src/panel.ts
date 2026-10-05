/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createSystem, RayInteractable, UIKit, UIKitMLAsset, VisibilityState } from '@iwsdk/core';
import { CHALLENGE_MODE, reloadInMode } from './challenge-mode.js';
import { challengeStart, liveProgress, PLAYABLE } from './challenge-start.js';
import { WELCOME } from './data/copy.js';
import { welcomeLines } from './data/daily-flow.js';
import { sounds } from './sound.js';

const WELCOME_PANEL_NODE_ID = 'welcome-panel';

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
    this.cleanupFuncs.push(
      () => xrButton.removeEventListener('click', launchXR),
      () => exitButton.removeEventListener('click', exitXR),
      () => modeButton?.removeEventListener('click', switchMode),
      // Driven by visibility state rather than the buttons, so leaving XR
      // through the platform (Quest system menu, emulator exit control)
      // restores the browser entry flow exactly like the old Exit button.
      this.world.visibilityState.subscribe((visibilityState) => {
        const is2D = visibilityState === VisibilityState.NonImmersive;
        xrButton.setProperties({ display: is2D ? 'flex' : 'none' });
        modeButton?.setProperties({ display: is2D ? 'flex' : 'none' });
        exitButton.setProperties({ display: is2D ? 'none' : 'flex' });
        if (is2D) {
          // A session may have solved the daily or extended the streak.
          this.fillProgress(panel);
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
