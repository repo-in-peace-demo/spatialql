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
import { PlacementDebug, type PlacementKind, type SlabReport } from './placement-debug.js';
import { TableSlab, TableSlabRuntime } from './table-slab-component.js';
import { buildTableSlabDocument, type TableSlabDocument } from './table-slab-view.js';

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

// Floating fallback: slab centers this far ahead of / below the head, tilted
// back from vertical by FLOATING_TILT_DEG.
const FLOATING_FORWARD_METERS = 0.45;
const FLOATING_BELOW_HEAD_METERS = 0.32;
const FLOATING_TILT_DEG = 18;

// On a surface: the slabs' bottom edges sit this far ahead of the head
// (horizontally), propped up like a lectern at this angle from the desk.
const SURFACE_FORWARD_METERS = 0.6;
const SURFACE_TILT_FROM_FLAT_DEG = 40;
// Keeps the bottom edge from z-fighting with the surface it rests on.
const SURFACE_LIFT_METERS = 0.002;

// Field-of-view guard: a slab center may sit at most this far below the
// head's forward direction; if it would sit lower, the slabs move farther
// forward, but never beyond this horizontal reach from the head.
const FOV_MAX_BELOW_FORWARD_DEG = 38;
const MAX_REACH_METERS = 0.75;

// A slab rotated by a negative angle around its local X axis has its
// +Z-facing normal tilted upward, toward eyes above it. Expressed as the
// panel's lean back from vertical.
const FLOATING_TILT_FROM_VERTICAL_RAD = MathUtils.degToRad(FLOATING_TILT_DEG);
const SURFACE_TILT_FROM_VERTICAL_RAD = MathUtils.degToRad(90 - SURFACE_TILT_FROM_FLAT_DEG);
const FOV_MAX_BELOW_FORWARD_RAD = MathUtils.degToRad(FOV_MAX_BELOW_FORWARD_DEG);

const SLAB_GAP_METERS = 0.04;

// Dev-only: forces the "surface found" outcome at a fixed head-relative
// height (a realistic seated desk) so the snap path is testable without
// relying on the emulator's room layout or timing. `import.meta.env.DEV` is a
// compile-time constant under Vite (the same idiom @iwsdk/core's own
// grab-warnings.js uses), so this branch is dead-code-eliminated from
// production builds regardless of the query string.
const FORCE_SURFACE_QUERY_PARAM = 'forceSurface';
const FORCE_SURFACE_HEIGHT_BELOW_HEAD = 0.45;
// Dev-only: `?debug=1` logs placement decisions and outlines surface
// candidates in the scene. Stripped from production builds the same way.
const DEBUG_QUERY_PARAM = 'debug';

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

  init(): void {
    this.customersDoc = buildTableSlabDocument(CUSTOMERS_TABLE);
    this.ordersDoc = buildTableSlabDocument(ORDERS_TABLE);

    this.customersEntity = this.world.createTransformEntity(this.customersDoc.document);
    this.customersEntity.addComponent(TableSlab, { tableId: CUSTOMERS_TABLE.id });
    this.customersEntity.addComponent(TableSlabRuntime, {
      document: this.customersDoc.document,
      rowViews: this.customersDoc.rowViews,
    });
    this.customersEntity.addComponent(OneHandGrabbable, {});

    this.ordersEntity = this.world.createTransformEntity(this.ordersDoc.document);
    this.ordersEntity.addComponent(TableSlab, { tableId: ORDERS_TABLE.id });
    this.ordersEntity.addComponent(TableSlabRuntime, {
      document: this.ordersDoc.document,
      rowViews: this.ordersDoc.rowViews,
    });
    this.ordersEntity.addComponent(OneHandGrabbable, {});

    const params = new URLSearchParams(window.location.search);
    this.forceSurfaceRequested = import.meta.env.DEV && params.has(FORCE_SURFACE_QUERY_PARAM);
    this.debug =
      import.meta.env.DEV && params.has(DEBUG_QUERY_PARAM) ? new PlacementDebug(this.world) : null;
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
   * Horizontal distance at which a point `drop` meters below the head sits
   * exactly FOV_MAX_BELOW_FORWARD_DEG below the head's forward direction.
   */
  private requiredHorizontalDistance(drop: number): number {
    const allowedBelowHorizontal = FOV_MAX_BELOW_FORWARD_RAD + this._headPitchDown;
    if (drop <= 0 || allowedBelowHorizontal >= Math.PI / 2 - 1e-3) {
      return 0;
    }
    if (allowedBelowHorizontal <= 0) {
      return Infinity;
    }
    return drop / Math.tan(allowedBelowHorizontal);
  }

  private slabHeightMeters(doc: TableSlabDocument): number {
    const size = doc.document.computedSize;
    return size && size.height > 0 ? size.height / 100 : doc.heightMeters;
  }

  /**
   * Floating fallback: both slab centers on one line ahead of and below the
   * head, sharing the head's yaw, pushed forward (up to reach) if they'd sit
   * too far below the view.
   */
  private placeFloating(): void {
    this.setYawAxes(this._headYaw);
    const forward = Math.min(
      MAX_REACH_METERS,
      Math.max(FLOATING_FORWARD_METERS, this.requiredHorizontalDistance(FLOATING_BELOW_HEAD_METERS)),
    );
    this._anchor.copy(this._headPos).addScaledVector(this._forward, forward);
    this._anchor.y = this._headPos.y - FLOATING_BELOW_HEAD_METERS;

    const leftOffset = SLAB_GAP_METERS / 2 + this.customersDoc.widthMeters / 2;
    const rightOffset = SLAB_GAP_METERS / 2 + this.ordersDoc.widthMeters / 2;
    if (!this.touchedCustomers) {
      this._slabCenter.copy(this._anchor).addScaledVector(this._right, -leftOffset);
      this.applySlabTransform(this.customersEntity, this._slabCenter, FLOATING_TILT_FROM_VERTICAL_RAD);
    }
    if (!this.touchedOrders) {
      this._slabCenter.copy(this._anchor).addScaledVector(this._right, rightOffset);
      this.applySlabTransform(this.ordersEntity, this._slabCenter, FLOATING_TILT_FROM_VERTICAL_RAD);
    }
    this.warnIfOutOfView();
  }

  /**
   * Surface placement: both slabs share the head's yaw and stand side by
   * side with their bottom edges on the surface along one line
   * SURFACE_FORWARD_METERS ahead of the head (farther if needed to stay in
   * view, up to reach), propped up SURFACE_TILT_FROM_FLAT_DEG from the desk.
   * With a detected surface, that line's midpoint is clamped to the
   * surface's footprint.
   */
  private placeOnSurface(surfaceY: number, surface: SurfaceAssessment | null): void {
    this.setYawAxes(this._headYaw);

    // Bottom edge -> center offset of a propped slab: up by `rise`, away
    // from the viewer by `back`.
    const sinLean = Math.sin(SURFACE_TILT_FROM_VERTICAL_RAD);
    const cosLean = Math.cos(SURFACE_TILT_FROM_VERTICAL_RAD);
    const customersHalf = this.slabHeightMeters(this.customersDoc) / 2;
    const ordersHalf = this.slabHeightMeters(this.ordersDoc) / 2;

    const forward = Math.min(
      MAX_REACH_METERS,
      Math.max(
        SURFACE_FORWARD_METERS,
        this.surfaceForwardToFit(surfaceY, customersHalf, sinLean, cosLean),
        this.surfaceForwardToFit(surfaceY, ordersHalf, sinLean, cosLean),
      ),
    );

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

    const leftOffset = SLAB_GAP_METERS / 2 + this.customersDoc.widthMeters / 2;
    const rightOffset = SLAB_GAP_METERS / 2 + this.ordersDoc.widthMeters / 2;
    if (!this.touchedCustomers) {
      this.proppedCenter(-leftOffset, customersHalf, sinLean, cosLean);
      this.applySlabTransform(this.customersEntity, this._slabCenter, SURFACE_TILT_FROM_VERTICAL_RAD);
    }
    if (!this.touchedOrders) {
      this.proppedCenter(rightOffset, ordersHalf, sinLean, cosLean);
      this.applySlabTransform(this.ordersEntity, this._slabCenter, SURFACE_TILT_FROM_VERTICAL_RAD);
    }
    this.warnIfOutOfView();
  }

  /** Bottom-edge distance that puts a propped slab's center at the FOV limit. */
  private surfaceForwardToFit(surfaceY: number, half: number, sinLean: number, cosLean: number): number {
    const drop = this._headPos.y - (surfaceY + SURFACE_LIFT_METERS + half * cosLean);
    return this.requiredHorizontalDistance(drop) - half * sinLean;
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

  /** Degrees a point sits below the head's forward direction. */
  private degreesBelowForward(point: Vector3): number {
    const dx = point.x - this._headPos.x;
    const dz = point.z - this._headPos.z;
    const pitchToPoint = Math.atan2(point.y - this._headPos.y, Math.sqrt(dx * dx + dz * dz));
    return MathUtils.radToDeg(-this._headPitchDown - pitchToPoint);
  }

  private warnIfOutOfView(): void {
    this.warnSlabOutOfView(this.customersEntity, this.touchedCustomers, 'customers');
    this.warnSlabOutOfView(this.ordersEntity, this.touchedOrders, 'orders');
  }

  private warnSlabOutOfView(entity: Entity, touched: boolean, name: string): void {
    const object = entity.object3D;
    if (touched || !object) {
      return;
    }
    const below = this.degreesBelowForward(object.position);
    if (below > FOV_MAX_BELOW_FORWARD_DEG + 0.5) {
      console.warn(
        `[DeskPlacement] ${name} slab center is ${below.toFixed(1)}° below the head's forward ` +
          `direction (limit ${FOV_MAX_BELOW_FORWARD_DEG}°) even at max reach ${MAX_REACH_METERS} m ` +
          `or clamped to the surface edge.`,
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
      this.slabReport('customers', this.customersEntity, this.touchedCustomers),
      this.slabReport('orders', this.ordersEntity, this.touchedOrders),
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

  private slabReport(name: string, entity: Entity, touched: boolean): SlabReport {
    const object = entity.object3D;
    const position = object ? object.position.clone() : new Vector3(NaN, NaN, NaN);
    const leanRad = object ? -object.rotation.x : NaN;
    return {
      name,
      touched,
      position,
      yawDeg: object ? MathUtils.radToDeg(object.rotation.y) : NaN,
      tiltFromFlatDeg: 90 - MathUtils.radToDeg(leanRad),
      degreesBelowForward: this.degreesBelowForward(position),
    };
  }
}
