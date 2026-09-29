/**
 * Dev-only grab readout (`debug` flag, see dev-flags.ts): explains, per hand, why a pinch (hands)
 * or squeeze (controllers) did or didn't grab a slab, and shows a dot at each
 * grab sphere's center. Only loaded behind `import.meta.env.DEV`, so it never
 * reaches production builds. Observation only: it changes no grab behavior.
 *
 * How IWSDK grabbing works (the rules this readout reports against):
 * - A OneHandGrabbable is grabbed by the hand's *grab pointer*: a sphere of
 *   GRAB_SPHERE_RADIUS_METERS centered on the hand's grip pose (the palm, not
 *   the fingertips), started by a "squeeze" on that pointer.
 * - Controllers squeeze with the grip button. Hands have no squeeze: GrabSystem
 *   forwards a hand's pinch (WebXR select) as a squeeze only when its
 *   `useHandPinchForGrab` config is on, and only while that hand is the primary
 *   input for its side.
 * - The pinch itself is a runtime-decided select (the emulator's Pinch
 *   slider); the page sees pressed/released, not a strength, so the readout
 *   reports the thumb-index fingertip distance instead. Emulator pose names
 *   ("default", "point") aren't exposed through WebXR.
 */

import {
  createSystem,
  Grabbed,
  GrabSystem,
  Group,
  InputComponent,
  Mesh,
  MeshBasicMaterial,
  OneHandGrabbable,
  SphereGeometry,
  Vector3,
  VisibilityState,
  type Entity,
  type Object3D,
} from '@iwsdk/core';
import { JoinDocked, JoinResultSlab, TableSlab, TableSlabRuntime } from './table-slab-component.js';
import { slabBottomLocalY, slabTopLocalY, type TableSlabDocument } from './table-slab-view.js';

/** @pmndrs/pointer-events' createGrabPointer default radius, which IWSDK's GrabPointer uses. */
const GRAB_SPHERE_RADIUS_METERS = 0.07;
/** Frames to wait after a pinch/squeeze before judging the outcome (GrabSystem must run first). */
const OUTCOME_DELAY_FRAMES = 2;
const LOG_PREFIX = '[Grab debug]';
const DOT_RADIUS_METERS = 0.006;
const COLOR_IN_RANGE = 0x2ecc40;
const COLOR_OUT_OF_RANGE = 0x9a9a9a;

type Hand = 'left' | 'right';
const HANDS: readonly Hand[] = ['left', 'right'];

type SlabDistance = { entity: Entity | null; name: string; distance: number; where: string };

type PendingOutcome = {
  frames: number;
  kind: 'pinch' | 'squeeze';
  nearest: SlabDistance;
};

const noRaycast: Object3D['raycast'] = () => {};

function cm(meters: number): string {
  return `${(meters * 100).toFixed(1)} cm`;
}

function fmt(v: Vector3): string {
  return `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;
}

export class GrabDebugSystem extends createSystem({
  // Grabbable slabs only: the join result slab is view-only and never grabbable.
  slabs: { required: [TableSlab, TableSlabRuntime, OneHandGrabbable] },
  held: { required: [TableSlab, Grabbed] },
}) {
  private grabSystem: GrabSystem | undefined;
  private readonly pending: Record<Hand, PendingOutcome | null> = { left: null, right: null };
  private readonly holders = new Map<Entity, Hand | null>();
  private readonly releases: { entity: Entity; frames: number }[] = [];

  private dots!: Record<Hand, Mesh>;
  private inRangeMaterial!: MeshBasicMaterial;
  private outOfRangeMaterial!: MeshBasicMaterial;

  // Scratch -- allocated once.
  private readonly _palm = new Vector3();
  private readonly _local = new Vector3();
  private readonly _nearest: SlabDistance = { entity: null, name: '', distance: Infinity, where: '' };

  init(): void {
    this.grabSystem = this.world.getSystem(GrabSystem);

    this.inRangeMaterial = new MeshBasicMaterial({ color: COLOR_IN_RANGE, depthTest: false });
    this.outOfRangeMaterial = new MeshBasicMaterial({ color: COLOR_OUT_OF_RANGE, depthTest: false });
    const geometry = new SphereGeometry(DOT_RADIUS_METERS, 12, 8);
    const root = new Group();
    root.name = 'grab-debug-dots';
    const makeDot = () => {
      const dot = new Mesh(geometry, this.outOfRangeMaterial);
      dot.raycast = noRaycast;
      dot.renderOrder = 999;
      dot.visible = false;
      root.add(dot);
      return dot;
    };
    this.dots = { left: makeDot(), right: makeDot() };
    const rootEntity = this.world.createTransformEntity(root, { parent: this.world.sceneEntity, persistent: true });

    this.queries.held.subscribe('qualify', (entity) => {
      const hand = this.grabSystem?.getHolderHand(entity) ?? null;
      this.holders.set(entity, hand);
      console.log(`${LOG_PREFIX} ${hand ?? 'unknown'} hand grabbed ${this.slabName(entity)}`);
    });
    this.queries.held.subscribe('disqualify', (entity) => {
      this.releases.push({ entity, frames: 1 });
    });

    this.cleanupFuncs.push(() => {
      geometry.dispose();
      this.inRangeMaterial.dispose();
      this.outOfRangeMaterial.dispose();
      rootEntity.dispose();
    });

    console.info(
      `${LOG_PREFIX} active. Grab sphere: ${cm(GRAB_SPHERE_RADIUS_METERS)} radius around each palm (grip pose). ` +
        `Hand pinch-to-grab: ${this.pinchRoutedToGrab() ? 'ON' : 'OFF (useHandPinchForGrab is false)'}.`,
    );
  }

  update(): void {
    const immersive = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    for (const hand of HANDS) {
      this.updateHand(hand, immersive);
    }
    this.updateReleases();
  }

  private updateHand(hand: Hand, immersive: boolean): void {
    const dot = this.dots[hand];
    const inputSource = this.input.xr.getPrimaryInputSource(hand);
    if (!immersive || !inputSource) {
      dot.visible = false;
      this.pending[hand] = null;
      return;
    }

    // Grab sphere center = the grip space GrabPointer is attached to.
    const grip = this.player.gripSpaces[hand];
    grip.updateWorldMatrix(true, false);
    this._palm.setFromMatrixPosition(grip.matrixWorld);
    this.nearestSlab(this._palm, this._nearest);

    dot.visible = true;
    dot.position.copy(this._palm);
    dot.material = this._nearest.distance <= GRAB_SPHERE_RADIUS_METERS ? this.inRangeMaterial : this.outOfRangeMaterial;

    const isHand = !!inputSource.hand;
    const gamepad = this.input.xr.gamepads[hand];
    const started = isHand ? gamepad?.getSelectStart() : gamepad?.getButtonDown(InputComponent.Squeeze);
    if (started) {
      this.logStart(hand, isHand, inputSource);
      this.pending[hand] = {
        frames: OUTCOME_DELAY_FRAMES,
        kind: isHand ? 'pinch' : 'squeeze',
        nearest: { ...this._nearest },
      };
    }

    const pending = this.pending[hand];
    if (pending && --pending.frames <= 0) {
      this.pending[hand] = null;
      this.logOutcome(hand, isHand, pending);
    }
  }

  private logStart(hand: Hand, isHand: boolean, inputSource: XRInputSource): void {
    const nearest = this._nearest;
    const parts = [
      `${LOG_PREFIX} ${hand} ${isHand ? 'hand pinch' : 'controller squeeze'} start`,
      `palm (grab sphere center) ${fmt(this._palm)}`,
    ];
    if (isHand) {
      const pinch = this.pinchInfo(inputSource);
      if (pinch) {
        parts.push(`pinch point ${fmt(pinch.point)}, thumb-index tips ${cm(pinch.distance)} apart`);
      }
    }
    parts.push(
      nearest.entity
        ? `nearest slab: ${nearest.name}, palm ${cm(nearest.distance)} from its surface (${nearest.where})`
        : 'no slab in the scene',
    );
    console.log(parts.join('\n  '));
  }

  private logOutcome(hand: Hand, isHand: boolean, pending: PendingOutcome): void {
    for (const entity of this.queries.held.entities) {
      if (this.grabSystem?.getHolderHand(entity) === hand) {
        console.log(`${LOG_PREFIX} ${hand} ${pending.kind}: grab started on ${this.slabName(entity)}`);
        return;
      }
    }
    console.log(`${LOG_PREFIX} ${hand} ${pending.kind}: no grab - ${this.noGrabReason(hand, isHand, pending)}`);
  }

  /** Reasons in the order the SDK's rules apply. */
  private noGrabReason(hand: Hand, isHand: boolean, pending: PendingOutcome): string {
    if (isHand && !this.pinchRoutedToGrab()) {
      return 'hand pinch isn\'t routed to grabbing (GrabSystem.useHandPinchForGrab = false).';
    }
    if (isHand && !this.input.xr.isPrimary('hand', hand)) {
      return `the ${hand} hand isn't the primary input on its side, so its pinch isn't forwarded.`;
    }
    const nearest = pending.nearest;
    if (!nearest.entity) {
      return 'there is no slab to grab.';
    }
    if (nearest.distance > GRAB_SPHERE_RADIUS_METERS) {
      return (
        `palm is ${cm(nearest.distance)} from the ${nearest.name} slab surface (${nearest.where}); ` +
        `move the palm within ${cm(GRAB_SPHERE_RADIUS_METERS)}.`
      );
    }
    const hovered = this.input.xr.multiPointers[hand].getPointer('grab').getIntersection()?.object;
    return (
      `palm is within range of the ${nearest.name} slab (${cm(nearest.distance)}, ${nearest.where}) ` +
      `but no grab started - grab pointer hovering: ${hovered ? hovered.name || hovered.type : 'nothing'}. ` +
      'This points at an app-side issue, not hand placement.'
    );
  }

  private updateReleases(): void {
    for (let i = this.releases.length - 1; i >= 0; i--) {
      const release = this.releases[i];
      if (--release.frames > 0) {
        continue;
      }
      this.releases.splice(i, 1);
      const hand = this.holders.get(release.entity) ?? null;
      this.holders.delete(release.entity);
      // JoinSystem commits a previewed join on this same release, so one
      // frame later the slab is either docked or free.
      const outcome = release.entity.hasComponent(JoinDocked) ? 'docked into a join' : 'stayed free';
      console.log(`${LOG_PREFIX} ${hand ?? 'unknown'} hand released ${this.slabName(release.entity)}: ${outcome}`);
    }
  }

  private pinchRoutedToGrab(): boolean {
    return Boolean(this.grabSystem?.config.useHandPinchForGrab.peek());
  }

  /** Thumb/index tip midpoint and separation from the live XR frame, if available. */
  private pinchInfo(inputSource: XRInputSource): { point: Vector3; distance: number } | null {
    const frame = this.world.xrFrame;
    const space = this.world.xrReferenceSpace;
    const hand = inputSource.hand;
    const thumb = hand?.get('thumb-tip');
    const index = hand?.get('index-finger-tip');
    if (!frame || !space || !thumb || !index || !frame.getJointPose) {
      return null;
    }
    const thumbPose = frame.getJointPose(thumb, space);
    const indexPose = frame.getJointPose(index, space);
    if (!thumbPose || !indexPose) {
      return null;
    }
    const a = thumbPose.transform.position;
    const b = indexPose.transform.position;
    const point = new Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    return { point, distance: Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) };
  }

  /**
   * Distance from `point` to the nearest visible slab's panel rectangle,
   * and where the point is relative to it. Allocation-free.
   */
  private nearestSlab(point: Vector3, out: SlabDistance): SlabDistance {
    out.entity = null;
    out.name = '';
    out.distance = Infinity;
    out.where = '';
    for (const entity of this.queries.slabs.entities) {
      const object = entity.object3D;
      const doc = entity.getValue(TableSlabRuntime, 'layout') as TableSlabDocument | undefined;
      if (!object || !doc || !object.visible) {
        continue;
      }
      object.updateWorldMatrix(true, false);
      this._local.copy(point);
      object.worldToLocal(this._local);
      const halfWidth = doc.widthMeters / 2;
      const top = slabTopLocalY(doc);
      const bottom = slabBottomLocalY(doc);
      const dx = Math.max(0, Math.abs(this._local.x) - halfWidth);
      const dy = this._local.y > top ? this._local.y - top : this._local.y < bottom ? bottom - this._local.y : 0;
      const distance = Math.sqrt(dx * dx + dy * dy + this._local.z * this._local.z);
      if (distance < out.distance) {
        out.entity = entity;
        out.distance = distance;
        out.name = this.slabName(entity);
        out.where =
          dx > 0 || dy > 0
            ? dx > 0
              ? 'beside it'
              : this._local.y > top
                ? 'above it'
                : 'below it'
            : this._local.z >= 0
              ? 'in front'
              : 'behind';
      }
    }
    return out;
  }

  private slabName(entity: Entity): string {
    return entity.hasComponent(JoinResultSlab) ? 'result' : (entity.getValue(TableSlab, 'tableId') ?? '?');
  }
}
