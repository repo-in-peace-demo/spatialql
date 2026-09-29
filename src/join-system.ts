/**
 * The join snap: push one table slab into the other, release, and watch the
 * join happen row by row.
 *
 * Driven by the pure state machine in `data/join-state.ts`; this system only
 * turns scene observations into events (proximity, grab/release, pulls) and
 * turns transitions into animation. The LEFT/RIGHT rule lives with the state
 * machine: the slab that stayed put is LEFT, the slab brought over is RIGHT,
 * independent of which side it docks on.
 *
 * Animation never re-runs layout or rebuilds documents: result slabs are
 * built once per join direction (at startup), and rows/lines/slabs animate
 * through signals bound to UIKit opacity/translate properties and through
 * preallocated instanced segments.
 *
 * The result slab is derived output: it follows the docked pair and is not
 * grabbable. A join is dismissed by pulling a source slab apart.
 *
 * Grab vs. press: the INNER | LEFT control lives on its own non-grabbable
 * entity at the pair's front (bottom) edge, centered on the seam, floating
 * CONTROL_SLAB_CLEARANCE_METERS off the slab plane toward the eyes. It isn't
 * a child of any slab: UIKit pointer events bubble up the Object3D tree, and
 * IWSDK's grab handles listen for pointer events on the grabbable object, so
 * a control parented under a slab would forward a press to that slab's grab
 * handle. The clearance keeps a palm on the control outside every source
 * slab's 7 cm grab sphere, so a press or pinch there never starts a grab.
 * It responds to a fingertip poke and a ray select (both UIKit `click`),
 * and to a pinch whose pinch point lands on an option (checked here, since
 * a pinch only clicks UIKit when the hand's ray happens to point at it).
 */

import {
  Color,
  createSystem,
  Euler,
  Grabbed,
  Group,
  MathUtils,
  PokeInteractable,
  Quaternion,
  RayInteractable,
  signal,
  Vector3,
  type Entity,
  type Object3D,
  type Signal,
} from '@iwsdk/core';
import { buildJoinResultTable, fullJoinPairings, joinTables, requireJoinKeys } from './data/join-result.js';
import { buildJoinSql } from './data/join-sql.js';
import { INITIAL_JOIN_STATE, transition, type JoinEvent, type JoinState } from './data/join-state.js';
import { assignKeyTints } from './data/key-tints.js';
import { CUSTOMERS_TABLE, ORDERS_TABLE } from './data/sample-data.js';
import type { CellValue, JoinType, Table } from './data/types.js';
import { devFlag } from './dev-flags.js';
import { JoinDebug, type JoinDebugHost, type JoinStats } from './join-debug.js';
import { COLOR_MATCH_LINE, COLOR_PREVIEW, EdgeGlow, lineColorForTint, SegmentBatch } from './join-visuals.js';
import { JoinDocked, JoinResultSlab, TableSlab, TableSlabRuntime } from './table-slab-component.js';
import {
  buildJoinTypeControl,
  buildTableSlabDocument,
  controlOptionStyle,
  MAX_RESULT_ROWS,
  rowCenterLocalY,
  setRowTint,
  slabBottomLocalY,
  slabTopLocalY,
  type JoinTypeControlView,
  type TableSlabDocument,
} from './table-slab-view.js';
import { easeInCubic, easeOutBack, easeOutCubic, TweenPool } from './tween.js';
import {
  CONTROL_MAX_BELOW_FORWARD_DEG,
  degreesFromForward,
  DESK_MAX_BELOW_FORWARD_DEG,
  eyeFacingLeanFromBottom,
  FOV_MAX_ABOVE_FORWARD_DEG,
  FOV_MAX_BELOW_FORWARD_DEG,
  measureSlabEdges,
  MIN_ROW_TEXT_DEG,
  RESULT_MAX_ABOVE_FORWARD_DEG,
  textAngleDeg,
  TOUCH_REACH_MAX_METERS,
  type SlabEdgeAngles,
} from './view-comfort.js';

const SOURCE_TABLES = new Map<string, Table>([
  [CUSTOMERS_TABLE.id, CUSTOMERS_TABLE],
  [ORDERS_TABLE.id, ORDERS_TABLE],
]);

// --- Approach / preview -----------------------------------------------------
// Measured in the stationary slab's frame. Entering needs the tighter
// thresholds; staying in preview uses looser ones (hysteresis) plus a grace
// window, so hand-tracking jitter and release drift don't cancel a join.
const PREVIEW_ENTER_GAP_METERS = 0.06;
const PREVIEW_EXIT_GAP_METERS = 0.09;
// Pushing a slab partly "into" the other still counts, up to this overlap.
const PREVIEW_ENTER_OVERLAP_METERS = 0.08;
const PREVIEW_EXIT_OVERLAP_METERS = 0.12;
const PREVIEW_ALIGN_DEG = 30;
const PREVIEW_EXIT_ALIGN_DEG = 35;
// Out-of-plane distance and vertical misalignment (vs. tops aligned).
const PREVIEW_ENTER_DEPTH_METERS = 0.08;
const PREVIEW_EXIT_DEPTH_METERS = 0.12;
const PREVIEW_ENTER_VERTICAL_METERS = 0.12;
const PREVIEW_EXIT_VERTICAL_METERS = 0.16;
const PREVIEW_EXIT_GRACE_SECONDS = 0.15;
const PREVIEW_HINT_COUNT = 3;

// --- Commit / dock -------------------------------------------------------------
// Room for fan-out lines between the docked slabs. Independent of the preview
// thresholds above (those measure how far the held slab has been pushed, not
// the dock gap) and of SEPARATE_DISTANCE_METERS (measured from the dock pose),
// so widening it needs no threshold changes.
const DOCK_GAP_METERS = 0.09;
const DOCK_DURATION_SECONDS = 0.18;
const REDOCK_DURATION_SECONDS = 0.15;
/** Pulling a docked slab farther than this from its dock pose separates. */
const SEPARATE_DISTANCE_METERS = 0.1;
/** Debug separate: how far the RIGHT slab slides away. */
const DEBUG_SEPARATE_SLIDE_METERS = 0.15;

// --- Join animation timeline (seconds after release; total < 1.5 s) ----------
const LINE_START_SECONDS = DOCK_DURATION_SECONDS;
const LINE_STAGGER_SECONDS = 0.04;
const LINE_DRAW_SECONDS = 0.22;
const RESULT_APPEAR_SECONDS = 0.3;
const RESULT_FADE_SECONDS = 0.25;
const ROW_START_SECONDS = 0.45;
const ROW_STAGGER_SECONDS = 0.05;
const ROW_DURATION_SECONDS = 0.22;
const ROW_SLIDE_CM = 2;
const DIM_START_SECONDS = 0.6;
const DIM_DURATION_SECONDS = 0.35;
const DIM_OPACITY = 0.35;
const DIM_DROP_CM = 0.6;
const TOGGLE_DURATION_SECONDS = 0.3;
const SEPARATE_DURATION_SECONDS = 0.3;

// --- Visuals -------------------------------------------------------------------
const MAX_MATCH_LINES = 24;
// Lines are secondary to the key tints: thin, translucent, tinted per key.
const LINE_THICKNESS_METERS = 0.0015;
const LINE_OPACITY = 0.55;
const LINE_SURFACE_OFFSET_METERS = 0.004;
const GLOW_WIDTH_METERS = 0.008;

// --- Result slab placement ----------------------------------------------------
// Bottom edge just above and slightly behind the docked pair's top edge,
// leaning back only as far as needed to face the eyes.
const RESULT_GAP_ABOVE_METERS = 0.03;
const RESULT_BEHIND_METERS = 0.02;
/** Legibility cap: the result slab's center is never farther than this from the eyes. */
const RESULT_MAX_DISTANCE_METERS = 0.85;
/** Push-back steps that bring the result slab's top edge inside the view. */
const RESULT_FIT_ITERATIONS = 6;
const PARKED_Y = -100;
// For the debug readout's angular text size.
const DATA_TEXT_HEIGHT_METERS = 0.016;

// --- Join-type control ----------------------------------------------------------
/**
 * Every point of the control floats at least this far off the source slabs
 * (toward the eyes): 3 cm more than the 7 cm palm grab sphere, so a palm on
 * the control can't reach a slab's grab surface.
 */
const CONTROL_SLAB_CLEARANCE_METERS = 0.1;
/** The control's top edge sits this far below the pair's front edge, in view. */
const CONTROL_VIEW_GAP_DEG = 1;
/** A pinch selects an option when its pinch point is this close to it, in plane... */
const CONTROL_PINCH_MARGIN_METERS = 0.015;
/** ...and at most this far in front of / behind the control's surface. */
const CONTROL_PINCH_DEPTH_METERS = 0.03;
/** Grab sphere radius of IWSDK's grab pointer, for the clearance readout. */
const GRAB_SPHERE_RADIUS_METERS = 0.07;

const UP = new Vector3(0, 1, 0);
const HANDS = ['left', 'right'] as const;

type SourceSlab = { id: string; entity: Entity; object: Object3D; doc: TableSlabDocument; table: Table };

type ResultView = {
  key: string;
  leftId: string;
  rightId: string;
  entity: Entity;
  object: Object3D;
  doc: TableSlabDocument;
  /** Result row indices, matched rows first; ghost rows are appended. */
  matchedRowCount: number;
  ghostRows: number[];
  /** One entry per match line: left/right source row index. */
  lineLeftRows: number[];
  lineRightRows: number[];
  unmatchedLeftRows: Set<number>;
  unmatchedRightRows: Set<number>;
  /** Join-key tint per match line, and per matched source row on each side. */
  lineTints: string[];
  leftRowTints: Map<number, string>;
  rightRowTints: Map<number, string>;
  sql: Record<JoinType, [string, string]>;
  stats: Omit<JoinStats, 'resultRows' | 'joinType'> & { innerRows: number; leftRows: number };
};

type DockAnimation = {
  active: boolean;
  slab: SourceSlab | null;
  fromPos: Vector3;
  fromQuat: Quaternion;
  toPos: Vector3;
  toQuat: Quaternion;
  elapsed: number;
  duration: number;
};

export class JoinSystem
  extends createSystem({
    sources: { required: [TableSlab, TableSlabRuntime], excluded: [JoinResultSlab] },
    held: { required: [TableSlab, Grabbed] },
  })
  implements JoinDebugHost
{
  private state: JoinState = INITIAL_JOIN_STATE;
  private readonly sources = new Map<string, SourceSlab>();
  private readonly results = new Map<string, ResultView>();
  private active: ResultView | null = null;

  /** Sign of the RIGHT slab's x in the LEFT slab's frame (+1: docked on its right). */
  private dockSide = 1;
  private previewSide = 1;
  private previewExitTimer = 0;

  private readonly tweens = new TweenPool(192);
  private readonly separateClock = signal(0);
  private readonly dock: DockAnimation = {
    active: false,
    slab: null,
    fromPos: new Vector3(),
    fromQuat: new Quaternion(),
    toPos: new Vector3(),
    toQuat: new Quaternion(),
    elapsed: 0,
    duration: DOCK_DURATION_SECONDS,
  };

  private visualsRoot!: Group;
  private lines!: SegmentBatch;
  private hints!: SegmentBatch;
  private stationaryGlow!: EdgeGlow;
  private movingGlow!: EdgeGlow;
  private control!: JoinTypeControlView;
  private controlEntity!: Entity;
  private debug: JoinDebug | null = null;

  // Scratch -- allocated once, never in update().
  private readonly _a = new Vector3();
  private readonly _b = new Vector3();
  private readonly _c = new Vector3();
  private readonly _d = new Vector3();
  private readonly _e = new Vector3();
  private readonly _viewUp = new Vector3();
  private readonly _pinchA = new Vector3();
  private readonly _pinchB = new Vector3();
  private readonly _up = new Vector3();
  private readonly _normal = new Vector3();
  private readonly _q1 = new Quaternion();
  private readonly _q2 = new Quaternion();
  private readonly _euler = new Euler();
  private readonly _color = new Color();
  private readonly _head = new Vector3();
  private headPitchDown = 0;
  private readonly _edges: SlabEdgeAngles = { topDeg: 0, bottomDeg: 0, fits: true };
  private readonly _prox = { side: 1, gap: 0, depth: 0, vertical: 0, angleDeg: 0 };

  init(): void {
    this.visualsRoot = new Group();
    this.visualsRoot.name = 'join-visuals';
    this.lines = new SegmentBatch(MAX_MATCH_LINES, COLOR_MATCH_LINE, LINE_THICKNESS_METERS, LINE_OPACITY);
    this.hints = new SegmentBatch(PREVIEW_HINT_COUNT, COLOR_PREVIEW, 0.002, 0.45);
    this.stationaryGlow = new EdgeGlow(GLOW_WIDTH_METERS);
    this.movingGlow = new EdgeGlow(GLOW_WIDTH_METERS);
    this.visualsRoot.add(this.lines.mesh, this.hints.mesh, this.stationaryGlow.mesh, this.movingGlow.mesh);
    const visualsEntity = this.world.createTransformEntity(this.visualsRoot, {
      parent: this.world.sceneEntity,
      persistent: true,
    });

    this.control = buildJoinTypeControl();
    this.control.fade.value = 0;
    this.control.document.visible = false;
    this.control.document.position.set(0, PARKED_Y, 0);
    this.controlEntity = this.world.createTransformEntity(this.control.document);
    // Poke and ray select both arrive as UIKit clicks.
    const onInner = () => this.requestJoinType('inner');
    const onLeft = () => this.requestJoinType('left');
    this.control.inner.addEventListener('click', onInner);
    this.control.left.addEventListener('click', onLeft);

    this.debug = import.meta.env.DEV && devFlag('debug') ? new JoinDebug(this) : null;

    this.cleanupFuncs.push(
      () => this.control.inner.removeEventListener('click', onInner),
      () => this.control.left.removeEventListener('click', onLeft),
      () => {
        this.lines.dispose();
        this.hints.dispose();
        this.stationaryGlow.dispose();
        this.movingGlow.dispose();
        visualsEntity.dispose();
        this.debug?.dispose();
      },
    );

    for (const entity of this.queries.sources.entities) {
      this.registerSource(entity);
    }
    this.queries.sources.subscribe('qualify', (entity) => this.registerSource(entity));
    this.queries.held.subscribe('disqualify', (entity) => this.onRelease(entity));
  }

  update(delta: number): void {
    this.tweens.update(delta);
    this.updateDock(delta);

    switch (this.state.phase) {
      case 'idle':
      case 'previewing':
        this.updateProximity(delta);
        break;
      case 'joined':
        this.updateJoined();
        break;
      case 'separating':
        break;
    }

    this.updatePreviewVisuals();
    this.updateLines();
    this.updatePinchSelect();
  }

  // --- Public actions (pill, debug keys, and later the wrist gesture) -------

  /** The single entry point for changing the join type, whatever the input. */
  requestJoinType(joinType: JoinType): void {
    this.applyTransition({ type: 'setJoinType', joinType });
  }

  toggleJoinType(): void {
    this.applyTransition({ type: 'toggleJoinType' });
  }

  /** Dev: join without grabbing. `reverse` brings customers to orders instead. */
  debugJoin(reverse: boolean): void {
    const moving = this.sources.get(reverse ? CUSTOMERS_TABLE.id : ORDERS_TABLE.id);
    const stationary = this.sources.get(reverse ? ORDERS_TABLE.id : CUSTOMERS_TABLE.id);
    if (!moving || !stationary || this.state.phase !== 'idle') {
      this.debug?.note(`join ignored in phase "${this.state.phase}"`);
      return;
    }
    this.measureProximity(moving, stationary);
    this.dockSide = this._prox.side;
    this.applyTransition({ type: 'commit', left: stationary.id, right: moving.id });
  }

  /** Dev: slide the RIGHT slab away and separate. */
  debugSeparate(): void {
    if (this.state.phase !== 'joined') {
      this.debug?.note(`separate ignored in phase "${this.state.phase}"`);
      return;
    }
    const left = this.sources.get(this.state.left);
    const right = this.sources.get(this.state.right);
    if (!left || !right) {
      return;
    }
    this.applyTransition({ type: 'pullApart' });
    right.object.updateWorldMatrix(true, false);
    right.object.getWorldQuaternion(this._q1);
    this._a.set(this.dockSide * DEBUG_SEPARATE_SLIDE_METERS, 0, 0).applyQuaternion(this._q1);
    this._a.add(right.object.position);
    this.startDock(right, this._a, this._q1, DOCK_DURATION_SECONDS);
  }

  // --- State machine plumbing -------------------------------------------------

  private applyTransition(event: JoinEvent): boolean {
    const prev = this.state;
    const next = transition(prev, event);
    if (next === prev) {
      return false;
    }
    this.state = next;

    if (next.phase === 'joined' && prev.phase !== 'joined') {
      this.beginJoin(next.left, next.right, next.joinType);
    } else if (next.phase === 'joined' && prev.phase === 'joined' && next.joinType !== prev.joinType) {
      this.applyJoinTypeChange(prev.joinType, next.joinType);
    } else if (next.phase === 'separating') {
      this.beginSeparate();
    } else if (next.phase === 'previewing') {
      this.previewExitTimer = 0;
    }

    if (import.meta.env.DEV && this.debug) {
      this.debug.logTransition(event, prev, next, this.currentStats(next));
    }
    return true;
  }

  private currentStats(state: JoinState): JoinStats | null {
    if (state.phase !== 'joined' && state.phase !== 'separating') {
      return null;
    }
    const view = this.results.get(resultKey(state.left, state.right));
    if (!view) {
      return null;
    }
    return {
      ...view.stats,
      joinType: state.joinType,
      resultRows: state.joinType === 'inner' ? view.stats.innerRows : view.stats.leftRows,
    };
  }

  // --- Sources and result views -------------------------------------------------

  private registerSource(entity: Entity): void {
    const tableId = entity.getValue(TableSlab, 'tableId') ?? '';
    const table = SOURCE_TABLES.get(tableId);
    const doc = entity.getValue(TableSlabRuntime, 'layout') as TableSlabDocument | undefined;
    const object = entity.object3D;
    if (!table || !doc || !object || this.sources.has(tableId)) {
      return;
    }
    this.sources.set(tableId, { id: tableId, entity, object, doc, table });
    // Build every join direction's result slab up front (startup, not mid-interaction).
    for (const other of this.sources.values()) {
      if (other.id !== tableId) {
        this.resultViewFor(tableId, other.id);
        this.resultViewFor(other.id, tableId);
      }
    }
  }

  private sourceFor(entity: Entity): SourceSlab | null {
    for (const source of this.sources.values()) {
      if (source.entity === entity) {
        return source;
      }
    }
    return null;
  }

  private otherSource(source: SourceSlab): SourceSlab | null {
    for (const candidate of this.sources.values()) {
      if (candidate !== source) {
        return candidate;
      }
    }
    return null;
  }

  private resultViewFor(leftId: string, rightId: string): ResultView | null {
    const key = resultKey(leftId, rightId);
    const cached = this.results.get(key);
    if (cached) {
      return cached;
    }
    const left = this.sources.get(leftId)?.table;
    const right = this.sources.get(rightId)?.table;
    if (!left || !right) {
      return null;
    }

    // The slab holds every LEFT JOIN row; INNER hides the trailing ghosts.
    const result = buildJoinResultTable(left, right, joinTables(left, right, 'left'), 'left');
    const ghostRows = result.lineage.flatMap((l, index) => (l.ghost ? [index] : []));
    const sql = { inner: buildJoinSql(left, right, 'inner'), left: buildJoinSql(left, right, 'left') };
    const doc = buildTableSlabDocument(result.table, {
      maxRows: MAX_RESULT_ROWS,
      hiddenRows: new Set(ghostRows),
      caption: { lines: [...sql.inner], fitLines: [...sql.inner, ...sql.left] },
      anchorTop: true,
    });

    doc.fade.value = 0;
    doc.document.visible = false;
    doc.document.position.set(0, PARKED_Y, 0);
    const entity = this.world.createTransformEntity(doc.document);
    // JoinResultSlab first, so the entity never qualifies as a source slab.
    entity.addComponent(JoinResultSlab, {});
    entity.addComponent(TableSlab, { tableId: result.table.id });
    entity.addComponent(TableSlabRuntime, { document: doc.document, rowViews: doc.rowViews, layout: doc });

    const inner = joinTables(left, right, 'inner').pairings;
    const full = fullJoinPairings(left, right).pairings;
    const unmatchedLeftRows = new Set(full.flatMap((p) => (p.left && !p.right ? [p.left.rowIndex] : [])));
    const unmatchedRightRows = new Set(full.flatMap((p) => (!p.left && p.right ? [p.right.rowIndex] : [])));

    // One stable tint per matched key value, shared by its left rows, right
    // rows, lines, and result rows. Unmatched and ghost rows get none.
    const keyColumn = requireJoinKeys(left, right).leftColumn;
    const keyOf = (leftRowIndex: number): CellValue => left.rows[leftRowIndex][keyColumn] ?? null;
    const tints = assignKeyTints(inner.map((p) => keyOf(p.left!.rowIndex)));
    const tintOf = (leftRowIndex: number): string | null => {
      const keyValue = keyOf(leftRowIndex);
      return keyValue === null ? null : (tints.get(keyValue) ?? null);
    };
    const leftRowTints = new Map<number, string>();
    const rightRowTints = new Map<number, string>();
    const lineTints: string[] = [];
    for (const pairing of inner.slice(0, MAX_MATCH_LINES)) {
      const tint = tintOf(pairing.left!.rowIndex);
      if (tint) {
        leftRowTints.set(pairing.left!.rowIndex, tint);
        rightRowTints.set(pairing.right!.rowIndex, tint);
      }
      lineTints.push(tint ?? COLOR_MATCH_LINE);
    }
    // Result rows are tinted once, at build time: matched rows in their key's
    // tint; unmatched LEFT JOIN rows (NULL on the right) stay untinted.
    result.lineage.forEach((lineage, row) => {
      const rowView = doc.rowViews.get(row);
      if (rowView && lineage.left && !lineage.ghost) {
        setRowTint(rowView, tintOf(lineage.left.rowIndex));
      }
    });

    const view: ResultView = {
      key,
      leftId,
      rightId,
      entity,
      object: doc.document,
      doc,
      matchedRowCount: result.lineage.length - ghostRows.length,
      ghostRows,
      lineLeftRows: inner.map((p) => p.left!.rowIndex).slice(0, MAX_MATCH_LINES),
      lineRightRows: inner.map((p) => p.right!.rowIndex).slice(0, MAX_MATCH_LINES),
      unmatchedLeftRows,
      unmatchedRightRows,
      lineTints,
      leftRowTints,
      rightRowTints,
      sql,
      stats: {
        left: leftId,
        right: rightId,
        matchedPairings: inner.length,
        unmatchedLeft: unmatchedLeftRows.size,
        unmatchedRight: unmatchedRightRows.size,
        innerRows: inner.length,
        leftRows: result.lineage.length,
      },
    };
    this.results.set(key, view);
    return view;
  }

  // --- Proximity / preview --------------------------------------------------------

  private updateProximity(delta: number): void {
    let held: SourceSlab | null = null;
    let heldCount = 0;
    for (const entity of this.queries.held.entities) {
      const source = this.sourceFor(entity);
      if (source) {
        held = source;
        heldCount++;
      }
    }
    const previewing = this.state.phase === 'previewing' ? this.state : null;

    // Previews need exactly one held source slab (two-hand holds never join).
    if (heldCount !== 1 || !held) {
      if (previewing) {
        this.applyTransition({ type: 'exitRange' });
      }
      return;
    }
    const stationary = this.otherSource(held);
    if (!stationary) {
      return;
    }
    this.measureProximity(held, stationary);

    if (previewing && previewing.moving === held.id) {
      if (this.proximityWithin(true)) {
        this.previewExitTimer = 0;
        this.previewSide = this._prox.side;
      } else {
        this.previewExitTimer += delta;
        if (this.previewExitTimer >= PREVIEW_EXIT_GRACE_SECONDS) {
          this.applyTransition({ type: 'exitRange' });
        }
      }
      return;
    }
    if (this.proximityWithin(false)) {
      this.previewSide = this._prox.side;
      this.applyTransition({ type: 'enterRange', moving: held.id, stationary: stationary.id });
    }
  }

  /** Measures `moving` against `stationary` in the stationary slab's frame into `_prox`. */
  private measureProximity(moving: SourceSlab, stationary: SourceSlab): void {
    moving.object.updateWorldMatrix(true, false);
    stationary.object.updateWorldMatrix(true, false);
    this._a.setFromMatrixPosition(moving.object.matrixWorld);
    stationary.object.worldToLocal(this._a);
    const halfWidths = (moving.doc.widthMeters + stationary.doc.widthMeters) / 2;
    const topAlignedY = stationary.doc.heightMeters / 2 - moving.doc.heightMeters / 2;
    this._prox.side = this._a.x >= 0 ? 1 : -1;
    this._prox.gap = Math.abs(this._a.x) - halfWidths;
    this._prox.depth = Math.abs(this._a.z);
    this._prox.vertical = Math.abs(this._a.y - topAlignedY);
    moving.object.getWorldQuaternion(this._q1);
    stationary.object.getWorldQuaternion(this._q2);
    this._prox.angleDeg = (this._q1.angleTo(this._q2) * 180) / Math.PI;
  }

  private proximityWithin(exitThresholds: boolean): boolean {
    const p = this._prox;
    return exitThresholds
      ? p.gap <= PREVIEW_EXIT_GAP_METERS &&
          p.gap >= -PREVIEW_EXIT_OVERLAP_METERS &&
          p.depth <= PREVIEW_EXIT_DEPTH_METERS &&
          p.vertical <= PREVIEW_EXIT_VERTICAL_METERS &&
          p.angleDeg <= PREVIEW_EXIT_ALIGN_DEG
      : p.gap <= PREVIEW_ENTER_GAP_METERS &&
          p.gap >= -PREVIEW_ENTER_OVERLAP_METERS &&
          p.depth <= PREVIEW_ENTER_DEPTH_METERS &&
          p.vertical <= PREVIEW_ENTER_VERTICAL_METERS &&
          p.angleDeg <= PREVIEW_ALIGN_DEG;
  }

  private onRelease(entity: Entity): void {
    const source = this.sourceFor(entity);
    if (!source) {
      return;
    }
    if (this.state.phase === 'previewing' && this.state.moving === source.id) {
      // Commit on release, not on contact: jitter while holding never joins.
      this.dockSide = this.previewSide;
      this.applyTransition({ type: 'release', slab: source.id });
      return;
    }
    if (this.state.phase === 'joined' && (source.id === this.state.left || source.id === this.state.right)) {
      // Released before pulling far enough to separate: settle back into the dock.
      const partner = this.sources.get(source.id === this.state.left ? this.state.right : this.state.left);
      if (partner) {
        this.computeDockPose(partner, source, source.id === this.state.right, this._a, this._q1);
        this.startDock(source, this._a, this._q1, REDOCK_DURATION_SECONDS);
      }
    }
  }

  // --- Dock / redock animation ----------------------------------------------------

  /**
   * Dock pose of `mover` next to `anchor`: same orientation, edge to edge
   * with DOCK_GAP_METERS between, tops aligned (so rows line up). `moverIsRight`
   * says whether `mover` is the RIGHT table; `dockSide` is defined as the
   * RIGHT slab's side of the LEFT slab.
   */
  private computeDockPose(
    anchor: SourceSlab,
    mover: SourceSlab,
    moverIsRight: boolean,
    outPos: Vector3,
    outQuat: Quaternion,
  ): void {
    anchor.object.updateWorldMatrix(true, false);
    anchor.object.getWorldQuaternion(outQuat);
    const side = moverIsRight ? this.dockSide : -this.dockSide;
    outPos.set(
      side * (anchor.doc.widthMeters / 2 + DOCK_GAP_METERS + mover.doc.widthMeters / 2),
      anchor.doc.heightMeters / 2 - mover.doc.heightMeters / 2,
      0,
    );
    anchor.object.localToWorld(outPos);
  }

  private startDock(slab: SourceSlab, toPos: Vector3, toQuat: Quaternion, duration: number): void {
    this.dock.active = true;
    this.dock.slab = slab;
    this.dock.fromPos.copy(slab.object.position);
    this.dock.fromQuat.copy(slab.object.quaternion);
    this.dock.toPos.copy(toPos);
    this.dock.toQuat.copy(toQuat);
    this.dock.elapsed = 0;
    this.dock.duration = duration;
  }

  private updateDock(delta: number): void {
    const dock = this.dock;
    if (!dock.active || !dock.slab) {
      return;
    }
    // A new grab always wins over the snap.
    if (dock.slab.entity.hasComponent(Grabbed)) {
      dock.active = false;
      return;
    }
    dock.elapsed += delta;
    const t = easeOutCubic(Math.min(1, dock.elapsed / dock.duration));
    dock.slab.object.position.lerpVectors(dock.fromPos, dock.toPos, t);
    dock.slab.object.quaternion.slerpQuaternions(dock.fromQuat, dock.toQuat, t);
    if (t >= 1) {
      dock.active = false;
    }
  }

  // --- Join / toggle / separate -----------------------------------------------------

  private beginJoin(leftId: string, rightId: string, joinType: JoinType): void {
    const left = this.sources.get(leftId);
    const right = this.sources.get(rightId);
    const view = this.resultViewFor(leftId, rightId);
    if (!left || !right || !view) {
      return;
    }
    this.tweens.finishAll();
    this.hidePreview();
    this.active = view;
    left.entity.addComponent(JoinDocked, {});
    right.entity.addComponent(JoinDocked, {});

    // 1. Snap the brought-over slab into its dock.
    this.computeDockPose(left, right, true, this._a, this._q1);
    this.startDock(right, this._a, this._q1, DOCK_DURATION_SECONDS);

    // 2. Match lines, staggered, fan-out included. Each line is tinted by its
    //    join key, and lights up its two source rows in that tint as it lands.
    const lineCount = view.lineLeftRows.length;
    this.lines.setCount(lineCount);
    this.lines.fade.value = 1;
    for (let i = 0; i < lineCount; i++) {
      this.lines.setColor(i, lineColorForTint(view.lineTints[i], this._color));
      this.tweens.set(this.lines.progress[i], 0);
      this.tweens.to(
        this.lines.progress[i],
        1,
        LINE_DRAW_SECONDS,
        LINE_START_SECONDS + i * LINE_STAGGER_SECONDS,
        easeOutCubic,
        () => this.tintLineRows(view, left, right, i),
      );
    }

    // 3. Result slab appears behind/above the pair, the control at its front
    //    edge; rows assemble in pairing order. Both are placed against the
    //    head pose at join time and only move again when the pair does.
    this.setCaption(view, joinType);
    this.setControlSelection(joinType);
    this.showResult(view);
    this.readHead();
    this.placeResult(view, left, right);
    this.tweens.set(view.doc.fade, 0);
    this.tweens.to(view.doc.fade, 1, RESULT_FADE_SECONDS, RESULT_APPEAR_SECONDS);
    this.tweens.set(this.control.fade, 0);
    this.tweens.to(this.control.fade, 1, RESULT_FADE_SECONDS, RESULT_APPEAR_SECONDS);
    for (let row = 0; row < view.matchedRowCount; row++) {
      const rowView = view.doc.rowViews.get(row);
      if (!rowView) {
        continue;
      }
      const delay = ROW_START_SECONDS + row * ROW_STAGGER_SECONDS;
      this.tweens.set(rowView.opacity, 0);
      this.tweens.set(rowView.offsetYCm, ROW_SLIDE_CM);
      this.tweens.to(rowView.opacity, 1, ROW_DURATION_SECONDS, delay);
      this.tweens.to(rowView.offsetYCm, 0, ROW_DURATION_SECONDS, delay);
    }
    this.setGhostRowsShown(view, joinType === 'left', false, 0);

    // 4. Unmatched source rows dim and drop (INNER) / only unmatched-right (LEFT).
    this.applySourceDim(view, left, right, joinType, DIM_START_SECONDS, DIM_DURATION_SECONDS);

    this.warnIfOutOfView(view, left, right);
  }

  private applyJoinTypeChange(from: JoinType, to: JoinType): void {
    const view = this.active;
    const left = view ? this.sources.get(view.leftId) : null;
    const right = view ? this.sources.get(view.rightId) : null;
    if (!view || !left || !right || from === to) {
      return;
    }
    // Replay only the difference; settle the join animation first.
    this.tweens.finishAll();
    this.setCaption(view, to);
    this.setControlSelection(to);
    this.setGhostRowsShown(view, to === 'left', true, 0);
    this.applySourceDim(view, left, right, to, 0, TOGGLE_DURATION_SECONDS);
  }

  private beginSeparate(): void {
    const view = this.active;
    this.tweens.finishAll();
    this.dock.active = false;
    for (const source of this.sources.values()) {
      if (source.entity.hasComponent(JoinDocked)) {
        source.entity.removeComponent(JoinDocked);
      }
      // Restore every dimmed and tinted row.
      for (const rowView of source.doc.rowViews.values()) {
        this.tweens.to(rowView.opacity, 1, SEPARATE_DURATION_SECONDS);
        this.tweens.to(rowView.offsetYCm, 0, SEPARATE_DURATION_SECONDS);
        setRowTint(rowView, null);
      }
    }
    // Lines retract (last drawn first), the result dissolves.
    const lineCount = view ? view.lineLeftRows.length : 0;
    for (let i = 0; i < lineCount; i++) {
      this.tweens.to(this.lines.progress[i], 0, 0.16, (lineCount - 1 - i) * 0.012, easeInCubic);
    }
    if (view) {
      this.tweens.to(view.doc.fade, 0, SEPARATE_DURATION_SECONDS, 0, easeInCubic);
    }
    this.tweens.to(this.control.fade, 0, SEPARATE_DURATION_SECONDS * 0.6, 0, easeInCubic);
    this.tweens.set(this.separateClock, 0);
    this.tweens.to(this.separateClock, 1, SEPARATE_DURATION_SECONDS, 0, easeOutCubic, () =>
      this.finishSeparate(),
    );
  }

  /** Paints line `i`'s left and right source rows in its key tint. */
  private tintLineRows(view: ResultView, left: SourceSlab, right: SourceSlab, i: number): void {
    if (this.active !== view || this.state.phase !== 'joined') {
      return;
    }
    const leftRow = view.lineLeftRows[i];
    const rightRow = view.lineRightRows[i];
    const leftView = left.doc.rowViews.get(leftRow);
    const rightView = right.doc.rowViews.get(rightRow);
    if (leftView) {
      setRowTint(leftView, view.leftRowTints.get(leftRow) ?? null);
    }
    if (rightView) {
      setRowTint(rightView, view.rightRowTints.get(rightRow) ?? null);
    }
  }

  private finishSeparate(): void {
    if (this.active) {
      this.hideResult(this.active);
    }
    this.active = null;
    this.lines.setCount(0);
    this.applyTransition({ type: 'separated' });
  }

  private applySourceDim(
    view: ResultView,
    left: SourceSlab,
    right: SourceSlab,
    joinType: JoinType,
    delay: number,
    duration: number,
  ): void {
    for (const [row, rowView] of left.doc.rowViews) {
      const dim = joinType === 'inner' && view.unmatchedLeftRows.has(row);
      this.tweenRowDim(rowView.opacity, rowView.offsetYCm, dim, delay, duration);
    }
    for (const [row, rowView] of right.doc.rowViews) {
      // Unmatched-right rows are excluded by both INNER and LEFT joins.
      this.tweenRowDim(rowView.opacity, rowView.offsetYCm, view.unmatchedRightRows.has(row), delay, duration);
    }
  }

  private tweenRowDim(
    opacity: Signal<number>,
    offsetYCm: Signal<number>,
    dim: boolean,
    delay: number,
    duration: number,
  ): void {
    const targetOpacity = dim ? DIM_OPACITY : 1;
    const targetOffset = dim ? DIM_DROP_CM : 0;
    if (opacity.peek() === targetOpacity && offsetYCm.peek() === targetOffset) {
      return;
    }
    this.tweens.to(opacity, targetOpacity, duration, delay);
    // Dimming "falls" slightly past its resting drop, then settles.
    this.tweens.to(offsetYCm, targetOffset, duration, delay, dim ? easeOutBack : easeOutCubic);
  }

  /** Ghost rows slide in from below / slide out downward. */
  private setGhostRowsShown(view: ResultView, shown: boolean, animate: boolean, delay: number): void {
    view.ghostRows.forEach((row, i) => {
      const rowView = view.doc.rowViews.get(row);
      if (!rowView) {
        return;
      }
      const rowDelay = delay + i * ROW_STAGGER_SECONDS;
      if (shown) {
        rowView.row.setProperties({ display: 'flex' });
        this.tweens.set(rowView.opacity, 0);
        this.tweens.set(rowView.offsetYCm, ROW_SLIDE_CM);
        this.tweens.to(rowView.opacity, 1, animate ? TOGGLE_DURATION_SECONDS : ROW_DURATION_SECONDS, rowDelay);
        this.tweens.to(rowView.offsetYCm, 0, animate ? TOGGLE_DURATION_SECONDS : ROW_DURATION_SECONDS, rowDelay);
      } else if (animate) {
        this.tweens.to(rowView.offsetYCm, ROW_SLIDE_CM, TOGGLE_DURATION_SECONDS, rowDelay, easeInCubic);
        this.tweens.to(rowView.opacity, 0, TOGGLE_DURATION_SECONDS, rowDelay, easeInCubic, () =>
          rowView.row.setProperties({ display: 'none' }),
        );
      } else {
        this.tweens.set(rowView.opacity, 0);
        rowView.row.setProperties({ display: 'none' });
      }
    });
  }

  private setCaption(view: ResultView, joinType: JoinType): void {
    view.doc.captionLines.forEach((line, i) => {
      line.setProperties({ text: view.sql[joinType][i] });
    });
  }

  private setControlSelection(joinType: JoinType): void {
    this.control.inner.setProperties(controlOptionStyle(joinType === 'inner'));
    this.control.left.setProperties(controlOptionStyle(joinType === 'left'));
  }

  /** Shows the (view-only, never grabbable) result slab and the control. */
  private showResult(view: ResultView): void {
    view.doc.document.visible = true;
    this.control.document.visible = true;
    if (!this.controlEntity.hasComponent(PokeInteractable)) {
      this.controlEntity.addComponent(PokeInteractable, {});
    }
    if (!this.controlEntity.hasComponent(RayInteractable)) {
      this.controlEntity.addComponent(RayInteractable, {});
    }
  }

  private hideResult(view: ResultView): void {
    view.doc.document.visible = false;
    view.doc.document.position.set(0, PARKED_Y, 0);
    this.control.document.visible = false;
    this.control.document.position.set(0, PARKED_Y, 0);
    if (this.controlEntity.hasComponent(PokeInteractable)) {
      this.controlEntity.removeComponent(PokeInteractable);
    }
    if (this.controlEntity.hasComponent(RayInteractable)) {
      this.controlEntity.removeComponent(RayInteractable);
    }
  }

  /**
   * Result slab: just behind and above the docked pair, leaning back less
   * than the pair so it faces the eyes, bottom edge a few cm above the
   * pair's top. Pushed farther away (never cut, never shrunk) until its top
   * edge sits inside the result's relaxed view limit, up to the legibility
   * cap. Also places the control, which moves with the pair.
   *
   * Uses the head pose last read by `readHead()` (at join time), so both
   * stay world-locked while the head moves.
   */
  private placeResult(view: ResultView, left: SourceSlab, right: SourceSlab): void {
    left.object.updateWorldMatrix(true, false);
    left.object.getWorldQuaternion(this._q1);
    this._up.copy(UP).applyQuaternion(this._q1);
    this._normal.set(0, 0, 1).applyQuaternion(this._q1);

    // Top-edge midpoints of both slabs, with the right one at its dock pose.
    this._a.set(0, left.doc.heightMeters / 2, 0);
    left.object.localToWorld(this._a);
    this.computeDockPose(left, right, true, this._b, this._q2);
    this._b.addScaledVector(this._up, right.doc.heightMeters / 2);
    // Bottom-edge midpoint of the result slab.
    this._c
      .addVectors(this._a, this._b)
      .multiplyScalar(0.5)
      .addScaledVector(this._up, RESULT_GAP_ABOVE_METERS)
      .addScaledVector(this._normal, -RESULT_BEHIND_METERS);

    // Shared yaw, and the horizontal "away from the viewer" axis it implies.
    this._euler.setFromQuaternion(this._q1, 'YXZ');
    const yaw = this._euler.y;
    this._b.set(0, 0, -1).applyAxisAngle(UP, yaw);

    // Lean to face the eyes from the slab's own center. If that center is
    // beyond the legibility cap, pull the slab toward the viewer -- at most
    // until its bottom edge is level with the pair's top edge, so it never
    // hangs in front of the pair's rows. Never shrunk.
    const height = view.doc.heightMeters;
    let lean = 0;
    let pulled = 0;
    for (let i = 0; i < 3; i++) {
      this._a.subVectors(this._c, this._head);
      lean = eyeFacingLeanFromBottom(this._head.y - this._c.y, this._a.dot(this._b), height);
      this._a
        .copy(this._c)
        .addScaledVector(this._b, (height / 2) * Math.sin(lean))
        .addScaledVector(UP, (height / 2) * Math.cos(lean));
      const excess = this._a.distanceTo(this._head) - RESULT_MAX_DISTANCE_METERS;
      const pull = Math.min(Math.max(0, excess), RESULT_BEHIND_METERS - pulled);
      if (pull <= 1e-4) {
        break;
      }
      this._c.addScaledVector(this._b, -pull);
      pulled += pull;
    }

    // With the pair now close to the eyes, the slab's top edge can rise past
    // the result's relaxed view limit: push it back (horizontally) until the
    // top edge fits, but never so far that its center passes the cap.
    const maxAboveRad = MathUtils.degToRad(RESULT_MAX_ABOVE_FORWARD_DEG) - this.headPitchDown;
    for (let i = 0; i < RESULT_FIT_ITERATIONS && maxAboveRad > 0.05; i++) {
      this._a
        .copy(this._c)
        .addScaledVector(this._b, height * Math.sin(lean))
        .addScaledVector(UP, height * Math.cos(lean));
      const rise = this._a.y - this._head.y;
      this._d.subVectors(this._a, this._head);
      this._d.y = 0;
      const push = rise / Math.tan(maxAboveRad) - this._d.length();
      if (rise <= 0 || push <= 1e-3) {
        break;
      }
      this._e
        .copy(this._c)
        .addScaledVector(this._b, (height / 2) * Math.sin(lean))
        .addScaledVector(UP, (height / 2) * Math.cos(lean));
      const step = Math.min(push, RESULT_MAX_DISTANCE_METERS - this._e.distanceTo(this._head));
      if (step <= 1e-3) {
        break;
      }
      this._c.addScaledVector(this._b, step);
      this._a.subVectors(this._c, this._head);
      lean = eyeFacingLeanFromBottom(this._head.y - this._c.y, this._a.dot(this._b), height);
    }

    // Top-anchored document: origin = bottom edge + slab-up * height.
    this._euler.set(-lean, yaw, 0, 'YXZ');
    this._q2.setFromEuler(this._euler);
    this._up.copy(UP).applyQuaternion(this._q2);
    const object = view.object;
    object.quaternion.copy(this._q2);
    object.position.copy(this._c).addScaledVector(this._up, height);
    this.placeControl(left, right);
  }

  /**
   * The join-type control: centered on the seam at the pair's front
   * (bottom) edge, lifted CONTROL_SLAB_CLEARANCE_METERS off it toward the
   * eyes, then lowered in view so its top edge sits just below that edge.
   * Faces the eyes. Measured with the RIGHT slab at its dock pose.
   */
  private placeControl(left: SourceSlab, right: SourceSlab): void {
    left.object.updateWorldMatrix(true, false);
    const seamX = this.dockSide * (left.doc.widthMeters / 2 + DOCK_GAP_METERS / 2);
    // Tops are aligned, so the taller slab's bottom edge is the front edge.
    const leftBottomY = -left.doc.heightMeters / 2;
    const rightBottomY = left.doc.heightMeters / 2 - right.doc.heightMeters;
    this._d.set(seamX, Math.min(leftBottomY, rightBottomY), 0);
    left.object.localToWorld(this._d);

    const control = this.control.document;
    this._e.subVectors(this._head, this._d).normalize();
    control.position.copy(this._d).addScaledVector(this._e, CONTROL_SLAB_CLEARANCE_METERS);
    this._viewUp.copy(UP).addScaledVector(this._e, -UP.dot(this._e)).normalize();
    const drop =
      this.control.heightMeters / 2 +
      control.position.distanceTo(this._head) * Math.tan(MathUtils.degToRad(CONTROL_VIEW_GAP_DEG));
    control.position.addScaledVector(this._viewUp, -drop);
    control.lookAt(this._head);

    // The control faces the eyes, so it's tilted against the slabs' plane
    // (both docked slabs share it) and the sight line isn't the plane's
    // normal: push it along the sight line until every corner is at least
    // CONTROL_SLAB_CLEARANCE_METERS off that plane.
    control.updateWorldMatrix(true, false);
    let minOffPlane = Infinity;
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sy = -1; sy <= 1; sy += 2) {
        this._c.set((sx * this.control.widthMeters) / 2, (sy * this.control.heightMeters) / 2, 0);
        control.localToWorld(this._c);
        left.object.worldToLocal(this._c);
        minOffPlane = Math.min(minOffPlane, this._c.z);
      }
    }
    if (minOffPlane < CONTROL_SLAB_CLEARANCE_METERS) {
      left.object.getWorldQuaternion(this._q2);
      this._normal.set(0, 0, 1).applyQuaternion(this._q2);
      const alongNormal = Math.max(0.2, this._e.dot(this._normal));
      control.position.addScaledVector(this._e, (CONTROL_SLAB_CLEARANCE_METERS - minOffPlane) / alongNormal);
    }
  }

  // --- Pinch near the control ---------------------------------------------------------

  /**
   * A hand pinch whose pinch point lands on an option selects it. Poke and
   * ray select arrive as UIKit clicks instead; if one of those also fires
   * for the same press, `setJoinType` is idempotent.
   */
  private updatePinchSelect(): void {
    if (this.state.phase !== 'joined' || !this.control.document.visible || this.control.fade.peek() < 0.5) {
      return;
    }
    for (const hand of HANDS) {
      const source = this.input.xr.getPrimaryInputSource(hand);
      if (!source?.hand || !this.input.xr.gamepads[hand]?.getSelectStart()) {
        continue;
      }
      if (this.readPinchPoint(source, this._pinchA)) {
        this.evaluatePinch(hand, this._pinchA);
      }
    }
  }

  /** World-space midpoint of the thumb and index fingertips, if tracked. */
  private readPinchPoint(source: XRInputSource, out: Vector3): boolean {
    const frame = this.world.xrFrame;
    const space = this.world.xrReferenceSpace;
    const thumb = source.hand?.get('thumb-tip');
    const index = source.hand?.get('index-finger-tip');
    if (!frame || !space || !thumb || !index || !frame.getJointPose) {
      return false;
    }
    const thumbPose = frame.getJointPose(thumb, space);
    const indexPose = frame.getJointPose(index, space);
    if (!thumbPose || !indexPose) {
      return false;
    }
    const a = thumbPose.transform.position;
    const b = indexPose.transform.position;
    out.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    // Joint poses are in the XR reference space, which the player rig carries.
    this.player.updateWorldMatrix(true, false);
    out.applyMatrix4(this.player.matrixWorld);
    return true;
  }

  private evaluatePinch(hand: (typeof HANDS)[number], point: Vector3): void {
    const control = this.control;
    control.document.updateWorldMatrix(true, false);
    this._pinchB.copy(point);
    control.document.worldToLocal(this._pinchB);
    const depth = Math.abs(this._pinchB.z);
    const planar = (centerX: number) =>
      Math.hypot(
        Math.max(0, Math.abs(this._pinchB.x - centerX) - control.optionWidthMeters / 2),
        Math.max(0, Math.abs(this._pinchB.y) - control.optionHeightMeters / 2),
      );
    const innerDistance = planar(control.innerCenterX);
    const leftDistance = planar(control.leftCenterX);
    const nearest: JoinType = innerDistance <= leftDistance ? 'inner' : 'left';
    const distance = Math.min(innerDistance, leftDistance);
    const selected = distance <= CONTROL_PINCH_MARGIN_METERS && depth <= CONTROL_PINCH_DEPTH_METERS;

    if (import.meta.env.DEV && this.debug) {
      const name = nearest.toUpperCase();
      const already = this.state.phase === 'joined' && this.state.joinType === nearest;
      this.debug.note(
        `${hand} pinch evaluated against the control: pinch point ${cm(distance)} from ${name} in plane, ` +
          `${cm(depth)} off its surface -> ` +
          (selected
            ? `selected ${name}${already ? ' (already selected)' : ''}`
            : `not selected (needs <= ${cm(CONTROL_PINCH_MARGIN_METERS)} in plane and ` +
              `<= ${cm(CONTROL_PINCH_DEPTH_METERS)} off the surface)`),
      );
    }
    if (selected) {
      this.requestJoinType(nearest);
    }
  }

  private readHead(): void {
    this.player.head.updateWorldMatrix(true, false);
    this._head.setFromMatrixPosition(this.player.head.matrixWorld);
    this._q1.setFromRotationMatrix(this.player.head.matrixWorld);
    this._euler.setFromQuaternion(this._q1, 'YXZ');
    this.headPitchDown = -this._euler.x;
  }

  /**
   * Dev-only (`debug` flag): logs every joined element's eye distance and
   * view angles -- the source slabs and the control against the seated
   * reach limit, the result slab against its relaxed top limit and the
   * minimum text size -- plus the control's clearance from the source slabs'
   * grab surfaces. Warns on any limit it breaks. Runs once per join, so the
   * small allocations here are fine.
   */
  private warnIfOutOfView(view: ResultView, left: SourceSlab, right: SourceSlab): void {
    if (!import.meta.env.DEV || !this.debug) {
      return;
    }
    const debug = this.debug;
    const reachNote = (distance: number) =>
      `reach limit ${TOUCH_REACH_MAX_METERS} m, ${distance <= TOUCH_REACH_MAX_METERS + 0.005 ? 'within reach' : 'BEYOND REACH'}`;

    // The RIGHT slab is still animating into its dock; measure it there.
    const restore = this._c.copy(right.object.position);
    this._q2.copy(right.object.quaternion);
    right.object.position.copy(this.dock.toPos);
    right.object.quaternion.copy(this.dock.toQuat);

    // Source slabs: touched, so against the reach limit (and the desk view limit).
    let sourceDistance = 0;
    for (const slab of [left, right]) {
      measureSlabEdges(
        this._head,
        this.headPitchDown,
        slab.object,
        slabTopLocalY(slab.doc),
        slabBottomLocalY(slab.doc),
        this._a,
        this._edges,
        FOV_MAX_ABOVE_FORWARD_DEG,
        DESK_MAX_BELOW_FORWARD_DEG,
      );
      this._a.setFromMatrixPosition(slab.object.matrixWorld);
      const distance = this._a.distanceTo(this._head);
      sourceDistance = Math.max(sourceDistance, distance);
      debug.note(
        `${slab.id} slab (touch): center ${distance.toFixed(2)} m from the eyes (${reachNote(distance)}); ` +
          `edges top ${this._edges.topDeg.toFixed(1)}°, bottom ${this._edges.bottomDeg.toFixed(1)}° from head forward`,
      );
      if (distance > TOUCH_REACH_MAX_METERS + 0.005) {
        debug.warn(`${slab.id} slab is ${distance.toFixed(2)} m from the eyes, beyond the ${TOUCH_REACH_MAX_METERS} m reach limit`);
      }
    }

    // Control: touched, so against the reach limit; plus its grab clearance.
    const control = this.control;
    control.document.updateWorldMatrix(true, false);
    this._a.setFromMatrixPosition(control.document.matrixWorld);
    const controlDistance = this._a.distanceTo(this._head);
    const controlDeg = degreesFromForward(this._head, this.headPitchDown, this._a);
    let clearance = Infinity;
    for (const sx of [-1, 0, 1]) {
      for (const sy of [-1, 0, 1]) {
        this._d.set((sx * control.widthMeters) / 2, (sy * control.heightMeters) / 2, 0);
        control.document.localToWorld(this._d);
        clearance = Math.min(clearance, distanceToSlab(this._d, left, this._e), distanceToSlab(this._d, right, this._e));
      }
    }
    debug.note(
      `join-type control (touch): center ${controlDistance.toFixed(2)} m from the eyes (${reachNote(controlDistance)}), ` +
        `${controlDeg.toFixed(1)}° from head forward (limit -${CONTROL_MAX_BELOW_FORWARD_DEG}°); clearance to the nearest ` +
        `source slab ${cm(clearance)} (palm grab sphere ${cm(GRAB_SPHERE_RADIUS_METERS)}, target >= ` +
        `${cm(CONTROL_SLAB_CLEARANCE_METERS)}); options ${cm(control.optionWidthMeters)} x ${cm(control.optionHeightMeters)}`,
    );
    if (controlDistance > TOUCH_REACH_MAX_METERS + 0.005) {
      debug.warn(`join-type control is ${controlDistance.toFixed(2)} m from the eyes, beyond the reach limit`);
    }
    if (controlDeg < -(CONTROL_MAX_BELOW_FORWARD_DEG + 0.5)) {
      debug.warn(`join-type control is ${(-controlDeg).toFixed(1)}° below head forward, past its ${CONTROL_MAX_BELOW_FORWARD_DEG}° limit`);
    }
    if (clearance < CONTROL_SLAB_CLEARANCE_METERS - 0.005) {
      debug.warn(`join-type control is only ${cm(clearance)} from a source slab (target ${cm(CONTROL_SLAB_CLEARANCE_METERS)})`);
    }

    right.object.position.copy(restore);
    right.object.quaternion.copy(this._q2);

    // Result slab: viewed, not touched.
    measureSlabEdges(
      this._head,
      this.headPitchDown,
      view.object,
      slabTopLocalY(view.doc),
      slabBottomLocalY(view.doc),
      this._a,
      this._edges,
      RESULT_MAX_ABOVE_FORWARD_DEG,
      FOV_MAX_BELOW_FORWARD_DEG,
    );
    const topDeg = this._edges.topDeg;
    const bottomDeg = this._edges.bottomDeg;
    this._a.set(0, -view.doc.heightMeters / 2, 0);
    view.object.localToWorld(this._a);
    const resultDistance = this._a.distanceTo(this._head);
    const centerDeg = degreesFromForward(this._head, this.headPitchDown, this._a);
    const resultTextDeg = textAngleDeg(DATA_TEXT_HEIGHT_METERS, resultDistance);
    debug.note(
      `result slab (view only): ${resultDistance.toFixed(2)} m from the eyes (cap ${RESULT_MAX_DISTANCE_METERS} m), ` +
        `center ${centerDeg.toFixed(1)}°, top edge ${topDeg.toFixed(1)}°, bottom edge ${bottomDeg.toFixed(1)}° from ` +
        `head forward; row text ${resultTextDeg.toFixed(2)}° tall (source slabs ` +
        `${textAngleDeg(DATA_TEXT_HEIGHT_METERS, sourceDistance).toFixed(2)}° at ${sourceDistance.toFixed(2)} m; ` +
        `minimum ${MIN_ROW_TEXT_DEG.toFixed(2)}°)`,
    );
    if (!this._edges.fits) {
      debug.warn(
        `result slab edges outside the comfortable view (top ${topDeg.toFixed(1)}°, bottom ${bottomDeg.toFixed(1)}° ` +
          `from head forward; limits -${FOV_MAX_BELOW_FORWARD_DEG}°/+${RESULT_MAX_ABOVE_FORWARD_DEG}°)`,
      );
    }
    if (resultTextDeg < MIN_ROW_TEXT_DEG) {
      debug.warn(`result slab row text is ${resultTextDeg.toFixed(2)}° tall, below the ${MIN_ROW_TEXT_DEG}° minimum`);
    }
  }

  // --- Joined: separation by pulling -------------------------------------------------

  private updateJoined(): void {
    if (this.state.phase !== 'joined') {
      return;
    }
    const left = this.sources.get(this.state.left);
    const right = this.sources.get(this.state.right);
    if (!left || !right) {
      return;
    }
    if (this.pulledApart(left, right, false) || this.pulledApart(right, left, true)) {
      this.applyTransition({ type: 'pullApart' });
      return;
    }
    // The result slab and the control follow the pair, so re-place them
    // whenever the pair can be moving: while a docked slab is held (before
    // it's pulled apart) or snapping back into its dock.
    const view = this.active;
    if (view && (this.dock.active || left.entity.hasComponent(Grabbed) || right.entity.hasComponent(Grabbed))) {
      this.placeResult(view, left, right);
    }
  }

  /** Whether held `slab` is farther than SEPARATE_DISTANCE_METERS from its dock pose. */
  private pulledApart(slab: SourceSlab, partner: SourceSlab, slabIsRight: boolean): boolean {
    if (!slab.entity.hasComponent(Grabbed)) {
      return false;
    }
    this.computeDockPose(partner, slab, slabIsRight, this._a, this._q1);
    return slab.object.position.distanceTo(this._a) > SEPARATE_DISTANCE_METERS;
  }

  // --- Per-frame visuals -------------------------------------------------------------

  private hidePreview(): void {
    this.stationaryGlow.hide();
    this.movingGlow.hide();
    this.hints.setCount(0);
    this.hints.update();
  }

  private updatePreviewVisuals(): void {
    if (this.state.phase !== 'previewing') {
      if (this.hints.mesh.count > 0 || this.stationaryGlow.mesh.visible) {
        this.hidePreview();
      }
      return;
    }
    const moving = this.sources.get(this.state.moving);
    const stationary = this.sources.get(this.state.stationary);
    if (!moving || !stationary) {
      return;
    }
    const side = this.previewSide;
    const pulse = 0.55 + 0.25 * Math.sin(this.tweens.now * 7);
    this.stationaryGlow.place(
      stationary.object,
      (side * stationary.doc.widthMeters) / 2,
      0,
      stationary.doc.heightMeters,
      pulse,
    );
    this.movingGlow.place(moving.object, (-side * moving.doc.widthMeters) / 2, 0, moving.doc.heightMeters, pulse);

    this.hints.setCount(PREVIEW_HINT_COUNT);
    this.hints.fade.value = pulse;
    for (let i = 0; i < PREVIEW_HINT_COUNT; i++) {
      const fraction = 0.5 - (i + 1) / (PREVIEW_HINT_COUNT + 1);
      this._a.set((side * stationary.doc.widthMeters) / 2, fraction * stationary.doc.heightMeters, LINE_SURFACE_OFFSET_METERS);
      stationary.object.localToWorld(this._a);
      this._b.set((-side * moving.doc.widthMeters) / 2, fraction * moving.doc.heightMeters, LINE_SURFACE_OFFSET_METERS);
      moving.object.localToWorld(this._b);
      this.hints.setEndpoints(i, this._a, this._b);
      this.hints.progress[i].value = 1;
    }
    this.hints.update();
  }

  private updateLines(): void {
    const view = this.active;
    const phase = this.state.phase;
    if (!view || (phase !== 'joined' && phase !== 'separating')) {
      if (this.lines.mesh.count > 0) {
        this.lines.setCount(0);
        this.lines.update();
      }
      return;
    }
    const left = this.sources.get(view.leftId);
    const right = this.sources.get(view.rightId);
    if (!left || !right) {
      return;
    }
    left.object.updateWorldMatrix(true, false);
    right.object.updateWorldMatrix(true, false);
    const leftEdgeX = (this.dockSide * left.doc.widthMeters) / 2;
    const rightEdgeX = (-this.dockSide * right.doc.widthMeters) / 2;
    const count = view.lineLeftRows.length;
    for (let i = 0; i < count; i++) {
      this._a.set(leftEdgeX, rowCenterLocalY(left.doc, view.lineLeftRows[i]), LINE_SURFACE_OFFSET_METERS);
      left.object.localToWorld(this._a);
      this._b.set(rightEdgeX, rowCenterLocalY(right.doc, view.lineRightRows[i]), LINE_SURFACE_OFFSET_METERS);
      right.object.localToWorld(this._b);
      this.lines.setEndpoints(i, this._a, this._b);
    }
    this.lines.update();
  }
}

function resultKey(leftId: string, rightId: string): string {
  return `${leftId}>${rightId}`;
}

function cm(meters: number): string {
  return `${(meters * 100).toFixed(1)} cm`;
}

/**
 * Distance from world `point` to a source slab's panel rectangle, measured
 * in the slab's own frame (the grab surface the palm sphere must reach).
 * Uses `scratch`; allocates nothing.
 */
function distanceToSlab(point: Vector3, slab: SourceSlab, scratch: Vector3): number {
  slab.object.updateWorldMatrix(true, false);
  scratch.copy(point);
  slab.object.worldToLocal(scratch);
  const top = slabTopLocalY(slab.doc);
  const bottom = slabBottomLocalY(slab.doc);
  const dx = Math.max(0, Math.abs(scratch.x) - slab.doc.widthMeters / 2);
  const dy = scratch.y > top ? scratch.y - top : scratch.y < bottom ? bottom - scratch.y : 0;
  return Math.sqrt(dx * dx + dy * dy + scratch.z * scratch.z);
}
