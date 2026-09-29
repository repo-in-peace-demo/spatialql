/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createSystem, RayInteractable, UIKitMLAsset, VisibilityState } from '@iwsdk/core';

const WELCOME_PANEL_NODE_ID = 'welcome-panel';

export class PanelSystem extends createSystem({}) {
  private welcomePanel: UIKitMLAsset | null = null;

  /**
   * In XR the welcome panel must not render at all. It's a ScreenSpace
   * panel: ScreenSpaceUISystem reparents it every frame (under the camera in
   * the browser, back under its entity in XR), so toggling `visible` alone
   * doesn't reliably hide it. Detaching it each XR frame does: the
   * ScreenSpace system only re-attaches it on its browser path (to the
   * camera), which is exactly when it should show again.
   */
  update(): void {
    const panel = this.welcomePanel;
    if (panel && panel.parent && this.world.visibilityState.peek() !== VisibilityState.NonImmersive) {
      panel.removeFromParent();
    }
  }

  init(): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>(WELCOME_PANEL_NODE_ID);
    const xrButton = panel?.getElementById('xr-button');
    const exitButton = panel?.getElementById('exit-button');
    if (panel == null || xrButton == null || exitButton == null) {
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
    panel.visible = shown;
    const entity = this.world.getSceneEntity(WELCOME_PANEL_NODE_ID);
    if (!entity) {
      return;
    }
    if (shown && !entity.hasComponent(RayInteractable)) {
      entity.addComponent(RayInteractable, {});
    } else if (!shown && entity.hasComponent(RayInteractable)) {
      entity.removeComponent(RayInteractable);
    }
  }
}
