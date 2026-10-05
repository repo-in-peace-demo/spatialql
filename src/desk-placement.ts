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
import { CHALLENGE_MODE } from './challenge-mode.js';
import { challengeStart } from './challenge-start.js';
import { DATASETS, type DatasetId } from './data/datasets.js';
import { deskTransition, type DeskState } from './data/desk-session.js';
import { tableLabel } from './data/join-result.js';
import type { Table } from './data/types.js';
import { deskBridge, type DeskControls } from './desk-bridge.js';
import { devFlag } from './dev-flags.js';
import { PlacementDebug, type PlacementKind, type SlabReport } from './placement-debug.js';
import { sounds } from './sound.js';
import { JoinDocked, TableSlab, TableSlabRuntime } from './table-slab-component.js';
import { buildTableSlabDocument, type TableSlabDocument } from './table-slab-view.js';
import { easeInCubic, easeOutCubic } from './tween.js';
import {
  eyeFacingLean,
  eyeFacingLeanFromBottom,
  measureSlabEdges,
  minDistanceForDrop,
  NATURAL_GAZE_PITCH_RAD,
  PLANNED_SOURCE_DISTANCE_METERS,
  slabTextSizeAt,
  textAngleDeg,
  TOUCH_REACH_MAX_METERS,
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

// Challenge mode's dataset switch: the old slabs sink and fade, the new ones
// are built one per frame, then rise and fade in, a little apart.
const SWITCH_SINK_METERS = 0.06;
const SWITCH_LEAVE_SECONDS = 0.35;
const SWITCH_ARRIVE_SECONDS = 0.35;
const SWITCH_ARRIVE_STAGGER_SECONDS = 0.08;

/** One source slab on the desk: the dataset's parent table is slabs[0] (left), the child slabs[1] (right). */
type Slab = {
  table: Table;
  doc: TableSlabDocument;
  entity: Entity;
  /** Grabbed this session: placement never moves it again (never-yank). */
  touched: boolean;
  // Switch animation: from / to positions along the slab's own up axis.
  from: Vector3;
  to: Vector3;
  landed: boolean;
};

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

export class DeskPlacementSystem
  extends createSystem({
    tableMeshes: { required: [XRMesh] },
    tablePlanes: { required: [XRPlane] },
    grabbedSlabs: { required: [TableSlab, Grabbed] },
  })
  implements DeskControls
{
  /** The two source slabs of the dataset on the desk (empty mid-switch, between leaving and building). */
  private slabs: Slab[] = [];
  private deskStateValue: DeskState = { phase: 'ready', dataset: 'shop' };
  /** A requested dataset, waiting for the join to be idle and no slab held. */
  private pendingDataset: DatasetId | null = null;
  private switchClock = 0;
  private switchStartMs = 0;
  /** True only while placing new slabs for a switch (placement is otherwise paused mid-switch). */
  private placingForSwitch = false;
  /** The surface last snapped to (its top Y, and its assessment if detected), reused when tables switch. */
  private lastSurfaceY: number | null = null;
  private lastSurface: SurfaceAssessment | null = null;

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
    // Each slab keeps its natural height; their bottom edges share one line
    // (on a desk, both rest on it), like two sheets of different lengths.
    // Text is sized by angle for the planned seated distance, once per slab:
    // documents aren't rebuilt when placed (the readout logs the real angle).
    // Free play is the shop; challenge mode starts on the resume puzzle's
    // dataset (after a reload, not always the shop).
    const dataset: DatasetId = CHALLENGE_MODE ? challengeStart().datasetId : 'shop';
    this.deskStateValue = { phase: 'ready', dataset };
    for (const table of DATASETS[dataset].tables) {
      this.slabs.push(this.createSlab(table, true));
    }
    if (CHALLENGE_MODE) {
      deskBridge.desk = this;
      this.cleanupFuncs.push(() => {
        if (deskBridge.desk === this) {
          deskBridge.desk = null;
        }
      });
    }

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
      const slab = this.slabs.find((s) => s.entity === entity);
      if (slab) {
        slab.touched = true;
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

  // --- Desk: the dataset on it, and switching (challenge mode) -------------------------

  get deskState(): DeskState {
    return this.deskStateValue;
  }

  requestDataset(dataset: DatasetId): void {
    const state = this.deskStateValue;
    if (state.phase === 'ready' && state.dataset !== dataset) {
      this.pendingDataset = dataset;
    }
  }

  anySlabHeld(): boolean {
    return this.queries.grabbedSlabs.entities.size > 0;
  }

  /** Builds one source slab's document and entity (grabbable now, or once it has landed). */
  private createSlab(table: Table, grabbable: boolean): Slab {
    const text = slabTextSizeAt(PLANNED_SOURCE_DISTANCE_METERS);
    const dataset = DATASETS[this.deskDatasetFor(table)];
    // The name tab (both modes), in the dataset accent in challenge mode.
    const doc = buildTableSlabDocument(table, {
      text,
      title: tableLabel(table),
      ...(CHALLENGE_MODE ? { accent: dataset.theme.accent } : {}),
    });
    const entity = this.world.createTransformEntity(doc.document);
    entity.addComponent(TableSlab, { tableId: table.id });
    entity.addComponent(TableSlabRuntime, { document: doc.document, rowViews: doc.rowViews, layout: doc });
    if (grabbable) {
      entity.addComponent(OneHandGrabbable, {});
    }
    return { table, doc, entity, touched: false, from: new Vector3(), to: new Vector3(), landed: grabbable };
  }

  private deskDatasetFor(table: Table): DatasetId {
    return (Object.keys(DATASETS) as DatasetId[]).find((id) => DATASETS[id].tables.includes(table)) ?? 'shop';
  }

  /** The slab's up axis (leaning back with it), into `out`. */
  private slabUp(slab: Slab, out: Vector3): Vector3 {
    const object = slab.entity.object3D;
    return object ? out.set(0, 1, 0).applyQuaternion(object.quaternion) : out.set(0, 1, 0);
  }

  /**
   * The switch, a phase per frame: waits for a quiet desk (no slab held or
   * docked, no surface search), then the old slabs sink and fade and are
   * disposed; the new ones are built one per frame, placed for their sizes
   * on the surface already found, then rise and fade in, becoming
   * grabbable as each lands.
   */
  private updateSwitch(delta: number): void {
    const state = this.deskStateValue;
    if (state.phase === 'ready') {
      const target = this.pendingDataset;
      const docked = this.slabs.some((slab) => slab.entity.hasComponent(JoinDocked));
      if (target === null || this.anySlabHeld() || docked || this.searching) {
        return;
      }
      this.pendingDataset = null;
      this.deskStateValue = deskTransition(state, { type: 'request', dataset: target });
      this.switchClock = 0;
      this.switchStartMs = performance.now();
      for (const slab of this.slabs) {
        slab.entity.removeComponent(OneHandGrabbable);
        slab.from.copy(slab.entity.object3D?.position ?? slab.from);
        this.slabUp(slab, slab.to);
      }
      this.slabMidpoint(this._center);
      sounds.playTablesOut(this._center);
      return;
    }

    if (state.phase === 'leaving') {
      this.switchClock += delta;
      const t = Math.min(1, this.switchClock / SWITCH_LEAVE_SECONDS);
      for (const slab of this.slabs) {
        // `to` holds the slab's up axis while leaving.
        slab.entity.object3D?.position.copy(slab.from).addScaledVector(slab.to, -SWITCH_SINK_METERS * easeInCubic(t));
        slab.doc.fade.value = 1 - t;
      }
      if (t >= 1) {
        for (const slab of this.slabs) {
          slab.entity.dispose();
        }
        this.slabs = [];
        this.deskStateValue = deskTransition(state, { type: 'leftDone' });
      }
      return;
    }

    if (state.phase === 'building') {
      // One document per frame, so no frame does all of them.
      const tables = DATASETS[state.to].tables;
      const table = tables[this.slabs.length];
      const slab = this.createSlab(table, false);
      slab.doc.fade.value = 0;
      this.slabs.push(slab);
      if (this.slabs.length < tables.length) {
        return;
      }
      // Both built: place them for their sizes, then start them one sink-depth down.
      this.placingForSwitch = true;
      if (this.lastSurfaceY !== null) {
        this.placeOnSurface(this.lastSurfaceY, this.lastSurface);
      } else {
        this.placeFloating();
      }
      this.placingForSwitch = false;
      for (const slab of this.slabs) {
        const object = slab.entity.object3D;
        if (!object) {
          continue;
        }
        slab.to.copy(object.position);
        this.slabUp(slab, this._local);
        slab.from.copy(slab.to).addScaledVector(this._local, -SWITCH_SINK_METERS);
        object.position.copy(slab.from);
      }
      this.deskStateValue = deskTransition(state, { type: 'built' });
      this.switchClock = 0;
      this.slabMidpoint(this._center);
      sounds.playTablesIn(this._center);
      return;
    }

    // Arriving.
    this.switchClock += delta;
    let allLanded = true;
    this.slabs.forEach((slab, i) => {
      const t = MathUtils.clamp((this.switchClock - i * SWITCH_ARRIVE_STAGGER_SECONDS) / SWITCH_ARRIVE_SECONDS, 0, 1);
      const object = slab.entity.object3D;
      object?.position.lerpVectors(slab.from, slab.to, easeOutCubic(t));
      slab.doc.fade.value = t;
      if (t >= 1 && !slab.landed) {
        slab.landed = true;
        slab.entity.addComponent(OneHandGrabbable, {});
        if (object) {
          sounds.playDropTap(object.position);
        }
      }
      allLanded &&= slab.landed;
    });
    if (allLanded) {
      this.deskStateValue = deskTransition(state, { type: 'arrived' });
      if (import.meta.env.DEV && this.debug) {
        const ms = performance.now() - this.switchStartMs;
        const sizes = this.slabs
          .map((slab) => `${slab.table.id} ${(slab.doc.widthMeters * 100).toFixed(1)} x ${(slab.doc.heightMeters * 100).toFixed(1)} cm`)
          .join(', ');
        console.log(`[DeskPlacement debug] switched to ${state.to} in ${ms.toFixed(0)} ms; slabs ${sizes}`);
        this.reportPlacement(`dataset ${state.to} arrived`, this.lastSurfaceY === null ? 'floating' : 'surface', this.lastSurface);
      }
    }
  }

  /** Midpoint of the slabs (for the switch sounds). */
  private slabMidpoint(out: Vector3): Vector3 {
    out.set(0, 0, 0);
    for (const slab of this.slabs) {
      if (slab.entity.object3D) {
        out.addScaledVector(slab.entity.object3D.position, 1 / this.slabs.length);
      }
    }
    return out;
  }

  update(delta: number): void {
    if (CHALLENGE_MODE) {
      this.updateSwitch(delta);
    }
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
    for (const slab of this.slabs) {
      slab.touched = false;
    }
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

    if (this.slabs.length > 0 && this.slabs.every((slab) => slab.touched)) {
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

    this.lastSurfaceY = this._best.surfaceY;
    this.lastSurface = this._best;
    this.placeOnSurface(this._best.surfaceY, this._best);
    this.reportPlacement(`snapped to detected ${kind}`, 'surface', this._best);
  }

  private commitForcedSurface(): void {
    this.searching = false;
    this.readHeadPose();
    this.lastSurfaceY = this._headPos.y - FORCE_SURFACE_HEIGHT_BELOW_HEAD;
    this.lastSurface = null;
    this.placeOnSurface(this.lastSurfaceY, null);
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

  /** Placement runs on a full, settled desk (or for the switch's new slabs). */
  private canPlace(): boolean {
    return this.slabs.length === 2 && (this.placingForSwitch || this.deskStateValue.phase === 'ready');
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
   * Floating fallback: ahead of and below the head, sharing the head's yaw
   * and lean, with both slabs' bottom edges on one line (the taller slab's
   * center at FLOATING_BELOW_HEAD_METERS), pushed forward if either edge of
   * either slab would leave the comfortable view -- but never past reach.
   */
  private placeFloating(): void {
    if (!this.canPlace()) {
      return;
    }
    const [leftSlab, rightSlab] = this.slabs;
    this.setYawAxes(this._headYaw);
    const customersHalf = this.slabHeightMeters(leftSlab.doc) / 2;
    const ordersHalf = this.slabHeightMeters(rightSlab.doc) / 2;
    const leftOffset = SLAB_GAP_METERS / 2 + leftSlab.doc.widthMeters / 2;
    const rightOffset = SLAB_GAP_METERS / 2 + rightSlab.doc.widthMeters / 2;
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
    // `_anchor` is the taller slab's center; each slab's center sits its own
    // half-height up the leaning plane from the shared bottom line.
    this._anchor.copy(this._headPos).addScaledVector(this._forward, forward);
    this._anchor.y = this._headPos.y - FLOATING_BELOW_HEAD_METERS;
    const tallerHalf = Math.max(customersHalf, ordersHalf);
    // Up along a slab leaning back by `lean`: up, and away from the viewer.
    this._local.set(0, Math.cos(lean), 0).addScaledVector(this._forward, Math.sin(lean));

    if (!this.isFrozen(leftSlab.entity, leftSlab.touched)) {
      this._slabCenter
        .copy(this._anchor)
        .addScaledVector(this._right, -leftOffset)
        .addScaledVector(this._local, customersHalf - tallerHalf);
      this.applySlabTransform(leftSlab.entity, this._slabCenter, lean);
    }
    if (!this.isFrozen(rightSlab.entity, rightSlab.touched)) {
      this._slabCenter
        .copy(this._anchor)
        .addScaledVector(this._right, rightOffset)
        .addScaledVector(this._local, ordersHalf - tallerHalf);
      this.applySlabTransform(rightSlab.entity, this._slabCenter, lean);
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
    if (!this.canPlace()) {
      return;
    }
    const [leftSlab, rightSlab] = this.slabs;
    this.setYawAxes(this._headYaw);

    const customersHeight = this.slabHeightMeters(leftSlab.doc);
    const ordersHeight = this.slabHeightMeters(rightSlab.doc);
    const eyeRise = this._headPos.y - (surfaceY + SURFACE_LIFT_METERS);
    const leftOffset = SLAB_GAP_METERS / 2 + leftSlab.doc.widthMeters / 2;
    const rightOffset = SLAB_GAP_METERS / 2 + rightSlab.doc.widthMeters / 2;

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
    if (!this.isFrozen(leftSlab.entity, leftSlab.touched)) {
      const lean = eyeFacingLeanFromBottom(anchorEyeRise, anchorForward, customersHeight);
      this.proppedCenter(-leftOffset, customersHeight / 2, Math.sin(lean), Math.cos(lean));
      this.applySlabTransform(leftSlab.entity, this._slabCenter, lean);
    }
    if (!this.isFrozen(rightSlab.entity, rightSlab.touched)) {
      const lean = eyeFacingLeanFromBottom(anchorEyeRise, anchorForward, ordersHeight);
      this.proppedCenter(rightOffset, ordersHeight / 2, Math.sin(lean), Math.cos(lean));
      this.applySlabTransform(rightSlab.entity, this._slabCenter, lean);
    }
    this.warnIfOutOfView();
  }

  /** Bottom-edge distance keeping both edges of a propped slab in view. */
  private surfaceForwardToFit(surfaceY: number, half: number, sinLean: number, cosLean: number): number {
    const bottomY = surfaceY + SURFACE_LIFT_METERS;
    // The highest point is the name tab's top (the taller of the two).
    const tab = Math.max(0, ...this.slabs.map((slab) => slab.doc.tabHeightMeters));
    const topY = bottomY + (2 * half + tab) * cosLean;
    return Math.max(
      this.edgeFitDistance(this._headPos.y - bottomY, 0),
      this.edgeFitDistance(this._headPos.y - topY, (2 * half + tab) * sinLean),
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
    // The top edge is the name tab's top: the highest thing on the slab.
    return measureSlabEdges(
      this._headPos,
      NATURAL_GAZE_PITCH_RAD,
      object,
      half + doc.tabHeightMeters,
      -half,
      this._local,
      this._edges,
    );
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

  /**
   * Dev-only (`debug` flag): warns when a placed slab is out of view, off its
   * text-angle target, or beyond reach. The warnings live in PlacementDebug,
   * a dev-only module, so none of their text ships in production builds.
   */
  private warnIfOutOfView(): void {
    if (!import.meta.env.DEV || !this.debug) {
      return;
    }
    this.debug.warnOutOfView(this.slabs.map((slab) => this.slabReport(slab.table.id, slab.entity, slab.doc, slab.touched)));
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
    const slabs: SlabReport[] = this.slabs.map((slab) =>
      this.slabReport(slab.table.id, slab.entity, slab.doc, slab.touched),
    );
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
