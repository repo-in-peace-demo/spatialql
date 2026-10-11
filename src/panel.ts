/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createSystem, VisibilityState } from '@iwsdk/core';
import { CHALLENGE_MODE, reloadInMode } from './challenge-mode.js';
import { challengeStart, liveProgress, pickPuzzle, PLAYABLE, resetAllProgress } from './challenge-start.js';
import { puzzleTiles, welcomeLines } from './data/daily-flow.js';
import type { PuzzleId } from './data/puzzles.js';
import { sounds } from './sound.js';
import { WelcomePage } from './welcome-page.js';

/** The camera layer the flat page draws: nothing is on it, so the canvas stays clear under the welcome page. */
const FLAT_PAGE_LAYER = 5;

/**
 * The welcome page (welcome-page.ts, HTML over the canvas) is the browser
 * entry point: Start enters XR from its click, a user gesture. It shows
 * outside XR only, driven by the session's visibility state, so leaving XR
 * through the platform (the Quest system menu, the emulator's exit control)
 * brings it back with fresh progress.
 *
 * Outside XR the page covers the canvas, so the camera draws an empty layer
 * there (the slabs, the result and the card stay in place, unseen) and gets
 * its own layers back in XR.
 */
export class PanelSystem extends createSystem({}) {
  /** The camera's layers as set up (restored in XR), and whether the flat-page layer is in use. */
  private cameraLayersMask = 0;
  private flatPage = false;
  private page: WelcomePage | null = null;
  /** The puzzle picked in the picker (Start enters XR on it), or null. */
  private picked: PuzzleId | null = null;

  update(): void {
    const immersive = this.world.visibilityState.peek() !== VisibilityState.NonImmersive || this.renderer.xr.isPresenting;
    if (this.flatPage === immersive) {
      this.flatPage = !immersive;
      if (this.flatPage) {
        this.cameraLayersMask = this.camera.layers.mask;
        this.camera.layers.set(FLAT_PAGE_LAYER);
      } else {
        this.camera.layers.mask = this.cameraLayersMask;
      }
      this.page?.setShown(this.flatPage);
    }
  }

  init(): void {
    const page = new WelcomePage(CHALLENGE_MODE, {
      // The Start tap is a user gesture: the moment browsers allow audio to start.
      start: () => {
        sounds.unlock();
        this.world.launchXR();
      },
      pick: (id) => {
        this.picked = id;
        // The challenge system loads it now (behind the page), switching tables if needed.
        pickPuzzle(id);
        this.fillPicker();
      },
      reset: () => resetAllProgress(),
      // Dormant free play (dev only): reloads, as both modes build their slabs at startup.
      puzzles: () => reloadInMode(false),
    });
    this.page = page;
    page.mount();
    page.setXrAvailable(this.world.xrEnabled);
    this.fillProgress();
    this.cleanupFuncs.push(
      () => page.root.remove(),
      this.world.visibilityState.subscribe((visibilityState) => {
        const is2D = visibilityState === VisibilityState.NonImmersive;
        if (is2D) {
          // A session may have solved the daily or extended the streak; the
          // puzzle it ended on is what Start resumes, so the pick is spent.
          this.picked = null;
          page.closeOverlays();
          this.fillProgress();
        }
        page.setShown(is2D);
      }),
    );
  }

  /** Today's puzzle, the streak, the calendar, practice and the picker (challenge mode). */
  private fillProgress(): void {
    if (!CHALLENGE_MODE || !this.page) {
      return;
    }
    const { progress, saveWorks } = liveProgress();
    this.page.fillProgress(welcomeLines(progress, challengeStart().today, PLAYABLE, saveWorks));
    this.fillPicker();
  }

  private fillPicker(): void {
    if (!CHALLENGE_MODE || !this.page) {
      return;
    }
    this.page.fillPicker(puzzleTiles(liveProgress().progress, challengeStart().today, PLAYABLE), this.picked);
  }
}
