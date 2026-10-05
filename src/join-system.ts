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
 * entity in the band between the pair's top edge and the result slab,
 * centered on the seam, floating CONTROL_SLAB_CLEARANCE_METERS off the slab
 * plane toward the eyes -- right next to the SQL caption it switches. It isn't
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
  VisibilityState,
  type Entity,
  type Object3D,
  type Signal,
} from '@iwsdk/core';
import { CHALLENGE_MODE } from './challenge-mode.js';
import type { RowStatus } from './data/compare.js';
import {
  buildJoinResultTable,
  fullJoinPairings,
  joinTables,
  requireJoinKeys,
  type JoinResultTable,
} from './data/join-result.js';
import { buildJoinSql, buildWhereSql } from './data/join-sql.js';
import { INITIAL_JOIN_STATE, transition, type JoinEvent, type JoinState } from './data/join-state.js';
import { assignKeyTints } from './data/key-tints.js';
import { RESULT_ROW_CAP } from './data/puzzles.js';
import { filterForColumn, nullFilterMask, sameFilter } from './data/query.js';
import { DATASETS, datasetOfTable, tableById } from './data/datasets.js';
import type { QuerySpec } from './data/query.js';
import type { CellValue, JoinType, NullFilter, Table } from './data/types.js';
import { deskReady } from './desk-bridge.js';
import { devFlag } from './dev-flags.js';
import { joinBridge, type ChallengeLayout, type JoinControls, type PlacedElement } from './join-bridge.js';
import { JoinDebug, type JoinDebugHost, type JoinStats } from './join-debug.js';
import { COLOR_MATCH_LINE, COLOR_PREVIEW, EdgeGlow, lineColorForTint, SegmentBatch } from './join-visuals.js';
import { readJointsPoint, readPinchPoint, readWristPoint } from './pinch.js';
import { JoinDocked, JoinResultSlab, TableSlab, TableSlabRuntime } from './table-slab-component.js';
import {
  buildJoinTypeControl,
  buildTableSlabDocument,
  captionColor,
  controlOptionStyle,
  MAX_RESULT_ROWS,
  rowCenterLocalY,
  setRowTint,
  slabBorderColor,
  slabBottomLocalY,
  slabTopLocalY,
  slabVisualTopLocalY,
  type CellOffset,
  type JoinTypeControlView,
  type TableSlabDocument,
} from './table-slab-view.js';
import { sounds } from './sound.js';
import {
  BOUNCE_FIRST_IMPACT,
  easeInCubic,
  easeInOutCubic,
  easeOutBackSoft,
  easeOutBounce,
  easeOutCubic,
  TweenPool,
} from './tween.js';
import {
  degreesFromForward,
  eyeFacingLeanFromBottom,
  GROUP_MAX_VERTICAL_FOV_DEG,
  measureSlabEdges,
  MIN_ROW_TEXT_DEG,
  NATURAL_GAZE_PITCH_DEG,
  NATURAL_GAZE_PITCH_RAD,
  PLANNED_CONTROL_DISTANCE_METERS,
  PLANNED_RESULT_DISTANCE_METERS,
  ROW_TEXT_TARGET_DEG,
  slabTextSizeAt,
  TEXT_ANGLE_TOLERANCE,
  textAngleDeg,
  TOUCH_REACH_MAX_METERS,
  VIEW_MAX_ABOVE_GAZE_DEG,
  VIEW_MAX_BELOW_GAZE_DEG,
  type SlabEdgeAngles,
} from './view-comfort.js';

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
/**
 * The "magnet": from this edge gap in, a held slab's approach shows as a
 * facing-edge glow (and hum) that strengthens until the preview gap.
 */
const APPROACH_GAP_METERS = 0.15;
const APPROACH_GLOW_MIN = 0.12;
const APPROACH_GLOW_RANGE = 0.35;

// --- Commit / dock -------------------------------------------------------------
// Room for fan-out lines between the docked slabs. Independent of the preview
// thresholds above (those measure how far the held slab has been pushed, not
// the dock gap) and of SEPARATE_DISTANCE_METERS (measured from the dock pose),
// so widening it needs no threshold changes.
const DOCK_GAP_METERS = 0.09;
// Snaps in with a slight overshoot and settle (easeOutBackSoft).
const DOCK_DURATION_SECONDS = 0.22;
const REDOCK_DURATION_SECONDS = 0.18;
/** Pulling a docked slab farther than this from its dock pose separates. */
const SEPARATE_DISTANCE_METERS = 0.1;
/** Debug separate: how far the RIGHT slab slides away. */
const DEBUG_SEPARATE_SLIDE_METERS = 0.15;

// --- Join animation timeline (seconds after release; total ~1.3 s) ----------
// 0 snap | 0-0.22 dock | 0.22+ lines (+0.03 each) | 0.35+ rows fly (+0.05
// each, 0.35 s flights) | 0.55 unmatched rows drop | last row lands: resolve.
const LINE_START_SECONDS = DOCK_DURATION_SECONDS;
const LINE_STAGGER_SECONDS = 0.03;
const LINE_DRAW_SECONDS = 0.2;
const RESULT_APPEAR_SECONDS = 0.15;
const RESULT_FADE_SECONDS = 0.2;
const ROW_START_SECONDS = 0.35;
const ROW_STAGGER_SECONDS = 0.05;
/** Each result row's cells fly from their source rows for this long. */
const ROW_FLY_SECONDS = 0.35;
/** A row's background fades in over this last fraction of its flight, as its cells land. */
const ROW_BACKGROUND_LANDING_FRACTION = 0.3;
const ROW_DURATION_SECONDS = 0.22;
const ROW_SLIDE_CM = 2;
const DIM_START_SECONDS = 0.55;
const DIM_DURATION_SECONDS = 0.45;
const DIM_OPACITY = 0.35;
/**
 * An excluded row drops by this fraction of its own row height, bounce
 * included (easeOutBounce never passes its target), so it stays inside its
 * slot and never overlaps its neighbor. Derived from the row height because
 * rows scale with the font.
 */
const DIM_DROP_ROW_FRACTION = 0.12;
const TOGGLE_DURATION_SECONDS = 0.3;
const SEPARATE_DURATION_SECONDS = 0.3;

// --- Visuals -------------------------------------------------------------------
const MAX_MATCH_LINES = 24;
// Lines are secondary to the key tints: thin, translucent, tinted per key.
const LINE_THICKNESS_METERS = 0.0015;
const LINE_OPACITY = 0.55;
const LINE_SURFACE_OFFSET_METERS = 0.004;
const GLOW_WIDTH_METERS = 0.008;
// A short bright pulse travels along each match line as it draws.
const COLOR_LINE_PULSE = '#fff2d0';
const LINE_PULSE_THICKNESS_METERS = 0.003;
const LINE_PULSE_OPACITY = 0.9;
/** Pulse length as a fraction of its line. */
const LINE_PULSE_FRACTION = 0.18;

// --- Result slab placement ----------------------------------------------------
// Bottom edge just above and slightly behind the docked pair's top edge,
// leaning back only as far as needed to face the eyes.
// Leaves room for the join-type control in the band below the result slab,
// and keeps a pinch at the result's bottom edge out of the pair's grab range.
const RESULT_GAP_ABOVE_METERS = 0.08;
const RESULT_BEHIND_METERS = 0.02;
/** Legibility cap: the result slab's center is never farther than this from the eyes. */
const RESULT_MAX_DISTANCE_METERS = 0.85;
/** Push-back steps that bring the result slab's top edge (and the card above it) inside the view. */
const RESULT_FIT_ITERATIONS = 6;
/**
 * Pushing the result slab back to fit the card above it never takes its row
 * text below this angle (measured at the slab's center): legibility wins
 * over the last degree of the view window.
 */
const RESULT_MIN_PUSHED_ROW_TEXT_DEG = 1.05;
/** The result slab's (and silhouette's) row font: sized by angle at the planned result distance. */
const RESULT_ROW_FONT_METERS = slabTextSizeAt(PLANNED_RESULT_DISTANCE_METERS).rowFontCm / 100;
/** The farthest the result slab's center may be pushed: the legibility cap, or where its rows reach the minimum angle. */
const RESULT_MAX_PUSHED_DISTANCE_METERS = Math.min(
  RESULT_MAX_DISTANCE_METERS,
  RESULT_ROW_FONT_METERS / (2 * Math.tan(MathUtils.degToRad(RESULT_MIN_PUSHED_ROW_TEXT_DEG) / 2)),
);
const PARKED_Y = -100;

// --- Join-type control ----------------------------------------------------------
/**
 * Every point of the control floats at least this far off the source slabs
 * (toward the eyes): 3 cm more than the 7 cm palm grab sphere, so a palm on
 * the control can't reach a slab's grab surface.
 */
const CONTROL_SLAB_CLEARANCE_METERS = 0.1;
/**
 * In view, the control's bottom edge sits this far above the pair's top
 * edge, and the result slab's bottom edge this far above the control.
 */
const CONTROL_VIEW_GAP_DEG = 1;
/** A pinch selects an option when its pinch point is this close to it, in plane... */
const CONTROL_PINCH_MARGIN_METERS = 0.015;
/** ...and at most this far in front of / behind the control's surface. */
const CONTROL_PINCH_DEPTH_METERS = 0.03;
/** Grab sphere radius of IWSDK's grab pointer, for the clearance readout. */
const GRAB_SPHERE_RADIUS_METERS = 0.07;

// --- Challenge mode ------------------------------------------------------------------
/** Clear gap between the join-type control and the puzzle bar, side by side in the band (never less). */
const BAR_CONTROL_GAP_METERS = 0.015;
/** Gap between the result slot's top edge and the puzzle card. */
const CARD_GAP_METERS = 0.015;
/** A filter change: leaving rows fade out, then the rest slide to their new slots. */
const FILTER_FADE_SECONDS = 0.2;
const FILTER_SLIDE_SECONDS = 0.25;
/** Rows the answer doesn't have: dimmed, with a `+` marker. */
const DIFF_EXTRA_OPACITY = 0.55;
const DIFF_FADE_SECONDS = 0.2;
/** A poke and a ray select (or a pinch) on the same NULL cell count once. */
const NULL_ACTIVATION_DEBOUNCE_SECONDS = 0.3;
/** A pinch selects a NULL cell within this of it in plane (and CONTROL_PINCH_DEPTH_METERS off it). */
const NULL_PINCH_MARGIN_METERS = 0.01;
/** A ray hit or fingertip counts as on a NULL cell within this of its rectangle. */
const NULL_RAY_TOLERANCE_METERS = 0.003;
/** A fingertip pokes when it crosses to within this of the result slab's surface. */
const NULL_POKE_DEPTH_METERS = 0.01;
const INDEX_TIP: readonly XRHandJoint[] = ['index-finger-tip'];
/** Home glide on Next: both slabs return to where they started. */
const HOME_GLIDE_SECONDS = 0.45;
const COLOR_WIN_GLOW = '#f0b43c';

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
  /** Per result row: its LEFT / RIGHT source row index (lineage), or -1 for none. */
  rowLeftSource: number[];
  rowRightSource: number[];
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
  /** The full LEFT JOIN result the slab shows (INNER and the NULL filter hide rows of it). */
  result: JoinResultTable;
  leftTable: Table;
  rightTable: Table;
  /** Per result row: currently displayed. */
  rowShown: boolean[];
  /** Per result row: its display slot (0 = top), or -1 while hidden. */
  rowSlot: number[];
  /** Per result row: the indices of its columns holding NULL. */
  nullColumns: number[][];
  /** Challenge mode: placeholder rows shown for rows the answer still needs. */
  placeholdersShown: number;
  /** Removes this view's listeners (when its tables leave the desk, or at shutdown). */
  cleanup: (() => void)[];
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

function dockAnimation(duration: number): DockAnimation {
  return {
    active: false,
    slab: null,
    fromPos: new Vector3(),
    fromQuat: new Quaternion(),
    toPos: new Vector3(),
    toQuat: new Quaternion(),
    elapsed: 0,
    duration,
  };
}

/** Where a slab sat before this puzzle's first grab or join (challenge mode's home glide). */
type HomePose = { pos: Vector3; quat: Quaternion; set: boolean };

export class JoinSystem
  extends createSystem({
    sources: { required: [TableSlab, TableSlabRuntime], excluded: [JoinResultSlab] },
    held: { required: [TableSlab, Grabbed] },
  })
  implements JoinDebugHost, JoinControls
{
  private state: JoinState = INITIAL_JOIN_STATE;
  private readonly sources = new Map<string, SourceSlab>();
  private readonly results = new Map<string, ResultView>();
  /** Result directions still to build (left id, right id), one per frame. */
  private pendingResults: [string, string][] = [];
  private active: ResultView | null = null;

  /** Sign of the RIGHT slab's x in the LEFT slab's frame (+1: docked on its right). */
  private dockSide = 1;
  private previewSide = 1;
  private previewExitTimer = 0;

  private readonly tweens = new TweenPool(256);
  /** 0..1 approach of a held slab toward the other (the "magnet"); 0 when none. */
  private approach = 0;
  private approachMoving: SourceSlab | null = null;
  private approachStationary: SourceSlab | null = null;
  private readonly separateClock = signal(0);
  private readonly dock: DockAnimation = dockAnimation(DOCK_DURATION_SECONDS);

  // Challenge mode (all inert in free play: `challengeLayout` stays null).
  private challengeLayout: ChallengeLayout | null = null;
  private silhouette: PlacedElement | null = null;
  private layoutDirty = true;
  private readonly homes = new Map<string, HomePose>();
  private readonly glides = new Map<string, DockAnimation>();
  private winLook = false;
  private winGlowLeft!: EdgeGlow;
  private winGlowRight!: EdgeGlow;
  /** Fires the challenge's `onSettled` once an animation finishes (a tween's completion). */
  private readonly settleClock = signal(0);
  /** Times the second step of a filter change (the relayout after rows fade out). */
  private readonly relayoutClock = signal(0);
  private lastNullActivation = -Infinity;
  private readonly _nullHit = { row: -1, column: -1, distance: Infinity, depth: 0 };
  /** Per hand: the index fingertip's last distance in front of the result slab (for pokes). */
  private readonly pokeDepth = { left: Infinity, right: Infinity };
  private readonly _rayOrigin = new Vector3();
  private readonly _rayDir = new Vector3();
  private readonly _pokeTip = new Vector3();
  private readonly _layoutA = new Vector3();
  private readonly _layoutB = new Vector3();

  private visualsRoot!: Group;
  private lines!: SegmentBatch;
  private pulses!: SegmentBatch;
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
  private readonly _f = new Vector3();
  private readonly _g = new Vector3();
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
    this.pulses = new SegmentBatch(MAX_MATCH_LINES, COLOR_LINE_PULSE, LINE_PULSE_THICKNESS_METERS, LINE_PULSE_OPACITY);
    this.hints = new SegmentBatch(PREVIEW_HINT_COUNT, COLOR_PREVIEW, 0.002, 0.45);
    this.stationaryGlow = new EdgeGlow(GLOW_WIDTH_METERS);
    this.movingGlow = new EdgeGlow(GLOW_WIDTH_METERS);
    this.winGlowLeft = new EdgeGlow(GLOW_WIDTH_METERS, COLOR_WIN_GLOW);
    this.winGlowRight = new EdgeGlow(GLOW_WIDTH_METERS, COLOR_WIN_GLOW);
    this.visualsRoot.add(
      this.lines.mesh,
      this.pulses.mesh,
      this.hints.mesh,
      this.stationaryGlow.mesh,
      this.movingGlow.mesh,
      this.winGlowLeft.mesh,
      this.winGlowRight.mesh,
    );
    const visualsEntity = this.world.createTransformEntity(this.visualsRoot, {
      parent: this.world.sceneEntity,
      persistent: true,
    });

    // Bold label sized like header text at the control's distance; the
    // options keep their fingertip-sized minimum regardless.
    this.control = buildJoinTypeControl(slabTextSizeAt(PLANNED_CONTROL_DISTANCE_METERS).headerFontCm);
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

    // Sound: built now (suspended); started by the first user gesture.
    sounds.init(this.world, { muted: import.meta.env.DEV && devFlag('mute') });
    if (import.meta.env.DEV && this.debug) {
      const debug = this.debug;
      sounds.setHook((name, delay, peakDb) =>
        debug.note(
          `sound: ${name} at +${delay.toFixed(2)} s; ` +
            (peakDb === null
              ? 'not played (audio not running, or muted)'
              : `output peak ${Number.isFinite(peakDb) ? peakDb.toFixed(1) : '-inf'} dBFS`),
        ),
      );
    }
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        if (state !== VisibilityState.NonImmersive) {
          sounds.unlock();
        }
      }),
    );

    this.cleanupFuncs.push(
      () => this.control.inner.removeEventListener('click', onInner),
      () => this.control.left.removeEventListener('click', onLeft),
      () => {
        this.lines.dispose();
        this.pulses.dispose();
        this.hints.dispose();
        this.stationaryGlow.dispose();
        this.movingGlow.dispose();
        this.winGlowLeft.dispose();
        this.winGlowRight.dispose();
        visualsEntity.dispose();
        this.debug?.dispose();
        for (const view of this.results.values()) {
          view.cleanup.forEach((fn) => fn());
        }
      },
    );

    for (const entity of this.queries.sources.entities) {
      this.registerSource(entity);
    }
    this.queries.sources.subscribe('qualify', (entity) => this.registerSource(entity));
    // A dataset switch disposes the old slabs: forget them and their result views.
    this.queries.sources.subscribe('disqualify', (entity) => this.unregisterSource(entity));
    this.queries.held.subscribe('disqualify', (entity) => this.onRelease(entity));

    if (CHALLENGE_MODE) {
      joinBridge.join = this;
      // Home poses: where each slab was before this puzzle first moved it.
      this.queries.held.subscribe('qualify', (entity) => {
        const source = this.sourceFor(entity);
        if (source) {
          this.captureHome(source);
        }
      });
      // A new session re-places the slabs: forget the old homes, re-lay out.
      this.cleanupFuncs.push(
        this.world.visibilityState.subscribe(() => {
          for (const home of this.homes.values()) {
            home.set = false;
          }
          this.layoutDirty = true;
        }),
        () => {
          joinBridge.join = null;
        },
      );
    }
  }

  update(delta: number): void {
    this.tweens.update(delta);
    this.updateDock(delta);
    this.updateGlides(delta);
    sounds.update();
    this.unlockSoundOnPinch();
    // Result slabs for newly arrived tables: one document per frame.
    const pending = this.pendingResults.shift();
    if (pending) {
      this.resultViewFor(pending[0], pending[1]);
    }
    if (this.challengeLayout) {
      this.updateChallengeLayout();
      this.updateWinGlow();
    }

    this.approach = 0;
    switch (this.state.phase) {
      case 'idle':
      case 'previewing':
        // Mid-switch (challenge mode), tables are leaving or arriving: no joins.
        if (deskReady()) {
          this.updateProximity(delta);
        } else if (this.state.phase === 'previewing') {
          this.applyTransition({ type: 'exitRange' });
        }
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
    if (this.challengeLayout) {
      this.updateNullRayAndPoke();
    }
  }

  /**
   * Challenge mode: ray selects and fingertip pokes on NULL cells, tested
   * against the result slab's own geometry (UIKit clicks don't reach the
   * result slab in the emulator, so this doesn't rely on them).
   * - Ray: on select start, each input's target ray is intersected with the
   *   slab's plane; a hit inside a NULL cell pokes it.
   * - Poke: an index fingertip crossing the surface (from in front to within
   *   NULL_POKE_DEPTH_METERS) over a NULL cell pokes it.
   * A pinch on the same press may also land; the activation debounce makes it count once.
   */
  private updateNullRayAndPoke(): void {
    const view = this.active;
    if (!view || this.state.phase !== 'joined' || view.doc.fade.peek() < 0.5) {
      this.pokeDepth.left = Infinity;
      this.pokeDepth.right = Infinity;
      return;
    }
    view.object.updateWorldMatrix(true, false);
    for (const hand of HANDS) {
      // Ray.
      if (this.input.xr.gamepads[hand]?.getSelectStart()) {
        const raySpace = this.player.raySpaces[hand];
        raySpace.updateWorldMatrix(true, false);
        this._rayOrigin.setFromMatrixPosition(raySpace.matrixWorld);
        raySpace.getWorldQuaternion(this._q2);
        this._rayDir.set(0, 0, -1).applyQuaternion(this._q2).add(this._rayOrigin);
        // Into the slab's frame, where its surface is z = 0.
        view.object.worldToLocal(this._rayOrigin);
        view.object.worldToLocal(this._rayDir);
        this._rayDir.sub(this._rayOrigin);
        if (this._rayDir.z < -1e-4 && this._rayOrigin.z > 0) {
          const t = -this._rayOrigin.z / this._rayDir.z;
          this._a.copy(this._rayOrigin).addScaledVector(this._rayDir, t);
          view.object.localToWorld(this._a);
          if (this.nearestNullCell(view, this._a) && this._nullHit.distance <= NULL_RAY_TOLERANCE_METERS) {
            if (import.meta.env.DEV && this.debug) {
              this.debug.note(`${hand} ray select on the NULL cell at row ${this._nullHit.row}, column ${this._nullHit.column}`);
            }
            this.activateNullCell(view.key, this._nullHit.row, this._nullHit.column);
          }
        }
      }
      // Poke.
      const source = this.input.xr.getPrimaryInputSource(hand);
      if (!source?.hand || !readJointsPoint(this.world, this.player, source, INDEX_TIP, this._pokeTip)) {
        this.pokeDepth[hand] = Infinity;
        continue;
      }
      this._a.copy(this._pokeTip);
      view.object.worldToLocal(this._a);
      const depth = this._a.z;
      const before = this.pokeDepth[hand];
      this.pokeDepth[hand] = depth;
      if (before > NULL_POKE_DEPTH_METERS && depth <= NULL_POKE_DEPTH_METERS && depth > -NULL_POKE_DEPTH_METERS) {
        if (this.nearestNullCell(view, this._pokeTip) && this._nullHit.distance <= NULL_RAY_TOLERANCE_METERS) {
          if (import.meta.env.DEV && this.debug) {
            this.debug.note(`${hand} fingertip poke on the NULL cell at row ${this._nullHit.row}, column ${this._nullHit.column}`);
          }
          this.activateNullCell(view.key, this._nullHit.row, this._nullHit.column);
        }
      }
    }
  }

  /** A pinch is a WebXR user gesture: try to start audio until it runs. */
  private unlockSoundOnPinch(): void {
    if (sounds.running) {
      return;
    }
    for (const hand of HANDS) {
      if (this.input.xr.gamepads[hand]?.getSelectStart()) {
        sounds.unlock();
      }
    }
  }

  // --- Public actions (control, debug keys, and later the wrist gesture) -------

  /** The single entry point for changing the join type, whatever the input. */
  requestJoinType(joinType: JoinType): void {
    this.clickControl();
    this.applyTransition({ type: 'setJoinType', joinType });
  }

  toggleJoinType(): void {
    this.clickControl();
    this.applyTransition({ type: 'toggleJoinType' });
  }

  /** Press feedback at the control, whether or not the type changes. */
  private clickControl(): void {
    if (this.control.document.visible) {
      this.control.document.updateWorldMatrix(true, false);
      this._a.setFromMatrixPosition(this.control.document.matrixWorld);
      sounds.playClick(this._a);
    }
  }

  /** Dev (`R`): replays the join animation and sounds on the docked pair, without separating. */
  debugReplay(): void {
    const view = this.active;
    if (this.state.phase !== 'joined' || !view) {
      this.debug?.note(`replay ignored in phase "${this.state.phase}"`);
      return;
    }
    const left = this.sources.get(view.leftId);
    const right = this.sources.get(view.rightId);
    if (!left || !right) {
      return;
    }
    this.tweens.finishAll();
    this.debug?.markJoinStart();
    // Back to the pre-join look, then play the sequence again.
    for (const source of [left, right]) {
      for (const rowView of source.doc.rowViews.values()) {
        this.tweens.set(rowView.opacity, 1);
        this.tweens.set(rowView.offsetYCm, 0);
        setRowTint(rowView, null);
      }
    }
    this.playJoinSequence(view, left, right, this.state.joinType);
  }

  /**
   * Dev: join without grabbing: brings the loaded dataset's child table to
   * its parent (e.g. orders to customers); `reverse` brings the parent to
   * the child instead.
   */
  debugJoin(reverse: boolean): void {
    const [parent, child] = this.parentAndChild();
    const moving = reverse ? parent : child;
    const stationary = reverse ? child : parent;
    if (!moving || !stationary || this.state.phase !== 'idle' || !deskReady()) {
      this.debug?.note(`join ignored in phase "${this.state.phase}"${deskReady() ? '' : ' (tables switching)'}`);
      return;
    }
    this.measureProximity(moving, stationary);
    this.dockSide = this._prox.side;
    this.applyTransition({ type: 'commit', left: stationary.id, right: moving.id });
  }

  /** The loaded dataset's parent (referenced) and child slabs, in its table order. */
  private parentAndChild(): [SourceSlab | undefined, SourceSlab | undefined] {
    const first = this.sources.values().next().value;
    const datasetId = first ? datasetOfTable(first.id) : null;
    if (!datasetId) {
      return [undefined, undefined];
    }
    const [parent, child] = DATASETS[datasetId].tables;
    return [this.sources.get(parent.id), this.sources.get(child.id)];
  }

  /** Dev (`A` / `X` in challenge mode): a query to apply once the pair is separated. */
  private pendingApply: QuerySpec | null = null;

  /**
   * Dev: puts the join into `spec`'s state through the same transitions as
   * real input: separate if joined, then commit with `spec.left` staying
   * put, then the join type, then the NULL filter.
   */
  debugApply(spec: QuerySpec): void {
    if (!deskReady()) {
      this.debug?.note('apply ignored: tables switching');
      return;
    }
    if (this.state.phase === 'joined') {
      this.pendingApply = spec;
      this.applyTransition({ type: 'pullApart' });
      return;
    }
    if (this.state.phase !== 'idle') {
      this.debug?.note(`apply ignored in phase "${this.state.phase}"`);
      return;
    }
    const stationary = this.sources.get(spec.left);
    const moving = this.sources.get(spec.right);
    if (!stationary || !moving) {
      this.debug?.note(`apply ignored: ${spec.left} / ${spec.right} aren't on the desk`);
      return;
    }
    this.measureProximity(moving, stationary);
    this.dockSide = this._prox.side;
    this.applyTransition({ type: 'commit', left: stationary.id, right: moving.id });
    if (spec.joinType === 'left') {
      this.applyTransition({ type: 'setJoinType', joinType: 'left' });
    }
    if (spec.filter) {
      this.applyTransition({ type: 'setFilter', filter: spec.filter });
    }
  }

  isGliding(): boolean {
    return this.gliding();
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
    // A pending "settled" belongs to the previous state.
    this.tweens.cancel(this.settleClock);

    if (next.phase === 'joined' && prev.phase !== 'joined') {
      this.beginJoin(next.left, next.right, next.joinType);
    } else if (next.phase === 'joined' && prev.phase === 'joined' && next.joinType !== prev.joinType) {
      this.applyJoinTypeChange(prev.joinType, next.joinType);
    } else if (
      next.phase === 'joined' &&
      prev.phase === 'joined' &&
      !sameFilter(prev.filter ?? null, next.filter ?? null)
    ) {
      this.applyFilterChange();
    } else if (next.phase === 'separating') {
      this.beginSeparate();
    } else if (next.phase === 'previewing') {
      this.previewExitTimer = 0;
    }

    if (import.meta.env.DEV && this.debug) {
      this.debug.logTransition(event, prev, next, this.currentStats(next));
    }
    if (next.phase !== prev.phase) {
      joinBridge.challenge?.onPhase(next.phase);
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
    const table = tableById(tableId);
    const doc = entity.getValue(TableSlabRuntime, 'layout') as TableSlabDocument | undefined;
    const object = entity.object3D;
    if (!table || !doc || !object || this.sources.has(tableId)) {
      return;
    }
    this.sources.set(tableId, { id: tableId, entity, object, doc, table });
    this.homes.set(tableId, { pos: new Vector3(), quat: new Quaternion(), set: false });
    this.glides.set(tableId, dockAnimation(HOME_GLIDE_SECONDS));
    this.layoutDirty = true;
    // Build every join direction's result slab ahead of any join (at startup,
    // or while new tables arrive), one per frame from update(); a join that
    // starts sooner builds its view on demand.
    for (const other of this.sources.values()) {
      if (other.id !== tableId) {
        this.pendingResults.push([tableId, other.id], [other.id, tableId]);
      }
    }
  }

  /** A slab left the desk (a dataset switch disposed it): forget it, its result views and its home. */
  private unregisterSource(entity: Entity): void {
    const source = this.sourceFor(entity);
    if (!source) {
      return;
    }
    this.sources.delete(source.id);
    this.homes.delete(source.id);
    this.glides.delete(source.id);
    if (this.dock.slab === source) {
      this.dock.active = false;
      this.dock.slab = null;
    }
    this.pendingResults = this.pendingResults.filter(([left, right]) => left !== source.id && right !== source.id);
    for (const [key, view] of this.results) {
      if (view.leftId !== source.id && view.rightId !== source.id) {
        continue;
      }
      if (this.active === view) {
        this.active = null;
      }
      view.cleanup.forEach((fn) => fn());
      view.entity.dispose();
      this.results.delete(key);
    }
    this.layoutDirty = true;
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
    // Challenge mode reserves a third caption line for `WHERE ... IS NULL`
    // (hidden until a filter is set, so filtering never relayouts the
    // caption), sized for every column a filter could name.
    const whereLines = CHALLENGE_MODE
      ? result.columns.map((_, index) => buildWhereSql(left, right, filterForColumn(left, right, result, index)))
      : [];
    const doc = buildTableSlabDocument(result.table, {
      maxRows: MAX_RESULT_ROWS,
      hiddenRows: new Set(ghostRows),
      caption: CHALLENGE_MODE
        ? { lines: [...sql.inner, whereLines[0] ?? ''], fitLines: [...sql.inner, ...sql.left, ...whereLines] }
        : { lines: [...sql.inner], fitLines: [...sql.inner, ...sql.left] },
      ...(CHALLENGE_MODE
        ? {
            diffGutter: true,
            placeholderRows: RESULT_ROW_CAP,
            reserveRows: RESULT_ROW_CAP,
            accent: DATASETS[datasetOfTable(leftId) ?? 'shop'].theme.accent,
          }
        : {}),
      anchorTop: true,
      // Same angular text size as the source slabs, at the result's own distance.
      text: slabTextSizeAt(PLANNED_RESULT_DISTANCE_METERS),
      // Height follows the rows shown (INNER hides the trailing ghost rows);
      // placement still reserves the full LEFT height, so it never grows
      // into the control.
      animatedHeight: true,
      // Each row's LEFT-table and RIGHT-table cells can fly in separately
      // from their own source rows.
      cellSides: result.columns.map((column) => column.source),
    });

    doc.fade.value = 0;
    doc.document.visible = false;
    doc.document.position.set(0, PARKED_Y, 0);
    if (CHALLENGE_MODE && doc.captionOpacity[2]) {
      doc.captionOpacity[2].value = 0;
    }
    const entity = this.world.createTransformEntity(doc.document);

    // Every NULL cell (stored, or a LEFT JOIN ghost) is a poke / ray target in
    // challenge mode: it filters the result to rows where that column IS NULL.
    // One listener on the whole slab finds the cell from the hit point, with
    // the same geometry as the pinch test, so a press on any layer of a row
    // (background, outline, text) counts.
    const nullColumns = result.table.rows.map((row) =>
      result.columns.flatMap((column, index) => (row[column.key] === null ? [index] : [])),
    );
    const cleanup: (() => void)[] = [];
    if (CHALLENGE_MODE) {
      // Interactable from the start (it's parked out of sight until shown);
      // the slab itself is never grabbable.
      entity.addComponent(PokeInteractable, {});
      entity.addComponent(RayInteractable, {});
      const onClick = (event: unknown) => this.onResultClick(key, event);
      doc.root.addEventListener('click', onClick);
      cleanup.push(() => doc.root.removeEventListener('click', onClick));
    }
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
      rowLeftSource: result.lineage.map((l) => l.left?.rowIndex ?? -1),
      rowRightSource: result.lineage.map((l) => l.right?.rowIndex ?? -1),
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
      result,
      leftTable: left,
      rightTable: right,
      rowShown: result.lineage.map((l) => !l.ghost),
      rowSlot: [],
      nullColumns,
      placeholdersShown: 0,
      cleanup,
    };
    updateRowSlots(view);
    this.results.set(key, view);
    return view;
  }

  // --- Challenge mode (JoinControls) -------------------------------------------------

  get joinState(): JoinState {
    return this.state;
  }

  deskTableIds(): string[] {
    return [...this.sources.keys()];
  }

  setChallengeLayout(layout: ChallengeLayout): void {
    this.challengeLayout = layout;
    this.layoutDirty = true;
  }

  setSilhouette(silhouette: PlacedElement | null): void {
    this.silhouette = silhouette;
    if (silhouette) {
      silhouette.object.visible = this.state.phase === 'idle' || this.state.phase === 'previewing';
    }
    this.layoutDirty = true;
  }

  requestLayout(): void {
    this.layoutDirty = true;
    // Joined: the band (control + bar) and the card are placed with the
    // result; re-place now (e.g. the bar just resized for the filter chip).
    const view = this.active;
    if (this.state.phase === 'joined' && view) {
      const left = this.sources.get(view.leftId);
      const right = this.sources.get(view.rightId);
      if (left && right) {
        this.placeResult(view, left, right);
      }
    }
  }

  requestClearFilter(): void {
    this.applyTransition({ type: 'clearFilter' });
  }

  resetToHome(): void {
    if (this.state.phase === 'joined') {
      this.applyTransition({ type: 'pullApart' });
    }
    for (const source of this.sources.values()) {
      const home = this.homes.get(source.id);
      const glide = this.glides.get(source.id);
      if (!home?.set || !glide || source.entity.hasComponent(Grabbed)) {
        continue;
      }
      glide.active = true;
      glide.slab = source;
      glide.fromPos.copy(source.object.position);
      glide.fromQuat.copy(source.object.quaternion);
      glide.toPos.copy(home.pos);
      glide.toQuat.copy(home.quat);
      glide.elapsed = 0;
    }
    this.layoutDirty = true;
  }

  applyDiff(rowStatus: readonly RowStatus[] | null, missing: number): void {
    if (this.active && this.state.phase === 'joined') {
      this.setDiff(this.active, rowStatus, missing);
    }
  }

  setWinLook(won: boolean): void {
    this.winLook = won;
    const view = this.active;
    if (view) {
      view.doc.root.setProperties({ borderColor: slabBorderColor(won) });
      for (const line of view.doc.captionLines) {
        line.setProperties({ color: captionColor(won) });
      }
    }
    if (!won) {
      this.winGlowLeft.hide();
      this.winGlowRight.hide();
    }
  }

  pulseNullRows(): void {
    const view = this.active;
    if (view) {
      this.pulseRows(view.nullColumns.flatMap((columns, row) => (columns.length > 0 ? [row] : [])));
    }
  }

  /** Briefly pulses these result rows (shown ones only): the NULL coach, or a fan-out win's repeats. */
  pulseRows(rows: readonly number[]): void {
    const view = this.active;
    if (!view) {
      return;
    }
    rows.forEach((row) => {
      const rowView = view.doc.rowViews.get(row);
      if (!rowView || !view.rowShown[row]) {
        return;
      }
      const restore = rowView.opacity.peek();
      this.tweens.to(rowView.opacity, 0.3, 0.18, 0, easeOutCubic, () =>
        this.tweens.to(rowView.opacity, restore, 0.32, 0, easeInOutCubic, () =>
          this.tweens.to(rowView.opacity, 0.3, 0.18, 0, easeOutCubic, () =>
            this.tweens.to(rowView.opacity, restore, 0.32, 0, easeInOutCubic),
          ),
        ),
      );
    });
  }

  hasVisibleNull(): boolean {
    const view = this.active;
    return !!view && view.nullColumns.some((columns, row) => view.rowShown[row] && columns.length > 0);
  }

  /** Dev (`F`): pokes the first shown NULL cell, as a finger would. */
  debugPokeFirstNull(): boolean {
    const view = this.active;
    if (!view || this.state.phase !== 'joined') {
      return false;
    }
    for (let row = 0; row < view.nullColumns.length; row++) {
      if (view.rowShown[row] && view.nullColumns[row].length > 0) {
        this.lastNullActivation = -Infinity;
        this.activateNullCell(view.key, row, view.nullColumns[row][0]);
        return true;
      }
    }
    return false;
  }

  /** Records where a slab sits before this puzzle first moves it (once per placement). */
  private captureHome(source: SourceSlab): void {
    const home = this.homes.get(source.id);
    if (home && !home.set) {
      home.pos.copy(source.object.position);
      home.quat.copy(source.object.quaternion);
      home.set = true;
    }
  }

  /** The home glide (Next): eases each slab back to where it started; a grab wins. */
  private updateGlides(delta: number): void {
    for (const glide of this.glides.values()) {
      const slab = glide.slab;
      if (!glide.active || !slab) {
        continue;
      }
      if (slab.entity.hasComponent(Grabbed)) {
        glide.active = false;
        continue;
      }
      glide.elapsed += delta;
      const progress = Math.min(1, glide.elapsed / glide.duration);
      const t = easeInOutCubic(progress);
      slab.object.position.lerpVectors(glide.fromPos, glide.toPos, t);
      slab.object.quaternion.slerpQuaternions(glide.fromQuat, glide.toQuat, t);
      if (progress >= 1) {
        glide.active = false;
        this.layoutDirty = true;
      }
    }
  }

  private gliding(): boolean {
    for (const glide of this.glides.values()) {
      if (glide.active) {
        return true;
      }
    }
    return false;
  }

  /**
   * Before a join: lays out the bar, silhouette and card when the slabs come
   * to rest somewhere new (or on request). Never while a slab is held,
   * docking or gliding, so the layout doesn't chase a moving slab.
   */
  private updateChallengeLayout(): void {
    const layout = this.challengeLayout;
    if (
      !layout ||
      !deskReady() ||
      this.state.phase !== 'idle' ||
      this.queries.held.entities.size > 0 ||
      this.dock.active ||
      this.gliding()
    ) {
      return;
    }
    // The first registered slab is the frame (the parent table, e.g. customers).
    const a: SourceSlab | null = this.sources.values().next().value ?? null;
    const b = a ? this.otherSource(a) : null;
    if (!a || !b) {
      return;
    }
    const moved =
      a.object.position.distanceToSquared(this._layoutA) > 1e-6 ||
      b.object.position.distanceToSquared(this._layoutB) > 1e-6;
    if (!moved && !this.layoutDirty) {
      return;
    }
    this._layoutA.copy(a.object.position);
    this._layoutB.copy(b.object.position);
    this.layoutDirty = false;
    this.placePreJoin(a, b, layout);
  }

  /** The win glow along the result slab's side edges, following it. */
  private updateWinGlow(): void {
    const view = this.active;
    if (!this.winLook || !view || this.state.phase !== 'joined') {
      return;
    }
    const height = (view.doc.panelHeightCm?.peek() ?? view.doc.heightMeters * 100) / 100;
    const glow = 0.55 + 0.2 * Math.sin(this.tweens.now * 3);
    this.winGlowLeft.place(view.object, -view.doc.widthMeters / 2, -height / 2, height, glow);
    this.winGlowRight.place(view.object, view.doc.widthMeters / 2, -height / 2, height, glow);
  }

  /** Tells challenge mode once the current animation has finished (latest call wins). */
  private scheduleSettle(delay: number): void {
    if (!joinBridge.challenge) {
      return;
    }
    this.tweens.set(this.settleClock, 0);
    this.tweens.to(this.settleClock, 1, 0.001, delay, easeOutCubic, () => joinBridge.challenge?.onSettled());
  }

  /** At a new join: every matched row displayed again, no filter, no diff. */
  private resetChallengeRows(view: ResultView): void {
    view.result.lineage.forEach((lineage, row) => {
      if (!lineage.ghost) {
        view.rowShown[row] = true;
        view.doc.rowViews.get(row)?.row.setProperties({ display: 'flex' });
      }
    });
    updateRowSlots(view);
    this.setDiff(view, null, 0);
    this.setWhereLine(view, null);
    this.setWinLook(false);
  }

  /**
   * Challenge mode's row display when a NULL filter is (or was) involved:
   * shows exactly the rows that `joinType` and `filter` keep. Rows leaving
   * fade out first; then the layout changes and the remaining rows slide
   * from where they were to their new slots, while rows entering fade in.
   * One relayout per change, never per frame. Returns its duration.
   */
  private applyRowVisibility(view: ResultView, joinType: JoinType, filter: NullFilter | null): number {
    const mask = nullFilterMask(view.leftTable, view.rightTable, view.result, filter);
    const nextShown = view.result.lineage.map((lineage, row) => (joinType === 'left' || !lineage.ghost) && mask[row]);
    const oldSlot = view.rowSlot.slice();
    let leaving = false;
    nextShown.forEach((shown, row) => {
      const rowView = view.doc.rowViews.get(row);
      if (rowView && view.rowShown[row] && !shown) {
        leaving = true;
        this.tweens.to(rowView.opacity, 0, FILTER_FADE_SECONDS, 0, easeInCubic);
      }
    });

    const relayout = () => {
      view.rowShown = nextShown;
      updateRowSlots(view);
      const rowCm = view.doc.rowHeightMeters * 100;
      nextShown.forEach((shown, row) => {
        const rowView = view.doc.rowViews.get(row);
        if (!rowView) {
          return;
        }
        rowView.row.setProperties({ display: shown ? 'flex' : 'none' });
        if (!shown) {
          return;
        }
        if (oldSlot[row] >= 0) {
          // Layout moves it to its new slot; start it where it was and slide.
          this.tweens.set(rowView.offsetYCm, (oldSlot[row] - view.rowSlot[row]) * rowCm);
          this.tweens.to(rowView.offsetYCm, 0, FILTER_SLIDE_SECONDS, 0, easeInOutCubic);
        } else {
          this.tweens.set(rowView.offsetYCm, 0);
          this.tweens.set(rowView.opacity, 0);
          this.tweens.to(rowView.opacity, 1, FILTER_SLIDE_SECONDS);
        }
      });
      const panelHeight = view.doc.panelHeightCm;
      if (panelHeight) {
        const rows = nextShown.filter(Boolean).length + view.placeholdersShown;
        this.tweens.to(panelHeight, view.doc.heightForRowsMeters(rows) * 100, FILTER_SLIDE_SECONDS, 0, easeOutCubic);
      }
    };
    if (leaving) {
      this.tweens.set(this.relayoutClock, 0);
      this.tweens.to(this.relayoutClock, 1, FILTER_FADE_SECONDS, 0, easeOutCubic, relayout);
      return FILTER_FADE_SECONDS + FILTER_SLIDE_SECONDS;
    }
    relayout();
    return FILTER_SLIDE_SECONDS;
  }

  private applyFilterChange(): void {
    const view = this.active;
    const state = this.state;
    if (!view || state.phase !== 'joined') {
      return;
    }
    const filter = state.filter ?? null;
    this.setWhereLine(view, filter);
    this._a.set(0, -view.doc.heightMeters / 2, 0);
    view.object.updateWorldMatrix(true, false);
    view.object.localToWorld(this._a);
    sounds.playSlide(this._a, filter ? 'out' : 'in');
    this.scheduleSettle(this.applyRowVisibility(view, state.joinType, filter) + 0.05);
  }

  /**
   * A NULL cell was poked (or ray-selected, or pinched): keep only rows
   * where its column IS NULL, or clear that filter if it's the one set.
   * A poke and a ray select on the same press count once.
   */
  private activateNullCell(key: string, row: number, column: number): void {
    const view = this.results.get(key);
    const state = this.state;
    if (!view || this.active !== view || state.phase !== 'joined' || !view.rowShown[row] || view.doc.fade.peek() < 0.5) {
      return;
    }
    if (this.tweens.now - this.lastNullActivation < NULL_ACTIVATION_DEBOUNCE_SECONDS) {
      return;
    }
    this.lastNullActivation = this.tweens.now;
    const filter = filterForColumn(view.leftTable, view.rightTable, view.result, column);
    const span = view.doc.columnSpans[column];
    this._a.set((span.x0 + span.x1) / 2, rowCenterLocalY(view.doc, view.rowSlot[row]), 0);
    view.object.updateWorldMatrix(true, false);
    view.object.localToWorld(this._a);
    sounds.playClick(this._a);
    if (import.meta.env.DEV && this.debug) {
      this.debug.note(`NULL cell poked: row ${row}, ${view.result.columns[column].label} (${filter.tableId}.${filter.column})`);
    }
    const current = state.filter ?? null;
    this.applyTransition(current && sameFilter(current, filter) ? { type: 'clearFilter' } : { type: 'setFilter', filter });
  }

  /**
   * The shown NULL cell nearest world `point` (in the slab's plane), into
   * `_nullHit`: its row and column, the in-plane distance to its rectangle
   * (0 inside it), and how far `point` is off the surface. False if no shown
   * row holds a NULL.
   */
  private nearestNullCell(view: ResultView, point: Vector3): boolean {
    view.object.updateWorldMatrix(true, false);
    this._pinchB.copy(point);
    view.object.worldToLocal(this._pinchB);
    const hit = this._nullHit;
    hit.row = -1;
    hit.column = -1;
    hit.distance = Infinity;
    hit.depth = Math.abs(this._pinchB.z);
    const halfRow = view.doc.rowHeightMeters / 2;
    for (let row = 0; row < view.nullColumns.length; row++) {
      if (!view.rowShown[row] || view.nullColumns[row].length === 0) {
        continue;
      }
      const dy = Math.max(0, Math.abs(this._pinchB.y - rowCenterLocalY(view.doc, view.rowSlot[row])) - halfRow);
      for (const column of view.nullColumns[row]) {
        const span = view.doc.columnSpans[column];
        const dx = Math.max(0, span.x0 - this._pinchB.x, this._pinchB.x - span.x1);
        const distance = Math.hypot(dx, dy);
        if (distance < hit.distance) {
          hit.distance = distance;
          hit.row = row;
          hit.column = column;
        }
      }
    }
    return hit.row >= 0;
  }

  /**
   * A poke or ray select anywhere on the result slab (UIKit click, with the
   * world hit point): pokes the NULL cell under it, if there is one.
   */
  private onResultClick(key: string, event: unknown): void {
    const view = this.results.get(key);
    const point = (event as { point?: Vector3 } | null)?.point;
    if (import.meta.env.DEV && this.debug && !point) {
      const keys = event && typeof event === 'object' ? Object.keys(event).join(', ') : typeof event;
      this.debug.warn(`result slab click without a hit point; event fields: ${keys}`);
    }
    if (!view || this.active !== view || !point) {
      return;
    }
    const onCell = this.nearestNullCell(view, point) && this._nullHit.distance <= 1e-3;
    if (import.meta.env.DEV && this.debug) {
      this.debug.note(
        `result slab pressed (poke or ray): ` +
          (onCell
            ? `on the NULL cell at row ${this._nullHit.row}, column ${this._nullHit.column}`
            : `not on a NULL cell (nearest ${cm(this._nullHit.distance)} away)`),
      );
    }
    if (onCell) {
      this.activateNullCell(key, this._nullHit.row, this._nullHit.column);
    }
  }

  /** Diff markers (`+` and dimming for extra rows) and the placeholder rows for missing ones. */
  private setDiff(view: ResultView, rowStatus: readonly RowStatus[] | null, missing: number): void {
    view.result.lineage.forEach((_, row) => {
      const rowView = view.doc.rowViews.get(row);
      if (!rowView) {
        return;
      }
      const extra = rowStatus?.[row] === 'extra';
      if (rowView.marker) {
        this.tweens.to(rowView.marker, extra ? 1 : 0, DIFF_FADE_SECONDS);
      }
      if (rowStatus && view.rowShown[row]) {
        this.tweens.to(rowView.opacity, extra ? DIFF_EXTRA_OPACITY : 1, DIFF_FADE_SECONDS);
      }
    });
    const count = rowStatus ? Math.min(missing, view.doc.placeholders.length) : 0;
    view.doc.placeholders.forEach((placeholder, i) => {
      if (i < count) {
        placeholder.row.setProperties({ display: 'flex' });
        this.tweens.to(placeholder.opacity, 1, DIFF_FADE_SECONDS);
      } else {
        placeholder.row.setProperties({ display: 'none' });
        this.tweens.set(placeholder.opacity, 0);
      }
    });
    view.placeholdersShown = count;
    const panelHeight = view.doc.panelHeightCm;
    if (panelHeight && rowStatus) {
      const rows = view.rowShown.filter(Boolean).length + count;
      this.tweens.to(panelHeight, view.doc.heightForRowsMeters(rows) * 100, DIFF_FADE_SECONDS, 0, easeOutCubic);
    }
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
    this.approach = this.approachAmount();
    this.approachMoving = held;
    this.approachStationary = stationary;

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

  /**
   * How close (0..1) the measured `_prox` is to entering the preview: 0 at
   * APPROACH_GAP_METERS or farther (or when badly misaligned), 1 at the
   * preview gap. Only drives feedback; it never moves the held slab.
   */
  private approachAmount(): number {
    const p = this._prox;
    if (
      p.depth > PREVIEW_EXIT_DEPTH_METERS ||
      p.vertical > PREVIEW_EXIT_VERTICAL_METERS ||
      p.angleDeg > PREVIEW_EXIT_ALIGN_DEG ||
      p.gap < -PREVIEW_EXIT_OVERLAP_METERS
    ) {
      return 0;
    }
    return MathUtils.clamp(
      (APPROACH_GAP_METERS - p.gap) / (APPROACH_GAP_METERS - PREVIEW_ENTER_GAP_METERS),
      0,
      1,
    );
  }

  /** Measures `moving` against `stationary` in the stationary slab's frame into `_prox`. */
  private measureProximity(moving: SourceSlab, stationary: SourceSlab): void {
    moving.object.updateWorldMatrix(true, false);
    stationary.object.updateWorldMatrix(true, false);
    this._a.setFromMatrixPosition(moving.object.matrixWorld);
    stationary.object.worldToLocal(this._a);
    const halfWidths = (moving.doc.widthMeters + stationary.doc.widthMeters) / 2;
    // Docked slabs align their bottom edges (see computeDockPose).
    const bottomAlignedY = -stationary.doc.heightMeters / 2 + moving.doc.heightMeters / 2;
    this._prox.side = this._a.x >= 0 ? 1 : -1;
    this._prox.gap = Math.abs(this._a.x) - halfWidths;
    this._prox.depth = Math.abs(this._a.z);
    this._prox.vertical = Math.abs(this._a.y - bottomAlignedY);
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
   * with DOCK_GAP_METERS between, bottom edges aligned -- so on a desk both
   * keep resting on it and docking needs no vertical move. (Rows don't
   * correspond across tables; matches are shown by tint and lines.)
   * `moverIsRight` says whether `mover` is the RIGHT table; `dockSide` is
   * defined as the RIGHT slab's side of the LEFT slab.
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
      -anchor.doc.heightMeters / 2 + mover.doc.heightMeters / 2,
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
    // A little physics: overshoots the dock slightly, then settles.
    const progress = Math.min(1, dock.elapsed / dock.duration);
    const t = easeOutBackSoft(progress);
    dock.slab.object.position.lerpVectors(dock.fromPos, dock.toPos, t);
    dock.slab.object.quaternion.slerpQuaternions(dock.fromQuat, dock.toQuat, t);
    if (progress >= 1) {
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
    if (this.challengeLayout) {
      // Before the dock moves anything (a debug join moves a slab without a grab).
      this.captureHome(left);
      this.captureHome(right);
      this.resetChallengeRows(view);
      if (this.silhouette) {
        // Hidden and parked: an invisible UIKit document can still catch a
        // pointer ray meant for the result slab in front of or behind it.
        this.silhouette.object.visible = false;
        this.silhouette.object.position.set(0, PARKED_Y, 0);
      }
    }
    left.entity.addComponent(JoinDocked, {});
    right.entity.addComponent(JoinDocked, {});

    const t0 = import.meta.env.DEV ? performance.now() : 0;
    if (import.meta.env.DEV) {
      this.debug?.markJoinStart();
    }

    // 1. Snap the brought-over slab into its dock (overshoot and settle).
    this.computeDockPose(left, right, true, this._a, this._q1);
    this.startDock(right, this._a, this._q1, DOCK_DURATION_SECONDS);

    // The result slab appears behind/above the pair, the control between
    // them. Both are placed against the head pose at join time and only move
    // again when the pair does.
    this.setControlSelection(joinType);
    this.showResult(view);
    this.readHead();
    this.placeResult(view, left, right);
    const t1 = import.meta.env.DEV ? performance.now() : 0;

    this.playJoinSequence(view, left, right, joinType);
    const t2 = import.meta.env.DEV ? performance.now() : 0;
    this.warnIfOutOfView(view, left, right);

    if (import.meta.env.DEV && this.debug) {
      const t3 = performance.now();
      this.debug.note(
        `join start work: setup+placement ${(t1 - t0).toFixed(1)} ms, sequence ${(t2 - t1).toFixed(1)} ms, ` +
          `debug readout ${(t3 - t2).toFixed(1)} ms`,
      );
    }
  }

  /**
   * The join's animation and sound, from the snap to the resolve (~1.3 s):
   * match lines draw with a traveling pulse and a rising tick each; each
   * result row's LEFT and RIGHT cells fly in from their own source rows in
   * pairing order; unmatched source rows drop with a bounce. Expects the
   * result slab and control already placed. Replayable (`R` in debug).
   */
  private playJoinSequence(view: ResultView, left: SourceSlab, right: SourceSlab, joinType: JoinType): void {
    // RIGHT slab: at its dock pose (it may still be snapping in).
    const rightDocking = this.dock.active && this.dock.slab === right;

    this.seamPoint(left, right, this._f);
    sounds.playSnap(this._f);

    // 1. Match lines, staggered, fan-out included. Each line is tinted by its
    //    join key, ticks as it starts, and lights up its two source rows in
    //    that tint as it lands. A pulse travels along it while it draws.
    const lineCount = view.lineLeftRows.length;
    this.lines.setCount(lineCount);
    this.pulses.setCount(lineCount);
    this.lines.fade.value = 1;
    this.pulses.fade.value = 1;
    for (let i = 0; i < lineCount; i++) {
      this.lines.setColor(i, lineColorForTint(view.lineTints[i], this._color));
      this.tweens.set(this.lines.progress[i], 0);
      const delay = LINE_START_SECONDS + i * LINE_STAGGER_SECONDS;
      this.tweens.to(this.lines.progress[i], 1, LINE_DRAW_SECONDS, delay, easeOutCubic, () =>
        this.tintLineRows(view, left, right, i),
      );
      this.sourceRowPoint(left, view.lineLeftRows[i], false, this._a);
      sounds.playLineTick(this._a, i, lineCount, delay);
    }

    // 2. The result slab fades in, then its rows assemble in pairing order:
    //    each row's LEFT cells fly from their LEFT source row and its RIGHT
    //    cells from their RIGHT source row, landing in its slot. LEFT JOIN's
    //    unmatched rows fly in their LEFT cells; their NULL cells fade in in place.
    this.setCaption(view, joinType);
    this.tweens.set(view.doc.fade, 0);
    this.tweens.to(view.doc.fade, 1, RESULT_FADE_SECONDS, RESULT_APPEAR_SECONDS);
    this.tweens.set(this.control.fade, 0);
    this.tweens.to(this.control.fade, 1, RESULT_FADE_SECONDS, RESULT_APPEAR_SECONDS);
    this.setGhostRowsShown(view, joinType === 'left', false, 0);
    const rowCount = view.matchedRowCount + (joinType === 'left' ? view.ghostRows.length : 0);
    view.object.updateWorldMatrix(true, false);
    for (let row = 0; row < rowCount; row++) {
      const rowView = view.doc.rowViews.get(row);
      if (!rowView) {
        continue;
      }
      const delay = ROW_START_SECONDS + row * ROW_STAGGER_SECONDS;
      // Cells are visible as soon as they leave their source rows; the row's
      // background (its own layer) fades in only over the last part of the
      // flight, as the cells land, so the rows visibly assemble.
      this.tweens.set(rowView.offsetYCm, 0);
      this.tweens.set(rowView.opacity, 0);
      this.tweens.to(rowView.opacity, 1, 0.06, delay);
      this.tweens.set(rowView.backgroundFade, 0);
      this.tweens.to(
        rowView.backgroundFade,
        1,
        ROW_FLY_SECONDS * ROW_BACKGROUND_LANDING_FRACTION,
        delay + ROW_FLY_SECONDS * (1 - ROW_BACKGROUND_LANDING_FRACTION),
      );
      if (rowView.flight) {
        this.flyCells(view, row, rowView.flight.left, left, view.rowLeftSource[row], false, delay);
        this.flyCells(view, row, rowView.flight.right, right, view.rowRightSource[row], rightDocking, delay);
      }
    }
    const lastLanding = ROW_START_SECONDS + Math.max(0, rowCount - 1) * ROW_STAGGER_SECONDS + ROW_FLY_SECONDS;
    this._a.set(0, -view.doc.heightMeters / 2, 0);
    view.object.localToWorld(this._a);
    sounds.playResolve(this._a, lastLanding);

    // 3. Unmatched source rows drop and dim (INNER), or only unmatched-right
    //    (LEFT), with a bounce and a tap at the first impact.
    this.applySourceDim(view, left, right, joinType, DIM_START_SECONDS, DIM_DURATION_SECONDS);

    const linesEnd = LINE_START_SECONDS + Math.max(0, lineCount - 1) * LINE_STAGGER_SECONDS + LINE_DRAW_SECONDS;
    const end = Math.max(lastLanding, linesEnd, DIM_START_SECONDS + DIM_DURATION_SECONDS);
    this.scheduleSettle(end + 0.05);
    if (import.meta.env.DEV && this.debug) {
      this.debug.note(
        `join sequence: ${end.toFixed(2)} s (snap at 0, dock ${DOCK_DURATION_SECONDS} s, ${lineCount} lines by ` +
          `${linesEnd.toFixed(2)} s, ${rowCount} rows land by ${lastLanding.toFixed(2)} s, drops end ` +
          `${(DIM_START_SECONDS + DIM_DURATION_SECONDS).toFixed(2)} s)`,
      );
    }
  }

  /**
   * Starts one side's cells of result row `row` at source row `sourceRow`
   * (in the result slab's frame, cm) and flies them to their slot.
   * `sourceRow` < 0: no source (NULL cells), so they stay in place.
   */
  private flyCells(
    view: ResultView,
    row: number,
    offset: CellOffset,
    source: SourceSlab,
    sourceRow: number,
    atDockPose: boolean,
    delay: number,
  ): void {
    if (sourceRow < 0) {
      this.tweens.set(offset.x, 0);
      this.tweens.set(offset.y, 0);
      this.tweens.set(offset.z, 0);
      return;
    }
    this.sourceRowPoint(source, sourceRow, atDockPose, this._a);
    view.object.worldToLocal(this._a);
    const slotY = rowCenterLocalY(view.doc, row);
    // UIKit offsets are in cm, with +Y pointing down.
    this.tweens.set(offset.x, this._a.x * 100);
    this.tweens.set(offset.y, -(this._a.y - slotY) * 100);
    this.tweens.set(offset.z, this._a.z * 100);
    this.tweens.to(offset.x, 0, ROW_FLY_SECONDS, delay, easeInOutCubic);
    this.tweens.to(offset.y, 0, ROW_FLY_SECONDS, delay, easeInOutCubic);
    this.tweens.to(offset.z, 0, ROW_FLY_SECONDS, delay, easeInOutCubic);
  }

  /** World center of source row `row` on `source`'s face (optionally at the dock target). */
  private sourceRowPoint(source: SourceSlab, row: number, atDockPose: boolean, out: Vector3): Vector3 {
    out.set(0, rowCenterLocalY(source.doc, row), LINE_SURFACE_OFFSET_METERS);
    if (atDockPose) {
      return out.applyQuaternion(this.dock.toQuat).add(this.dock.toPos);
    }
    source.object.updateWorldMatrix(true, false);
    return source.object.localToWorld(out);
  }

  /** World point at the middle of the seam between the docked slabs. */
  private seamPoint(left: SourceSlab, right: SourceSlab, out: Vector3): Vector3 {
    left.object.updateWorldMatrix(true, false);
    out.set(
      this.dockSide * (left.doc.widthMeters / 2 + DOCK_GAP_METERS / 2),
      (-left.doc.heightMeters / 2 + pairTopLocalY(left, right)) / 2,
      0,
    );
    return left.object.localToWorld(out);
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
    const filter = this.currentFilter();
    if (filter) {
      // With a NULL filter, rows can come and go anywhere, not just the ghosts at the end.
      this.scheduleSettle(this.applyRowVisibility(view, to, filter) + 0.05);
    } else {
      this.setGhostRowsShown(view, to === 'left', true, 0);
      this.scheduleSettle(
        TOGGLE_DURATION_SECONDS * 1.6 + Math.max(0, view.ghostRows.length - 1) * ROW_STAGGER_SECONDS + 0.05,
      );
    }
    this.applySourceDim(view, left, right, to, 0, TOGGLE_DURATION_SECONDS);
    // The LEFT-only rows sliding in or out.
    const ghost = view.ghostRows[0];
    if (ghost !== undefined) {
      view.object.updateWorldMatrix(true, false);
      this._a.set(0, rowCenterLocalY(view.doc, ghost), 0);
      view.object.localToWorld(this._a);
      sounds.playSlide(this._a, to === 'left' ? 'in' : 'out');
    }
  }

  private beginSeparate(): void {
    const view = this.active;
    this.tweens.finishAll();
    this.dock.active = false;
    if (this.challengeLayout && view) {
      this.setDiff(view, null, 0);
      this.setWinLook(false);
    }
    // A soft release at the seam: the reverse of the snap.
    const left = view ? this.sources.get(view.leftId) : null;
    const right = view ? this.sources.get(view.rightId) : null;
    if (left && right) {
      sounds.playRelease(this.seamPoint(left, right, this._f));
    }
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
    this.pulses.setCount(0);
    if (this.silhouette) {
      this.silhouette.object.visible = true;
    }
    this.layoutDirty = true;
    this.applyTransition({ type: 'separated' });
    // Dev: an apply waiting for the separation.
    const apply = this.pendingApply;
    if (apply) {
      this.pendingApply = null;
      this.debugApply(apply);
    }
  }

  private applySourceDim(
    view: ResultView,
    left: SourceSlab,
    right: SourceSlab,
    joinType: JoinType,
    delay: number,
    duration: number,
  ): void {
    // A soft tap where the first row lands, at the first bounce.
    let tapRow = -1;
    let tapSlab: SourceSlab | null = null;
    const leftDropCm = left.doc.rowHeightMeters * 100 * DIM_DROP_ROW_FRACTION;
    const rightDropCm = right.doc.rowHeightMeters * 100 * DIM_DROP_ROW_FRACTION;
    for (const [row, rowView] of left.doc.rowViews) {
      const dim = joinType === 'inner' && view.unmatchedLeftRows.has(row);
      if (this.tweenRowDim(rowView.opacity, rowView.offsetYCm, dim, leftDropCm, delay, duration) && tapRow < 0) {
        tapRow = row;
        tapSlab = left;
      }
    }
    for (const [row, rowView] of right.doc.rowViews) {
      // Unmatched-right rows are excluded by both INNER and LEFT joins.
      const dim = view.unmatchedRightRows.has(row);
      if (this.tweenRowDim(rowView.opacity, rowView.offsetYCm, dim, rightDropCm, delay, duration) && tapRow < 0) {
        tapRow = row;
        tapSlab = right;
      }
    }
    if (tapSlab) {
      const docking = this.dock.active && this.dock.slab === tapSlab;
      sounds.playDropTap(this.sourceRowPoint(tapSlab, tapRow, docking, this._g), delay + duration * BOUNCE_FIRST_IMPACT);
    }

    // Dev only: once settled, report where every unmatched source row ended up.
    if (import.meta.env.DEV && this.debug) {
      const debug = this.debug;
      setTimeout(() => {
        for (const [slab, rows] of [
          [left, view.unmatchedLeftRows],
          [right, view.unmatchedRightRows],
        ] as const) {
          for (const row of rows) {
            const rowView = slab.doc.rowViews.get(row);
            if (!rowView) {
              continue;
            }
            const rowCm = slab.doc.rowHeightMeters * 100;
            const offset = rowView.offsetYCm.peek();
            debug.note(
              `unmatched ${slab.id} row ${row}: offset ${offset.toFixed(3)} cm ` +
                `(${((offset / rowCm) * 100).toFixed(1)}% of its ${rowCm.toFixed(2)} cm row; limit ` +
                `${(DIM_DROP_ROW_FRACTION * 100).toFixed(0)}%), opacity ${rowView.opacity.peek().toFixed(2)} ` +
                `(${joinType.toUpperCase()})`,
            );
          }
        }
      }, (delay + duration + 0.1) * 1000);
    }
  }

  /** Tweens one source row to dimmed (dropped within its slot) or normal. Returns true if it starts dropping. */
  private tweenRowDim(
    opacity: Signal<number>,
    offsetYCm: Signal<number>,
    dim: boolean,
    dropCm: number,
    delay: number,
    duration: number,
  ): boolean {
    const targetOpacity = dim ? DIM_OPACITY : 1;
    const targetOffset = dim ? dropCm : 0;
    if (opacity.peek() === targetOpacity && offsetYCm.peek() === targetOffset) {
      return false;
    }
    this.tweens.to(opacity, targetOpacity, duration, delay);
    // Dimming falls a little and bounces at the bottom of its slot; restoring
    // eases back to exactly 0 (absolute targets, so toggles never accumulate).
    this.tweens.to(offsetYCm, targetOffset, duration, delay, dim ? easeOutBounce : easeOutCubic);
    return dim;
  }

  /** Ghost rows slide in from below / slide out downward. */
  private setGhostRowsShown(view: ResultView, shown: boolean, animate: boolean, delay: number): void {
    for (const row of view.ghostRows) {
      view.rowShown[row] = shown;
    }
    updateRowSlots(view);
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

    // The panel's height follows the rows shown. Its origin is its top edge,
    // so it grows and shrinks at the bottom: it grows as the incoming rows
    // slide in, and shrinks once the outgoing rows have slid out.
    const panelHeight = view.doc.panelHeightCm;
    if (panelHeight) {
      const rows = view.matchedRowCount + (shown ? view.ghostRows.length : 0) + view.placeholdersShown;
      const targetCm = view.doc.heightForRowsMeters(rows) * 100;
      if (!animate) {
        this.tweens.set(panelHeight, targetCm);
      } else if (shown) {
        this.tweens.to(panelHeight, targetCm, TOGGLE_DURATION_SECONDS, delay, easeOutCubic);
      } else {
        const rowsGone = delay + TOGGLE_DURATION_SECONDS + Math.max(0, view.ghostRows.length - 1) * ROW_STAGGER_SECONDS;
        this.tweens.to(panelHeight, targetCm, TOGGLE_DURATION_SECONDS * 0.6, rowsGone, easeOutCubic);
      }
    }
  }

  private setCaption(view: ResultView, joinType: JoinType): void {
    view.sql[joinType].forEach((text, i) => {
      view.doc.captionLines[i]?.setProperties({ text });
    });
  }

  /** Challenge mode: the caption's reserved third line shows the filter's WHERE clause. */
  private setWhereLine(view: ResultView, filter: NullFilter | null): void {
    const line = view.doc.captionLines[2];
    const opacity = view.doc.captionOpacity[2];
    if (!line || !opacity) {
      return;
    }
    if (filter) {
      line.setProperties({ text: buildWhereSql(view.leftTable, view.rightTable, filter) });
    }
    this.tweens.to(opacity, filter ? 1 : 0, FILTER_FADE_SECONDS);
  }

  private currentFilter(): NullFilter | null {
    return this.state.phase === 'joined' ? (this.state.filter ?? null) : null;
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

    // Bottom-edge midpoint of the result slab: centered between the two
    // slabs (the RIGHT one at its dock pose), above the pair's higher top
    // edge -- tops differ, since docked slabs align their bottoms.
    const rightX = this.dockSide * (left.doc.widthMeters / 2 + DOCK_GAP_METERS + right.doc.widthMeters / 2);
    this._c.set(rightX / 2, pairTopLocalY(left, right), 0);
    left.object.localToWorld(this._c);

    // The control sits in the band between the pair's top edge and this
    // slab's bottom edge (next to the SQL caption it switches). Place it
    // first (and the puzzle bar beside it), then keep this slab's bottom
    // edge above the control in view.
    this.placeControl(left, right);
    if (this.challengeLayout) {
      this.placeBarBesideControl(this.challengeLayout.bar);
    }
    // In challenge mode the card sits on the result slab: it must fit the view too.
    const card = this.challengeLayout?.card;
    this.placeAboveBand(
      view.object,
      view.doc.heightMeters,
      this.control.document,
      this.control.heightMeters,
      card ? CARD_GAP_METERS + card.heightMeters : 0,
    );
    if (card) {
      this.placeCard(view.object, card);
    }
  }

  /**
   * Places a top-anchored slab (`object`, `height` m tall) whose bottom-edge
   * midpoint starts at `_c` (on the pair's top-edge line, in the frame of
   * `_q1`): lifted above that line, kept above `band`'s top edge in view,
   * leaning to face the eyes, pushed back if its top would leave the view.
   * Overwrites `_c`.
   */
  private placeAboveBand(object: Object3D, height: number, band: Object3D, bandHeight: number, above = 0): void {
    this._up.copy(UP).applyQuaternion(this._q1);
    this._normal.set(0, 0, 1).applyQuaternion(this._q1);
    this._c.addScaledVector(this._up, RESULT_GAP_ABOVE_METERS).addScaledVector(this._normal, -RESULT_BEHIND_METERS);

    band.updateWorldMatrix(true, false);
    this._f.set(0, bandHeight / 2, 0);
    band.localToWorld(this._f);
    const minBottomRad =
      MathUtils.degToRad(degreesFromForward(this._head, this.headPitchDown, this._f) + CONTROL_VIEW_GAP_DEG) -
      this.headPitchDown;
    this._f.subVectors(this._c, this._head);
    const minBottomY = this._head.y + Math.hypot(this._f.x, this._f.z) * Math.tan(minBottomRad);
    if (this._c.y < minBottomY) {
      this._c.y = minBottomY;
    }

    // Shared yaw, and the horizontal "away from the viewer" axis it implies.
    this._euler.setFromQuaternion(this._q1, 'YXZ');
    const yaw = this._euler.y;
    this._b.set(0, 0, -1).applyAxisAngle(UP, yaw);

    // Lean to face the eyes from the slab's own center. If that center is
    // beyond the legibility cap, pull the slab toward the viewer -- at most
    // until its bottom edge is level with the pair's top edge, so it never
    // hangs in front of the pair's rows. Never shrunk.
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

    // With the pair close to the eyes, the slab's top edge -- or the top of
    // what sits on it (`above`: the card, in challenge mode) -- can rise past
    // the top of the group's view window: push it back (horizontally) until
    // that top fits, but never so far that its center passes the cap, nor so
    // far that its rows drop below RESULT_MIN_PUSHED_ROW_TEXT_DEG.
    const maxAboveRad = MathUtils.degToRad(VIEW_MAX_ABOVE_GAZE_DEG) - this.headPitchDown;
    const reach = height + above;
    for (let i = 0; i < RESULT_FIT_ITERATIONS && maxAboveRad > 0.05; i++) {
      this._a
        .copy(this._c)
        .addScaledVector(this._b, reach * Math.sin(lean))
        .addScaledVector(UP, reach * Math.cos(lean));
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
      const step = Math.min(push, RESULT_MAX_PUSHED_DISTANCE_METERS - this._e.distanceTo(this._head));
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
    object.quaternion.copy(this._q2);
    object.position.copy(this._c).addScaledVector(this._up, height);
  }

  /**
   * The join-type control: centered on the seam at the pair's (higher) top
   * edge, lifted CONTROL_SLAB_CLEARANCE_METERS off it toward the eyes, then
   * raised in view so its bottom edge sits just above that edge -- in the
   * band below the result slab. Oriented from the pair alone: the pair's
   * yaw, a lean that faces the eyes, zero roll. (Turning it to face the eye
   * point instead twisted it against the slabs whenever the seam sat off to
   * one side, e.g. after Shift+J.) Leaves `_c` and `_q1` untouched for
   * `placeResult`.
   */
  private placeControl(left: SourceSlab, right: SourceSlab): void {
    left.object.updateWorldMatrix(true, false);
    const seamX = this.dockSide * (left.doc.widthMeters / 2 + DOCK_GAP_METERS / 2);
    this._d.set(seamX, pairTopLocalY(left, right), 0);
    left.object.localToWorld(this._d);
    this.placeInBand(this.control.document, this.control.widthMeters, this.control.heightMeters, this._d, left.object);
  }

  /**
   * Challenge mode: control + gap + bar as one group, centered where the
   * control alone would sit (on the seam). Both share the control's
   * orientation and depth, and the bar is laid out along the control's own
   * horizontal axis, so the gap between them is exact (never an overlap)
   * and the bar keeps the control's clearance from the slabs (that axis
   * lies in the slabs' plane). Run after placeControl.
   */
  private placeBarBesideControl(bar: PlacedElement): void {
    const control = this.control.document;
    this._e.set(1, 0, 0).applyQuaternion(control.quaternion);
    const groupWidth = this.control.widthMeters + BAR_CONTROL_GAP_METERS + bar.widthMeters;
    // Shift the control left so the group is centered on its old center...
    control.position.addScaledVector(this._e, this.control.widthMeters / 2 - groupWidth / 2);
    // ...and put the bar to its right, one gap away.
    bar.object.quaternion.copy(control.quaternion);
    bar.object.position
      .copy(control.position)
      .addScaledVector(this._e, this.control.widthMeters / 2 + BAR_CONTROL_GAP_METERS + bar.widthMeters / 2);
  }

  /**
   * Places a touchable element (`width` x `height` m, origin at its center)
   * in the band above the slabs' top edge at world point `anchor`: lifted
   * CONTROL_SLAB_CLEARANCE_METERS toward the eyes, raised in view so its
   * bottom edge clears that edge, oriented from `frame` (a slab: its yaw, a
   * lean that faces the eyes, zero roll), and pushed out until every corner
   * is that clearance off the slabs' plane. Leaves `_c`, `_d` and `_q1`
   * untouched (it reads `anchor` first).
   */
  private placeInBand(target: Object3D, width: number, height: number, anchor: Vector3, frame: Object3D): void {
    frame.updateWorldMatrix(true, false);
    this._e.subVectors(this._head, anchor).normalize();
    target.position.copy(anchor).addScaledVector(this._e, CONTROL_SLAB_CLEARANCE_METERS);
    this._viewUp.copy(UP).addScaledVector(this._e, -UP.dot(this._e)).normalize();
    const lift = height / 2 + target.position.distanceTo(this._head) * Math.tan(MathUtils.degToRad(CONTROL_VIEW_GAP_DEG));
    target.position.addScaledVector(this._viewUp, lift);

    // The pair's yaw; lean back by the eye line's elevation in the pair's
    // vertical plane; no roll.
    frame.getWorldQuaternion(this._q2);
    this._euler.setFromQuaternion(this._q2, 'YXZ');
    const yaw = this._euler.y;
    this._g.set(0, 0, -1).applyAxisAngle(UP, yaw);
    this._f.subVectors(target.position, this._head);
    const lean = Math.atan2(this._head.y - target.position.y, Math.max(this._f.dot(this._g), 1e-3));
    this._euler.set(-lean, yaw, 0, 'YXZ');
    target.quaternion.setFromEuler(this._euler);

    // It faces the eyes, so it's tilted against the slabs' plane (both
    // slabs share it) and the sight line isn't the plane's normal: push it
    // along the sight line until every corner is at least
    // CONTROL_SLAB_CLEARANCE_METERS off that plane.
    target.updateWorldMatrix(true, false);
    let minOffPlane = Infinity;
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sy = -1; sy <= 1; sy += 2) {
        this._f.set((sx * width) / 2, (sy * height) / 2, 0);
        target.localToWorld(this._f);
        frame.worldToLocal(this._f);
        minOffPlane = Math.min(minOffPlane, this._f.z);
      }
    }
    if (minOffPlane < CONTROL_SLAB_CLEARANCE_METERS) {
      frame.getWorldQuaternion(this._q2);
      this._normal.set(0, 0, 1).applyQuaternion(this._q2);
      const alongNormal = Math.max(0.2, this._e.dot(this._normal));
      target.position.addScaledVector(this._e, (CONTROL_SLAB_CLEARANCE_METERS - minOffPlane) / alongNormal);
    }
  }

  /** Challenge mode: the puzzle card, just above a top-anchored slot (the result or the silhouette). */
  private placeCard(slot: Object3D, card: PlacedElement): void {
    slot.updateWorldMatrix(true, false);
    slot.getWorldQuaternion(this._q2);
    this._up.copy(UP).applyQuaternion(this._q2);
    card.object.quaternion.copy(this._q2);
    card.object.position.copy(slot.position).addScaledVector(this._up, CARD_GAP_METERS + card.heightMeters / 2);
  }

  /**
   * Challenge mode, before a join: the bar centered between the two slabs
   * in the band above them, the silhouette above it where the result will
   * appear, and the card above that. World-locked: laid out against the head
   * pose read now, and again only when the slabs come to rest somewhere new.
   */
  private placePreJoin(a: SourceSlab, b: SourceSlab, layout: ChallengeLayout): void {
    this.readHead();
    a.object.updateWorldMatrix(true, false);
    b.object.updateWorldMatrix(true, false);
    // B's center in A's frame: the midpoint between them, at the higher top edge.
    this._a.setFromMatrixPosition(b.object.matrixWorld);
    a.object.worldToLocal(this._a);
    const midX = this._a.x / 2;
    // The pair's highest point, name tabs included.
    const topY = Math.max(
      a.doc.heightMeters / 2 + a.doc.tabHeightMeters,
      this._a.y + b.doc.heightMeters / 2 + b.doc.tabHeightMeters,
    );

    this._d.set(midX, topY, 0);
    a.object.localToWorld(this._d);
    this.placeInBand(layout.bar.object, layout.bar.widthMeters, layout.bar.heightMeters, this._d, a.object);

    const slot = this.silhouette;
    if (!slot) {
      return;
    }
    a.object.getWorldQuaternion(this._q1);
    this._c.set(midX, topY, 0);
    a.object.localToWorld(this._c);
    this.placeAboveBand(
      slot.object,
      slot.heightMeters,
      layout.bar.object,
      layout.bar.heightMeters,
      CARD_GAP_METERS + layout.card.heightMeters,
    );
    this.placeCard(slot.object, layout.card);
  }

  // --- Pinch near the control ---------------------------------------------------------

  /**
   * A hand pinch whose pinch point lands on an option selects it. Poke and
   * ray select arrive as UIKit clicks instead; if one of those also fires
   * for the same press, `setJoinType` is idempotent.
   */
  private updatePinchSelect(): void {
    const controlLive =
      this.state.phase === 'joined' && this.control.document.visible && this.control.fade.peek() >= 0.5;
    // Challenge mode's bar takes pinches before a join, too.
    if (!controlLive && !this.challengeLayout) {
      return;
    }
    for (const hand of HANDS) {
      const source = this.input.xr.getPrimaryInputSource(hand);
      if (!source?.hand || !this.input.xr.gamepads[hand]?.getSelectStart()) {
        continue;
      }
      if (!readPinchPoint(this.world, this.player, source, this._pinchA)) {
        continue;
      }
      // The control and the puzzle bar sit side by side: the nearer target
      // within its margin wins (a pinch in the gap between them goes to
      // whichever is closer). Otherwise, NULL cells on the result.
      const controlDistance = controlLive ? this.evaluatePinch(hand, this._pinchA) : Infinity;
      const barDistance = joinBridge.challenge?.barDistance(this._pinchA) ?? Infinity;
      if (barDistance < Infinity && barDistance < controlDistance) {
        joinBridge.challenge?.pressBarAt(this._pinchA, hand);
        continue;
      }
      if (controlDistance < Infinity) {
        this.requestJoinType(this.pinchNearest);
        continue;
      }
      if (controlLive && this.challengeLayout) {
        this.evaluateNullPinch(hand, source, this._pinchA);
      }
    }
  }

  /** The join type nearest the last pinch evaluated against the control. */
  private pinchNearest: JoinType = 'inner';

  /**
   * Measures a pinch against the control's options (logged with `debug`);
   * returns its in-plane distance to the nearest option if it would select
   * it (within the margin and near the surface), else Infinity. The caller
   * decides, since the puzzle bar may be nearer.
   */
  private evaluatePinch(hand: (typeof HANDS)[number], point: Vector3): number {
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
    this.pinchNearest = nearest;
    return selected ? distance : Infinity;
  }

  /**
   * Challenge mode: a pinch whose pinch point lands on a shown NULL cell (in
   * plane within NULL_PINCH_MARGIN_METERS, and near the surface) pokes it.
   * Dev readout: how far the pinch point and the wrist were from the nearest
   * source slab's grab surface, since a pinch that near a slab could grab it.
   */
  private evaluateNullPinch(hand: (typeof HANDS)[number], source: XRInputSource, point: Vector3): void {
    const view = this.active;
    if (!view || !this.nearestNullCell(view, point)) {
      return;
    }
    const { row: bestRow, column: bestColumn, distance: best, depth } = this._nullHit;
    const selected = best <= NULL_PINCH_MARGIN_METERS && depth <= CONTROL_PINCH_DEPTH_METERS;

    if (import.meta.env.DEV && this.debug) {
      let tipToSlab = Infinity;
      let wristToSlab = Infinity;
      const hasWrist = readWristPoint(this.world, this.player, source, this._pinchB);
      for (const slab of this.sources.values()) {
        tipToSlab = Math.min(tipToSlab, distanceToSlab(point, slab, this._g));
        if (hasWrist) {
          wristToSlab = Math.min(wristToSlab, distanceToSlab(this._pinchB, slab, this._g));
        }
      }
      this.debug.note(
        `${hand} pinch evaluated against NULL cells: ${cm(best)} from row ${bestRow} column ${bestColumn} in plane, ` +
          `${cm(depth)} off the surface -> ${selected ? 'poked' : 'not poked'}; pinch point ${cm(tipToSlab)} and ` +
          `wrist ${hasWrist ? cm(wristToSlab) : 'untracked'} from the nearest source slab (grab sphere ` +
          `${cm(GRAB_SPHERE_RADIUS_METERS)} around the palm)`,
      );
      if (tipToSlab < GRAB_SPHERE_RADIUS_METERS + 0.03 || wristToSlab < GRAB_SPHERE_RADIUS_METERS + 0.03) {
        this.debug.warn(`a pinch on a NULL cell came within grab range of a source slab (see the note above)`);
      }
    }
    if (selected) {
      this.activateNullCell(view.key, bestRow, bestColumn);
    }
  }

  /**
   * Eye position, and the natural seated gaze that every view angle is
   * measured from (not the head's actual pitch at join time).
   */
  private readHead(): void {
    this.player.head.updateWorldMatrix(true, false);
    this._head.setFromMatrixPosition(this.player.head.matrixWorld);
    this.headPitchDown = NATURAL_GAZE_PITCH_RAD;
  }

  /**
   * Dev-only (`debug` flag): logs every joined element's eye distance and
   * top/bottom edge angles from the natural gaze -- the source slabs and
   * the control against the seated reach limit, the result slab against the
   * minimum text size -- the control's clearance from the source slabs'
   * grab surfaces, and the whole group's vertical extent against
   * GROUP_MAX_VERTICAL_FOV_DEG. Warns on any limit it breaks. Runs once per
   * join, so the small allocations here are fine.
   */
  private warnIfOutOfView(view: ResultView, left: SourceSlab, right: SourceSlab): void {
    if (!import.meta.env.DEV || !this.debug) {
      return;
    }
    const debug = this.debug;
    const gaze = `from the natural gaze (${NATURAL_GAZE_PITCH_DEG}° down)`;
    const reachNote = (distance: number) =>
      `reach limit ${TOUCH_REACH_MAX_METERS} m, ${distance <= TOUCH_REACH_MAX_METERS + 0.005 ? 'within reach' : 'BEYOND REACH'}`;
    let groupTop = -Infinity;
    let groupBottom = Infinity;
    // Records one element's edges in the group extent; warns if outside the window.
    const edgeNote = (name: string, topDeg: number, bottomDeg: number) => {
      groupTop = Math.max(groupTop, topDeg);
      groupBottom = Math.min(groupBottom, bottomDeg);
      if (topDeg > VIEW_MAX_ABOVE_GAZE_DEG + 0.5 || bottomDeg < -(VIEW_MAX_BELOW_GAZE_DEG + 0.5)) {
        debug.warn(
          `${name} edges outside the view window (top ${topDeg.toFixed(1)}°, bottom ${bottomDeg.toFixed(1)}° ${gaze}; ` +
            `window -${VIEW_MAX_BELOW_GAZE_DEG}°/+${VIEW_MAX_ABOVE_GAZE_DEG}°)`,
        );
      }
      return `edges top ${topDeg.toFixed(1)}°, bottom ${bottomDeg.toFixed(1)}° ${gaze}`;
    };
    // Font size and the angle it subtends; warns when off the angular target.
    const textNote = (name: string, fontMeters: number, distance: number) => {
      const deg = textAngleDeg(fontMeters, distance);
      if (Math.abs(deg / ROW_TEXT_TARGET_DEG - 1) > TEXT_ANGLE_TOLERANCE) {
        debug.warn(
          `${name} row text is ${deg.toFixed(2)}° at ${distance.toFixed(2)} m, more than ` +
            `${TEXT_ANGLE_TOLERANCE * 100}% off the ${ROW_TEXT_TARGET_DEG}° target`,
        );
      }
      return `row font ${cm(fontMeters)} = ${deg.toFixed(2)}° (target ${ROW_TEXT_TARGET_DEG}°)`;
    };

    // The RIGHT slab is still animating into its dock; measure it there.
    const restore = this._c.copy(right.object.position);
    this._q2.copy(right.object.quaternion);
    right.object.position.copy(this.dock.toPos);
    right.object.quaternion.copy(this.dock.toQuat);

    // Source slabs: touched, so against the reach limit.
    let sourceDistance = 0;
    for (const slab of [left, right]) {
      measureSlabEdges(
        this._head,
        this.headPitchDown,
        slab.object,
        slabVisualTopLocalY(slab.doc),
        slabBottomLocalY(slab.doc),
        this._a,
        this._edges,
      );
      const edges = edgeNote(`${slab.id} slab (name tab included)`, this._edges.topDeg, this._edges.bottomDeg);
      this._a.setFromMatrixPosition(slab.object.matrixWorld);
      const distance = this._a.distanceTo(this._head);
      sourceDistance = Math.max(sourceDistance, distance);
      debug.note(
        `${slab.id} slab (touch): center ${distance.toFixed(2)} m from the eyes (${reachNote(distance)}); ` +
          `${textNote(`${slab.id} slab`, slab.doc.rowFontMeters, distance)}; ${edges}`,
      );
      if (distance > TOUCH_REACH_MAX_METERS + 0.005) {
        debug.warn(`${slab.id} slab is ${distance.toFixed(2)} m from the eyes, beyond the ${TOUCH_REACH_MAX_METERS} m reach limit`);
      }
    }

    // The pair's top edge where the control sits: at the seam (the same
    // point placeControl works from), not at the slabs' centers.
    this._d.set(this.dockSide * (left.doc.widthMeters / 2 + DOCK_GAP_METERS / 2), pairTopLocalY(left, right), 0);
    left.object.localToWorld(this._d);
    const pairTopDeg = degreesFromForward(this._head, this.headPitchDown, this._d);

    // Control: touched, so against the reach limit; plus its grab clearance.
    const control = this.control;
    control.document.updateWorldMatrix(true, false);
    this._a.setFromMatrixPosition(control.document.matrixWorld);
    const controlDistance = this._a.distanceTo(this._head);
    let clearance = Infinity;
    for (const sx of [-1, 0, 1]) {
      for (const sy of [-1, 0, 1]) {
        this._d.set((sx * control.widthMeters) / 2, (sy * control.heightMeters) / 2, 0);
        control.document.localToWorld(this._d);
        clearance = Math.min(clearance, distanceToSlab(this._d, left, this._e), distanceToSlab(this._d, right, this._e));
      }
    }
    this._d.set(0, control.heightMeters / 2, 0);
    control.document.localToWorld(this._d);
    this._e.set(0, -control.heightMeters / 2, 0);
    control.document.localToWorld(this._e);
    const controlTopDeg = degreesFromForward(this._head, this.headPitchDown, this._d);
    const controlBottomDeg = degreesFromForward(this._head, this.headPitchDown, this._e);
    const controlEdges = edgeNote('join-type control', controlTopDeg, controlBottomDeg);
    // Orientation against the pair (roll and relative yaw should be 0).
    control.document.getWorldQuaternion(this._q1);
    this._euler.setFromQuaternion(this._q1, 'YXZ');
    const controlYawDeg = MathUtils.radToDeg(this._euler.y);
    const controlRollDeg = MathUtils.radToDeg(this._euler.z);
    left.object.getWorldQuaternion(this._q1);
    this._euler.setFromQuaternion(this._q1, 'YXZ');
    const relativeYawDeg = controlYawDeg - MathUtils.radToDeg(this._euler.y);
    debug.note(
      `join-type control (touch): center ${controlDistance.toFixed(2)} m from the eyes (${reachNote(controlDistance)}); ` +
        `${controlEdges}; clearance to the nearest source slab ${cm(clearance)} (palm grab sphere ` +
        `${cm(GRAB_SPHERE_RADIUS_METERS)}, target >= ${cm(CONTROL_SLAB_CLEARANCE_METERS)}); ` +
        `options ${cm(control.optionWidthMeters)} x ${cm(control.optionHeightMeters)}; label font ` +
        `${cm(control.labelFontMeters)} = ${textAngleDeg(control.labelFontMeters, controlDistance).toFixed(2)}°; ` +
        `roll ${controlRollDeg.toFixed(1)}°, yaw vs pair ${relativeYawDeg.toFixed(1)}°`,
    );
    if (Math.abs(controlRollDeg) > 0.5 || Math.abs(relativeYawDeg) > 0.5) {
      debug.warn(`join-type control isn't parallel to the pair (roll ${controlRollDeg.toFixed(1)}°, yaw vs pair ${relativeYawDeg.toFixed(1)}°)`);
    }
    if (controlDistance > TOUCH_REACH_MAX_METERS + 0.005) {
      debug.warn(`join-type control is ${controlDistance.toFixed(2)} m from the eyes, beyond the reach limit`);
    }
    if (clearance < CONTROL_SLAB_CLEARANCE_METERS - 0.005) {
      debug.warn(`join-type control is only ${cm(clearance)} from a source slab (target ${cm(CONTROL_SLAB_CLEARANCE_METERS)})`);
    }

    // Challenge mode's puzzle bar: touched, like the control.
    const bar = this.challengeLayout?.bar;
    if (bar) {
      bar.object.updateWorldMatrix(true, false);
      this._a.setFromMatrixPosition(bar.object.matrixWorld);
      const barDistance = this._a.distanceTo(this._head);
      let barClearance = Infinity;
      for (const sx of [-1, 0, 1]) {
        for (const sy of [-1, 0, 1]) {
          this._d.set((sx * bar.widthMeters) / 2, (sy * bar.heightMeters) / 2, 0);
          bar.object.localToWorld(this._d);
          barClearance = Math.min(barClearance, distanceToSlab(this._d, left, this._e), distanceToSlab(this._d, right, this._e));
        }
      }
      this._d.set(0, bar.heightMeters / 2, 0);
      bar.object.localToWorld(this._d);
      this._e.set(0, -bar.heightMeters / 2, 0);
      bar.object.localToWorld(this._e);
      const barEdges = edgeNote(
        'puzzle bar',
        degreesFromForward(this._head, this.headPitchDown, this._d),
        degreesFromForward(this._head, this.headPitchDown, this._e),
      );
      // The gap between the control's right edge and the bar's left edge, in the control's frame.
      this._d.set(-bar.widthMeters / 2, 0, 0);
      bar.object.localToWorld(this._d);
      control.document.worldToLocal(this._d);
      const gap = this._d.x - control.widthMeters / 2;
      debug.note(
        `puzzle bar (touch): center ${barDistance.toFixed(2)} m from the eyes (${reachNote(barDistance)}); ${barEdges}; ` +
          `clearance to the nearest source slab ${cm(barClearance)} (target >= ${cm(CONTROL_SLAB_CLEARANCE_METERS)}); ` +
          `${cm(bar.widthMeters)} x ${cm(bar.heightMeters)}; gap from the control ${cm(gap)} ` +
          `(target >= ${cm(BAR_CONTROL_GAP_METERS)})`,
      );
      if (gap < 0) {
        debug.warn(`puzzle bar OVERLAPS the join-type control by ${cm(-gap)}`);
      } else if (gap < BAR_CONTROL_GAP_METERS - 0.001) {
        debug.warn(`puzzle bar is only ${cm(gap)} from the join-type control (target ${cm(BAR_CONTROL_GAP_METERS)})`);
      }
      if (barDistance > TOUCH_REACH_MAX_METERS + 0.005) {
        debug.warn(`puzzle bar is ${barDistance.toFixed(2)} m from the eyes, beyond the reach limit`);
      }
      if (barClearance < CONTROL_SLAB_CLEARANCE_METERS - 0.005) {
        debug.warn(`puzzle bar is only ${cm(barClearance)} from a source slab (target ${cm(CONTROL_SLAB_CLEARANCE_METERS)})`);
      }

      // Every touch target in the band: size, distance from the eyes, and
      // clearance to the slabs (its four corners and center).
      const targets: { name: string; object: Object3D; centerX: number; width: number; height: number }[] = [
        { name: 'INNER', object: control.document, centerX: control.innerCenterX, width: control.optionWidthMeters, height: control.optionHeightMeters },
        { name: 'LEFT', object: control.document, centerX: control.leftCenterX, width: control.optionWidthMeters, height: control.optionHeightMeters },
        ...bar.buttons.map((button) => ({
          name: button.name,
          object: bar.object,
          centerX: button.centerX,
          width: button.width,
          height: bar.buttonHeightMeters,
        })),
      ];
      const lines = targets.map((target) => {
        this._d.set(target.centerX, 0, 0);
        target.object.localToWorld(this._d);
        const distance = this._d.distanceTo(this._head);
        let targetClearance = Infinity;
        for (const [sx, sy] of [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
          this._d.set(target.centerX + (sx * target.width) / 2, (sy * target.height) / 2, 0);
          target.object.localToWorld(this._d);
          targetClearance = Math.min(targetClearance, distanceToSlab(this._d, left, this._e), distanceToSlab(this._d, right, this._e));
        }
        if (distance > TOUCH_REACH_MAX_METERS + 0.005 || targetClearance < CONTROL_SLAB_CLEARANCE_METERS - 0.005) {
          debug.warn(`${target.name} target: ${distance.toFixed(2)} m from the eyes, ${cm(targetClearance)} from a slab`);
        }
        return `${target.name} ${cm(target.width)} x ${cm(target.height)}, ${distance.toFixed(2)} m, clearance ${cm(targetClearance)}`;
      });
      debug.note(`band touch targets (size, distance from the eyes, clearance to the slabs): ${lines.join('; ')}`);
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
    );
    const resultBottomDeg = this._edges.bottomDeg;
    const resultEdges = edgeNote('result slab', this._edges.topDeg, resultBottomDeg);
    this._a.set(0, -view.doc.heightMeters / 2, 0);
    view.object.localToWorld(this._a);
    const resultDistance = this._a.distanceTo(this._head);
    const resultTextDeg = textAngleDeg(view.doc.rowFontMeters, resultDistance);
    debug.note(
      `result slab (view only): ${resultDistance.toFixed(2)} m from the eyes (cap ${RESULT_MAX_DISTANCE_METERS} m); ` +
        `${textNote('result slab', view.doc.rowFontMeters, resultDistance)} (source slabs ` +
        `${textAngleDeg(left.doc.rowFontMeters, sourceDistance).toFixed(2)}° at ${sourceDistance.toFixed(2)} m; ` +
        `minimum ${MIN_ROW_TEXT_DEG.toFixed(2)}°); ${resultEdges}`,
    );
    if (resultTextDeg < MIN_ROW_TEXT_DEG) {
      debug.warn(`result slab row text is ${resultTextDeg.toFixed(2)}° tall, below the ${MIN_ROW_TEXT_DEG}° minimum`);
    }

    // Challenge mode: where the first NULL cell sits (LEFT layout), to aim pokes and rays at in testing.
    if (this.challengeLayout) {
      const row = view.nullColumns.findIndex((columns) => columns.length > 0);
      if (row >= 0) {
        const column = view.nullColumns[row][0];
        const span = view.doc.columnSpans[column];
        this._a.set((span.x0 + span.x1) / 2, rowCenterLocalY(view.doc, row), 0);
        view.object.localToWorld(this._a);
        debug.note(
          `first NULL cell (row ${row}, ${view.result.columns[column].label}, with LEFT): world ` +
            `(${this._a.x.toFixed(3)}, ${this._a.y.toFixed(3)}, ${this._a.z.toFixed(3)}); ` +
            `${cm(span.x1 - span.x0)} x ${cm(view.doc.rowHeightMeters)}`,
        );
      }
    }

    // Challenge mode's puzzle card: viewed, above the result slab.
    const card = this.challengeLayout?.card;
    if (card) {
      card.object.updateWorldMatrix(true, false);
      this._a.setFromMatrixPosition(card.object.matrixWorld);
      const cardDistance = this._a.distanceTo(this._head);
      this._d.set(0, card.heightMeters / 2, 0);
      card.object.localToWorld(this._d);
      this._e.set(0, -card.heightMeters / 2, 0);
      card.object.localToWorld(this._e);
      const cardEdges = edgeNote(
        'puzzle card',
        degreesFromForward(this._head, this.headPitchDown, this._d),
        degreesFromForward(this._head, this.headPitchDown, this._e),
      );
      debug.note(
        `puzzle card (view only): center ${cardDistance.toFixed(2)} m from the eyes; ${cardEdges}; ` +
          `${cm(card.widthMeters)} x ${cm(card.heightMeters)}`,
      );
    }
    debug.note(
      `layout gaps in view: pair top -> control bottom ${(controlBottomDeg - pairTopDeg).toFixed(1)}°, ` +
        `control top -> result bottom ${(resultBottomDeg - controlTopDeg).toFixed(1)}° (result bottom at its full ` +
        `LEFT height; INNER sits higher)`,
    );
    if (controlBottomDeg < pairTopDeg) {
      debug.warn(
        `join-type control's bottom edge (${controlBottomDeg.toFixed(1)}°) is below the pair's top edge ` +
          `(${pairTopDeg.toFixed(1)}°) in view: they overlap`,
      );
    }
    if (resultBottomDeg < controlTopDeg) {
      debug.warn(
        `result slab's bottom edge (${resultBottomDeg.toFixed(1)}°) is below the control's top edge ` +
          `(${controlTopDeg.toFixed(1)}°) in view: they overlap`,
      );
    }

    // The whole group against its vertical budget.
    const extent = groupTop - groupBottom;
    const fits = extent <= GROUP_MAX_VERTICAL_FOV_DEG + 0.5;
    debug.note(
      `group: top ${groupTop.toFixed(1)}°, bottom ${groupBottom.toFixed(1)}° ${gaze}; extent ${extent.toFixed(1)}° ` +
        `of ${GROUP_MAX_VERTICAL_FOV_DEG}° (${fits ? 'fits' : `OUTSIDE by ${(extent - GROUP_MAX_VERTICAL_FOV_DEG).toFixed(1)}°`})`,
    );
    if (!fits) {
      debug.warn(`slab group spans ${extent.toFixed(1)}°, more than GROUP_MAX_VERTICAL_FOV_DEG (${GROUP_MAX_VERTICAL_FOV_DEG}°)`);
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
    sounds.setPreviewProximity(0, this._head);
  }

  /**
   * The "magnet": while a held slab approaches (within APPROACH_GAP_METERS),
   * the facing edges glow faintly, brighter as it nears the preview range,
   * with a hum that rises to match. In preview range: a full pulsing glow
   * (faster as the gap closes), hint lines, and the hum at full. The held
   * slab itself is never moved.
   */
  private updatePreviewVisuals(): void {
    const previewing = this.state.phase === 'previewing';
    let moving: SourceSlab | null | undefined = null;
    let stationary: SourceSlab | null | undefined = null;
    let side = this.previewSide;
    if (this.state.phase === 'previewing') {
      moving = this.sources.get(this.state.moving);
      stationary = this.sources.get(this.state.stationary);
    } else if (this.approach > 0) {
      moving = this.approachMoving;
      stationary = this.approachStationary;
      side = this._prox.side;
    }
    if (!moving || !stationary) {
      if (this.hints.mesh.count > 0 || this.stationaryGlow.mesh.visible) {
        this.hidePreview();
      }
      sounds.setPreviewProximity(0, this._head);
      return;
    }

    const now = this.tweens.now;
    let glow: number;
    if (previewing) {
      const closeness = MathUtils.clamp((PREVIEW_ENTER_GAP_METERS - this._prox.gap) / PREVIEW_ENTER_GAP_METERS, 0, 1);
      glow = 0.55 + 0.25 * Math.sin(now * (7 + 6 * closeness)) + 0.15 * closeness;
    } else {
      glow = APPROACH_GLOW_MIN + APPROACH_GLOW_RANGE * this.approach * (0.85 + 0.15 * Math.sin(now * 5));
    }
    this.stationaryGlow.place(
      stationary.object,
      (side * stationary.doc.widthMeters) / 2,
      0,
      stationary.doc.heightMeters,
      glow,
    );
    this.movingGlow.place(moving.object, (-side * moving.doc.widthMeters) / 2, 0, moving.doc.heightMeters, glow);

    // The hum comes from the stationary slab's facing edge.
    this._c.set((side * stationary.doc.widthMeters) / 2, 0, 0);
    stationary.object.localToWorld(this._c);
    sounds.setPreviewProximity(previewing ? 1 : this.approach * 0.8, this._c);

    if (!previewing) {
      if (this.hints.mesh.count > 0) {
        this.hints.setCount(0);
        this.hints.update();
      }
      return;
    }
    const pulse = glow;
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
        this.pulses.setCount(0);
        this.pulses.update();
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
      // A short bright pulse rides the drawing tip of the line, then goes.
      const p = this.lines.progress[i].peek();
      if (p > 0.001 && p < 0.999 && phase === 'joined') {
        this._c.lerpVectors(this._a, this._b, Math.max(0, p - LINE_PULSE_FRACTION));
        this._d.lerpVectors(this._a, this._b, p);
        this.pulses.setEndpoints(i, this._c, this._d);
        this.pulses.progress[i].value = 1;
      } else {
        this.pulses.progress[i].value = 0;
      }
    }
    this.lines.update();
    this.pulses.update();
  }
}

function resultKey(leftId: string, rightId: string): string {
  return `${leftId}>${rightId}`;
}

/** Recomputes each result row's display slot from `rowShown` (hidden rows: -1). */
function updateRowSlots(view: ResultView): void {
  let slot = 0;
  view.rowSlot.length = view.rowShown.length;
  for (let row = 0; row < view.rowShown.length; row++) {
    view.rowSlot[row] = view.rowShown[row] ? slot++ : -1;
  }
}

/**
 * Local Y (in the LEFT slab's frame) of the docked pair's highest point:
 * the taller slab's name tab (docked slabs align their bottom edges). The
 * control band sits above it, so the control never covers a tab.
 */
function pairTopLocalY(left: SourceSlab, right: SourceSlab): number {
  return Math.max(
    left.doc.heightMeters / 2 + left.doc.tabHeightMeters,
    -left.doc.heightMeters / 2 + right.doc.heightMeters + right.doc.tabHeightMeters,
  );
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
