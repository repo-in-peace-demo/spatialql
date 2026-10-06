/**
 * Dev-only plumbing for the touch readout (`touch-debug.ts`, `?debug=1`):
 * the join and challenge systems register their touch surfaces (the
 * INNER | LEFT control, the puzzle bar, the result slab's NULL cells) and
 * report each press with the input path that produced it. The readout
 * watches fingertips and pinches against the surfaces and matches each
 * attempt with the press (or none) that followed.
 *
 * Callers only touch this inside `import.meta.env.DEV` checks, so
 * production builds drop it.
 */

import type { Object3D } from '@iwsdk/core';

/** One touch target on a surface, in the surface object's frame (meters, center and size). */
export type TouchRect = { name: string; x: number; y: number; width: number; height: number };

/** A surface whose targets the readout tests: its object (null while not live) and its current targets. */
export type TouchSurface = {
  name: string;
  object(): Object3D | null;
  /** Writes the live targets into `out` (preallocated) and returns how many. */
  rects(out: TouchRect[]): number;
};

/**
 * Whether a UIKit click came from the SDK's poke ("touch") pointer. The
 * control, bar and NULL cells have their own contact poke (contact-poke.ts);
 * the SDK pointer flickers down/up while a fingertip rests near a button,
 * so its clicks double-press. They're ignored; ray and controller clicks
 * aren't. (Not dev-only: the click handlers use it.)
 */
export function isTouchPointerClick(event: unknown): boolean {
  return (event as { pointerType?: string } | null)?.pointerType === 'touch';
}

/** Fills a preallocated target (no allocation beyond the name). */
export function setRect(rect: TouchRect, name: string, x: number, y: number, width: number, height: number): void {
  rect.name = name;
  rect.x = x;
  rect.y = y;
  rect.width = width;
  rect.height = height;
}

/** Which input path produced a press (`debug-key`: a dev shortcut, not an input). */
export type PressPath = 'uikit-click' | 'pinch' | 'poke' | 'ray' | 'debug-key';

export type PressNote = { target: string; path: PressPath; atMs: number };

export const touchProbe = {
  /** Set by the readout: presses are only recorded while it runs. */
  enabled: false,
  surfaces: [] as TouchSurface[],
  presses: [] as PressNote[],
  addSurface(surface: TouchSurface): void {
    this.surfaces.push(surface);
  },
  pressed(target: string, path: PressPath): void {
    if (this.enabled && this.presses.length < 64) {
      this.presses.push({ target, path, atMs: performance.now() });
    }
  },
};
