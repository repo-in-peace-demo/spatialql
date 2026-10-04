/**
 * World-space visuals for the join interaction: thin connector segments
 * (match lines and preview hints) and edge glow strips. Built once; per-frame
 * updates only write preallocated matrices.
 *
 * Segments are thin instanced boxes rather than GL lines, because WebGL line
 * width is fixed at 1px, which is unreadable in a headset.
 */

import {
  BoxGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  signal,
  Vector3,
  type Object3D,
  type Signal,
} from '@iwsdk/core';

const X_AXIS = new Vector3(1, 0, 0);
const ZERO_SCALE = new Vector3(0, 0, 0);

// Visuals must never intercept pointers aimed at the slabs or the pill.
const noRaycast: Object3D['raycast'] = () => {};

export const COLOR_MATCH_LINE = '#c8661b';
export const COLOR_PREVIEW = '#f2a03d';

/**
 * A soft row tint is too pale to read as a thin line over a desk or
 * passthrough, so lines use a deeper, more saturated version of the same hue.
 */
export function lineColorForTint(tint: string, out: Color): Color {
  const hsl = { h: 0, s: 0, l: 0 };
  out.set(tint).getHSL(hsl);
  return out.setHSL(hsl.h, Math.max(0.55, hsl.s), 0.45);
}

/**
 * A batch of thin segments, each drawn from `start` toward `end` as far as
 * its `progress` (0..1) signal says.
 */
export class SegmentBatch {
  readonly mesh: InstancedMesh;
  readonly material: MeshBasicMaterial;
  readonly progress: Signal<number>[];
  /** Multiplies the material's base opacity. */
  readonly fade = signal(1);
  private readonly starts: Vector3[];
  private readonly ends: Vector3[];
  private readonly baseOpacity: number;
  private readonly thickness: number;
  private count = 0;
  private readonly _dir = new Vector3();
  private readonly _pos = new Vector3();
  private readonly _scale = new Vector3();
  private readonly _quat = new Quaternion();
  private readonly _matrix = new Matrix4();

  constructor(capacity: number, color: string, thickness: number, baseOpacity: number) {
    this.material = new MeshBasicMaterial({
      color: new Color(color),
      transparent: true,
      opacity: baseOpacity,
      depthWrite: false,
    });
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), this.material, capacity);
    // Per-instance colours multiply the (white) material colour; start every
    // instance at the batch's base colour.
    const base = new Color(color);
    this.material.color.set(0xffffff);
    for (let i = 0; i < capacity; i++) {
      this.mesh.setColorAt(i, base);
    }
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.raycast = noRaycast;
    this.mesh.renderOrder = 2;
    this.progress = Array.from({ length: capacity }, () => signal(0));
    this.starts = Array.from({ length: capacity }, () => new Vector3());
    this.ends = Array.from({ length: capacity }, () => new Vector3());
    this.baseOpacity = baseOpacity;
    this.thickness = thickness;
  }

  get capacity(): number {
    return this.progress.length;
  }

  setCount(count: number): void {
    this.count = Math.min(count, this.capacity);
    this.mesh.count = this.count;
  }

  /** Event-time only (not per frame): recolours one segment. */
  setColor(index: number, color: Color): void {
    this.mesh.setColorAt(index, color);
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  setEndpoints(index: number, start: Vector3, end: Vector3): void {
    this.starts[index].copy(start);
    this.ends[index].copy(end);
  }

  /** Rewrites instance matrices from endpoints and progress. */
  update(): void {
    const fade = this.fade.peek();
    this.material.opacity = this.baseOpacity * fade;
    this.mesh.visible = this.count > 0 && fade > 0.001;
    for (let i = 0; i < this.count; i++) {
      const p = this.progress[i].peek();
      this._dir.subVectors(this.ends[i], this.starts[i]);
      const length = this._dir.length();
      if (p <= 0.001 || length < 1e-5) {
        this._matrix.compose(this.starts[i], this._quat.identity(), ZERO_SCALE);
      } else {
        this._dir.divideScalar(length);
        this._quat.setFromUnitVectors(X_AXIS, this._dir);
        const drawn = length * p;
        this._pos.copy(this.starts[i]).addScaledVector(this._dir, drawn / 2);
        this._scale.set(drawn, this.thickness, this.thickness);
        this._matrix.compose(this._pos, this._quat, this._scale);
      }
      this.mesh.setMatrixAt(i, this._matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * A glowing strip laid along one vertical edge of a slab, positioned in
 * world space each frame from the slab's transform.
 */
export class EdgeGlow {
  readonly mesh: Mesh;
  private readonly material: MeshBasicMaterial;
  private readonly _local = new Vector3();
  private readonly _quat = new Quaternion();

  constructor(width: number, color: string = COLOR_PREVIEW) {
    this.material = new MeshBasicMaterial({
      color: new Color(color),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(width, 1), this.material);
    this.mesh.raycast = noRaycast;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  /** Places the strip on `slab`'s edge at local x = `edgeX`, spanning `height`. */
  place(slab: Object3D, edgeX: number, centerY: number, height: number, opacity: number): void {
    slab.updateWorldMatrix(true, false);
    this._local.set(edgeX, centerY, 0.004);
    slab.localToWorld(this._local);
    this.mesh.position.copy(this._local);
    slab.getWorldQuaternion(this._quat);
    this.mesh.quaternion.copy(this._quat);
    this.mesh.scale.set(1, height, 1);
    this.material.opacity = opacity;
    this.mesh.visible = opacity > 0.001;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
