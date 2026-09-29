/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createSystem, RayInteractable, UIKitMLAsset, VisibilityState } from '@iwsdk/core';

const WELCOME_PANEL_NODE_ID = 'welcome-panel';

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
    if (!this.world.xrEnabled) {
      xrButton.setProperties({ display: 'none' });
      exitButton.setProperties({ display: 'none' });
      return;
    }

    const launchXR = () => this.world.launchXR();
    const exitXR = () => this.world.exitXR();
    xrButton.addEventListener('click', launchXR);
    exitButton.addEventListener('click', exitXR);
    this.cleanupFuncs.push(
      () => xrButton.removeEventListener('click', launchXR),
      () => exitButton.removeEventListener('click', exitXR),
      // Driven by visibility state rather than the buttons, so leaving XR
      // through the platform (Quest system menu, emulator exit control)
      // restores the browser entry flow exactly like the old Exit button.
      this.world.visibilityState.subscribe((visibilityState) => {
        const is2D = visibilityState === VisibilityState.NonImmersive;
        xrButton.setProperties({ display: is2D ? 'flex' : 'none' });
        exitButton.setProperties({ display: is2D ? 'none' : 'flex' });
        this.setWelcomePanelShown(panel, is2D);
      }),
    );
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
