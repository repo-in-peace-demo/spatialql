/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { DeskPlacementSystem } from './desk-placement.js';
import { JoinSystem } from './join-system.js';
import { PanelSystem } from './panel.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  // Dev-only `?seated=1`: seated eye height in the emulator. The dynamic
  // import sits behind a compile-time constant, so production drops it.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('seated')) {
    void import('./dev-seated.js').then(({ installSeatedHead }) => installSeatedHead(world));
  }
  world.registerSystem(PanelSystem);
  world.registerSystem(DeskPlacementSystem);
  // After DeskPlacementSystem, which creates the source slabs it joins.
  world.registerSystem(JoinSystem);
  // Dev-only `?debug=1`: per-hand grab readout. Dropped from production.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('debug')) {
    void import('./grab-debug.js').then(({ GrabDebugSystem }) => world.registerSystem(GrabDebugSystem));
  }
});
