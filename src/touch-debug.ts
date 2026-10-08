/**
 * Dev-only touch readout (`?debug=1`): logs every poke and pinch attempt on
 * the INNER | LEFT control, the puzzle bar and the result slab's NULL cells,
 * with the outcome. Loaded behind `import.meta.env.DEV` (index.ts), so it
 * never ships. Observation only: it changes no input behavior.
 *
 * - **Poke attempt:** an index fingertip crosses a registered surface's
 *   plane (from more than POKE_DEPTH_METERS in front to within it) with the
 *   nearest target at most POKE_NEAR_METERS away in the plane.
 * - **Pinch attempt:** a pinch starts with its pinch point at most
 *   PINCH_NEAR_METERS from a target (in plane and off the surface).
 * - **Outcome:** the press the join or challenge system reported
 *   (`touchProbe.pressed`, with its input path: UIKit click, pinch, poke or
 *   ray) within OUTCOME_WINDOW_MS, or "no press". A press with no attempt
 *   near it (a ray, or a poke this didn't see) is logged on its own.
 *
 * Surfaces and presses come from `touch-probe.ts`. Allocation is limited to
 * the log lines; the per-frame checks reuse preallocated scratch.
 */

import { createSystem, Vector3, VisibilityState, type Object3D } from '@iwsdk/core';
import { unrollArc } from './band-arc.js';
import { readJointsPoint, readPinchPoint } from './pinch.js';
import { touchProbe, type PressNote, type TouchRect } from './touch-probe.js';

const LOG_PREFIX = '[Touch debug]';
/** A fingertip "pokes" a surface when it crosses to within this of it (the custom poke checks use 1 cm). */
const POKE_DEPTH_METERS = 0.01;
/** ...and counts as an attempt only this close to a target in the plane. */
const POKE_NEAR_METERS = 0.03;
/** A pinch counts as an attempt this close to a target (in plane and off the surface). */
const PINCH_NEAR_METERS = 0.1;
/** A press this soon after an attempt is its outcome. */
const OUTCOME_WINDOW_MS = 300;
const MAX_SURFACES = 8;
const MAX_RECTS = 64;
const HANDS = ['left', 'right'] as const;
const INDEX_TIP: readonly XRHandJoint[] = ['index-finger-tip'];

type Hand = (typeof HANDS)[number];
type Attempt = { atMs: number; text: string };

function cm(meters: number): string {
  return `${(meters * 100).toFixed(1)} cm`;
}

export class TouchDebugSystem extends createSystem({}) {
  private readonly rects: TouchRect[] = Array.from({ length: MAX_RECTS }, () => ({ name: '', x: 0, y: 0, width: 0, height: 0 }));
  /** Per hand, per surface: the fingertip's last distance in front of the surface. */
  private readonly depth: Record<Hand, Float32Array> = {
    left: new Float32Array(MAX_SURFACES).fill(Infinity),
    right: new Float32Array(MAX_SURFACES).fill(Infinity),
  };
  private readonly pending: Attempt[] = [];
  private readonly _tip = new Vector3();
  private readonly _local = new Vector3();
  /** The nearest target of the last `nearest()` call. */
  private readonly hit = { surface: '', target: '', inPlane: Infinity, depth: Infinity };

  init(): void {
    touchProbe.enabled = true;
    this.cleanupFuncs.push(() => {
      touchProbe.enabled = false;
    });
    console.info(
      `${LOG_PREFIX} active: logging pokes (fingertip crossing within ${cm(POKE_DEPTH_METERS)} of a surface, ` +
        `${cm(POKE_NEAR_METERS)} of a target) and pinches (within ${cm(PINCH_NEAR_METERS)} of a target) on ` +
        `${touchProbe.surfaces.map((s) => s.name).join(', ') || 'no surfaces yet'}`,
    );
  }

  update(): void {
    const now = performance.now();
    if (this.world.visibilityState.peek() !== VisibilityState.NonImmersive) {
      for (const hand of HANDS) {
        this.checkHand(hand, now);
      }
    }
    this.resolve(now);
  }

  private checkHand(hand: Hand, now: number): void {
    const source = this.input.xr.getPrimaryInputSource(hand);
    if (!source?.hand) {
      this.depth[hand].fill(Infinity);
      return;
    }
    // Poke: the fingertip crossing each surface's plane.
    if (readJointsPoint(this.world, this.player, source, INDEX_TIP, this._tip)) {
      const surfaces = touchProbe.surfaces;
      for (let i = 0; i < surfaces.length && i < MAX_SURFACES; i++) {
        const object = surfaces[i].object();
        if (!object) {
          this.depth[hand][i] = Infinity;
          continue;
        }
        const z = this.localPoint(object, this._tip, surfaces[i].arc?.());
        const before = this.depth[hand][i];
        this.depth[hand][i] = z;
        if (before > POKE_DEPTH_METERS && z <= POKE_DEPTH_METERS && z > -0.03) {
          if (this.nearestOn(i) && this.hit.inPlane <= POKE_NEAR_METERS) {
            this.pending.push({
              atMs: now,
              text: `${hand} fingertip poke on the ${this.hit.surface}: ${this.hit.target} ${cm(this.hit.inPlane)} away in plane`,
            });
          }
        }
      }
    }
    // Pinch: the pinch point at the moment the pinch starts.
    if (this.input.xr.gamepads[hand]?.getSelectStart() && readPinchPoint(this.world, this.player, source, this._tip)) {
      let best = { surface: '', target: '', inPlane: Infinity, depth: Infinity };
      const surfaces = touchProbe.surfaces;
      for (let i = 0; i < surfaces.length && i < MAX_SURFACES; i++) {
        const object = surfaces[i].object();
        if (!object) {
          continue;
        }
        this.localPoint(object, this._tip, surfaces[i].arc?.());
        if (this.nearestOn(i) && this.hit.inPlane < best.inPlane) {
          best = { ...this.hit };
        }
      }
      if (best.inPlane <= PINCH_NEAR_METERS && best.depth <= PINCH_NEAR_METERS) {
        this.pending.push({
          atMs: now,
          text:
            `${hand} pinch near the ${best.surface}: pinch point ${cm(best.inPlane)} from ${best.target} in plane, ` +
            `${cm(best.depth)} off its surface`,
        });
      }
    }
  }

  /**
   * `point` in `object`'s frame into `_local` (unrolled onto the band's arc
   * when `arc` is given: its buttons are curved); returns its distance
   * in front of the surface (z).
   */
  private localPoint(object: Object3D, point: Vector3, arc?: { radius: number; lean: number }): number {
    object.updateWorldMatrix(true, false);
    this._local.copy(point);
    object.worldToLocal(this._local);
    if (arc) {
      unrollArc(this._local, arc.radius, arc.lean);
    }
    return this._local.z;
  }

  /** The target on surface `index` nearest `_local` (in its plane) into `hit`; false if it has none. */
  private nearestOn(index: number): boolean {
    const surface = touchProbe.surfaces[index];
    const count = Math.min(surface.rects(this.rects), MAX_RECTS);
    this.hit.surface = surface.name;
    this.hit.target = '';
    this.hit.inPlane = Infinity;
    this.hit.depth = Math.abs(this._local.z);
    for (let r = 0; r < count; r++) {
      const rect = this.rects[r];
      const dx = Math.max(0, Math.abs(this._local.x - rect.x) - rect.width / 2);
      const dy = Math.max(0, Math.abs(this._local.y - rect.y) - rect.height / 2);
      const distance = Math.hypot(dx, dy);
      if (distance < this.hit.inPlane) {
        this.hit.inPlane = distance;
        this.hit.target = rect.name;
      }
    }
    return count > 0;
  }

  /** Pairs attempts with presses; logs each attempt's outcome once its window closes, and presses on their own. */
  private resolve(now: number): void {
    const presses = touchProbe.presses;
    // An attempt's outcome: the first press inside its window.
    for (let i = 0; i < this.pending.length; ) {
      const attempt = this.pending[i];
      const index = presses.findIndex((p) => p.atMs >= attempt.atMs - 50 && p.atMs <= attempt.atMs + OUTCOME_WINDOW_MS);
      if (index >= 0) {
        const press = presses.splice(index, 1)[0];
        console.log(`${LOG_PREFIX} ${attempt.text} -> pressed ${press.target} via ${press.path}`);
        this.pending.splice(i, 1);
      } else if (now - attempt.atMs > OUTCOME_WINDOW_MS) {
        console.log(`${LOG_PREFIX} ${attempt.text} -> no press`);
        this.pending.splice(i, 1);
      } else {
        i++;
      }
    }
    // Presses no attempt claimed (e.g. a ray select), once they can't match one any more.
    for (let i = 0; i < presses.length; ) {
      const press: PressNote = presses[i];
      if (now - press.atMs > OUTCOME_WINDOW_MS && !this.pending.some((a) => a.atMs <= press.atMs + 50)) {
        console.log(`${LOG_PREFIX} pressed ${press.target} via ${press.path} (no poke or pinch attempt seen near it)`);
        presses.splice(i, 1);
      } else {
        i++;
      }
    }
  }
}
