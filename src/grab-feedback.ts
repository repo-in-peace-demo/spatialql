/**
 * Grab feedback for the source slabs. Hands give no physical feedback, so a
 * slab always shows its state:
 *
 * - **Can grab**: a palm within the grab sphere of it (the nearest slab, the
 *   one a pinch would grab) -- a soft, thin outline in the dataset accent.
 * - **Grabbed**: a brighter, thicker outline, the slab 2% larger (its "lift";
 *   moving it would fight the grab), and, when it rests on a real desk, a
 *   soft shadow on the desk below it. A quiet pick-up and put-down sound
 *   (sound.ts) go with it; the join's amber preview glow stays its own look.
 *
 * The outline is a rounded-rectangle ring just outside the panel's edge and
 * slightly behind it, so it never covers a cell. It's a world-space mesh
 * following the slab's matrix (not a child: the grab sphere would treat a
 * child as part of the slab). Geometry is rebuilt only when the slab's size
 * or the ring's thickness changes; per frame it only copies matrices.
 */

import {
  Color,
  DataTexture,
  DoubleSide,
  Euler,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  Shape,
  ShapeGeometry,
  Vector3,
  type Object3D,
} from '@iwsdk/core';

export type GrabLook = 'none' | 'canGrab' | 'grabbed';

/** Can grab: thin and translucent. Grabbed: thicker and nearly opaque. */
const LOOKS: Record<Exclude<GrabLook, 'none'>, { thicknessMeters: number; opacity: number; lighten: number }> = {
  canGrab: { thicknessMeters: 0.0035, opacity: 0.5, lighten: 0.15 },
  grabbed: { thicknessMeters: 0.0075, opacity: 0.95, lighten: 0.35 },
};
/** The ring's inner edge sits this far outside the panel's edge, and this far behind its face. */
const OUTLINE_GAP_METERS = 0.0015;
const OUTLINE_BEHIND_METERS = 0.002;
/** Grabbed: the slab's visual "lift". */
export const GRABBED_SCALE = 1.02;

const noRaycast = (): void => {};

function roundedRect(path: Shape, halfW: number, halfH: number, radius: number): void {
  const r = Math.min(radius, halfW, halfH);
  path.moveTo(-halfW + r, -halfH);
  path.lineTo(halfW - r, -halfH);
  path.quadraticCurveTo(halfW, -halfH, halfW, -halfH + r);
  path.lineTo(halfW, halfH - r);
  path.quadraticCurveTo(halfW, halfH, halfW - r, halfH);
  path.lineTo(-halfW + r, halfH);
  path.quadraticCurveTo(-halfW, halfH, -halfW, halfH - r);
  path.lineTo(-halfW, -halfH + r);
  path.quadraticCurveTo(-halfW, -halfH, -halfW + r, -halfH);
}

/** A rounded-rectangle ring around one slab's panel. */
export class SlabOutline {
  readonly mesh: Mesh;
  private readonly material: MeshBasicMaterial;
  private readonly color = new Color();
  private readonly offset = new Matrix4();
  private builtKey = '';
  private look: GrabLook = 'none';

  constructor() {
    this.material = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: DoubleSide });
    this.mesh = new Mesh(new PlaneGeometry(0, 0), this.material);
    this.mesh.raycast = noRaycast;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
  }

  /**
   * Shows `look` around `slab` (its panel `width` x from `bottomY` to `topY`
   * in its own frame, corners of `radius`), in `accent`. Rebuilds the ring
   * only on a size or look change; call every frame it's shown.
   */
  show(slab: Object3D, width: number, bottomY: number, topY: number, radius: number, accent: string, look: Exclude<GrabLook, 'none'>): void {
    const style = LOOKS[look];
    const halfW = width / 2 + OUTLINE_GAP_METERS;
    const halfH = (topY - bottomY) / 2 + OUTLINE_GAP_METERS;
    const key = `${halfW.toFixed(4)}:${halfH.toFixed(4)}:${radius.toFixed(4)}:${look}`;
    if (key !== this.builtKey) {
      // A size or look change (rare: a grab, a release, a dataset switch), never per frame.
      this.builtKey = key;
      const t = style.thicknessMeters;
      const outer = new Shape();
      roundedRect(outer, halfW + t, halfH + t, radius + OUTLINE_GAP_METERS + t);
      const hole = new Shape();
      roundedRect(hole, halfW, halfH, radius + OUTLINE_GAP_METERS);
      outer.holes.push(hole);
      this.mesh.geometry.dispose();
      this.mesh.geometry = new ShapeGeometry(outer, 6);
      this.offset.makeTranslation(0, (topY + bottomY) / 2, -OUTLINE_BEHIND_METERS);
    }
    if (look !== this.look) {
      this.look = look;
      this.color.set(accent).lerp(WHITE, style.lighten);
      this.material.color.copy(this.color);
      this.material.opacity = style.opacity;
    }
    slab.updateWorldMatrix(true, false);
    this.mesh.matrix.multiplyMatrices(slab.matrixWorld, this.offset);
    this.mesh.matrixWorld.copy(this.mesh.matrix);
    this.mesh.matrixWorldNeedsUpdate = false;
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
    this.look = 'none';
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

const WHITE = new Color('#ffffff');

/** A soft-edged rounded-rectangle alpha mask (built once, shared by every shadow). */
function shadowTexture(): DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Distance outside an inner rectangle, in texture units: a soft falloff to the edge.
      const u = Math.abs((x + 0.5) / size - 0.5) * 2;
      const v = Math.abs((y + 0.5) / size - 0.5) * 2;
      const dx = Math.max(0, u - 0.55) / 0.45;
      const dy = Math.max(0, v - 0.55) / 0.45;
      const d = Math.min(1, Math.hypot(dx, dy));
      const alpha = (1 - d * d) * (1 - d * d);
      const i = (y * size + x) * 4;
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = Math.round(255 * alpha);
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

/** How dark the shadow is right on the desk, and the height above it where it has faded to its lightest. */
const SHADOW_OPACITY = 0.32;
const SHADOW_FADE_METERS = 0.35;
const SHADOW_MIN_FACTOR = 0.35;
/** The shadow is this much larger than the slab's footprint, and this far above the desk. */
const SHADOW_MARGIN_METERS = 0.03;
const SHADOW_LIFT_METERS = 0.001;

/** A soft shadow on the desk under a held slab: its footprint projected straight down. */
export class DeskShadow {
  readonly mesh: Mesh;
  private readonly material: MeshBasicMaterial;
  private readonly texture: DataTexture;
  private readonly _a = new Vector3();
  private readonly _b = new Vector3();
  private readonly _c = new Vector3();
  private readonly _d = new Vector3();
  private readonly _euler = new Euler(0, 0, 0, 'YXZ');
  private readonly _quat = new Quaternion();

  constructor() {
    this.texture = shadowTexture();
    this.material = new MeshBasicMaterial({ color: 0x000000, alphaMap: null, map: this.texture, transparent: true, opacity: 0, depthWrite: false });
    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.material);
    this.mesh.raycast = noRaycast;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
    this.mesh.visible = false;
  }

  /**
   * Under `slab` (panel `width` from `bottomY` to `topY` in its frame) on
   * the desk at `deskY`: as wide as the slab, as deep as its tilted face's
   * footprint, darker the nearer its bottom edge is to the desk.
   */
  show(slab: Object3D, width: number, bottomY: number, topY: number, deskY: number): void {
    slab.updateWorldMatrix(true, false);
    const bottom = slab.localToWorld(this._a.set(0, bottomY, 0));
    const top = slab.localToWorld(this._b.set(0, topY, 0));
    const right = slab.localToWorld(this._c.set(1, 0, 0)).sub(slab.localToWorld(this._d.set(0, 0, 0)));
    right.y = 0;
    if (right.lengthSq() < 1e-8) {
      this.hide();
      return;
    }
    const yaw = Math.atan2(-right.z, right.x);
    const depth = Math.hypot(top.x - bottom.x, top.z - bottom.z);
    const height = Math.max(0, Math.min(bottom.y, top.y) - deskY);
    const factor = Math.max(SHADOW_MIN_FACTOR, 1 - height / SHADOW_FADE_METERS);
    this.mesh.position.set((top.x + bottom.x) / 2, deskY + SHADOW_LIFT_METERS, (top.z + bottom.z) / 2);
    this.mesh.quaternion.copy(this._quat.setFromEuler(this._euler.set(-Math.PI / 2, yaw, 0)));
    // Flat on the desk: the plane's local x is the slab's width, its local y the depth.
    this.mesh.scale.set(width + 2 * SHADOW_MARGIN_METERS, depth + 2 * SHADOW_MARGIN_METERS, 1);
    this.material.opacity = SHADOW_OPACITY * factor;
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
