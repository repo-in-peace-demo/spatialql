/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { ChallengeSystem } from './challenge-system.js';
import { DeskPlacementSystem } from './desk-placement.js';
import { devFlag, installDevFlagHotkeys } from './dev-flags.js';
import { JoinSystem } from './join-system.js';
import { PanelSystem } from './panel.js';
import { installXrSupportNotice } from './xr-support.js';

// Plain-DOM notice for browsers that can't run SpatialQL (or aren't the
// Quest Browser); independent of the 3D scene, so it shows even if WebXR
// is missing entirely.
void installXrSupportNotice();

// Dev-only `debug`: the in-headset readout. Loaded before the world so its
// console tap catches the systems' startup lines. Dropped from production.
let debugHud: Promise<typeof import('./debug-hud.js')> | null = null;
if (import.meta.env.DEV && devFlag('debug')) {
  debugHud = import('./debug-hud.js');
  void debugHud.then(({ installHudConsoleTap }) => installHudConsoleTap());
}

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  if (import.meta.env.DEV) {
    installDevFlagHotkeys();
  }
  // Dev-only `seated`: seated eye height in the emulator. The dynamic
  // import sits behind a compile-time constant, so production drops it.
  if (import.meta.env.DEV && devFlag('seated')) {
    void import('./dev-seated.js').then(({ installSeatedHead }) => installSeatedHead(world));
  }
  world.registerSystem(PanelSystem);
  world.registerSystem(DeskPlacementSystem);
  // After DeskPlacementSystem, which creates the source slabs it joins.
  world.registerSystem(JoinSystem);
  // After JoinSystem, which it plays on (inert in free play).
  world.registerSystem(ChallengeSystem);
  // Dev-only `debug`: per-hand grab readout. Dropped from production.
  if (import.meta.env.DEV && devFlag('debug')) {
    void import('./grab-debug.js').then(({ GrabDebugSystem }) => world.registerSystem(GrabDebugSystem));
  }
  if (import.meta.env.DEV && debugHud) {
    void debugHud.then(({ DebugHudSystem }) => world.registerSystem(DebugHudSystem));
  }
});
