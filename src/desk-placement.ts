/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Places the two table slabs: visible immediately (fast cold start), then
 * re-placed relative to the real head pose once an XR session actually
 * starts, snapping onto the nearest qualifying real-world surface if one
 * stabilizes before a timeout, and never moving a slab the user has already
 * grabbed.
 */

import {
  createSystem,
  Euler,
  Grabbed,
  MathUtils,
  OneHandGrabbable,
  Quaternion,
  Vector3,
  VisibilityState,
  XRMesh,
  XRPlane,
  type Entity,
} from '@iwsdk/core';
import { CUSTOMERS_TABLE, ORDERS_TABLE } from './data/sample-data.js';
import { devFlag } from './dev-flags.js';
import { PlacementDebug, type PlacementKind, type SlabReport } from './placement-debug.js';
import { JoinDocked, TableSlab, TableSlabRuntime } from './table-slab-component.js';
import { buildTableSlabDocument, tableSlabNaturalHeightMeters, type TableSlabDocument } from './table-slab-view.js';
import {
  eyeFacingLean,
  eyeFacingLeanFromBottom,
  measureSlabEdges,
  minDistanceForDrop,
  NATURAL_GAZE_PITCH_DEG,
  NATURAL_GAZE_PITCH_RAD,
  PLANNED_SOURCE_DISTANCE_METERS,
  ROW_TEXT_TARGET_DEG,
  slabTextSizeAt,
  TEXT_ANGLE_TOLERANCE,
  textAngleDeg,
  TOUCH_REACH_MAX_METERS,
  VIEW_MAX_ABOVE_GAZE_DEG,
  VIEW_MAX_BELOW_GAZE_DEG,
  type SlabEdgeAngles,
} from './view-comfort.js';

const UP_AXIS = new Vector3(0, 1, 0);

const SEARCH_TIMEOUT_SECONDS = 5;
const STABLE_COMMIT_SECONDS = 1;
const HEAD_POSE_WAIT_CAP_SECONDS = 1;
const NEAREST_SURFACE_RADIUS_METERS = 1.0;
// Head-relative, not floor-relative: XR's default reference space is
// 'local-floor', but IWSDK falls back to 'local'/'viewer' when that isn't
// available, neither of which guarantees floor-zero. A head-relative band
// works regardless of which reference space was actually granted. Wide
// enough to cover both a seated desk (~0.75m below ~1.2m eye height) and the
// emulator's standing default head pose (~1.6m) against a ~0.75m desk
// (~0.85m below head).
const SURFACE_HEIGHT_BELOW_HEAD = { min: 0.3, max: 0.95 };

// Every slab the system places is tilted so its face points at the eyes
// (`eyeFacingLean*` in view-comfort.ts, clamped to 30-85 deg from flat).
// A slab rotated by a negative angle around its local X axis ("leaning back
// from vertical") has its +Z-facing normal raised toward eyes above it.

// Floating fallback: slab centers this far ahead of / below the head, which
// keeps both centers within seated reach (TOUCH_REACH_MAX_METERS).
const FLOATING_FORWARD_METERS = 0.42;
const FLOATING_BELOW_HEAD_METERS = 0.3;

// On a surface: the slabs' bottom edges rest on it, this far ahead of the
// head (horizontally), propped up to face the eyes.
const SURFACE_FORWARD_METERS = 0.32;
// Keeps the bottom edge from z-fighting with the surface it rests on.
const SURFACE_LIFT_METERS = 0.002;

// Field-of-view guard (view-comfort.ts): every slab's top and bottom edges
// should sit inside the group's view window around the natural seated gaze;
// if one wouldn't, the slabs move farther forward, but reach wins: never so
// far that a slab's center passes TOUCH_REACH_MAX_METERS from the eyes.
// Distance and tilt depend on each other; this many alternations settle both.
const FIT_ITERATIONS = 3;

// Well outside the join system's preview range (6 cm, 9 cm to exit), so a
// join always takes a deliberate push; merely grabbing and releasing a slab
// in place never joins.
const SLAB_GAP_METERS = 0.15;

// Dev-only `forceSurface` flag (see dev-flags.ts): forces the "surface found"
// outcome at a fixed head-relative height (a realistic seated desk) so the
// snap path is testable without relying on the emulator's room layout or
// timing. `import.meta.env.DEV` is a compile-time constant under Vite (the
// same idiom @iwsdk/core's own grab-warnings.js uses), so this branch is
// dead-code-eliminated from production builds.
const FORCE_SURFACE_HEIGHT_BELOW_HEAD = 0.45;
// Dev-only `debug` flag: logs placement decisions and outlines surface
// candidates in the scene. Stripped from production builds the same way.

const REJECT_NO_OBJECT = 'no object3D';
const REJECT_NOT_BOUNDED = 'not a bounded 3D mesh';
const REJECT_LABEL = 'label is not table/desk';
const REJECT_NOT_HORIZONTAL = 'plane is not horizontal';
const REJECT_TOO_HIGH = `less than ${SURFACE_HEIGHT_BELOW_HEAD.min} m below head`;
const REJECT_TOO_LOW = `more than ${SURFACE_HEIGHT_BELOW_HEAD.max} m below head`;
const REJECT_TOO_FAR = `farther than ${NEAREST_SURFACE_RADIUS_METERS} m`;

type PlaneLike = {
  orientation?: string;
  semanticLabel?: string;
  polygon?: ReadonlyArray<{ x: number; z: number }>;
};

/**
 * One surface candidate's evaluation. Bounds are in the surface object's
 * local frame (XRMesh min/max are local vertex bounds; an XRPlane's polygon
 * lies in its local XZ plane), so they stay correct for rotated surfaces.
 */
export type SurfaceAssessment = {
  entity: Entity | null;
  kind: 'mesh' | 'plane';
  label: string;
  hasBounds: boolean;
  minX: number;
  maxX: number;
  minY: number;
  topY: number;
  minZ: number;
  maxZ: number;
  surfaceY: number;
  heightBelowHead: number;
  distance: number;
  qualified: boolean;
  reason: string;
};

function createAssessment(): SurfaceAssessment {
  return {
    entity: null,
    kind: 'mesh',
    label: '',
    hasBounds: false,
    minX: 0,
    maxX: 0,
    minY: 0,
    topY: 0,
    minZ: 0,
    maxZ: 0,
    surfaceY: NaN,
    heightBelowHead: NaN,
    distance: NaN,
    qualified: false,
    reason: '',
  };
}

export class DeskPlacementSystem extends createSystem({
  tableMeshes: { required: [XRMesh] },
  tablePlanes: { required: [XRPlane] },
  grabbedSlabs: { required: [TableSlab, Grabbed] },
}) {
  private customersEntity!: Entity;
  private ordersEntity!: Entity;
  private customersDoc!: TableSlabDocument;
  private ordersDoc!: TableSlabDocument;

  private touchedCustomers = false;
  private touchedOrders = false;

  private sessionActive = false;
  private headPoseValid = false;
  private headPoseWaitElapsed = 0;

  private searching = false;
  private searchElapsed = 0;
  private bestCandidateEntity: Entity | null = null;
  private bestCandidateStableSeconds = 0;
  private scanBestDistance = Infinity;

  private forceSurfaceRequested = false;
  private debug: PlacementDebug | null = null;

  // Reusable scratch objects -- allocated once, never inside update().
  private _headPos = new Vector3();
  private _headQuat = new Quaternion();
  private _headEuler = new Euler();
  private _headYaw = 0;
  private _headPitchDown = 0;
  private _forward = new Vector3();
  private _right = new Vector3();
  private _local = new Vector3();
  private _anchor = new Vector3();
  private _slabCenter = new Vector3();
  private _basePos = new Vector3();
  private _scan = createAssessment();
  private _best = createAssessment();
  private _edges: SlabEdgeAngles = { topDeg: 0, bottomDeg: 0, fits: true };
  private _center = new Vector3();

  init(): void {
    // Both slabs share one height (the shorter is padded at the bottom), so
    // on a desk both rest on it with their tops -- and rows -- aligned, and
    // docking needs no vertical move.
    // Text is sized by angle for the planned seated distance, once: slab
    // documents aren't rebuilt when placed (the readout logs the real angle).
    const text = slabTextSizeAt(PLANNED_SOURCE_DISTANCE_METERS);
    const sharedHeight = Math.max(
      tableSlabNaturalHeightMeters(CUSTOMERS_TABLE, { text }),
      tableSlabNaturalHeightMeters(ORDERS_TABLE, { text }),
    );
    this.customersDoc = buildTableSlabDocument(CUSTOMERS_TABLE, { minHeightMeters: sharedHeight, text });
    this.ordersDoc = buildTableSlabDocument(ORDERS_TABLE, { minHeightMeters: sharedHeight, text });

    this.customersEntity = this.world.createTransformEntity(this.customersDoc.document);
    this.customersEntity.addComponent(TableSlab, { tableId: CUSTOMERS_TABLE.id });
    this.customersEntity.addComponent(TableSlabRuntime, {
      document: this.customersDoc.document,
      rowViews: this.customersDoc.rowViews,
      layout: this.customersDoc,
    });
    this.customersEntity.addComponent(OneHandGrabbable, {});

    this.ordersEntity = this.world.createTransformEntity(this.ordersDoc.document);
    this.ordersEntity.addComponent(TableSlab, { tableId: ORDERS_TABLE.id });
    this.ordersEntity.addComponent(TableSlabRuntime, {
      document: this.ordersDoc.document,
      rowViews: this.ordersDoc.rowViews,
      layout: this.ordersDoc,
    });
    this.ordersEntity.addComponent(OneHandGrabbable, {});

    this.forceSurfaceRequested = import.meta.env.DEV && devFlag('forceSurface');
    this.debug = import.meta.env.DEV && devFlag('debug') ? new PlacementDebug(this.world) : null;
    if (import.meta.env.DEV && this.debug) {
      const debug = this.debug;
      this.cleanupFuncs.push(() => debug.dispose());
    }

    // Fast cold start: visible immediately, before any XR session exists,
    // using the project's documented default standing pose.
    this._headPos.set(0, 1.6, 0);
    this._headYaw = 0;
    this._headPitchDown = 0;
    this.placeFloating();
    this.reportPlacement('cold start (floating, default head pose)', 'floating', null);

    this.queries.grabbedSlabs.subscribe('qualify', (entity) => {
      if (entity === this.customersEntity) {
        this.touchedCustomers = true;
      } else if (entity === this.ordersEntity) {
        this.touchedOrders = true;
      }
    });

    this.cleanupFuncs.push(
      this.visibilityState.subscribe((state) => {
        const isImmersive = state !== VisibilityState.NonImmersive;
        if (isImmersive && !this.sessionActive) {
          this.onSessionStart();
        } else if (!isImmersive && this.sessionActive) {
          this.onSessionEnd();
        }
        this.sessionActive = isImmersive;
      }),
    );
  }

  update(delta: number): void {
    if (this.sessionActive && !this.headPoseValid) {
      this.headPoseWaitElapsed += delta;
      this.player.head.updateWorldMatrix(true, false);
      this._headPos.setFromMatrixPosition(this.player.head.matrixWorld);
      const atDefaultOrigin = this._headPos.lengthSq() < 1e-6;
      if (!atDefaultOrigin || this.headPoseWaitElapsed >= HEAD_POSE_WAIT_CAP_SECONDS) {
        this.headPoseValid = true;
        this.beginSessionPlacement();
      }
    }

    if (this.searching) {
      this.updateSurfaceSearch(delta);
    }
  }

  private onSessionStart(): void {
    this.touchedCustomers = false;
    this.touchedOrders = false;
    this.headPoseValid = false;
    this.headPoseWaitElapsed = 0;
    this.searching = false;
    this.bestCandidateEntity = null;
    this.bestCandidateStableSeconds = 0;
    if (import.meta.env.DEV && this.debug) {
      this.debug.probeReferenceSpace();
    }
  }

  private onSessionEnd(): void {
    this.searching = false;
    if (import.meta.env.DEV && this.debug) {
      this.debug.clearOutlines();
    }
  }

  private beginSessionPlacement(): void {
    this.readHeadPose();
    this.placeFloating();
    this.reportPlacement('session start (floating, before surface search)', 'floating', null);

    this.searching = true;
    this.searchElapsed = 0;
    this.bestCandidateEntity = null;
    this.bestCandidateStableSeconds = 0;
  }

  private updateSurfaceSearch(delta: number): void {
    this.searchElapsed += delta;

    if (this.touchedCustomers && this.touchedOrders) {
      // Nothing left to place -- cancel the snap entirely.
      this.searching = false;
      return;
    }

    if (this.forceSurfaceRequested) {
      if (this.searchElapsed >= STABLE_COMMIT_SECONDS) {
        this.commitForcedSurface();
      }
      return;
    }

    this.player.head.updateWorldMatrix(true, false);
    this._headPos.setFromMatrixPosition(this.player.head.matrixWorld);

    const previousBest = this.bestCandidateEntity;
    this.bestCandidateEntity = null;
    this.scanBestDistance = NEAREST_SURFACE_RADIUS_METERS;

    for (const entity of this.queries.tableMeshes.entities) {
      this.considerCandidate(entity, 'mesh');
    }
    for (const entity of this.queries.tablePlanes.entities) {
      this.considerCandidate(entity, 'plane');
    }

    if (this.bestCandidateEntity !== null && this.bestCandidateEntity === previousBest) {
      this.bestCandidateStableSeconds += delta;
    } else {
      this.bestCandidateStableSeconds = 0;
    }

    if (import.meta.env.DEV && this.debug && this.bestCandidateEntity !== previousBest) {
      this.debug.logChosenChange(this._headPos, this.collectCandidates(), this.bestCandidateEntity);
    }

    const stable =
      this.bestCandidateEntity !== null && this.bestCandidateStableSeconds >= STABLE_COMMIT_SECONDS;
    if (stable || this.searchElapsed >= SEARCH_TIMEOUT_SECONDS) {
      this.commitSearch();
    }
  }

  private considerCandidate(entity: Entity, kind: 'mesh' | 'plane'): void {
    if (!this.assessSurface(entity, kind, this._scan)) {
      return;
    }
    if (this._scan.distance < this.scanBestDistance) {
      this.scanBestDistance = this._scan.distance;
      this.bestCandidateEntity = entity;
    }
  }

  /**
   * Evaluates one surface against the current `_headPos`, writing the result
   * into `out`. Returns whether it qualifies. Surface height is the top of
   * the surface in world space (mesh: local AABB top transformed by the
   * mesh's world matrix; plane: the plane itself), and distance is to the
   * nearest point of its bounds -- both computed in the surface's own frame
   * so a rotated table is handled correctly.
   */
  private assessSurface(entity: Entity, kind: 'mesh' | 'plane', out: SurfaceAssessment): boolean {
    out.entity = entity;
    out.kind = kind;
    out.label = '';
    out.hasBounds = false;
    out.surfaceY = NaN;
    out.heightBelowHead = NaN;
    out.distance = NaN;
    out.qualified = false;
    out.reason = '';

    const object = entity.object3D;

    if (kind === 'mesh') {
      out.label = entity.getValue(XRMesh, 'semanticLabel') ?? '';
      if (!entity.getValue(XRMesh, 'isBounded3D')) {
        out.reason = REJECT_NOT_BOUNDED;
        return false;
      }
      const min = entity.getVectorView(XRMesh, 'min');
      const max = entity.getVectorView(XRMesh, 'max');
      out.minX = min[0];
      out.maxX = max[0];
      out.minY = min[1];
      out.topY = max[1];
      out.minZ = min[2];
      out.maxZ = max[2];
      out.hasBounds = true;
    } else {
      const plane = entity.getValue(XRPlane, '_plane') as PlaneLike | null;
      out.label = plane?.semanticLabel ?? '';
      const polygon = plane?.polygon;
      if (polygon && polygon.length > 0) {
        out.minX = Infinity;
        out.maxX = -Infinity;
        out.minZ = Infinity;
        out.maxZ = -Infinity;
        for (const point of polygon) {
          out.minX = Math.min(out.minX, point.x);
          out.maxX = Math.max(out.maxX, point.x);
          out.minZ = Math.min(out.minZ, point.z);
          out.maxZ = Math.max(out.maxZ, point.z);
        }
        out.minY = 0;
        out.topY = 0;
        out.hasBounds = true;
      }
      if (!plane || (plane.orientation ?? '').toLowerCase() !== 'horizontal') {
        out.reason = REJECT_NOT_HORIZONTAL;
        return false;
      }
    }

    if (!object) {
      out.reason = REJECT_NO_OBJECT;
      return false;
    }
    object.updateWorldMatrix(true, false);

    if (out.hasBounds) {
      this._local.set((out.minX + out.maxX) / 2, out.topY, (out.minZ + out.maxZ) / 2);
      object.localToWorld(this._local);
      out.surfaceY = this._local.y;

      // Nearest point of the surface's footprint to the head.
      this._local.copy(this._headPos);
      object.worldToLocal(this._local);
      this._local.x = MathUtils.clamp(this._local.x, out.minX, out.maxX);
      this._local.z = MathUtils.clamp(this._local.z, out.minZ, out.maxZ);
      this._local.y = out.topY;
      object.localToWorld(this._local);
    } else {
      this._local.setFromMatrixPosition(object.matrixWorld);
      out.surfaceY = this._local.y;
    }
    const dx = this._local.x - this._headPos.x;
    const dz = this._local.z - this._headPos.z;
    out.distance = Math.sqrt(dx * dx + dz * dz);
    out.heightBelowHead = this._headPos.y - out.surfaceY;

    // Label is only checked after geometry so the debug readout still shows
    // where a rejected mesh sits.
    if (kind === 'mesh' && out.label !== 'table' && out.label !== 'desk') {
      out.reason = REJECT_LABEL;
      return false;
    }
    if (out.heightBelowHead < SURFACE_HEIGHT_BELOW_HEAD.min) {
      out.reason = REJECT_TOO_HIGH;
      return false;
    }
    if (out.heightBelowHead > SURFACE_HEIGHT_BELOW_HEAD.max) {
      out.reason = REJECT_TOO_LOW;
      return false;
    }
    if (out.distance > NEAREST_SURFACE_RADIUS_METERS) {
      out.reason = REJECT_TOO_FAR;
      return false;
    }
    out.qualified = true;
    return true;
  }

  private commitSearch(): void {
    this.searching = false;
    const candidate = this.bestCandidateEntity;
    this.readHeadPose();

    const kind = candidate?.hasComponent(XRMesh) ? 'mesh' : 'plane';
    if (!candidate || !this.assessSurface(candidate, kind, this._best)) {
      // No candidate ever qualified (or it stopped qualifying) -- stay at
      // the floating pose already placed in beginSessionPlacement(). The
      // explicit "bus or plane" case.
      this.reportPlacement('search ended with no surface (floating kept)', 'none', null);
      return;
    }

    this.placeOnSurface(this._best.surfaceY, this._best);
    this.reportPlacement(`snapped to detected ${kind}`, 'surface', this._best);
  }

  private commitForcedSurface(): void {
    this.searching = false;
    this.readHeadPose();
    this.placeOnSurface(this._headPos.y - FORCE_SURFACE_HEIGHT_BELOW_HEAD, null);
    this.reportPlacement('forced surface (SYNTHETIC, ?forceSurface)', 'synthetic', null);
  }

  /** Reads head position, flattened yaw, and pitch (positive = looking down). */
  private readHeadPose(): void {
    this.player.head.updateWorldMatrix(true, false);
    this._headPos.setFromMatrixPosition(this.player.head.matrixWorld);
    this._headQuat.setFromRotationMatrix(this.player.head.matrixWorld);
    this._headEuler.setFromQuaternion(this._headQuat, 'YXZ');
    this._headYaw = this._headEuler.y;
    this._headPitchDown = -this._headEuler.x;
  }

  private setYawAxes(yaw: number): void {
    this._forward.set(0, 0, -1).applyAxisAngle(UP_AXIS, yaw);
    this._right.set(1, 0, 0).applyAxisAngle(UP_AXIS, yaw);
  }

  /**
   * Never-yank rule: placement never moves a slab the user has grabbed this
   * session, nor one docked into a join (even one joined without a grab).
   */
  private isFrozen(entity: Entity, touched: boolean): boolean {
    return touched || entity.hasComponent(JoinDocked);
  }

  private slabHeightMeters(doc: TableSlabDocument): number {
    const size = doc.document.computedSize;
    return size && size.height > 0 ? size.height / 100 : doc.heightMeters;
  }

  /**
   * Horizontal head distance for a reference point such that an edge `drop`
   * meters below eye level (negative = above), lying `edgeOffset` meters
   * farther away than that reference point, is inside the comfortable view.
   */
  private edgeFitDistance(drop: number, edgeOffset: number): number {
    // Against the natural seated gaze, not the head's pitch at placement time.
    return minDistanceForDrop(drop, NATURAL_GAZE_PITCH_RAD) - edgeOffset;
  }

  /** Largest horizontal center distance keeping a center `drop` below the eyes within reach. */
  private floatingReachForward(drop: number, lateral: number): number {
    const r2 = TOUCH_REACH_MAX_METERS * TOUCH_REACH_MAX_METERS - drop * drop - lateral * lateral;
    return r2 > 0 ? Math.sqrt(r2) : 0;
  }

  /**
   * Largest bottom-edge distance keeping a propped slab's center within
   * reach, for a given lean: its center sits `half` up the slab from the
   * bottom edge, which rests `eyeRise` below the eyes.
   */
  private surfaceReachForward(eyeRise: number, half: number, lean: number, lateral: number): number {
    const centerDrop = eyeRise - half * Math.cos(lean);
    const r2 = TOUCH_REACH_MAX_METERS * TOUCH_REACH_MAX_METERS - centerDrop * centerDrop - lateral * lateral;
    return r2 > 0 ? Math.sqrt(r2) - half * Math.sin(lean) : 0;
  }

  /** Center distance keeping both edges of a floating slab in view. */
  private floatingForwardToFit(half: number, sinLean: number, cosLean: number): number {
    // Leaning back, the bottom edge is lower and nearer; the top edge higher and farther.
    return Math.max(
      this.edgeFitDistance(FLOATING_BELOW_HEAD_METERS + half * cosLean, -half * sinLean),
      this.edgeFitDistance(FLOATING_BELOW_HEAD_METERS - half * cosLean, half * sinLean),
    );
  }

  /**
   * Floating fallback: both slab centers on one line ahead of and below the
   * head, sharing the head's yaw, pushed forward if either edge of either
   * slab would leave the comfortable view -- but never past seated reach.
   */
  private placeFloating(): void {
    this.setYawAxes(this._headYaw);
    const customersHalf = this.slabHeightMeters(this.customersDoc) / 2;
    const ordersHalf = this.slabHeightMeters(this.ordersDoc) / 2;
    const leftOffset = SLAB_GAP_METERS / 2 + this.customersDoc.widthMeters / 2;
    const rightOffset = SLAB_GAP_METERS / 2 + this.ordersDoc.widthMeters / 2;
    const reachForward = Math.max(
      FLOATING_FORWARD_METERS,
      Math.min(
        this.floatingReachForward(FLOATING_BELOW_HEAD_METERS, leftOffset),
        this.floatingReachForward(FLOATING_BELOW_HEAD_METERS, rightOffset),
      ),
    );
    // Both centers sit at the same height and distance, so they share a lean.
    let forward = FLOATING_FORWARD_METERS;
    let lean = eyeFacingLean(FLOATING_BELOW_HEAD_METERS, forward);
    for (let i = 0; i < FIT_ITERATIONS; i++) {
      const sinLean = Math.sin(lean);
      const cosLean = Math.cos(lean);
      forward = Math.min(
        reachForward,
        Math.max(
          FLOATING_FORWARD_METERS,
          this.floatingForwardToFit(customersHalf, sinLean, cosLean),
          this.floatingForwardToFit(ordersHalf, sinLean, cosLean),
        ),
      );
      lean = eyeFacingLean(FLOATING_BELOW_HEAD_METERS, forward);
    }
    this._anchor.copy(this._headPos).addScaledVector(this._forward, forward);
    this._anchor.y = this._headPos.y - FLOATING_BELOW_HEAD_METERS;

    if (!this.isFrozen(this.customersEntity, this.touchedCustomers)) {
      this._slabCenter.copy(this._anchor).addScaledVector(this._right, -leftOffset);
      this.applySlabTransform(this.customersEntity, this._slabCenter, lean);
    }
    if (!this.isFrozen(this.ordersEntity, this.touchedOrders)) {
      this._slabCenter.copy(this._anchor).addScaledVector(this._right, rightOffset);
      this.applySlabTransform(this.ordersEntity, this._slabCenter, lean);
    }
    this.warnIfOutOfView();
  }

  /**
   * Surface placement: both slabs share the head's yaw and stand side by
   * side with their bottom edges on the surface along one line
   * SURFACE_FORWARD_METERS ahead of the head (farther if needed to stay in
   * view, up to reach), each propped up so its face points at the eyes.
   * With a detected surface, that line's midpoint is clamped to the
   * surface's footprint.
   */
  private placeOnSurface(surfaceY: number, surface: SurfaceAssessment | null): void {
    this.setYawAxes(this._headYaw);

    const customersHeight = this.slabHeightMeters(this.customersDoc);
    const ordersHeight = this.slabHeightMeters(this.ordersDoc);
    const eyeRise = this._headPos.y - (surfaceY + SURFACE_LIFT_METERS);
    const leftOffset = SLAB_GAP_METERS / 2 + this.customersDoc.widthMeters / 2;
    const rightOffset = SLAB_GAP_METERS / 2 + this.ordersDoc.widthMeters / 2;

    // Each slab leans to face the eyes from its own center; the bottom-edge
    // distance keeps both edges of both slabs in view, unless that would put
    // a center out of reach (reach wins). They depend on each other, so
    // alternate a few times.
    let forward = SURFACE_FORWARD_METERS;
    for (let i = 0; i < FIT_ITERATIONS; i++) {
      const customersLean = eyeFacingLeanFromBottom(eyeRise, forward, customersHeight);
      const ordersLean = eyeFacingLeanFromBottom(eyeRise, forward, ordersHeight);
      const reachForward = Math.max(
        SURFACE_FORWARD_METERS,
        Math.min(
          this.surfaceReachForward(eyeRise, customersHeight / 2, customersLean, leftOffset),
          this.surfaceReachForward(eyeRise, ordersHeight / 2, ordersLean, rightOffset),
        ),
      );
      forward = Math.min(
        reachForward,
        Math.max(
          SURFACE_FORWARD_METERS,
          this.surfaceForwardToFit(surfaceY, customersHeight / 2, Math.sin(customersLean), Math.cos(customersLean)),
          this.surfaceForwardToFit(surfaceY, ordersHeight / 2, Math.sin(ordersLean), Math.cos(ordersLean)),
        ),
      );
    }

    this._anchor.copy(this._headPos).addScaledVector(this._forward, forward);
    this._anchor.y = surfaceY;

    const object = surface?.entity?.object3D;
    if (surface && surface.hasBounds && object) {
      object.updateWorldMatrix(true, false);
      object.worldToLocal(this._anchor);
      this._anchor.x = MathUtils.clamp(this._anchor.x, surface.minX, surface.maxX);
      this._anchor.z = MathUtils.clamp(this._anchor.z, surface.minZ, surface.maxZ);
      this._anchor.y = surface.topY;
      object.localToWorld(this._anchor);
    }

    // Final leans from where the bottom edges actually ended up (the clamp
    // to the surface footprint may have moved them).
    this._local.subVectors(this._anchor, this._headPos);
    const anchorForward = Math.max(0.05, this._local.dot(this._forward));
    const anchorEyeRise = this._headPos.y - (this._anchor.y + SURFACE_LIFT_METERS);
    if (!this.isFrozen(this.customersEntity, this.touchedCustomers)) {
      const lean = eyeFacingLeanFromBottom(anchorEyeRise, anchorForward, customersHeight);
      this.proppedCenter(-leftOffset, customersHeight / 2, Math.sin(lean), Math.cos(lean));
      this.applySlabTransform(this.customersEntity, this._slabCenter, lean);
    }
    if (!this.isFrozen(this.ordersEntity, this.touchedOrders)) {
      const lean = eyeFacingLeanFromBottom(anchorEyeRise, anchorForward, ordersHeight);
      this.proppedCenter(rightOffset, ordersHeight / 2, Math.sin(lean), Math.cos(lean));
      this.applySlabTransform(this.ordersEntity, this._slabCenter, lean);
    }
    this.warnIfOutOfView();
  }

  /** Bottom-edge distance keeping both edges of a propped slab in view. */
  private surfaceForwardToFit(surfaceY: number, half: number, sinLean: number, cosLean: number): number {
    const bottomY = surfaceY + SURFACE_LIFT_METERS;
    const topY = bottomY + 2 * half * cosLean;
    return Math.max(
      this.edgeFitDistance(this._headPos.y - bottomY, 0),
      this.edgeFitDistance(this._headPos.y - topY, 2 * half * sinLean),
    );
  }

  private proppedCenter(lateral: number, half: number, sinLean: number, cosLean: number): void {
    this._slabCenter
      .copy(this._anchor)
      .addScaledVector(this._right, lateral)
      .addScaledVector(this._forward, half * sinLean);
    this._slabCenter.y += SURFACE_LIFT_METERS + half * cosLean;
  }

  private applySlabTransform(entity: Entity, center: Vector3, leanFromVertical: number): void {
    const object = entity.object3D;
    if (!object) {
      return;
    }
    object.position.copy(center);
    // Shared yaw for both slabs: the head's flattened yaw makes each slab's
    // +Z face point back toward the viewer, like two sheets side by side.
    object.rotation.set(-leanFromVertical, this._headYaw, 0, 'YXZ');
  }

  /** Measures a placed slab's top/bottom edges into `_edges`. */
  private measureEdges(entity: Entity, doc: TableSlabDocument): SlabEdgeAngles | null {
    const object = entity.object3D;
    if (!object) {
      return null;
    }
    const half = this.slabHeightMeters(doc) / 2;
    return measureSlabEdges(this._headPos, NATURAL_GAZE_PITCH_RAD, object, half, -half, this._local, this._edges);
  }

  /** Eye-to-center distance of a placed slab (NaN without an object). */
  private eyeDistance(entity: Entity): number {
    const object = entity.object3D;
    if (!object) {
      return NaN;
    }
    object.updateWorldMatrix(true, false);
    this._center.setFromMatrixPosition(object.matrixWorld);
    return this._center.distanceTo(this._headPos);
  }

  /** Dev-only (`?debug=1`): warns when a placed slab's edge is still out of view. */
  private warnIfOutOfView(): void {
    if (!import.meta.env.DEV || !this.debug) {
      return;
    }
    this.warnSlabOutOfView(this.customersEntity, this.customersDoc, this.touchedCustomers, 'customers');
    this.warnSlabOutOfView(this.ordersEntity, this.ordersDoc, this.touchedOrders, 'orders');
  }

  private warnSlabOutOfView(entity: Entity, doc: TableSlabDocument, touched: boolean, name: string): void {
    if (this.isFrozen(entity, touched)) {
      return;
    }
    const edges = this.measureEdges(entity, doc);
    if (edges && !edges.fits) {
      console.warn(
        `[DeskPlacement] ${name} slab edges are outside the comfortable view (top ` +
          `${edges.topDeg.toFixed(1)}°, bottom ${edges.bottomDeg.toFixed(1)}° from the natural gaze ` +
          `(${NATURAL_GAZE_PITCH_DEG}° down); limits -${VIEW_MAX_BELOW_GAZE_DEG}°/+${VIEW_MAX_ABOVE_GAZE_DEG}°): ` +
          `reach (${TOUCH_REACH_MAX_METERS} m) wins, ` +
          `or the slab is clamped to the surface edge.`,
      );
    }
    const distance = this.eyeDistance(entity);
    const textDeg = textAngleDeg(doc.rowFontMeters, distance);
    if (Math.abs(textDeg / ROW_TEXT_TARGET_DEG - 1) > TEXT_ANGLE_TOLERANCE) {
      console.warn(
        `[DeskPlacement] ${name} slab row text is ${textDeg.toFixed(2)}° at ${distance.toFixed(2)} m, more than ` +
          `${TEXT_ANGLE_TOLERANCE * 100}% off the ${ROW_TEXT_TARGET_DEG}° target (fonts are sized for ` +
          `${PLANNED_SOURCE_DISTANCE_METERS} m).`,
      );
    }
    if (distance > TOUCH_REACH_MAX_METERS + 0.005) {
      console.warn(
        `[DeskPlacement] ${name} slab center is ${distance.toFixed(2)} m from the eyes, ` +
          `beyond the ${TOUCH_REACH_MAX_METERS} m seated reach limit.`,
      );
    }
  }

  /** Dev-only: evaluates every current candidate into fresh records. */
  private collectCandidates(): SurfaceAssessment[] {
    const records: SurfaceAssessment[] = [];
    for (const entity of this.queries.tableMeshes.entities) {
      const record = createAssessment();
      this.assessSurface(entity, 'mesh', record);
      records.push(record);
    }
    for (const entity of this.queries.tablePlanes.entities) {
      const record = createAssessment();
      this.assessSurface(entity, 'plane', record);
      records.push(record);
    }
    return records;
  }

  private reportPlacement(event: string, kind: PlacementKind, chosen: SurfaceAssessment | null): void {
    if (!import.meta.env.DEV || !this.debug) {
      return;
    }
    const slabs: SlabReport[] = [
      this.slabReport('customers', this.customersEntity, this.customersDoc, this.touchedCustomers),
      this.slabReport('orders', this.ordersEntity, this.ordersDoc, this.touchedOrders),
    ];
    const syntheticY = kind === 'synthetic' ? this._headPos.y - FORCE_SURFACE_HEIGHT_BELOW_HEAD : null;
    this._basePos.copy(this._headPos);
    this.debug.logPlacement({
      event,
      kind,
      headPosition: this._basePos,
      headYawDeg: MathUtils.radToDeg(this._headYaw),
      headPitchDownDeg: MathUtils.radToDeg(this._headPitchDown),
      candidates: this.collectCandidates(),
      chosen: chosen?.entity ?? null,
      synthetic:
        syntheticY === null
          ? null
          : {
              y: syntheticY,
              heightBelowHead: FORCE_SURFACE_HEIGHT_BELOW_HEAD,
              center: this._anchor.clone(),
              yaw: this._headYaw,
            },
      slabs,
    });
  }

  private slabReport(name: string, entity: Entity, doc: TableSlabDocument, touched: boolean): SlabReport {
    const object = entity.object3D;
    const position = object ? object.position.clone() : new Vector3(NaN, NaN, NaN);
    const leanRad = object ? -object.rotation.x : NaN;
    const edges = this.measureEdges(entity, doc);
    return {
      name,
      touched: this.isFrozen(entity, touched),
      position,
      yawDeg: object ? MathUtils.radToDeg(object.rotation.y) : NaN,
      tiltFromFlatDeg: 90 - MathUtils.radToDeg(leanRad),
      topEdgeDeg: edges ? edges.topDeg : NaN,
      bottomEdgeDeg: edges ? edges.bottomDeg : NaN,
      edgesFit: edges ? edges.fits : false,
      eyeDistance: this.eyeDistance(entity),
      maxBelowDeg: VIEW_MAX_BELOW_GAZE_DEG,
      rowFontCm: doc.rowFontMeters * 100,
      rowTextDeg: textAngleDeg(doc.rowFontMeters, this.eyeDistance(entity)),
    };
  }
}
