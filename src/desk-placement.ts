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

const FLOATING_FORWARD_METERS = 0.45;
const FLOATING_BELOW_HEAD_METERS = 0.32;
const FLOATING_TILT_DEG = 18;
// Rotating the panel's +Z-facing normal by a negative angle around local X
// tilts it upward toward the viewer's eyes (the panel sits below eye height
// looking up), rather than downward. Not yet visually verified.
const TILT_RADIANS = -MathUtils.degToRad(FLOATING_TILT_DEG);

const SLAB_GAP_METERS = 0.04;

// Dev-only: forces the "surface found" outcome at a fixed height so the
// snap path is testable without relying on the emulator's room layout or
// timing. `import.meta.env.DEV` is a compile-time constant under Vite (the
// same idiom @iwsdk/core's own grab-warnings.js uses), so this branch is
// dead-code-eliminated from production builds regardless of the query
// string.
const FORCE_SURFACE_QUERY_PARAM = 'forceSurface';
const FORCE_SURFACE_HEIGHT_BELOW_HEAD = 0.75;

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

  // Reusable scratch objects -- allocated once, never inside update().
  private _headPos = new Vector3();
  private _headQuat = new Quaternion();
  private _headEuler = new Euler();
  private _forward = new Vector3();
  private _right = new Vector3();
  private _candidatePos = new Vector3();
  private _basePos = new Vector3();

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

    this.forceSurfaceRequested =
      import.meta.env.DEV &&
      new URLSearchParams(window.location.search).has(FORCE_SURFACE_QUERY_PARAM);

    // Fast cold start: visible immediately, before any XR session exists,
    // using the project's documented default standing pose.
    this._basePos.set(0, 1.6, 0);
    this.placePairAt(this._basePos, 0, FLOATING_FORWARD_METERS, FLOATING_BELOW_HEAD_METERS, this._basePos);

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
  }

  private onSessionEnd(): void {
    this.searching = false;
  }

  private beginSessionPlacement(): void {
    this.player.head.updateWorldMatrix(true, false);
    this._headPos.setFromMatrixPosition(this.player.head.matrixWorld);
    this._headQuat.setFromRotationMatrix(this.player.head.matrixWorld);
    this._headEuler.setFromQuaternion(this._headQuat, 'YXZ');
    const yaw = this._headEuler.y;

    this.placePairAt(this._headPos, yaw, FLOATING_FORWARD_METERS, FLOATING_BELOW_HEAD_METERS, this._headPos);

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
      this.evaluateMeshCandidate(entity);
    }
    for (const entity of this.queries.tablePlanes.entities) {
      this.evaluatePlaneCandidate(entity);
    }

    if (this.bestCandidateEntity !== null && this.bestCandidateEntity === previousBest) {
      this.bestCandidateStableSeconds += delta;
    } else {
      this.bestCandidateStableSeconds = 0;
    }

    const stable =
      this.bestCandidateEntity !== null && this.bestCandidateStableSeconds >= STABLE_COMMIT_SECONDS;
    if (stable || this.searchElapsed >= SEARCH_TIMEOUT_SECONDS) {
      this.commitSearch();
    }
  }

  private evaluateMeshCandidate(entity: Entity): void {
    const isBounded = entity.getValue(XRMesh, 'isBounded3D');
    const label = entity.getValue(XRMesh, 'semanticLabel');
    if (!isBounded || (label !== 'table' && label !== 'desk')) {
      return;
    }
    this.evaluateCandidate(entity);
  }

  private evaluatePlaneCandidate(entity: Entity): void {
    const plane = entity.getValue(XRPlane, '_plane') as { orientation?: string } | null;
    if (!plane || (plane.orientation ?? '').toLowerCase() !== 'horizontal') {
      return;
    }
    this.evaluateCandidate(entity);
  }

  private evaluateCandidate(entity: Entity): void {
    const object = entity.object3D;
    if (!object) {
      return;
    }
    object.updateWorldMatrix(true, false);
    this._candidatePos.setFromMatrixPosition(object.matrixWorld);

    const heightBelowHead = this._headPos.y - this._candidatePos.y;
    if (heightBelowHead < SURFACE_HEIGHT_BELOW_HEAD.min || heightBelowHead > SURFACE_HEIGHT_BELOW_HEAD.max) {
      return;
    }

    const dx = this._candidatePos.x - this._headPos.x;
    const dz = this._candidatePos.z - this._headPos.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance < this.scanBestDistance) {
      this.scanBestDistance = distance;
      this.bestCandidateEntity = entity;
    }
  }

  private commitSearch(): void {
    this.searching = false;
    const candidate = this.bestCandidateEntity;
    if (!candidate) {
      // No candidate ever qualified -- stay at the floating pose already
      // placed in beginSessionPlacement(). The explicit "bus or plane" case.
      return;
    }

    const object = candidate.object3D;
    if (!object) {
      return;
    }
    object.updateWorldMatrix(true, false);
    this._candidatePos.setFromMatrixPosition(object.matrixWorld);

    this.player.head.updateWorldMatrix(true, false);
    this._headPos.setFromMatrixPosition(this.player.head.matrixWorld);
    this._headQuat.setFromRotationMatrix(this.player.head.matrixWorld);
    this._headEuler.setFromQuaternion(this._headQuat, 'YXZ');
    const yaw = this._headEuler.y;

    let anchorX = this._candidatePos.x;
    let anchorZ = this._candidatePos.z;
    let surfaceY = this._candidatePos.y;

    // XRMesh carries a local-space AABB; clamp the anchor toward the head
    // within it so the slabs land on the part of the surface nearest the
    // user. Assumes the mesh's world rotation is close to axis-aligned
    // (true for the surfaces this targets) -- not a full oriented-box
    // clamp. XRPlane has no equivalent envelope, so its own reference point
    // is used as-is.
    if (candidate.hasComponent(XRMesh)) {
      const min = candidate.getVectorView(XRMesh, 'min');
      const max = candidate.getVectorView(XRMesh, 'max');
      const worldMinX = this._candidatePos.x + min[0];
      const worldMaxX = this._candidatePos.x + max[0];
      const worldMinZ = this._candidatePos.z + min[2];
      const worldMaxZ = this._candidatePos.z + max[2];
      anchorX = MathUtils.clamp(this._headPos.x, worldMinX, worldMaxX);
      anchorZ = MathUtils.clamp(this._headPos.z, worldMinZ, worldMaxZ);
      surfaceY = this._candidatePos.y + max[1];
    }

    this._basePos.set(anchorX, surfaceY, anchorZ);
    this.placePairAt(this._basePos, yaw, 0, 0, this._headPos);
  }

  private commitForcedSurface(): void {
    this.searching = false;
    this.player.head.updateWorldMatrix(true, false);
    this._headPos.setFromMatrixPosition(this.player.head.matrixWorld);
    this._headQuat.setFromRotationMatrix(this.player.head.matrixWorld);
    this._headEuler.setFromQuaternion(this._headQuat, 'YXZ');
    const yaw = this._headEuler.y;

    this._basePos.set(
      this._headPos.x,
      this._headPos.y - FORCE_SURFACE_HEIGHT_BELOW_HEAD,
      this._headPos.z,
    );
    this.placePairAt(this._basePos, yaw, FLOATING_FORWARD_METERS, 0, this._headPos);
  }

  /**
   * Places both slabs side by side, centered `forwardOffsetMeters` in front
   * of `basePosition` (rotated by `yaw`) and `verticalOffsetMeters` below it,
   * spaced by each slab's own authored width plus a fixed gap. Skips any
   * slab the user has already grabbed this session. Each slab's yaw is then
   * corrected individually via atan2 toward `facingTarget` so an off-center
   * slab still faces the viewer correctly.
   */
  private placePairAt(
    basePosition: Vector3,
    yaw: number,
    forwardOffsetMeters: number,
    verticalOffsetMeters: number,
    facingTarget: Vector3,
  ): void {
    this._forward.set(0, 0, -1).applyAxisAngle(UP_AXIS, yaw);
    this._right.set(1, 0, 0).applyAxisAngle(UP_AXIS, yaw);

    const centerX = basePosition.x + this._forward.x * forwardOffsetMeters;
    const centerZ = basePosition.z + this._forward.z * forwardOffsetMeters;
    const centerY = basePosition.y - verticalOffsetMeters;

    const leftOffset = SLAB_GAP_METERS / 2 + this.customersDoc.widthMeters / 2;
    const rightOffset = SLAB_GAP_METERS / 2 + this.ordersDoc.widthMeters / 2;

    if (!this.touchedCustomers) {
      const x = centerX - this._right.x * leftOffset;
      const z = centerZ - this._right.z * leftOffset;
      this.applySlabTransform(this.customersEntity, x, centerY, z, facingTarget);
    }
    if (!this.touchedOrders) {
      const x = centerX + this._right.x * rightOffset;
      const z = centerZ + this._right.z * rightOffset;
      this.applySlabTransform(this.ordersEntity, x, centerY, z, facingTarget);
    }
  }

  private applySlabTransform(
    entity: Entity,
    x: number,
    y: number,
    z: number,
    facingTarget: Vector3,
  ): void {
    const object = entity.object3D;
    if (!object) {
      return;
    }
    object.position.set(x, y, z);
    const faceYaw = Math.atan2(facingTarget.x - x, facingTarget.z - z);
    object.rotation.set(TILT_RADIANS, faceYaw, 0, 'YXZ');
  }
}
