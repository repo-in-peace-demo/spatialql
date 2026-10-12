/**
 * Soft shadows on a detected desk, under the floating slabs: the desk below
 * becomes part of the play space (passthrough) without moving the slabs
 * from their tuned floating pose. One soft, dark ellipse per slab, lying on
 * the desk straight under the slab's center (pair-placement.ts
 * `shadowPoint`), turned with the slab, larger and fainter the higher the
 * slab floats. Hidden when there's no desk under a slab.
 *
 * Updated only when a slab has moved (no allocation on still frames).
 */

import { CanvasTexture, Euler, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3, type Object3D, type World } from '@iwsdk/core';
import { shadowPoint, type DeskSurface } from './pair-placement.js';

/** The shadow's darkest opacity (a slab just above the desk), and the faintest (high above it). */
const SHADOW_OPACITY = 0.35;
const SHADOW_MIN_OPACITY = 0.12;
/** Above this height over the desk (meters) the shadow is at its faintest. */
const SHADOW_FADE_METERS = 0.6;
/** Just above the desk, so it never z-fights with it. */
const SHADOW_LIFT_METERS = 0.003;
/** A slab moving less than this (meters) keeps its shadow as is. */
const MOVE_EPSILON_METERS = 0.001;

/** A soft round shadow: dark in the middle, fading to nothing at the edge (built once). */
function shadowTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.55)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  return new CanvasTexture(canvas);
}

type ShadowView = { mesh: Mesh; material: MeshBasicMaterial; last: Vector3; shown: boolean };

export class DeskShadows {
  private readonly group = new Group();
  private readonly views: ShadowView[] = [];
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly texture = shadowTexture();
  private readonly _center = new Vector3();
  private readonly _euler = new Euler();
  /** The desk last drawn on (a new one redraws everything). */
  private desk: DeskSurface | null = null;

  constructor(world: World, count = 2) {
    for (let i = 0; i < count; i++) {
      const material = new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, color: 0x000000, opacity: 0 });
      const mesh = new Mesh(this.geometry, material);
      mesh.visible = false;
      mesh.renderOrder = -1;
      this.group.add(mesh);
      this.views.push({ mesh, material, last: new Vector3(Infinity, Infinity, Infinity), shown: false });
    }
    world.createTransformEntity(this.group);
  }

  /**
   * Each frame: the shadows of `slabs` (each with its width and depth) on
   * `desk`, or none (no desk, or the slabs rest on it).
   */
  update(slabs: readonly { object: Object3D | null | undefined; width: number; height: number }[], desk: DeskSurface | null): void {
    const deskChanged = desk !== this.desk;
    this.desk = desk;
    this.views.forEach((view, i) => {
      const slab = slabs[i];
      const object = slab?.object;
      if (!desk || !object || !object.visible) {
        this.hide(view);
        return;
      }
      object.updateWorldMatrix(true, false);
      this._center.setFromMatrixPosition(object.matrixWorld);
      if (!deskChanged && view.last.distanceToSquared(this._center) < MOVE_EPSILON_METERS * MOVE_EPSILON_METERS) {
        return;
      }
      view.last.copy(this._center);
      const point = shadowPoint(this._center, desk);
      if (!point) {
        this.hide(view);
        return;
      }
      const height = this._center.y - desk.surfaceY;
      const spread = 1 + Math.min(1, height / SHADOW_FADE_METERS) * 0.4;
      const fade = Math.max(0, 1 - height / SHADOW_FADE_METERS);
      view.material.opacity = SHADOW_MIN_OPACITY + (SHADOW_OPACITY - SHADOW_MIN_OPACITY) * fade;
      view.mesh.position.set(point.x, point.y + SHADOW_LIFT_METERS, point.z);
      // Flat on the desk, turned with the slab (its yaw only).
      this._euler.setFromQuaternion(object.quaternion, 'YXZ');
      view.mesh.rotation.set(-Math.PI / 2, this._euler.y, 0, 'YXZ');
      view.mesh.scale.set((slab.width + 0.06) * spread, Math.max(0.08, slab.height * 0.45) * spread, 1);
      view.mesh.visible = true;
      view.shown = true;
    });
  }

  private hide(view: ShadowView): void {
    if (view.shown) {
      view.mesh.visible = false;
      view.shown = false;
      view.last.set(Infinity, Infinity, Infinity);
    }
  }
}
