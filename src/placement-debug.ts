/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Dev-only placement readout for `DeskPlacementSystem`, enabled with
 * `?debug=1`: console logs of each placement decision and wireframe outlines
 * around every surface candidate. Only constructed behind
 * `import.meta.env.DEV`, so production builds drop this module entirely.
 * Allocation here is deliberate and fine: it only runs on placement events
 * and chosen-surface changes, never per frame.
 */

import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  normalizeReferenceSpec,
  resolveReferenceSpaceType,
  Vector3,
  type Entity,
  type World,
} from '@iwsdk/core';
import type { SurfaceAssessment } from './desk-placement.js';
import { NATURAL_GAZE_PITCH_DEG, ROW_TEXT_TARGET_DEG, TOUCH_REACH_MAX_METERS } from './view-comfort.js';

export type PlacementKind = 'floating' | 'surface' | 'synthetic' | 'none';

export type SlabReport = {
  name: string;
  touched: boolean;
  position: Vector3;
  yawDeg: number;
  tiltFromFlatDeg: number;
  /** Signed degrees from the head's forward direction (negative = below). */
  topEdgeDeg: number;
  bottomEdgeDeg: number;
  edgesFit: boolean;
  /** Eye-to-center distance (meters). */
  eyeDistance: number;
  /** The lowest-edge view limit this placement used. */
  maxBelowDeg: number;
  /** Row font size (cm) and the angle it subtends at `eyeDistance`. */
  rowFontCm: number;
  rowTextDeg: number;
};

export type PlacementReport = {
  event: string;
  kind: PlacementKind;
  headPosition: Vector3;
  headYawDeg: number;
  headPitchDownDeg: number;
  candidates: SurfaceAssessment[];
  chosen: Entity | null;
  synthetic: { y: number; heightBelowHead: number; center: Vector3; yaw: number } | null;
  slabs: SlabReport[];
};

const LOG_PREFIX = '[DeskPlacement debug]';

const COLOR_QUALIFYING = 0x2ecc40;
const COLOR_REJECTED = 0xff4136;
const COLOR_CHOSEN = 0xffdc00;
const COLOR_SYNTHETIC = 0xff00ff;
// The chosen outline is drawn slightly outside the candidate box so it
// reads as a highlight rather than a recolor.
const CHOSEN_OUTLINE_INFLATE_METERS = 0.015;
const SYNTHETIC_SURFACE_WIDTH_METERS = 1.4;
const SYNTHETIC_SURFACE_DEPTH_METERS = 0.8;

// Corner index pairs of a box's 12 edges; corners are numbered by bits
// (x = bit 0, y = bit 1, z = bit 2).
const BOX_EDGES: ReadonlyArray<[number, number]> = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

function fmt(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function fmtVec(v: Vector3): string {
  return `(${fmt(v.x)}, ${fmt(v.y)}, ${fmt(v.z)})`;
}

function candidateId(record: SurfaceAssessment): string {
  const index = record.entity ? record.entity.index : '?';
  return `${record.kind}#${index}${record.label ? ` "${record.label}"` : ''}`;
}

export class PlacementDebug {
  private readonly world: World;
  private readonly outlineRoot = new Group();
  private readonly outlineEntity: Entity;
  private readonly materials = {
    qualifying: new LineBasicMaterial({ color: COLOR_QUALIFYING, depthTest: false }),
    rejected: new LineBasicMaterial({ color: COLOR_REJECTED, depthTest: false }),
    chosen: new LineBasicMaterial({ color: COLOR_CHOSEN, depthTest: false }),
    synthetic: new LineDashedMaterial({
      color: COLOR_SYNTHETIC,
      dashSize: 0.04,
      gapSize: 0.025,
      depthTest: false,
    }),
  };
  private referenceSpace = 'n/a (no XR session yet)';

  constructor(world: World) {
    this.world = world;
    this.outlineRoot.name = 'placement-debug-outlines';
    this.outlineRoot.renderOrder = 999;
    // Parented to the scene root (identity transform), so the world-space
    // vertices written below land exactly where they are computed.
    this.outlineEntity = world.createTransformEntity(this.outlineRoot, {
      parent: world.sceneEntity,
      persistent: true,
    });
  }

  /**
   * Re-runs IWSDK's own reference-space resolution (same preferred type and
   * fallback order) against the live session, since three.js doesn't expose
   * which type it was given.
   */
  probeReferenceSpace(): void {
    const session = this.world.session;
    if (!session) {
      this.referenceSpace = 'n/a (no XR session)';
      return;
    }
    const spec = normalizeReferenceSpec(this.world.xrDefaults?.referenceSpace);
    this.referenceSpace = `resolving (preferred ${spec.type})`;
    resolveReferenceSpaceType(session, spec.type, spec.required ? [] : spec.fallbackOrder)
      .then((type) => {
        this.referenceSpace = type === spec.type ? type : `${type} (fell back from ${spec.type})`;
        console.log(`${LOG_PREFIX} reference space in use: ${this.referenceSpace}`);
      })
      .catch(() => {
        this.referenceSpace = `unresolved (preferred ${spec.type})`;
      });
  }

  logPlacement(report: PlacementReport): void {
    console.groupCollapsed(`${LOG_PREFIX} placement: ${report.event}`);
    this.logHead(report.headPosition, report.headYawDeg, report.headPitchDownDeg);
    this.logCandidates(report.candidates, report.chosen);
    if (report.synthetic) {
      console.log(
        `chosen: SYNTHETIC forced surface (not a detected surface) at world Y ${fmt(report.synthetic.y)} ` +
          `= head − ${fmt(report.synthetic.heightBelowHead)} m`,
      );
    } else {
      const chosen = report.candidates.find((c) => c.entity !== null && c.entity === report.chosen);
      console.log(`chosen: ${chosen ? candidateId(chosen) : 'none'}`);
    }
    console.table(
      report.slabs.map((slab) => ({
        slab: slab.name,
        moved: !slab.touched,
        position: fmtVec(slab.position),
        yawDeg: fmt(slab.yawDeg, 1),
        tiltFromFlatDeg: fmt(slab.tiltFromFlatDeg, 1),
        topEdgeDeg: fmt(slab.topEdgeDeg, 1),
        bottomEdgeDeg: fmt(slab.bottomEdgeDeg, 1),
        edgesInView: slab.edgesFit,
        eyeDistM: fmt(slab.eyeDistance),
      })),
    );
    console.groupEnd();
    // Outside the collapsed group, one line per slab, so the reach readout
    // is visible (and capturable) without expanding anything.
    for (const slab of report.slabs) {
      const withinReach = slab.eyeDistance <= TOUCH_REACH_MAX_METERS + 0.005;
      console.log(
        `${LOG_PREFIX} ${slab.name}: center ${fmt(slab.eyeDistance)} m from the eyes ` +
          `(reach limit ${TOUCH_REACH_MAX_METERS} m, ${withinReach ? 'within reach' : 'BEYOND REACH'}); ` +
          `row font ${fmt(slab.rowFontCm)} cm = ${fmt(slab.rowTextDeg)}° (target ${ROW_TEXT_TARGET_DEG}°); ` +
          `edges top ${fmt(slab.topEdgeDeg, 1)}°, bottom ${fmt(slab.bottomEdgeDeg, 1)}° from the natural gaze ` +
          `(${NATURAL_GAZE_PITCH_DEG}° down; limit -${slab.maxBelowDeg}°)` +
          `${slab.touched ? '; not moved (grabbed or docked)' : ''}`,
      );
    }
    this.drawOutlines(report.candidates, report.chosen, report.synthetic);
  }

  logChosenChange(headPosition: Vector3, candidates: SurfaceAssessment[], chosen: Entity | null): void {
    const chosenRecord = candidates.find((c) => c.entity !== null && c.entity === chosen);
    console.groupCollapsed(
      `${LOG_PREFIX} chosen surface changed → ${chosenRecord ? candidateId(chosenRecord) : 'none'}`,
    );
    console.log(`head position ${fmtVec(headPosition)}; reference space: ${this.referenceSpace}`);
    this.logCandidates(candidates, chosen);
    console.groupEnd();
    this.drawOutlines(candidates, chosen, null);
  }

  clearOutlines(): void {
    for (const child of [...this.outlineRoot.children]) {
      this.outlineRoot.remove(child);
      (child as LineSegments).geometry.dispose();
    }
  }

  dispose(): void {
    this.clearOutlines();
    for (const material of Object.values(this.materials)) {
      material.dispose();
    }
    this.outlineEntity.dispose();
  }

  private logHead(position: Vector3, yawDeg: number, pitchDownDeg: number): void {
    console.log(
      `head position ${fmtVec(position)}, yaw ${fmt(yawDeg, 1)}°, pitch ${fmt(pitchDownDeg, 1)}° down; ` +
        `reference space: ${this.referenceSpace}`,
    );
  }

  private logCandidates(candidates: SurfaceAssessment[], chosen: Entity | null): void {
    if (candidates.length === 0) {
      console.log('surface candidates: none detected (no XRMesh / XRPlane entities)');
      return;
    }
    console.table(
      candidates.map((c) => ({
        candidate: candidateId(c),
        type: c.kind,
        label: c.label || '(none)',
        worldY: fmt(c.surfaceY),
        belowHead: fmt(c.heightBelowHead),
        horizDist: fmt(c.distance),
        qualified: c.qualified,
        chosen: c.entity !== null && c.entity === chosen,
        whyNot: c.qualified ? '' : c.reason,
      })),
    );
  }

  private drawOutlines(
    candidates: SurfaceAssessment[],
    chosen: Entity | null,
    synthetic: PlacementReport['synthetic'],
  ): void {
    this.clearOutlines();
    for (const candidate of candidates) {
      const object = candidate.entity?.object3D;
      if (!candidate.hasBounds || !object) {
        continue;
      }
      object.updateWorldMatrix(true, false);
      const isChosen = candidate.entity === chosen;
      const inflate = isChosen ? CHOSEN_OUTLINE_INFLATE_METERS : 0;
      const corners: Vector3[] = [];
      for (let i = 0; i < 8; i++) {
        const corner = new Vector3(
          i & 1 ? candidate.maxX + inflate : candidate.minX - inflate,
          i & 2 ? candidate.topY + inflate : candidate.minY - inflate,
          i & 4 ? candidate.maxZ + inflate : candidate.minZ - inflate,
        );
        corners.push(corner.applyMatrix4(object.matrixWorld));
      }
      const material = isChosen
        ? this.materials.chosen
        : candidate.qualified
          ? this.materials.qualifying
          : this.materials.rejected;
      this.addSegments(
        BOX_EDGES.flatMap(([a, b]) => [corners[a], corners[b]]),
        material,
        false,
      );
    }

    if (synthetic) {
      const forward = new Vector3(0, 0, -1).applyAxisAngle(new Vector3(0, 1, 0), synthetic.yaw);
      const right = new Vector3(1, 0, 0).applyAxisAngle(new Vector3(0, 1, 0), synthetic.yaw);
      const halfW = SYNTHETIC_SURFACE_WIDTH_METERS / 2;
      const halfD = SYNTHETIC_SURFACE_DEPTH_METERS / 2;
      // `synthetic.center` is the slabs' bottom-edge line; the rectangle
      // starts a little in front of it and extends back under the slabs.
      const center = synthetic.center.clone().addScaledVector(forward, halfD - 0.15);
      center.y = synthetic.y;
      const corner = (w: number, d: number) =>
        center.clone().addScaledVector(right, w).addScaledVector(forward, d);
      const nearLeft = corner(-halfW, -halfD);
      const nearRight = corner(halfW, -halfD);
      const farRight = corner(halfW, halfD);
      const farLeft = corner(-halfW, halfD);
      // Rectangle plus an X so it reads as "placeholder", not a real table.
      this.addSegments(
        [nearLeft, nearRight, nearRight, farRight, farRight, farLeft, farLeft, nearLeft, nearLeft, farRight, nearRight, farLeft],
        this.materials.synthetic,
        true,
      );
    }
  }

  private addSegments(points: Vector3[], material: LineBasicMaterial | LineDashedMaterial, dashed: boolean): void {
    const positions: number[] = [];
    for (const p of points) {
      positions.push(p.x, p.y, p.z);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const lines = new LineSegments(geometry, material);
    lines.renderOrder = 999;
    lines.frustumCulled = false;
    if (dashed) {
      lines.computeLineDistances();
    }
    this.outlineRoot.add(lines);
  }
}
