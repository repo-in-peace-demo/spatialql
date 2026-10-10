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
  DoubleSide,
  Euler,
  Grabbed,
  GrabSystem,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PokeInteractable,
  Quaternion,
  RayInteractable,
  RingGeometry,
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
  columnHeaderText,
  fullJoinPairings,
  joinTables,
  requireJoinKeys,
  type JoinResultTable,
} from './data/join-result.js';
import { buildJoinSql, buildWhereSql } from './data/join-sql.js';
import { INITIAL_JOIN_STATE, transition, type JoinEvent, type JoinState } from './data/join-state.js';
import { assignKeyTints } from './data/key-tints.js';
import { RESULT_ROW_CAP } from './data/puzzles.js';
import { filterForColumn, nullFilterColumns, nullFilterMask, nullPokeEvent, sameFilter } from './data/query.js';
import { DATASETS, datasetOfTable, tableById, type DatasetId } from './data/datasets.js';
import type { QuerySpec } from './data/query.js';
import type { CellValue, JoinType, NullFilter, Table } from './data/types.js';
import { buildRecenterBar, setArcLean, setRecenterHover, type RecenterBarView } from './challenge-view.js';
import { ReachBanner } from './reach-banner.js';
import { REACH_HINT_CONTROL_METERS, REACH_HINT_SLAB_METERS, ReachHint } from './reach-hint.js';
import { BAR } from './data/copy.js';
import { deskBridge, deskReady } from './desk-bridge.js';
import { devLayout } from './dev-layout.js';
import {
  grabPoints,
  reachClearances,
  reachClearanceText,
  REACH_PATH_MIN_CLEARANCE_METERS,
  rectFromCorners,
  shoulders,
  type ReachRect,
} from './reach-path.js';
import { devFlag } from './dev-flags.js';
import {
  joinBridge,
  type ChallengeLayout,
  type JoinControls,
  type NullFilterChoice,
  type PlacedBar,
  type PlacedElement,
} from './join-bridge.js';
import { JoinDebug, type JoinDebugHost, type JoinStats } from './join-debug.js';
import { isTouchPointerClick, setRect, touchProbe, type PressPath } from './touch-probe.js';
import { DeskShadow, GRABBED_SCALE, SlabOutline, type GrabLook } from './grab-feedback.js';
import { COLOR_MATCH_LINE, COLOR_PREVIEW, CursorDot, EdgeGlow, lineColorForTint, SegmentBatch } from './join-visuals.js';
import {
  angleBetweenDeg,
  HAND_POINTER_FREEZE_LOOKBACK_SECONDS,
  HAND_POINTER_FLICKER_OPEN_SECONDS,
  HAND_POINTER_FREEZE_MAX_SECONDS,
  HAND_POINTER_MAX_BELOW_EYES_METERS,
  HAND_POINTER_PRESS_GAP_SECONDS,
  HAND_POINTER_MAX_METERS,
  HAND_POINTER_NEAR_BUTTON_METERS,
  HAND_POINTER_PITCH_OFFSET_DEG,
  pitchDeg,
  PinchFreeze,
  HoldSelect,
  PINCH_CLOSE_WINDOW_SECONDS,
  PINCH_CLOSED_HOLD_SECONDS,
  PINCH_CLOSED_METERS,
  PINCH_START_MAX_METERS,
  PinchConfirm,
  pinchStartVerdict,
  POINTER_PRESS_MIN_VISIBLE_SECONDS,
  PinchMotion,
  PINCH_OPEN_NULL_METERS,
  pinchOpenMetersFor,
  type PinchTargetKind,
  PINCH_OPENING_WINDOW_SECONDS,
  PINCH_TARGET_LOCK_SECONDS,
  RECENTER_HOLD_SECONDS,
  pointerRaised,
  PoseHistory,
  smoothingAlpha,
  StaleRay,
  type PressBlock,
} from './hand-pointer-math.js';
import {
  approachAngleDeg,
  BUTTON_PINCH_BACK_DEPTH_METERS,
  BUTTON_PINCH_FRONT_DEPTH_METERS,
  CONTACT_DEPTH_METERS,
  ContactPoke,
  MAX_POKE_APPROACH_DEG,
  MIN_INDEX_STRAIGHTNESS,
  POKE_HOVER_DEPTH_METERS,
  POKE_TARGET_TOLERANCE_METERS,
  pokeMissText,
  type PokeVerdict,
} from './contact-poke.js';
import { indexStraightness, readJointsPoint, readTargetRay, readWristPoint } from './pinch.js';
import { arcAngle, arcPlace, BAND_ARC_RADIUS_METERS, rayCircleDistance, unrollArc, type ArcPlacement } from './band-arc.js';
import { JoinDocked, JoinResultSlab, TableSlab, TableSlabRuntime } from './table-slab-component.js';
import {
  buildJoinTypeControl,
  joinTypeControlSizeCm,
  startTableSlabBuild,
  captionColor,
  controlOptionStyle,
  MAX_RESULT_ROWS,
  rowCenterLocalY,
  setRowTint,
  slabBorderColor,
  slabBottomLocalY,
  slabTopLocalY,
  slabVisualTopLocalY,
  setNullCellHover,
  setTargetHover,
  setSlabBadge,
  type CellOffset,
  type SlabBadgeLook,
  type JoinTypeControlView,
  type TableSlabDocument,
  type SlabBuild,
} from './table-slab-view.js';
import { buildQueue, type BuildJob } from './build-queue.js';
import { chooseFrameRate, PREFERRED_FRAME_RATE_HZ } from './frame-rate.js';
import { keptDatasets, onKeptDatasets } from './dataset-cache.js';
import { PressDips } from './press-dip.js';
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
  PLANNED_CARD_DISTANCE_METERS,
  PLANNED_CONTROL_DISTANCE_METERS,
  PLANNED_RESULT_DISTANCE_METERS,
  ROW_TEXT_TARGET_DEG,
  slabTextSizeAt,
  TEXT_ANGLE_TOLERANCE,
  textAngleDeg,
  TOUCH_REACH_MAX_METERS,
  BAND_DISTANCE_METERS,
  SLAB_VIEW_DISTANCE_METERS,
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
/** A slab released this close to its home (and this little turned) stays put rather than gliding. */
const HOME_RETURN_MIN_METERS = 0.01;
const HOME_RETURN_MIN_RAD = MathUtils.degToRad(1);
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
// Behind the docked pair (at its planned text distance), its bottom edge just
// above the pair's top edge in view, leaning back only as far as needed to
// face the eyes. (The controls are in the side column, not in a band here.)
/** The result's bottom edge sits this far (in view) above the pair's top edge. */
const RESULT_FLOOR_GAP_DEG = 1.5;
/** The result's center sits this far from the eyes (behind the pair, at its planned text distance). */
const RESULT_TARGET_DISTANCE_METERS = PLANNED_RESULT_DISTANCE_METERS;
const RESULT_BEHIND_METERS = 0.02;
/** Legibility cap: the result slab's center is never farther than this from the eyes. */
const RESULT_MAX_DISTANCE_METERS = 1.0;
/** The widest results move back at most this far to fit VIEW_HALF_WIDTH_DEG (rows stay at least ~1.15°). */
const RESULT_MAX_FIT_DISTANCE_METERS = 0.89;
/**
 * A result slab placed beyond RESULT_MAX_PUSHED_DISTANCE_METERS (a pair
 * pushed far away) is pulled toward the viewer by at most this much, so its
 * rows stay at least RESULT_MIN_PUSHED_ROW_TEXT_DEG tall.
 */
const RESULT_MAX_PULL_METERS = 0.15;
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
/** Background builds wait until nothing has moved for this long (build-queue.ts). */
const BACKGROUND_QUIET_SECONDS = 0.5;

// --- Join-type control ----------------------------------------------------------
/**
 * Every point of the control floats at least this far off the source slabs
 * (toward the eyes): 3 cm more than the 7 cm palm grab sphere, so a palm on
 * the control can't reach a slab's grab surface.
 */
const CONTROL_SLAB_CLEARANCE_METERS = 0.1;
/**
 * Every element's outer edge stays within this many degrees of straight
 * ahead (the pair's forward from the eyes), with the head facing forward:
 * the column, result and card are laid out centered on it, the widest
 * results pushed back (up to RESULT_MAX_FIT_DISTANCE_METERS) to fit.
 */
const VIEW_HALF_WIDTH_DEG = 42;
/** While the puzzle picker is open, the column may reach this far left (it extends left by design). */
const PICKER_LEFT_LIMIT_DEG = 45;
/** In view, the control column's right edge sits this far left of the result's left edge. */
const COLUMN_RESULT_GAP_DEG = 2;
/** A pinch selects an option when its pinch point is this close to it, in plane... */
const CONTROL_PINCH_MARGIN_METERS = 0.015;
/** ...and at most this far in front of / behind the control's surface. */
/** A pinch on a NULL cell counts at most this far off the result slab's surface (buttons: contact-poke.ts). */
const CONTROL_PINCH_DEPTH_METERS = 0.03;
/** Grab sphere radius of IWSDK's grab pointer, for the clearance readout. */
const GRAB_SPHERE_RADIUS_METERS = 0.07;

// --- Challenge mode ------------------------------------------------------------------
/** Gap (in view) between the result slot's side edge and the puzzle card beside it. */
const CARD_SIDE_GAP_DEG = 1.5;
/** The card's bottom edge stays at least this far (in view) above the band and the slabs below it. */
const CARD_CLEARANCE_DEG = 1.5;
/** The card clearance readout warns below this. */
const CARD_MIN_CLEARANCE_WARN_DEG = 1;
/**
 * Which side of the result the card goes: +1 = the viewer's right. The
 * control column sits on the left, so the card balances it on the right.
 */
const CARD_SIDE = 1;
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
const NULL_RAY_TOLERANCE_METERS = 0.01;
/** A ray hit counts as on a control option within this of its rectangle (bar buttons: the bar's pinch margin). */
const RAY_BUTTON_TOLERANCE_METERS = 0.005;
// The hand pointer's look: a thin ray and a cursor dot, and when it hits nothing, a short stub.
const COLOR_POINTER = '#f7f4ee';
const POINTER_THICKNESS_METERS = 0.0015;
const POINTER_OPACITY = 0.6;
const POINTER_DOT_RADIUS_METERS = 0.005;
const POINTER_STUB_METERS = 0.3;
/** Dev log: a hover change is logged at most this often per hand. */
const POINTER_HOVER_LOG_SECONDS = 0.25;
/** Exit: held this long, it ends the session (a ring fills meanwhile). */
const EXIT_HOLD_SECONDS = 1.0;
/** The reach hint: how often it measures, the shoulders (as the layout readout assumes them), and the banner's fit. */
const REACH_CHECK_HZ = 4;
const REACH_SHOULDER_SIDE_METERS = 0.18;
const REACH_SHOULDER_DROP_METERS = 0.25;
/**
 * The banner sits this much behind the slabs' farthest top edge (out of the
 * hand's path to them: reach-path.ts), and at least REACH_BANNER_RESULT_GAP_METERS
 * in front of the result (or outline).
 */
const REACH_BANNER_BEHIND_SLABS_METERS = 0.08;
const REACH_BANNER_RESULT_GAP_METERS = 0.02;
/** A row-free band under this (degrees) can't hold a readable banner: it goes below the gaze instead. */
const REACH_BANNER_MIN_DEG = 1.5;
const REACH_BANNER_MAX_DEG = 3;
const LINE_HEIGHT = 1.2;
/**
 * A hold button wider than this has a label: its ring, smaller, sits at its
 * right end (centered this far in from the edge), clear of the centered text.
 */
const HOLD_RING_ICON_MAX_WIDTH_METERS = 0.06;
const HOLD_RING_END_INSET_METERS = 0.0085;
const HOLD_RING_LABEL_SCALE = 0.6;
/** The ring around Exit's icon: its radii, smoothness, and lift off the bar's face (it fits the 2.5 cm button). */
const EXIT_RING_INNER_METERS = 0.0095;
const EXIT_RING_OUTER_METERS = 0.0115;
const EXIT_RING_SEGMENTS = 48;
const EXIT_RING_LIFT_METERS = 0.004;
const COLOR_EXIT_RING = '#d08a1e';
/** A fingertip holds Exit from this far in front of its face (pressed on it), to BUTTON_PINCH_BACK_DEPTH_METERS behind. */
const EXIT_TOUCH_FRONT_METERS = 0.01;
const THUMB_TIP: readonly XRHandJoint[] = ['thumb-tip'];
/**
 * Dev on localhost runs the XR emulator (IWER), whose hands hold perfectly
 * still: its ray would always read as stale, so the stale check is skipped there.
 */
const EMULATED_HANDS =
  import.meta.env.DEV && typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
/** A fingertip within POKE_HOVER_DEPTH_METERS in front of a NULL cell hovers it (its outline strengthens), as every poke target... */
/** ...or up to this far behind its face (pressing into it). */
const CONTACT_HOVER_BEHIND_METERS = 0.01;
/** The first-time cue: the NULL cells' outlines stay strong this long, then settle. */
const NULL_CUE_SECONDS = 0.9;
/**
 * A select whose grip is this close to a source slab's grab surface (beyond
 * the grab sphere) is a near grab, not a ray press.
 */
const NEAR_GRAB_MARGIN_METERS = 0.01;
/** A poke and its UIKit click (or a pinch) on the control within this count once. */
const CONTROL_PRESS_DEBOUNCE_SECONDS = 0.3;
const INDEX_TIP: readonly XRHandJoint[] = ['index-finger-tip'];
/** Home glide on Next: both slabs return to where they started. */
const HOME_GLIDE_SECONDS = 0.45;
/** A pair joined high glides down at most this far to fit the group in view. */
const JOIN_MAX_FIT_DROP_METERS = 0.3;
/** The group may sit this far over the view's top before a join lowers it (readout rounding). */
const FIT_DROP_TOLERANCE_DEG = 0.5;
const FIT_DROP_SEARCH_STEPS = 10;
const COLOR_WIN_GLOW = '#f0b43c';

const UP = new Vector3(0, 1, 0);
const HANDS = ['left', 'right'] as const;

type SourceSlab = {
  id: string;
  entity: Entity;
  object: Object3D;
  doc: TableSlabDocument;
  table: Table;
  /** The NULL cells it shows (a poke or pinch there gets "use the result's"), and its contact poke. */
  nullCells: { row: number; column: number }[];
  nullPoke: ContactPoke;
};

/** What a hand's or controller's target ray hit first (see `castRay`). */
type RayTarget = 'none' | 'control' | 'bar' | 'recenter' | 'exit' | 'null' | 'result' | 'slab' | 'card';

/** A ray's nearest hit: what, how far along the ray, where (world), and which option, cell or slab. */
type RayHit = {
  target: RayTarget;
  distance: number;
  option: JoinType;
  row: number;
  column: number;
  name: string;
  point: Vector3;
  slab: SourceSlab | null;
  /** A source slab the ray passed through to reach its target (slabs never block a press), or null. */
  through: SourceSlab | null;
};

function makeRayHit(): RayHit {
  return {
    target: 'none',
    distance: Infinity,
    option: 'inner',
    row: -1,
    column: -1,
    name: '',
    point: new Vector3(),
    slab: null,
    through: null,
  };
}

/** Whether a ray hit is something a press acts on (not nothing, a slab, the result between its NULL cells, or the card). */
function pressable(hit: RayHit): boolean {
  return hit.target !== 'none' && hit.target !== 'slab' && hit.target !== 'result' && hit.target !== 'card';
}

/** Whether a ray hit is a surface the pointer rests on but never presses: only the cursor dot, no hover highlight. */
function viewOnly(target: RayTarget): boolean {
  return target === 'slab' || target === 'result' || target === 'card';
}

function copyRayHit(from: RayHit, to: RayHit): void {
  to.target = from.target;
  to.distance = from.distance;
  to.option = from.option;
  to.row = from.row;
  to.column = from.column;
  to.name = from.name;
  to.point.copy(from.point);
  to.slab = from.slab;
  to.through = from.through;
}

/**
 * Why a hand's pointer is off, as a short code: no hand tracked, its wrist
 * lost, the hand at the body or lowered, a fingertip at a button (poke
 * applies), the palm at a slab (a grab applies), or no ray.
 */
type PointerOffReason = 'untracked' | 'lost' | 'body' | 'lowered' | 'poke' | 'grab' | 'noray' | 'stale';

/**
 * The dev log's words for a pointer-off code. Only called inside dev-only
 * code, so with the DEV checks around its callers it's dropped (and its
 * text with it) from production builds.
 */
function pointerOffText(reason: PointerOffReason | ''): string {
  if (!import.meta.env.DEV) {
    return reason;
  }
  switch (reason) {
    case 'untracked':
      return 'no tracked hand';
    case 'lost':
      return 'hand not tracked';
    case 'body':
      return 'hand at the body';
    case 'lowered':
      return 'hand lowered';
    case 'poke':
      return 'fingertip at a button (poke)';
    case 'grab':
      return 'palm at a slab (near grab)';
    case 'noray':
      return 'tracking lost: no ray pose';
    case 'stale':
      return 'ray stale';
    default:
      return '';
  }
}

/** One hand's pointer: on or off (and why), its smoothed or frozen ray, and what it hits. */
type HandPointer = {
  active: boolean;
  /** When it was last shown (seconds, `tweens.now`): it presses only after POINTER_PRESS_MIN_VISIBLE_SECONDS. */
  activeSince: number;
  /** The ray is frozen this frame (a pinch closing; see `freeze`). */
  frozen: boolean;
  /** The pre-pinch freeze and the one-press-per-pinch gate. */
  freeze: PinchFreeze;
  /** Detects a ray pose the platform stopped updating. */
  stale: StaleRay;
  /** This frame's ray pose was live (read from the frame, and changing). */
  fresh: boolean;
  origin: Vector3;
  dir: Vector3;
  history: PoseHistory;
  hit: RayHit;
  /** With a `bar` hit: which of the bar's buttons (-1 between them). */
  barIndex: number;
  /** The wrist's position relative to the head when last read (meters ahead, below the eyes). */
  forward: number;
  below: number;
  offReason: PointerOffReason | '';
  /** Dev log: the last hover logged, and when. */
  hoverKey: string;
  hoverLogAt: number;
};

function makeHandPointer(): HandPointer {
  return {
    active: false,
    activeSince: Infinity,
    frozen: false,
    freeze: new PinchFreeze(),
    stale: new StaleRay(),
    fresh: false,
    origin: new Vector3(),
    dir: new Vector3(0, 0, -1),
    history: new PoseHistory(),
    hit: makeRayHit(),
    barIndex: -1,
    forward: 0,
    below: 0,
    offReason: 'untracked',
    hoverKey: '',
    hoverLogAt: -Infinity,
  };
}

/** A slab's panel height now (meters): its animated height, or its full height. */
function shownHeightMeters(doc: TableSlabDocument): number {
  return doc.panelHeightCm ? doc.panelHeightCm.peek() / 100 : doc.heightMeters;
}

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

/**
 * A result slab queued for building (build-queue.ts): its job, and once that
 * has taken its first step (or a join needs it now), its build and the step
 * that turns the finished document into a ResultView.
 */
type ResultBuild = { job: BuildJob; build: SlabBuild | null; finish: (() => ResultView) | null };

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

/** One of a placed bar's buttons. */
type BarButtonRect = PlacedBar['buttons'][number];

/** The group's layout (JoinSystem.planGroup); angles in degrees, yaws + right of straight ahead. */
type GroupPlan = {
  /** The pair's top edge in view, and the result's floor (from the natural gaze). */
  pairTopDeg: number;
  floorDeg: number;
  /** The result width it's laid out for (meters), and the result's distance from the eyes. */
  resultWidth: number;
  resultDistance: number;
  /** The result's center, and the column's left edge. */
  resultYawDeg: number;
  columnLeftYawDeg: number;
};

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
  /**
   * Result slabs being built a step at a time (build-queue.ts), by key: each
   * becomes a ResultView in `results` when its last row is in.
   */
  private readonly resultBuilds = new Map<string, ResultBuild>();
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
  /** A pull-apart finished: glide both slabs home once none is held. */
  private homeAfterSeparate = false;
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
  /** Contact pokes (contact-poke.ts) on the NULL cells and on the control's options. */
  private readonly nullPoke = new ContactPoke();
  private readonly controlPoke = new ContactPoke();
  /** The INNER | LEFT option a fingertip is just in front of (its hover), or null. */
  private controlFingerOption: JoinType | null = null;
  /** Press feedback: the pressed option or NULL cell dips (press-dip.ts). */
  private readonly dips = new PressDips();
  /** The input source whose fingertip is being tested (for the index-straightness check). */
  private _pokeSource: XRInputSource | null = null;
  private readonly _pokeLocal = new Vector3();
  private readonly _groupTop = new Vector3();
  private readonly _straightA = new Vector3();
  private readonly _straightB = new Vector3();
  private lastControlPress = -Infinity;
  /** Contact-poke hit tests, allocated once (the poke asks only at a contact). */
  private readonly pokeOnNullCell = (): boolean => {
    const view = this.active;
    return !!view && this.nearestNullCell(view, this._pokeTip) && this._nullHit.distance <= POKE_TARGET_TOLERANCE_METERS;
  };
  private readonly pokeOnControl = (): boolean => {
    const control = this.control;
    const p = this._pokeLocal;
    const dy = Math.max(0, Math.abs(p.y) - control.optionHeightMeters / 2);
    const inner = Math.hypot(Math.max(0, Math.abs(p.x - control.innerCenterX) - control.optionWidthMeters / 2), dy);
    const left = Math.hypot(Math.max(0, Math.abs(p.x - control.leftCenterX) - control.optionWidthMeters / 2), dy);
    this.pokedOption = inner <= left ? 'inner' : 'left';
    return Math.min(inner, left) <= POKE_TARGET_TOLERANCE_METERS;
  };
  private readonly pokeStraightness = (): number | null =>
    this._pokeSource ? indexStraightness(this.world, this.player, this._pokeSource, this._straightA, this._straightB) : null;
  private readonly _rayOrigin = new Vector3();
  private readonly _rayDir = new Vector3();
  private readonly _rayLocalO = new Vector3();
  private readonly _rayLocalD = new Vector3();
  private readonly _rayLocal = new Vector3();
  private readonly _rayWorld = new Vector3();
  /** `castRay`'s nearest hit: what, how far along the ray, and where (world). */
  private readonly _rayHit: RayHit = makeRayHit();
  // The hand pointer (see updateHandPointers): one per hand, its visuals, and what it hovers.
  private readonly pointers: Record<(typeof HANDS)[number], HandPointer> = { left: makeHandPointer(), right: makeHandPointer() };
  /** Whether the SDK's own ray is off for a hand (ours replaces it; controllers keep theirs). */
  private readonly sdkRayOff = { left: false, right: false };
  private pointerLines!: SegmentBatch;
  private readonly pointerDots = {
    left: new CursorDot(POINTER_DOT_RADIUS_METERS, COLOR_POINTER, 0.95),
    right: new CursorDot(POINTER_DOT_RADIUS_METERS, COLOR_POINTER, 0.95),
  };
  /** Grab feedback (grab-feedback.ts): one outline and one desk shadow per source slab, pooled. */
  private readonly grabOutlines: SlabOutline[] = [];
  private readonly grabShadows: DeskShadow[] = [];
  /** Dev: each slab's last grab look, so only changes are logged. */
  private readonly grabLooks = new Map<string, GrabLook>();
  private readonly pointerHover = {
    option: null as JoinType | null,
    barIndex: -1,
    recenter: false,
    exit: false,
  };
  /** The control's two options as targets (centers and widths, in its frame). */
  private controlTargets: ButtonRect[] = [];
  private readonly _pointerHead = new Vector3();
  private readonly _pointerFwd = new Vector3();
  private readonly _pointerWrist = new Vector3();
  private readonly _pointerThumb = new Vector3();
  private readonly _pointerIndex = new Vector3();
  private readonly _pointerLocal = new Vector3();
  private readonly _pointerEnd = new Vector3();
  private readonly _pointerAxis = new Vector3();
  private readonly _poseBuffer = new Float64Array(6);
  private readonly _pokeTip = new Vector3();
  private readonly _layoutA = new Vector3();
  private readonly _layoutB = new Vector3();
  /** The source slab whose NULL cells a contact poke is being tested against (`pokeOnSourceNull`). */
  private _pokeSlab: SourceSlab | null = null;
  private readonly pokeOnSourceNull = (): boolean =>
    !!this._pokeSlab && nearestSourceNull(this._pokeSlab, this._a) <= POKE_TARGET_TOLERANCE_METERS;
  /** The result NULL cell drawn hovered (a fingertip in front of it, or a ray on it), if any. */
  private hoverView: ResultView | null = null;
  private hoverRow = -1;
  private hoverColumn = -1;
  /** The first-time cue's end (tween clock seconds); 0 when none is showing. */
  private nullCueUntil = 0;
  private nullCueView: ResultView | null = null;
  // Recenter (see followRecenter / pressRecenter).
  private placementEpoch = 0;
  private recenterWasGliding = false;
  private lastRecenterPress = -Infinity;
  private recenterHovered = false;
  // The hold buttons: Exit, Show answer (see updateHolds).
  private exitHovered = false;
  /** How long the hold button `holdName` has been held (seconds; 0 when not). */
  private holdHeld = 0;
  private holdName = '';
  /**
   * A hold that just completed, still held: the same touch doesn't start
   * another (a fingertip left on Recenter re-triggered it every 0.6 s, 2026-10-11
   * log); cleared once nothing holds that button.
   */
  private holdSpent = '';
  /** The session is ending (Exit completed); nothing more until a new one. */
  private exitEnded = false;
  /** Dev log: how the hold button is being held. */
  private holdPath = '';
  /**
   * Per hand: its current pinch or trigger started on a hold button (with a
   * pinch motion, for a hand): only such a select can hold it (see updateHolds).
   */
  private readonly holdSelect = { left: new HoldSelect(), right: new HoldSelect() };
  /** Per hand: the hold button its current select started on ('' if none). */
  private readonly holdTarget = { left: '', right: '' };
  /** Per hand: its pinch motion (hand-pointer-math.ts), sampled every frame; NULL cells' takes a smaller opening. */
  private readonly pinchMotion = { left: new PinchMotion(), right: new PinchMotion() };
  /** NULL cells, Prev and Next (pinchOpenMetersFor): the smaller opening. */
  private readonly pinchMotionNull = { left: new PinchMotion(PINCH_OPEN_NULL_METERS), right: new PinchMotion(PINCH_OPEN_NULL_METERS) };
  /** Each hand's last pinch start: its target's kind (which opening it needed). */
  private readonly pinchStartKind: Record<(typeof HANDS)[number], PinchTargetKind> = { left: 'other', right: 'other' };
  /** Per hand: the last pressable target its pointer was on, and when (the target lock: PINCH_TARGET_LOCK_SECONDS). */
  private readonly recentTarget = { left: makeRayHit(), right: makeRayHit() };
  private readonly recentTargetAt = { left: -Infinity, right: -Infinity };
  /** Per hand: this frame's pinch took its target from the lock, this many seconds old (-1: its pointer was on it). */
  private readonly pinchTargetAge = { left: -1, right: -1 };
  /** Per hand: whether this frame's select start may press (a controller's trigger, or a hand's pinch motion). */
  private readonly pinchStartOk = { left: false, right: false };
  /** Dev log: the widest tip distance before this frame's pinch start (meters). */
  private readonly pinchStartWidest = { left: -1, right: -1 };
  /** Per hand: why this frame's pinch start may not press ('' if it may), and its tips' distance then (meters; -1 untracked). */
  private readonly pinchStartBlock: Record<(typeof HANDS)[number], PressBlock> = { left: '', right: '' };
  private readonly pinchStartGap = { left: -1, right: -1 };
  /** Per hand: the current pinch, confirmed as a clear pinch before it presses (PinchConfirm). */
  private readonly pinchConfirm = { left: new PinchConfirm(), right: new PinchConfirm() };
  /** Per hand: what the pointer was on at the pinch's start -- what the press goes to once it's confirmed. */
  private readonly pinchTarget = { left: makeRayHit(), right: makeRayHit() };
  /** Per hand: its pending pinch was confirmed this frame (updateSelect presses `pinchTarget`). */
  private readonly pinchConfirmed = { left: false, right: false };
  private readonly _motionThumb = new Vector3();
  private readonly _motionIndex = new Vector3();
  private holdRing!: Mesh<RingGeometry, MeshBasicMaterial>;
  /** Free play's one-button bar (Recenter), and it as a placed bar; null in challenge mode (the puzzle bar has it). */
  private freeBar: RecenterBarView | null = null;
  private freeBarPlaced: PlacedBar | null = null;
  private readonly recenterPoke = new ContactPoke();
  private readonly pokeOnFreeBar = (): boolean => this.freeBarDistance(this._pokeLocal) <= POKE_TARGET_TOLERANCE_METERS;

  private visualsRoot!: Group;
  private lines!: SegmentBatch;
  private pulses!: SegmentBatch;
  private hints!: SegmentBatch;
  private stationaryGlow!: EdgeGlow;
  private movingGlow!: EdgeGlow;
  private control!: JoinTypeControlView;
  private controlEntity!: Entity;
  private debug: JoinDebug | null = null;
  /** Which hand holds a slab (a hand holding one doesn't poke or pinch the side column). */
  private grabSystem: GrabSystem | undefined;

  // Scratch -- allocated once, never in update().
  private readonly _a = new Vector3();
  private readonly _b = new Vector3();
  private readonly _c = new Vector3();
  private readonly _d = new Vector3();
  private readonly _e = new Vector3();
  private readonly _f = new Vector3();
  private readonly _g = new Vector3();
  private readonly _pinchB = new Vector3();
  private readonly _up = new Vector3();
  private readonly _normal = new Vector3();
  private readonly _q1 = new Quaternion();
  private readonly _q2 = new Quaternion();
  private readonly _euler = new Euler();
  private readonly _color = new Color();
  private readonly _head = new Vector3();
  /** Where placeAboveBand put a slab's bottom edge, and its up axis. */
  private readonly _placedBottom = new Vector3();
  /** Band-arc scratch (arcWorld). */
  private readonly _arcPlace: ArcPlacement = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
  private readonly _arcLift = new Vector3();
  /** Where the eyes were when the band was placed: its arc is a level circle around them. */
  private readonly _bandEyes = new Vector3();
  /** The reach hint ("Move closer, or hold Recenter."): its logic, banner, and where the banner sits now. */
  private readonly reachHint = new ReachHint();
  private reachBanner!: ReachBanner;
  private reachClock = 0;
  private reachEpoch = -1;
  private reachBelowGaze = false;
  /** The banner's height in view as last placed (degrees; 0 below the gaze). */
  private reachBannerDeg = 0;
  private readonly _reachA = new Vector3();
  private readonly _reachB = new Vector3();
  private readonly _reachL = new Vector3();
  private readonly _reachR = new Vector3();
  private readonly _reachQ = new Quaternion();
  private readonly _arcQ = new Quaternion();
  private readonly _arcEuler = new Euler();
  /** The band's lean as last placed (radians; see placeBand). */
  private bandLean = 0;
  /** Band scratch (placeBand must leave `_c` and `_q1` alone). */
  private readonly _colA = new Vector3();
  private readonly _colB = new Vector3();
  private readonly _colFwd = new Vector3();
  private readonly _colRight = new Vector3();
  private readonly _colQ = new Quaternion();
  private readonly _placedUp = new Vector3();
  /** The result slab's placed bottom edge and up axis (followResultHeight keeps it there). */
  private readonly _resultBottom = new Vector3();
  private readonly _resultUp = new Vector3();
  private resultPlaced: ResultView | null = null;
  private resultPlacedHeight = -1;
  private headPitchDown = 0;
  private readonly _edges: SlabEdgeAngles = { topDeg: 0, bottomDeg: 0, fits: true };
  private readonly _prox = { side: 1, gap: 0, depth: 0, vertical: 0, angleDeg: 0 };

  init(): void {
    this.reachBanner = new ReachBanner(this.world);
    this.visualsRoot = new Group();
    this.visualsRoot.name = 'join-visuals';
    this.lines = new SegmentBatch(MAX_MATCH_LINES, COLOR_MATCH_LINE, LINE_THICKNESS_METERS, LINE_OPACITY);
    this.pulses = new SegmentBatch(MAX_MATCH_LINES, COLOR_LINE_PULSE, LINE_PULSE_THICKNESS_METERS, LINE_PULSE_OPACITY);
    this.hints = new SegmentBatch(PREVIEW_HINT_COUNT, COLOR_PREVIEW, 0.002, 0.45);
    this.stationaryGlow = new EdgeGlow(GLOW_WIDTH_METERS);
    this.movingGlow = new EdgeGlow(GLOW_WIDTH_METERS);
    this.winGlowLeft = new EdgeGlow(GLOW_WIDTH_METERS, COLOR_WIN_GLOW);
    this.winGlowRight = new EdgeGlow(GLOW_WIDTH_METERS, COLOR_WIN_GLOW);
    this.pointerLines = new SegmentBatch(HANDS.length, COLOR_POINTER, POINTER_THICKNESS_METERS, POINTER_OPACITY);
    this.pointerLines.setCount(HANDS.length);
    // Exit's hold ring: built whole once; its draw range shows how far it has filled.
    // Mirrored in x, so it fills clockwise from the top.
    this.holdRing = new Mesh(
      new RingGeometry(EXIT_RING_INNER_METERS, EXIT_RING_OUTER_METERS, EXIT_RING_SEGMENTS, 1, Math.PI / 2, Math.PI * 2),
      // Double-sided: the mirroring turns its faces around.
      new MeshBasicMaterial({ color: new Color(COLOR_EXIT_RING), transparent: true, depthWrite: false, side: DoubleSide }),
    );
    this.holdRing.scale.x = -1;
    this.holdRing.raycast = () => {};
    this.holdRing.frustumCulled = false;
    this.holdRing.renderOrder = 4;
    this.holdRing.visible = false;
    this.visualsRoot.add(this.holdRing);
    this.visualsRoot.add(
      this.lines.mesh,
      this.pulses.mesh,
      this.hints.mesh,
      this.stationaryGlow.mesh,
      this.movingGlow.mesh,
      this.winGlowLeft.mesh,
      this.winGlowRight.mesh,
      this.pointerLines.mesh,
      this.pointerDots.left.mesh,
      this.pointerDots.right.mesh,
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
    this.controlTargets = [
      { centerX: this.control.innerCenterX, width: this.control.optionWidthMeters },
      { centerX: this.control.leftCenterX, width: this.control.optionWidthMeters },
    ];
    this.controlEntity = this.world.createTransformEntity(this.control.document);

    // Free play: a bar with Recenter and Exit (challenge mode's puzzle bar has its own).
    if (!CHALLENGE_MODE) {
      const labelFontCm = slabTextSizeAt(PLANNED_CONTROL_DISTANCE_METERS).headerFontCm;
      const freeBar = buildRecenterBar(labelFontCm, BAR.recenter, BAR.exit, joinTypeControlSizeCm(labelFontCm));
      this.freeBar = freeBar;
      this.freeBarPlaced = {
        onArcLean: (leanRad) => setArcLean(freeBar, leanRad),
        object: freeBar.document,
        widthMeters: freeBar.widthMeters,
        heightMeters: freeBar.heightMeters,
        buttons: [
          { name: 'recenter', centerX: freeBar.recenterCenterX, centerY: freeBar.centerY, width: freeBar.buttonWidthMeters },
          { name: 'exit', centerX: freeBar.exitCenterX, centerY: freeBar.centerY, width: freeBar.buttonWidthMeters },
        ],
        buttonHeightMeters: freeBar.buttonHeightMeters,
        leadCenterYMeters: freeBar.leadCenterYMeters,
        holdButton: null,
      };
      const freeBarEntity = this.world.createTransformEntity(freeBar.document);
      freeBarEntity.addComponent(PokeInteractable, {});
      freeBarEntity.addComponent(RayInteractable, {});
      // Rays and controllers only: a fingertip presses through the contact poke.
      const onRecenter = (event: unknown) => {
        if (!isTouchPointerClick(event)) {
          this.pressRecenter('uikit-click');
        }
      };
      freeBar.recenter.container.addEventListener('click', onRecenter);
      this.cleanupFuncs.push(
        () => freeBar.recenter.container.removeEventListener('click', onRecenter),
        () => freeBarEntity.dispose(),
      );
    }
    this.debug = import.meta.env.DEV && devFlag('debug') ? new JoinDebug(this) : null;
    this.grabSystem = this.world.getSystem(GrabSystem);

    // Poke and ray select both arrive as UIKit clicks.
    // Rays (and controllers) only: a fingertip presses through the contact poke.
    const onInner = (event: unknown) => {
      if (!isTouchPointerClick(event)) {
        this.pressControl('inner', 'uikit-click');
      }
    };
    const onLeft = (event: unknown) => {
      if (!isTouchPointerClick(event)) {
        this.pressControl('left', 'uikit-click');
      }
    };
    this.control.inner.addEventListener('click', onInner);
    this.control.left.addEventListener('click', onLeft);
    if (import.meta.env.DEV && this.debug) {
      this.registerTouchSurfaces();
    }

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
          this.requestFrameRate();
        }
      }),
    );
    // The kept datasets (challenge mode: the current puzzle's and its neighbors'):
    // build their result slabs ahead, dispose the rest.
    this.cleanupFuncs.push(onKeptDatasets(() => this.trimResultViews()));

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
        this.pointerLines.dispose();
        this.pointerDots.left.dispose();
        this.pointerDots.right.dispose();
        this.grabOutlines.forEach((outline) => outline.dispose());
        this.grabShadows.forEach((shadow) => shadow.dispose());
        this.holdRing.geometry.dispose();
        this.holdRing.material.dispose();
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

    // Home poses (both modes): where each slab was before this puzzle (or
    // placement) first moved it. A pull-apart glides back there; so does Next.
    this.queries.held.subscribe('qualify', (entity) => {
      const source = this.sourceFor(entity);
      if (source) {
        this.captureHome(source);
        sounds.playPickUp(source.object.position);
      }
    });
    // A new session re-places the slabs: forget the old homes, re-lay out.
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe(() => {
        for (const home of this.homes.values()) {
          home.set = false;
        }
        this.homeAfterSeparate = false;
        // A new session: Exit can end it again.
        this.exitEnded = false;
        this.holdHeld = 0;
        this.holdSpent = '';
        this.holdSelect.left.reset();
        this.holdSelect.right.reset();
        this.pinchMotion.left.reset();
        this.pinchMotion.right.reset();
        this.pinchMotionNull.left.reset();
        this.pinchMotionNull.right.reset();
        this.layoutDirty = true;
      }),
    );
    if (import.meta.env.DEV) {
      touchProbe.tipGap = (hand) => (hand === 'left' || hand === 'right' ? this.pinchMotion[hand].latest : null);
      this.cleanupFuncs.push(() => {
        touchProbe.tipGap = null;
      });
    }
    if (CHALLENGE_MODE) {
      joinBridge.join = this;
      this.cleanupFuncs.push(() => {
        joinBridge.join = null;
      });
    }
  }

  update(delta: number): void {
    this.tweens.update(delta);
    this.dips.update(this.tweens.now);
    // Background builds (the next puzzles' outlines, tables and result slabs): only once
    // things have been still a moment, at most BUILD_BUDGET_MS a frame; nothing once all are built.
    const quiet = this.backgroundQuiet(delta);
    if (quiet && buildQueue.pending > 0) {
      buildQueue.run();
    }
    if (import.meta.env.DEV && this.debug) {
      this.noteFinishedBuilds();
    }
    this.updateDock(delta);
    this.updateGlides(delta);
    sounds.update();
    this.unlockSoundOnPinch();
    this.samplePinchMotion();
    this.followRecenter();
    this.followResultHeight();
    this.updateHomeAfterSeparate();
    if (this.challengeLayout) {
      this.updateChallengeLayout();
      this.updateWinGlow();
    } else if (this.freeBar) {
      this.updateFreeBarLayout();
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

    this.updateGrabFeedback();
    this.updatePreviewVisuals();
    this.updateLines();
    this.updateHandPointers(delta);
    this.updateSelect();
    this.updateControlPoke();
    if (this.challengeLayout) {
      this.updateNullPokeAndHover();
      this.updateSourceNullPoke();
    } else {
      this.updateFreeBarPoke();
    }
    this.updateHolds(delta);
    this.updateReach(delta);
    this.updateRecenterHover();
  }

  // --- Recenter --------------------------------------------------------------------------

  /**
   * Follows a recenter (desk placement glides the slabs back in front of the
   * player): forgets the slabs' home poses once per re-placement, and while
   * joined re-places the band, result and card with the gliding pair,
   * against the head pose read now. Once more when the glide ends.
   */
  private followRecenter(): void {
    const desk = deskBridge.desk;
    if (!desk) {
      return;
    }
    if (desk.placementEpoch !== this.placementEpoch) {
      this.placementEpoch = desk.placementEpoch;
      // The recenter's side-by-side poses are the new homes -- also when the
      // pair glided joined, so a later pull-apart glides there.
      for (const [id, home] of this.homes) {
        home.set = desk.recenterHome(id, home.pos, home.quat);
      }
      if (import.meta.env.DEV && this.debug) {
        const ids = [...this.homes].map(([id, home]) => `${id} ${home.set ? 'set' : 'not placed'}`);
        this.debug.note(`recenter: new home poses (${ids.join(', ')})`);
      }
      this.layoutDirty = true;
    }
    const gliding = desk.recenterGliding;
    const view = this.active;
    if ((gliding || this.recenterWasGliding) && view && this.state.phase === 'joined') {
      const left = this.sources.get(view.leftId);
      const right = this.sources.get(view.rightId);
      if (left && right) {
        this.readHead();
        this.placeResult(view, left, right);
      }
    }
    this.recenterWasGliding = gliding;
  }

  /** Free play's Recenter button pressed (poke, ray, click): it acts only when held (updateHolds), so nothing. */
  private pressRecenter(path: PressPath): void {
    if (import.meta.env.DEV && this.debug) {
      this.debug.note(`Recenter pressed (${path}): it acts only when held ${RECENTER_HOLD_SECONDS} s`);
    }
  }

  /** Recenter, held its full time (free play): the group comes back in front of you (after its countdown). */
  private recenterNow(path: string): void {
    if (this.tweens.now - this.lastRecenterPress < CONTROL_PRESS_DEBOUNCE_SECONDS) {
      return;
    }
    this.lastRecenterPress = this.tweens.now;
    if (import.meta.env.DEV && this.debug) {
      this.debug.note(`Recenter (${path})`);
    }
    const bar = this.freeBar;
    if (bar) {
      bar.document.updateWorldMatrix(true, false);
      this._a.setFromMatrixPosition(bar.document.matrixWorld);
      sounds.playClick(this._a);
    }
    deskBridge.desk?.requestRecenter(bar ? this._a : undefined);
  }

  /** Free play: the one-button bar above the pair before a join (beside the control once joined). */
  private updateFreeBarLayout(): void {
    const bar = this.freeBarPlaced;
    if (!bar || !deskReady() || this.state.phase !== 'idle' || this.queries.held.entities.size > 0 || this.dock.active) {
      return;
    }
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
    this.readHead();
    // The column where it will be beside the result (the control joins it once joined).
    this.planGroup(a, b, false, 0);
    this.placeColumn(false);
    if (import.meta.env.DEV && this.debug) {
      this.noteBand(a, b, false, null);
    }
  }

  /** Free play: contact pokes on the Recenter button (the bar's only target). */
  private updateFreeBarPoke(): void {
    const bar = this.freeBarPlaced;
    if (!bar || !bar.object.visible) {
      return;
    }
    bar.object.updateWorldMatrix(true, false);
    for (const hand of HANDS) {
      const source = this.input.xr.getPrimaryInputSource(hand);
      if (!source?.hand || this.handHoldsSlab(hand) || !readJointsPoint(this.world, this.player, source, INDEX_TIP, this._pokeTip)) {
        this.recenterPoke.reset(hand);
        continue;
      }
      this._pokeSource = source;
      this._pokeLocal.copy(this._pokeTip);
      bar.object.worldToLocal(this._pokeLocal);
      unrollArc(this._pokeLocal, BAND_ARC_RADIUS_METERS, this.bandLean);
      if (this.recenterPoke.update(hand, this._pokeLocal, this.pokeOnFreeBar, this.pokeStraightness) === 'press') {
        this.pressRecenter('poke');
      }
      this.notePokeMiss(hand, 'the Recenter bar', this.recenterPoke);
    }
  }

  /** In-plane distance from `local` (the bar's frame) to the free bar's Recenter button (`index` 1: its Exit button). */
  private freeBarDistance(local: Vector3, index = 0): number {
    const bar = this.freeBarPlaced;
    if (!bar) {
      return Infinity;
    }
    return buttonDistance(local, bar.buttons[index], bar.buttonHeightMeters);
  }

  /**
   * The Recenter and Exit buttons' hover labels: shown while a fingertip is
   * just in front of the button, or a hand's pointer is on it (Exit's also
   * while it's held); the puzzle bar's buttons in challenge mode, free
   * play's bar otherwise. Writes only on a change.
   */
  private updateRecenterHover(): void {
    // Exit just ended the session: its frame is gone (no joint reads).
    if (this.exitEnded) {
      return;
    }
    const recenter = this.iconHovered('recenter');
    if (recenter !== this.recenterHovered) {
      this.recenterHovered = recenter;
      if (this.freeBar) {
        setRecenterHover(this.freeBar.recenter, recenter);
      } else {
        this.challengeLayout?.bar.onRecenterHover?.(recenter);
      }
    }
    const exit = (this.holdHeld > 0 && this.holdName === 'exit') || this.iconHovered('exit');
    if (exit !== this.exitHovered) {
      this.exitHovered = exit;
      if (this.freeBar) {
        setRecenterHover(this.freeBar.exit, exit);
      } else {
        this.challengeLayout?.bar.onExitHover?.(exit);
      }
    }
  }

  /** Whether a fingertip is just in front of the bar's `name` button, or a hand pointer is on it. */
  private iconHovered(name: 'recenter' | 'exit'): boolean {
    const bar = this.challengeLayout?.bar ?? this.freeBarPlaced;
    if (!bar || !bar.object.visible) {
      return false;
    }
    let button: ButtonRect | null = null;
    for (const candidate of bar.buttons) {
      if (candidate.name === name) {
        button = candidate;
      }
    }
    if (!button) {
      return false;
    }
    bar.object.updateWorldMatrix(true, false);
    for (const hand of HANDS) {
      const source = this.input.xr.getPrimaryInputSource(hand);
      if (source?.hand && readJointsPoint(this.world, this.player, source, INDEX_TIP, this._pokeTip)) {
        this._rayLocal.copy(this._pokeTip);
        bar.object.worldToLocal(this._rayLocal);
        unrollArc(this._rayLocal, BAND_ARC_RADIUS_METERS, this.bandLean);
        if (
          this._rayLocal.z >= -CONTACT_HOVER_BEHIND_METERS &&
          this._rayLocal.z <= POKE_HOVER_DEPTH_METERS &&
          onButton(this._rayLocal, button, bar.buttonHeightMeters)
        ) {
          return true;
        }
      }
      // Or the hand pointer on it.
      const pointer = this.pointers[hand];
      if (
        pointer.active &&
        (pointer.hit.target === name || (pointer.hit.target === 'bar' && bar.buttons[pointer.barIndex]?.name === name))
      ) {
        return true;
      }
    }
    return false;
  }

  // --- The reach hint ---------------------------------------------------------------------

  /**
   * "Move closer, or hold Recenter." (reach-hint.ts): REACH_CHECK_HZ times a
   * second, the nearest column button's distance from the nearer shoulder
   * (each assumed 0.18 m to the side of and 0.25 m below the eyes, along the
   * head's yaw) and the nearer source slab's from the eyes. Paused while a
   * slab is held, the desk switches tables, or a Recenter runs (which hides
   * it). The banner fades every frame; below the gaze it follows the head.
   */
  private updateReach(delta: number): void {
    this.reachBanner.update(delta);
    if (this.reachBanner.shown && this.reachBelowGaze) {
      this.reachBanner.placeBelowGaze(this.player.head);
    }
    this.reachClock += delta;
    if (this.reachClock < 1 / REACH_CHECK_HZ) {
      return;
    }
    const dt = this.reachClock;
    this.reachClock = 0;
    const desk = deskBridge.desk;
    const epoch = desk?.placementEpoch ?? 0;
    const recentering = !!desk && (desk.recenterGliding || desk.recenterCountdownActive || epoch !== this.reachEpoch);
    this.reachEpoch = epoch;
    if (this.world.visibilityState.peek() === VisibilityState.NonImmersive || recentering) {
      if (this.reachHint.reset() === 'hide') {
        this.reachBanner.hide();
        if (import.meta.env.DEV && this.debug) {
          this.debug.note(`reach hint hidden: ${recentering ? 'Recenter' : 'the session ended'}`);
        }
      }
      return;
    }
    if (!deskReady() || this.queries.held.entities.size > 0) {
      return;
    }
    const control = this.reachControlMeters();
    const slab = this.reachSlabMeters();
    const step = this.reachHint.step(dt, control, slab);
    if (step === 'show') {
      this.reachBanner.show();
      const placement = this.placeReachBanner();
      if (import.meta.env.DEV && this.debug) {
        this.debug.note(
          `reach hint shown: nearest control ${control.toFixed(2)} m from the nearer shoulder (limit ` +
            `${REACH_HINT_CONTROL_METERS} m), nearer slab ${slab.toFixed(2)} m from the eyes (limit ${REACH_HINT_SLAB_METERS} m); ${placement}`,
        );
      }
    } else if (step === 'hide') {
      this.reachBanner.hide();
      if (import.meta.env.DEV && this.debug) {
        this.debug.note(
          `reach hint hidden: back within reach (control ${control.toFixed(2)} m, slab ${slab.toFixed(2)} m)`,
        );
      }
    } else if (this.reachHint.shown && !this.reachBelowGaze) {
      // The player keeps moving: the banner refits the gap as they do (logged when it changes visibly).
      const before = this.reachBannerDeg;
      const placement = this.placeReachBanner();
      if (import.meta.env.DEV && this.debug && (this.reachBelowGaze || Math.abs(this.reachBannerDeg - before) >= 0.3)) {
        this.debug.note(`reach banner refit (control ${control.toFixed(2)} m, slab ${slab.toFixed(2)} m): ${placement}`);
      }
    }
  }

  /** The nearest column button's distance from the nearer shoulder (meters; Infinity without a column). */
  private reachControlMeters(): number {
    const bar = this.challengeLayout?.bar ?? this.freeBarPlaced;
    if (!bar || !bar.object.visible) {
      return Infinity;
    }
    const head = this.player.head;
    head.updateWorldMatrix(true, false);
    head.getWorldPosition(this._reachA);
    head.getWorldQuaternion(this._reachQ);
    this._euler.setFromQuaternion(this._reachQ, 'YXZ');
    this._reachB.set(1, 0, 0).applyAxisAngle(UP, this._euler.y);
    this._reachL.copy(this._reachA).addScaledVector(this._reachB, -REACH_SHOULDER_SIDE_METERS).addScaledVector(UP, -REACH_SHOULDER_DROP_METERS);
    this._reachR.copy(this._reachA).addScaledVector(this._reachB, REACH_SHOULDER_SIDE_METERS).addScaledVector(UP, -REACH_SHOULDER_DROP_METERS);
    let nearest = Infinity;
    for (const button of bar.buttons) {
      this.arcWorld(bar.object, button.centerX, button.centerY, 0, this._reachB);
      nearest = Math.min(nearest, this._reachB.distanceTo(this._reachL), this._reachB.distanceTo(this._reachR));
    }
    return nearest;
  }

  /** The nearer source slab's center distance from the eyes (meters; Infinity without slabs). */
  private reachSlabMeters(): number {
    this.player.head.getWorldPosition(this._reachA);
    let nearest = Infinity;
    for (const slab of this.sources.values()) {
      slab.object.getWorldPosition(this._reachB);
      nearest = Math.min(nearest, this._reachB.distanceTo(this._reachA));
    }
    return nearest;
  }

  /** A world point's elevation from the eyes at `_reachA` (degrees, + up). */
  private elevationDeg(point: Vector3): number {
    const dx = point.x - this._reachA.x;
    const dz = point.z - this._reachA.z;
    return MathUtils.radToDeg(Math.atan2(point.y - this._reachA.y, Math.hypot(dx, dz)));
  }

  /**
   * Places the banner in the row-free band between the source slabs' rows
   * and the result's (or the target outline's): from the higher slab's
   * header row top (its name tab and top padding may be covered) up to the
   * result's lowest row bottom (its bottom padding may be covered), centered
   * on the group, behind the slabs' top edges (REACH_BANNER_BEHIND_SLABS_METERS,
   * so a hand reaching for a slab never meets it) and in front of the result,
   * as tall as the band (at most REACH_BANNER_MAX_DEG). Too small a band
   * (under REACH_BANNER_MIN_DEG): semi-transparent below the gaze instead.
   * Returns a dev note on where it went.
   */
  private placeReachBanner(): string {
    const head = this.player.head;
    head.updateWorldMatrix(true, false);
    head.getWorldPosition(this._reachA);
    let lower = -Infinity;
    let slabTopDistance = 0;
    let pairTop = -Infinity;
    for (const slab of this.sources.values()) {
      const doc = slab.doc;
      slab.object.updateWorldMatrix(true, false);
      const headerRow = doc.headerFontMeters * LINE_HEIGHT + (doc.rowHeightMeters - doc.rowFontMeters * LINE_HEIGHT);
      const rowsTop = slabTopLocalY(doc) - (doc.firstRowTopMeters - headerRow);
      for (const sx of [-0.5, 0.5]) {
        slab.object.localToWorld(this._reachB.set(sx * doc.widthMeters, rowsTop, 0));
        lower = Math.max(lower, this.elevationDeg(this._reachB));
        slab.object.localToWorld(this._reachB.set(sx * doc.widthMeters, slabVisualTopLocalY(doc), 0));
        pairTop = Math.max(pairTop, this.elevationDeg(this._reachB));
        slabTopDistance = Math.max(slabTopDistance, this._reachB.distanceTo(this._reachA));
      }
    }
    // Above: the result's lowest row bottom, or the outline's bottom before the join.
    let upper = Infinity;
    let resultBottom = Infinity;
    let resultDistance = Infinity;
    const view = this.active && this.state.phase === 'joined' ? this.active : null;
    const slot = view ? null : this.silhouette;
    const above = view ? view.object : slot?.object ?? null;
    if (above) {
      const width = view ? view.doc.widthMeters : (slot?.widthMeters ?? 0);
      const bottom = view ? -shownHeightMeters(view.doc) : -(slot?.heightMeters ?? 0);
      const pad = view ? view.doc.heightForRowsMeters(0) - view.doc.firstRowTopMeters : 0;
      above.updateWorldMatrix(true, false);
      for (const sx of [-0.5, 0.5]) {
        above.localToWorld(this._reachB.set(sx * width, bottom + pad, 0));
        upper = Math.min(upper, this.elevationDeg(this._reachB));
        above.localToWorld(this._reachB.set(sx * width, bottom, 0));
        resultBottom = Math.min(resultBottom, this.elevationDeg(this._reachB));
      }
      above.localToWorld(this._reachB.set(0, bottom, 0));
      resultDistance = this._reachB.distanceTo(this._reachA);
    }
    const band = upper - lower;
    const gap = resultBottom - pairTop;
    if (!Number.isFinite(band) || band < REACH_BANNER_MIN_DEG) {
      this.reachBelowGaze = true;
      this.reachBannerDeg = 0;
      this.reachBanner.placeBelowGaze(head);
      if (!import.meta.env.DEV) {
        return '';
      }
      return (
        `banner below the gaze, semi-transparent: the row-free band is ${Number.isFinite(band) ? band.toFixed(1) + '°' : 'missing'} ` +
        `(needs ${REACH_BANNER_MIN_DEG}°; the bare gap ${Number.isFinite(gap) ? gap.toFixed(1) + '°' : '-'}); ${this.bannerReachText()}`
      );
    }
    this.reachBelowGaze = false;
    const heightDeg = Math.min(band, REACH_BANNER_MAX_DEG);
    this.reachBannerDeg = heightDeg;
    const centerDeg = (upper + lower) / 2;
    const distance = Math.min(
      slabTopDistance + REACH_BANNER_BEHIND_SLABS_METERS,
      resultDistance - REACH_BANNER_RESULT_GAP_METERS,
    );
    // Centered on the group: straight ahead along the pair's forward, at the band's middle.
    const elevation = MathUtils.degToRad(centerDeg);
    this._reachB.copy(this._colFwd).multiplyScalar(Math.cos(elevation)).addScaledVector(UP, Math.sin(elevation));
    this._reachL.copy(this._reachA).addScaledVector(this._reachB, distance);
    const scale = (2 * distance * Math.tan(MathUtils.degToRad(heightDeg) / 2)) / this.reachBanner.heightMeters;
    // Facing the eyes, level.
    this.reachBanner.document.position.copy(this._reachL);
    this.reachBanner.document.lookAt(this._reachA);
    this._reachQ.copy(this.reachBanner.document.quaternion);
    this.reachBanner.placeInGap(this._reachL, this._reachQ, scale);
    if (!import.meta.env.DEV) {
      return '';
    }
    const widthDeg = MathUtils.radToDeg(2 * Math.atan((this.reachBanner.widthMeters * scale) / 2 / distance));
    const textDeg = MathUtils.radToDeg(2 * Math.atan((this.reachBanner.fontMeters * scale) / 2 / distance));
    return (
      `banner in the gap: the bare gap (slab tops to the result's bottom) ${gap.toFixed(1)}°, the row-free band ` +
      `${band.toFixed(1)}° (${lower.toFixed(1)}° to ${upper.toFixed(1)}° from level); banner ${heightDeg.toFixed(1)}° x ` +
      `${widthDeg.toFixed(1)}°, text ${textDeg.toFixed(2)}°, ${distance.toFixed(2)} m from the eyes; ${this.bannerReachText()}`
    );
  }

  // --- Holds: Exit (ends the session) and Show answer -----------------------------------

  /** How long `name` must be held, or 0 if it isn't a hold button now (Exit always; challenge mode's `holdButton`). */
  private holdSeconds(bar: PlacedBar, name: string): number {
    if (name === 'exit') {
      return EXIT_HOLD_SECONDS;
    }
    if (name === 'recenter') {
      return RECENTER_HOLD_SECONDS;
    }
    return bar.holdButton?.name === name ? bar.holdButton.seconds : 0;
  }

  /**
   * The hold buttons -- Exit, and (challenge mode) the bar's `holdButton`,
   * Show answer before the answer -- act only when held, with a ring filling
   * on the button; letting go, or moving off it, resets it to zero. Held
   * means: a fingertip pressed onto it (in contact, from the front), or one
   * continuous pinch through the hand pointer (a pinch motion) or trigger
   * that started on it (see handHolds). Hover alone, or a select already
   * held when the pointer arrived, never moves the ring. A press alone does
   * nothing (a released hold tells challenge mode, which says to hold).
   */
  private updateHolds(delta: number): void {
    const bar = this.challengeLayout?.bar ?? this.freeBarPlaced;
    const live = !!bar && bar.object.visible && !this.exitEnded;
    let name = '';
    let button: BarButtonRect | null = null;
    for (const hand of HANDS) {
      const held = live && bar ? this.handHolds(hand, bar) : null;
      if (held && !button) {
        name = held.name;
        button = held;
      }
    }
    // One hold per touch: still on the button that just completed, nothing starts.
    if (this.holdSpent) {
      if (button && name === this.holdSpent) {
        return;
      }
      if (import.meta.env.DEV && this.debug) {
        this.debug.note(`${this.holdSpent} let go after its hold: it can be held again`);
      }
      this.holdSpent = '';
    }
    if (!bar || !button || name !== this.holdName) {
      if (this.holdHeld > 0) {
        if (import.meta.env.DEV && this.debug) {
          this.debug.note(`${this.holdName} hold cancelled after ${this.holdHeld.toFixed(2)} s`);
        }
        if (this.holdName !== 'exit' && this.challengeLayout) {
          joinBridge.challenge?.onHoldCancelled(this.holdName);
        }
      }
      this.holdHeld = 0;
      this.holdName = name;
      this.holdRing.visible = false;
      if (!bar || !button) {
        return;
      }
    }
    const seconds = this.holdSeconds(bar, name);
    if (this.holdHeld === 0 && import.meta.env.DEV && this.debug) {
      this.debug.note(`${name} hold started (${this.holdPath}; needs ${seconds} s)`);
    }
    this.holdHeld += delta;
    const progress = Math.min(1, this.holdHeld / seconds);
    // The ring: on the button (an icon: around it; a label: at its right end),
    // just in front of the bar, filling clockwise from the top.
    const label = button.width > HOLD_RING_ICON_MAX_WIDTH_METERS;
    const ringX = label ? button.centerX + button.width / 2 - HOLD_RING_END_INSET_METERS : button.centerX;
    const scale = label ? HOLD_RING_LABEL_SCALE : 1;
    // Mirrored in x, so it fills clockwise from the top.
    this.holdRing.scale.set(-scale, scale, scale);
    this.arcWorld(bar.object, ringX, button.centerY ?? 0, EXIT_RING_LIFT_METERS, this._a, this.holdRing.quaternion);
    this.holdRing.position.copy(this._a);
    this.holdRing.geometry.setDrawRange(0, 6 * Math.max(1, Math.ceil(EXIT_RING_SEGMENTS * progress)));
    this.holdRing.visible = true;
    if (progress < 1) {
      return;
    }
    this.holdRing.visible = false;
    this.holdHeld = 0;
    this.holdSpent = name;
    // Done: every hand's select must start again to hold anything.
    for (const hand of HANDS) {
      this.holdSelect[hand].reset();
    }
    if (import.meta.env.DEV && this.debug) {
      this.debug.note(`${name} held ${seconds} s (${this.holdPath})${name === 'exit' ? ': ending the XR session' : ''}`);
    }
    if (name === 'exit') {
      this.exitEnded = true;
      sounds.playClick(this._a);
      void this.xrManager.getSession()?.end();
    } else if (name === 'recenter' && !this.challengeLayout) {
      this.recenterNow('hold');
    } else {
      joinBridge.challenge?.onHoldComplete(name);
    }
  }

  /**
   * The hold button `hand` holds this frame, or null (see updateHolds); sets
   * `holdPath`. A fingertip pressed onto it; or one continuous pinch or
   * trigger that started on it (a hand's as a pinch motion) and is still on
   * it. Any end of that select -- even a one-frame flicker -- or moving off
   * the button ends it for good: a select already held when the pointer
   * arrives never holds it.
   */
  private handHolds(hand: (typeof HANDS)[number], bar: PlacedBar): BarButtonRect | null {
    const source = this.input.xr.getPrimaryInputSource(hand);
    const hold = this.holdSelect[hand];
    // A hand holding a slab never holds a button (its pinch is the grab).
    if (!source || this.handHoldsSlab(hand)) {
      hold.reset();
      return null;
    }
    bar.object.updateWorldMatrix(true, false);
    const gamepad = this.input.xr.gamepads[hand];
    const selecting = !!gamepad?.getSelecting();
    const selectStart = !!gamepad?.getSelectStart();
    let on: BarButtonRect | null = null;
    if (hold.needsOnTarget(selecting, selectStart)) {
      // A hand's pinch starts on its locked target (what its pointer showed at the start, or just before).
      on = this.selectOn(hand, source, bar, selectStart && !!source.hand ? this.pinchTarget[hand] : null);
      if (selectStart) {
        this.holdTarget[hand] = on?.name ?? '';
      } else if (on && on.name !== this.holdTarget[hand]) {
        on = null;
      }
    }
    if (hold.step(selecting, selectStart, this.pinchStartOk[hand], on !== null)) {
      return on;
    }
    return source.hand ? this.fingertipOn(source, bar) : null;
  }

  /** The hold button a fingertip is pressed onto: from just in front of its face to a little behind. */
  private fingertipOn(source: XRInputSource, bar: PlacedBar): BarButtonRect | null {
    if (!readJointsPoint(this.world, this.player, source, INDEX_TIP, this._pokeTip)) {
      return null;
    }
    this._pokeLocal.copy(this._pokeTip);
    bar.object.worldToLocal(this._pokeLocal);
    unrollArc(this._pokeLocal, BAND_ARC_RADIUS_METERS, this.bandLean);
    if (this._pokeLocal.z > EXIT_TOUCH_FRONT_METERS || this._pokeLocal.z < -BUTTON_PINCH_BACK_DEPTH_METERS) {
      return null;
    }
    for (const button of bar.buttons) {
      if (this.holdSeconds(bar, button.name) > 0 && onButton(this._pokeLocal, button, bar.buttonHeightMeters)) {
        if (import.meta.env.DEV) {
          this.holdPath = 'fingertip';
        }
        return button;
      }
    }
    return null;
  }

  /** The hold button `hand`'s select is on now: its pointer (a hand), or its ray (a controller); or null. */
  private selectOn(
    hand: (typeof HANDS)[number],
    source: XRInputSource,
    bar: PlacedBar,
    locked: RayHit | null,
  ): BarButtonRect | null {
    let hit: RayHit | null = null;
    if (source.hand) {
      // A pinch through the hand pointer (a pinch right at a button does nothing: only a fingertip presses there).
      const pointer = this.pointers[hand];
      hit = locked ?? (pointer.active ? pointer.hit : null);
    } else if (this.readRay(hand)) {
      // A controller: its ray on it.
      this.castRay(false, HAND_POINTER_MAX_METERS);
      hit = this._rayHit;
    }
    // Free play's bar targets are 'recenter' / 'exit'; the puzzle bar's, its buttons.
    const button: BarButtonRect | undefined = !hit
      ? undefined
      : hit.target === 'exit' || hit.target === 'recenter'
        ? bar.buttons.find((candidate) => candidate.name === hit.target)
        : hit.target === 'bar'
          ? bar.buttons[this.barButtonIndexAt(hit.point)]
          : undefined;
    if (!button || this.holdSeconds(bar, button.name) === 0) {
      return null;
    }
    if (import.meta.env.DEV) {
      this.holdPath = `${hand} ${source.hand ? 'pointer pinch' : 'controller trigger'}`;
    }
    return button;
  }

  /**
   * Challenge mode: fingertip pokes on the result's NULL cells, tested
   * against the slab's own geometry (by the same rules as the buttons,
   * `contact-poke.ts`), and their hover look: a fingertip just in front of a
   * NULL cell, or a hand's or controller's ray on it, draws its outline
   * stronger. (Ray selects: `updateSelect`.) A pinch or ray on the same
   * press may also land; the activation debounce makes it count once.
   */
  private updateNullPokeAndHover(): void {
    const view = this.active;
    const live = !!view && this.state.phase === 'joined' && view.doc.fade.peek() >= 0.5;
    this.updateNullCue();
    if (!view || !live) {
      this.nullPoke.reset('left');
      this.nullPoke.reset('right');
      this.setNullHover(null, -1, -1);
      return;
    }
    view.object.updateWorldMatrix(true, false);
    let hoverRow = -1;
    let hoverColumn = -1;
    for (const hand of HANDS) {
      // Poke.
      const source = this.input.xr.getPrimaryInputSource(hand);
      if (!source?.hand || !readJointsPoint(this.world, this.player, source, INDEX_TIP, this._pokeTip)) {
        this.nullPoke.reset(hand);
      } else {
        this._pokeSource = source;
        this._a.copy(this._pokeTip);
        view.object.worldToLocal(this._a);
        const verdict = this.nullPoke.update(hand, this._a, this.pokeOnNullCell, this.pokeStraightness);
        if (verdict === 'press') {
          if (import.meta.env.DEV && this.debug) {
            this.debug.note(`${hand} fingertip poke on the NULL cell at row ${this._nullHit.row}, column ${this._nullHit.column}`);
          }
          this.activateNullCell(view.key, this._nullHit.row, this._nullHit.column, 'poke');
        } else if (verdict !== 'none' && import.meta.env.DEV && this.debug) {
          this.notePokeRejected(hand, 'a NULL cell', verdict, this.nullPoke);
        }
        this.notePokeMiss(hand, 'the result', this.nullPoke);
        // Hover: the fingertip just in front of a NULL cell.
        if (
          hoverRow < 0 &&
          this._a.z >= -CONTACT_HOVER_BEHIND_METERS &&
          this._a.z <= POKE_HOVER_DEPTH_METERS &&
          this.nearestNullCell(view, this._pokeTip) &&
          this._nullHit.distance <= POKE_TARGET_TOLERANCE_METERS
        ) {
          hoverRow = this._nullHit.row;
          hoverColumn = this._nullHit.column;
        }
      }
      // Hover: the hand pointer on a NULL cell.
      const pointer = this.pointers[hand];
      if (hoverRow < 0 && pointer.active && pointer.hit.target === 'null') {
        hoverRow = pointer.hit.row;
        hoverColumn = pointer.hit.column;
      }
    }
    this.setNullHover(view, hoverRow, hoverColumn);
  }

  /** Draws one result NULL cell hovered (none: row -1), restoring the last one; only on a change. */
  private setNullHover(view: ResultView | null, row: number, column: number): void {
    if (view === this.hoverView && row === this.hoverRow && column === this.hoverColumn) {
      return;
    }
    // The first-time cue owns every outline while it shows.
    const cueing = this.nullCueUntil > 0;
    if (this.hoverView && this.hoverRow >= 0 && !cueing) {
      setNullCellHover(this.hoverView.doc, this.hoverRow, this.hoverColumn, false);
    }
    this.hoverView = row >= 0 ? view : null;
    this.hoverRow = row;
    this.hoverColumn = column;
    if (view && row >= 0 && !cueing) {
      setNullCellHover(view.doc, row, column, true);
    }
  }

  /** Ends the first-time cue once its time is up: every outline back to rest (the hovered one stays). */
  private updateNullCue(): void {
    const view = this.nullCueView;
    if (this.nullCueUntil === 0 || this.tweens.now < this.nullCueUntil) {
      return;
    }
    this.nullCueUntil = 0;
    this.nullCueView = null;
    if (view) {
      this.resetNullLooks(view);
      if (this.hoverView === view && this.hoverRow >= 0) {
        setNullCellHover(view.doc, this.hoverRow, this.hoverColumn, true);
      }
    }
  }

  /** Every NULL outline of `view` at rest. */
  private resetNullLooks(view: ResultView): void {
    view.nullColumns.forEach((columns, row) => {
      for (const column of columns) {
        setNullCellHover(view.doc, row, column, false);
      }
    });
  }

  /**
   * Challenge mode, joined: a fingertip poke on a NULL in a source table
   * (the NULL that's closest, and tempting, but doesn't filter): the card
   * says to poke the result's instead. Not on a held slab. No click.
   */
  private updateSourceNullPoke(): void {
    const joined = this.state.phase === 'joined';
    for (const hand of HANDS) {
      const source = joined ? this.input.xr.getPrimaryInputSource(hand) : undefined;
      let tracked = false;
      if (source?.hand) {
        tracked = readJointsPoint(this.world, this.player, source, INDEX_TIP, this._pokeTip);
        this._pokeSource = source;
      }
      for (const slab of this.sources.values()) {
        if (!tracked || slab.nullCells.length === 0 || slab.entity.hasComponent(Grabbed)) {
          slab.nullPoke.reset(hand);
          continue;
        }
        this._pokeSlab = slab;
        slab.object.updateWorldMatrix(true, false);
        this._a.copy(this._pokeTip);
        slab.object.worldToLocal(this._a);
        if (slab.nullPoke.update(hand, this._a, this.pokeOnSourceNull, this.pokeStraightness) === 'press') {
          this.wrongNull(slab, hand, 'poke');
        }
      }
    }
  }

  /** A NULL in a source table was poked or pinched: logged, and the card says where to poke. */
  private wrongNull(slab: SourceSlab, hand: string, path: PressPath): void {
    if (import.meta.env.DEV && this.debug) {
      this.debug.note(`${hand} ${path} on a NULL in the ${slab.id} source table: not a filter (the card points to the result)`);
    }
    joinBridge.challenge?.onWrongNull(slab.id, path);
  }

  /**
   * Contact pokes on the INNER | LEFT control's options, by the same rules
   * as the NULL cells (`contact-poke.ts`); the UIKit click stays as a second
   * path (`pressControl` counts a press once).
   */
  private updateControlPoke(): void {
    const control = this.control;
    if (this.state.phase !== 'joined' || !control.document.visible || control.fade.peek() < 0.5) {
      this.controlPoke.reset('left');
      this.controlPoke.reset('right');
      this.controlFingerOption = null;
      return;
    }
    control.document.updateWorldMatrix(true, false);
    let fingerOption: JoinType | null = null;
    for (const hand of HANDS) {
      const source = this.input.xr.getPrimaryInputSource(hand);
      // A hand holding a slab doesn't poke the side column (the arm passes it on the way to the right slab).
      if (!source?.hand || this.handHoldsSlab(hand) || !readJointsPoint(this.world, this.player, source, INDEX_TIP, this._pokeTip)) {
        this.controlPoke.reset(hand);
        continue;
      }
      this._pokeSource = source;
      this._pokeLocal.copy(this._pokeTip);
      control.document.worldToLocal(this._pokeLocal);
      const verdict = this.controlPoke.update(hand, this._pokeLocal, this.pokeOnControl, this.pokeStraightness);
      if (verdict === 'press') {
        this.pressControl(this.pokedOption, 'poke');
      } else if (verdict !== 'none' && import.meta.env.DEV && this.debug) {
        this.notePokeRejected(hand, `the ${this.pokedOption.toUpperCase()} option`, verdict, this.controlPoke);
      }
      this.notePokeMiss(hand, 'the INNER | LEFT control', this.controlPoke);
      // Hover: the fingertip just in front of an option (the hand pointer's outline).
      if (
        !fingerOption &&
        this._pokeLocal.z <= POKE_HOVER_DEPTH_METERS &&
        this._pokeLocal.z >= -CONTACT_DEPTH_METERS &&
        this.pokeOnControl()
      ) {
        fingerOption = this.pokedOption;
      }
    }
    this.controlFingerOption = fingerOption;
  }

  /** The option a control poke landed on (set by `pokeOnControl`). */
  private pokedOption: JoinType = 'inner';

  /**
   * One press on the control from any path (UIKit click, pinch, contact
   * poke): a poke and its UIKit click on the same touch count once.
   */
  private pressControl(joinType: JoinType, path: PressPath): void {
    if (this.tweens.now - this.lastControlPress < CONTROL_PRESS_DEBOUNCE_SECONDS) {
      return;
    }
    this.lastControlPress = this.tweens.now;
    if (import.meta.env.DEV && this.debug) {
      touchProbe.pressed(joinType.toUpperCase(), path);
    }
    this.requestJoinType(joinType);
  }

  /** Seconds nothing has moved (backgroundQuiet). */
  private quietFor = 0;

  /**
   * Whether background builds may run this frame: no slab held, docking or
   * gliding, no join animation, no switch or recenter, the card and outline
   * not fading -- for BACKGROUND_QUIET_SECONDS in a row.
   */
  private backgroundQuiet(delta: number): boolean {
    const desk = deskBridge.desk;
    const still =
      this.queries.held.entities.size === 0 &&
      !this.dock.active &&
      !this.gliding() &&
      !this.tweens.busy &&
      (this.state.phase === 'idle' || this.state.phase === 'joined') &&
      deskReady() &&
      !desk?.recenterGliding &&
      !desk?.recenterCountdownActive &&
      !(joinBridge.challenge?.animating() ?? false);
    this.quietFor = still ? this.quietFor + delta : 0;
    return this.quietFor >= BACKGROUND_QUIET_SECONDS;
  }

  /** Asked once per session (a new session asks again). */
  private frameRateSession: XRSession | null = null;

  /**
   * At session start: asks for the rate frame-rate.ts chooses from the ones
   * the browser offers (80 Hz on the Quest 3; the Quest Browser supports
   * updateTargetFrameRate). Dev: `?hz=72` (or any rate) asks for that one;
   * the log lists the rates offered and the one in use.
   */
  private requestFrameRate(): void {
    const session = this.xrManager.getSession() as
      | (XRSession & {
          supportedFrameRates?: Float32Array;
          frameRate?: number;
          updateTargetFrameRate?: (rate: number) => Promise<void>;
        })
      | null;
    if (!session || session === this.frameRateSession) {
      return;
    }
    this.frameRateSession = session;
    const offered = session.supportedFrameRates ? Array.from(session.supportedFrameRates) : [];
    const manual = import.meta.env.DEV ? devFrameRateChoice() : null;
    const target = chooseFrameRate(offered, manual ?? PREFERRED_FRAME_RATE_HZ);
    // Not every browser has it (the types say it always exists).
    const canUpdate = typeof (session as { updateTargetFrameRate?: unknown }).updateTargetFrameRate === 'function';
    if (!canUpdate || target === null) {
      if (import.meta.env.DEV && this.debug) {
        this.debug.note(
          `frame rate: ${session.frameRate ?? 'unknown'} Hz kept (offered: ${offered.length > 0 ? offered.join(', ') : 'none listed'}` +
            `${canUpdate ? '' : '; no updateTargetFrameRate'})`,
        );
      }
      return;
    }
    const before = session.frameRate;
    session
      .updateTargetFrameRate(target)
      .then(() => {
        if (import.meta.env.DEV && this.debug) {
          this.debug.note(
            `frame rate: asked for ${target} Hz${manual ? ` (?hz=${manual})` : ''} (offered ${offered.join(', ')}; was ` +
              `${before ?? '?'} Hz); now ${session.frameRate ?? '?'} Hz`,
          );
        }
      })
      .catch((error: unknown) => {
        if (import.meta.env.DEV && this.debug) {
          this.debug.note(`frame rate: asking for ${target} Hz failed (${String(error)}); ${session.frameRate ?? '?'} Hz`);
        }
      });
  }

  /** Dev only: each background build as it finishes (how many frames, how much time in all). */
  private noteFinishedBuilds(): void {
    if (!import.meta.env.DEV || !this.debug) {
      return;
    }
    for (const done of buildQueue.finished.splice(0)) {
      this.debug.note(`build queue: ${done.name} built in ${done.frames} frame(s), ${done.ms.toFixed(1)} ms in all`);
    }
  }

  /** Dev only: a contact on `surface` that didn't press, once the fingertip is back out (why, its angle, how deep it went). */
  private notePokeMiss(hand: string, surface: string, poke: ContactPoke): void {
    if (!import.meta.env.DEV || !this.debug) {
      return;
    }
    const miss = poke.takeMiss(hand);
    if (miss) {
      this.debug.note(`${hand} fingertip on ${surface}, no press: ${pokeMissText(miss)}`);
    }
  }

  /** Dev only: why a contact poke didn't count. */
  private notePokeRejected(hand: string, target: string, verdict: PokeVerdict, poke: ContactPoke): void {
    if (!import.meta.env.DEV || !this.debug) {
      return;
    }
    const { toward, sideways, straightness } = poke.last;
    this.debug.note(
      verdict === 'rejected-direction'
        ? `${hand} fingertip contact on ${target} rejected: it came in along the face (${cm(toward)} toward it, ` +
            `${cm(sideways)} sideways: ${approachAngleDeg(toward, sideways).toFixed(0)}° off straight, max ${MAX_POKE_APPROACH_DEG}°)`
        : `${hand} fingertip contact on ${target} rejected: index finger not extended (straightness ` +
            `${straightness === null ? 'n/a' : straightness.toFixed(2)}, needs ${MIN_INDEX_STRAIGHTNESS})`,
    );
  }

  /**
   * Dev only (`debug`): the control and the result slab's NULL cells, for
   * the touch readout (touch-debug.ts), which logs every poke and pinch
   * attempt on them and what it pressed.
   */
  private registerTouchSurfaces(): void {
    if (!import.meta.env.DEV || !this.debug) {
      return;
    }
    const control = this.control;
    // The SDK's own poke pointer (a UIKit "touch" pointer): its down / up on each option.
    const debug = this.debug;
    for (const [name, option] of [
      ['INNER', control.inner],
      ['LEFT', control.left],
    ] as const) {
      for (const type of ['pointerdown', 'pointerup'] as const) {
        const listener = (event: unknown) => {
          const pointerType = (event as { pointerType?: string } | null)?.pointerType;
          if (pointerType === 'touch') {
            debug.note(`SDK poke pointer ${type === 'pointerdown' ? 'down' : 'up'} on ${name}`);
          }
        };
        option.addEventListener(type, listener);
        this.cleanupFuncs.push(() => option.removeEventListener(type, listener));
      }
    }
    touchProbe.addSurface({
      name: 'join-type control',
      object: () => (control.document.visible && control.fade.peek() >= 0.5 ? control.document : null),
      rects: (out) => {
        setRect(out[0], 'INNER', control.innerCenterX, 0, control.optionWidthMeters, control.optionHeightMeters);
        setRect(out[1], 'LEFT', control.leftCenterX, 0, control.optionWidthMeters, control.optionHeightMeters);
        return 2;
      },
    });
    touchProbe.addSurface({
      name: 'result slab',
      object: () => {
        const view = this.active;
        return view && this.state.phase === 'joined' && view.doc.fade.peek() >= 0.5 ? view.object : null;
      },
      rects: (out) => {
        const view = this.active;
        let count = 0;
        if (!view) {
          return 0;
        }
        for (let row = 0; row < view.nullColumns.length; row++) {
          if (!view.rowShown[row]) {
            continue;
          }
          for (const column of view.nullColumns[row]) {
            if (count >= out.length) {
              return count;
            }
            const span = view.doc.columnSpans[column];
            setRect(
              out[count++],
              `NULL row ${row} ${view.result.columns[column].label}`,
              (span.x0 + span.x1) / 2,
              rowCenterLocalY(view.doc, view.rowSlot[row]),
              span.x1 - span.x0,
              view.doc.rowHeightMeters,
            );
          }
        }
        return count;
      },
    });
  }

  /**
   * Each frame, before anything reads this frame's select starts: every
   * tracked hand's thumb-index tip distance into its pinch motion, and for
   * each select start whether it may press -- a controller's trigger always;
   * a hand's pinch only as a pinch motion (the tips opened just before; see
   * PinchMotion). Nothing once Exit has ended the session (the frame is gone).
   */
  private samplePinchMotion(): void {
    const now = this.tweens.now;
    for (const hand of HANDS) {
      const source = this.exitEnded ? undefined : this.input.xr.getPrimaryInputSource(hand);
      const tracked =
        !!source?.hand &&
        readJointsPoint(this.world, this.player, source, THUMB_TIP, this._motionThumb) &&
        readJointsPoint(this.world, this.player, source, INDEX_TIP, this._motionIndex);
      const gap = tracked ? this._motionThumb.distanceTo(this._motionIndex) : null;
      this.pinchMotion[hand].sample(gap, now);
      this.pinchMotionNull[hand].sample(gap, now);
      const gamepad = this.input.xr.gamepads[hand];
      const confirm = this.pinchConfirm[hand];
      this.pinchConfirmed[hand] = false;
      const pointer = this.pointers[hand];
      // The target lock: the last pressable target this hand's pointer was on (last frame's hit).
      if (pointer.active && pressable(pointer.hit) && !gamepad?.getSelectStart()) {
        copyRayHit(pointer.hit, this.recentTarget[hand]);
        this.recentTargetAt[hand] = now;
      }
      if (gamepad?.getSelectStart()) {
        // Its target: what the pointer is on, or (if that isn't pressable) what it was on just before.
        const target = this.pinchTarget[hand];
        this.pinchTargetAge[hand] = -1;
        if (pointer.active && !pressable(pointer.hit) && now - this.recentTargetAt[hand] <= PINCH_TARGET_LOCK_SECONDS) {
          copyRayHit(this.recentTarget[hand], target);
          this.pinchTargetAge[hand] = now - this.recentTargetAt[hand];
        } else {
          copyRayHit(pointer.hit, target);
          if (!pointer.active) {
            target.target = 'none';
          }
        }
        // A hand's pinch may press only from a pointer shown long enough, as a pinch motion (NULL cells: a smaller
        // opening), starting closed enough.
        const visibleFor = pointer.active ? now - pointer.activeSince : 0;
        const kind = this.pinchTargetKind(target);
        this.pinchStartKind[hand] = kind;
        const motion = (pinchOpenMetersFor(kind) === PINCH_OPEN_NULL_METERS ? this.pinchMotionNull : this.pinchMotion)[hand].isPinchMotion(now);
        this.pinchStartBlock[hand] = source?.hand ? pinchStartVerdict(motion, gap, visibleFor) : '';
        this.pinchStartOk[hand] = this.pinchStartBlock[hand] === '';
        this.pinchStartWidest[hand] = source?.hand ? this.pinchMotion[hand].widest(now) : -1;
        this.pinchStartGap[hand] = gap ?? -1;
        // Its press (armed by updateSelect) waits until it closes.
        confirm.start(now, gap, false);
      } else if (source?.hand) {
        // Held, or ending this frame (a quick tap presses on its release).
        const selectEnd = !!gamepad?.getSelectEnd();
        const step = confirm.frame(now, gap, !!gamepad?.getSelecting(), selectEnd);
        if (step === 'press') {
          this.pinchConfirmed[hand] = true;
        } else if (step === 'no-close') {
          // Not a clear pinch: it presses nothing and holds nothing.
          this.holdSelect[hand].reset();
          if (import.meta.env.DEV && this.debug) {
            this.debug.note(
              `${hand} pinch dropped: never closed to ${cm(PINCH_CLOSED_METERS)} for ${PINCH_CLOSED_HOLD_SECONDS * 1000} ms ` +
                `within ${PINCH_CLOSE_WINDOW_SECONDS} s (narrowest ${cm(confirm.minGap)})`,
            );
          }
        } else if (step === 'released' && import.meta.env.DEV && this.debug) {
          this.debug.note(`${hand} pinch dropped: released before it closed (narrowest ${cm(confirm.minGap)})`);
        }
      }
      if (source?.hand && gamepad?.getSelectEnd()) {
        if (import.meta.env.DEV && this.debug && Number.isFinite(confirm.startAt)) {
          this.debug.note(
            `${hand} pinch ended after ${Math.round((now - confirm.startAt) * 1000)} ms: narrowest ` +
              `${Number.isFinite(confirm.minGap) ? cm(confirm.minGap) : 'untracked'}, closed (<= ${cm(PINCH_CLOSED_METERS)}) ` +
              `${Math.round(confirm.closedSeconds(now) * 1000)} ms`,
          );
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
    this.dips.dip(joinType === 'inner' ? this.control.inner : this.control.left, this.tweens.now);
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

  handHoldsSlab(hand: 'left' | 'right'): boolean {
    for (const entity of this.queries.held.entities) {
      if (this.grabSystem?.getHolderHand(entity) === hand) {
        return true;
      }
    }
    return false;
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
    const nullCells: { row: number; column: number }[] = [];
    for (const row of doc.rowViews.keys()) {
      table.columns.forEach((column, index) => {
        if (table.rows[row]?.[column] === null) {
          nullCells.push({ row, column: index });
        }
      });
    }
    this.sources.set(tableId, { id: tableId, entity, object, doc, table, nullCells, nullPoke: new ContactPoke() });
    this.homes.set(tableId, { pos: new Vector3(), quat: new Quaternion(), set: false });
    this.glides.set(tableId, dockAnimation(HOME_GLIDE_SECONDS));
    this.layoutDirty = true;
    // Build every join direction's result slab ahead of any join (at startup,
    // or while new tables arrive), a step at a time in the background (kept
    // ones are already built); a join that starts sooner finishes its view now.
    for (const other of this.sources.values()) {
      if (other.id !== tableId) {
        this.prefetchResultView(tableId, other.id);
        this.prefetchResultView(other.id, tableId);
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
    for (const view of this.results.values()) {
      if ((view.leftId === source.id || view.rightId === source.id) && this.active === view) {
        this.active = null;
      }
    }
    // Its result slabs stay built (parked) if its dataset is kept; otherwise they go.
    this.trimResultViews();
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

  /** The result slab for joining `leftId` with `rightId`: built (cached), or finished now if it's still building. */
  private resultViewFor(leftId: string, rightId: string): ResultView | null {
    const key = resultKey(leftId, rightId);
    const cached = this.results.get(key);
    if (cached) {
      return cached;
    }
    if (!this.resultBuilds.has(key) && !this.queueResultView(leftId, rightId)) {
      return null;
    }
    const pending = this.resultBuilds.get(key);
    if (!pending) {
      return this.results.get(key) ?? null;
    }
    // Needed now (a join that started before it was built ahead): the rest of it in this frame.
    const start = performance.now();
    buildQueue.remove(pending.job);
    if (!pending.build) {
      this.startResultBuild(key, leftId, rightId, pending);
    }
    pending.build!.step(Infinity);
    const view = pending.finish!();
    if (import.meta.env.DEV && this.debug) {
      this.debug.note(`perf: result slab ${key} finished on demand in ${(performance.now() - start).toFixed(1)} ms`);
    }
    return view;
  }

  /** Builds the result slab for `leftId` with `rightId` ahead, in the background (if it isn't built or building). */
  private prefetchResultView(leftId: string, rightId: string): void {
    const key = resultKey(leftId, rightId);
    if (!this.results.has(key) && !this.resultBuilds.has(key)) {
      this.queueResultView(leftId, rightId);
    }
  }

  /**
   * The result slabs kept built: those of the tables on the desk and of the
   * kept datasets (dataset-cache.ts); the rest are disposed (and their
   * builds dropped). The kept datasets' slabs are built ahead.
   */
  private trimResultViews(): void {
    const kept = keptDatasets();
    const keep = (id: string) => this.sources.has(id) || kept.includes(datasetOfTable(id) ?? ('' as DatasetId));
    for (const [key, view] of this.results) {
      if (keep(view.leftId) && keep(view.rightId)) {
        continue;
      }
      if (this.active === view) {
        this.active = null;
      }
      view.cleanup.forEach((fn) => fn());
      view.entity.dispose();
      this.results.delete(key);
    }
    for (const [key, pending] of this.resultBuilds) {
      const [leftId, rightId] = key.split('>');
      if (!(keep(leftId) && keep(rightId))) {
        buildQueue.remove(pending.job);
        pending.build?.doc.document.dispose();
        this.resultBuilds.delete(key);
      }
    }
    for (const dataset of kept) {
      const [a, b] = DATASETS[dataset].tables;
      if (a && b) {
        this.prefetchResultView(a.id, b.id);
        this.prefetchResultView(b.id, a.id);
      }
    }
  }

  /**
   * Queues the result slab for `leftId` with `rightId` (build-queue.ts): its
   * first step works out its data and starts its document, the next ones
   * add its rows, and the last makes it a view. Queuing costs nothing now.
   * False if either table is unknown.
   */
  private queueResultView(leftId: string, rightId: string): boolean {
    const key = resultKey(leftId, rightId);
    if (!tableById(leftId) || !tableById(rightId)) {
      return false;
    }
    const entry: ResultBuild = {
      build: null,
      finish: null,
      job: {
        name: `result slab ${key}`,
        step: (deadline) => {
          if (!entry.build) {
            this.startResultBuild(key, leftId, rightId, entry);
            return false;
          }
          if (!entry.build.done) {
            entry.build.step(deadline);
            return false;
          }
          // Its own step: the view's entity, listeners and tints.
          entry.finish!();
          return true;
        },
      },
    };
    this.resultBuilds.set(key, entry);
    buildQueue.add(entry.job);
    return true;
  }

  /** A queued result slab's first step: its data, and its document started (hidden, parked). */
  private startResultBuild(key: string, leftId: string, rightId: string, entry: ResultBuild): void {
    const left = tableById(leftId)!;
    const right = tableById(rightId)!;

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
    const build = startTableSlabBuild(result.table, {
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
            // The card's state, mirrored where the player looks (the card is beside it).
            badge: true,
            // Every NULL here filters: outlined, so it reads as a button.
            nullTargets: true,
            accent: DATASETS[datasetOfTable(leftId) ?? 'shop'].theme.accent,
          }
        : {}),
      anchorTop: true,
      // Same angular text size as the source slabs, at the result's own distance.
      text: slabTextSizeAt(PLANNED_RESULT_DISTANCE_METERS),
      // Height follows the rows shown (INNER hides the trailing ghost rows).
      // Placement fits the tallest state (the reserve) but keeps the bottom
      // edge fixed above the control: it grows upward (followResultHeight).
      animatedHeight: true,
      // Each row's LEFT-table and RIGHT-table cells can fly in separately
      // from their own source rows.
      cellSides: result.columns.map((column) => column.source),
    });
    const doc = build.doc;
    doc.fade.value = 0;
    doc.document.visible = false;
    doc.document.position.set(0, PARKED_Y, 0);
    if (CHALLENGE_MODE && doc.captionOpacity[2]) {
      doc.captionOpacity[2].value = 0;
    }
    entry.build = build;
    entry.finish = () => {
      this.resultBuilds.delete(key);
      const view = this.finishResultView(key, leftId, rightId, left, right, result, ghostRows, sql, doc);
      // The group is laid out for the pair's result width.
      this.layoutDirty = true;
      return view;
    };
  }

  /** A result slab whose document is complete: its entity, listeners, tints and lineage, as a cached view. */
  private finishResultView(
    key: string,
    leftId: string,
    rightId: string,
    left: Table,
    right: Table,
    result: JoinResultTable,
    ghostRows: number[],
    sql: Record<JoinType, [string, string]>,
    doc: TableSlabDocument,
  ): ResultView {
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
    // Joined: the column (control + bar) and the card are placed with the
    // result; re-place now (e.g. the column just grew for the filter area).
    const view = this.active;
    if (this.state.phase === 'joined' && view) {
      const left = this.sources.get(view.leftId);
      const right = this.sources.get(view.rightId);
      if (left && right) {
        this.placeResult(view, left, right);
        this.noteBarButtons();
      }
    }
  }

  /** Dev: after the bar changes width, where its buttons and the control are (the control must not move). */
  private noteBarButtons(): void {
    const bar = this.challengeLayout?.bar;
    if (!import.meta.env.DEV || !this.debug || !bar) {
      return;
    }
    bar.object.updateWorldMatrix(true, false);
    const buttons = bar.buttons.map((button) => {
      this.arcWorld(bar.object, button.centerX, button.centerY, 0, this._d);
      return `${button.name} ${cm(button.width)} wide, ${this._d.distanceTo(this._head).toFixed(2)} m`;
    });
    const control = this.control.document.position;
    this.debug.note(
      `puzzle bar re-placed: ${cm(bar.widthMeters)} x ${cm(bar.heightMeters)}; ${buttons.join('; ')}; ` +
        `control center (${control.x.toFixed(3)}, ${control.y.toFixed(3)}, ${control.z.toFixed(3)})`,
    );
  }

  requestClearFilter(): void {
    this.applyTransition({ type: 'clearFilter' });
  }

  resetToHome(): void {
    if (this.state.phase === 'joined') {
      this.applyTransition({ type: 'pullApart' });
    }
    this.glideHome();
  }

  /**
   * After a pull-apart, both slabs glide home -- where placement (or the
   * last recenter) put them -- once no slab is held (never-yank: a slab
   * still in a hand waits for its release). A new grab toward a join first
   * (a preview) cancels it.
   */
  private updateHomeAfterSeparate(): void {
    if (!this.homeAfterSeparate) {
      return;
    }
    if (this.state.phase !== 'idle') {
      this.homeAfterSeparate = false;
      return;
    }
    if (this.queries.held.entities.size > 0 || this.dock.active) {
      return;
    }
    this.homeAfterSeparate = false;
    if (import.meta.env.DEV && this.debug) {
      const homes = [...this.sources.values()].map((source) => {
        const home = this.homes.get(source.id);
        return home?.set ? `${source.id} ${cm(source.object.position.distanceTo(home.pos))} away` : `${source.id} (no home: stays)`;
      });
      this.debug.note(`pull-apart: slabs released, gliding home (${homes.join('; ')})`);
    }
    this.glideHome();
  }

  /** Eases every slab not held back to its home pose (HOME_GLIDE_SECONDS). */
  private glideHome(): void {
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
      // (A join's fit glide may have shortened it.)
      glide.duration = HOME_GLIDE_SECONDS;
    }
    this.layoutDirty = true;
  }

  applyDiff(rowStatus: readonly RowStatus[] | null, missing: number): void {
    if (this.active && this.state.phase === 'joined') {
      this.setDiff(this.active, rowStatus, missing);
    }
  }

  setResultBadge(text: string | null, look: SlabBadgeLook): void {
    const view = this.active;
    if (view && this.state.phase === 'joined') {
      setSlabBadge(view.doc, text, look);
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

  pulseNullCells(): void {
    const view = this.active;
    if (!view || this.state.phase !== 'joined') {
      return;
    }
    view.nullColumns.forEach((columns, row) => {
      if (view.rowShown[row]) {
        for (const column of columns) {
          setNullCellHover(view.doc, row, column, true);
        }
      }
    });
    this.nullCueView = view;
    this.nullCueUntil = this.tweens.now + NULL_CUE_SECONDS;
  }

  nullFilterChoices(): NullFilterChoice[] {
    const view = this.active;
    const state = this.state;
    if (!view || state.phase !== 'joined') {
      return [];
    }
    return nullFilterColumns(view.leftTable, view.rightTable, view.result, state.joinType, state.filter ?? null).map(
      (column) => ({ column, header: columnHeaderText(view.result.table, view.result.columns[column].key) }),
    );
  }

  applyNullFilter(column: number, path: PressPath): void {
    const view = this.active;
    const state = this.state;
    if (!view || state.phase !== 'joined' || column < 0 || column >= view.result.columns.length) {
      return;
    }
    const filter = filterForColumn(view.leftTable, view.rightTable, view.result, column);
    if (import.meta.env.DEV && this.debug) {
      this.debug.note(`filter chip (${path}): ${view.result.columns[column].label} is NULL (${filter.tableId}.${filter.column})`);
    }
    if (!sameFilter(state.filter ?? null, filter)) {
      this.applyTransition({ type: 'setFilter', filter });
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
        this.activateNullCell(view.key, row, view.nullColumns[row][0], 'debug-key');
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
    setSlabBadge(view.doc, null);
    // NULL outlines at rest (a cue or hover from the last join may have left one drawn).
    this.nullCueUntil = 0;
    this.nullCueView = null;
    this.setNullHover(null, -1, -1);
    this.resetNullLooks(view);
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
   * where its column IS NULL (or switch to that column). A press never
   * clears the filter (only Clear does): on the column already filtered it
   * ticks and pulses the WHERE lines, so it's acknowledged and shows which
   * filter is active. A poke and a ray select on the same press count once.
   */
  private activateNullCell(key: string, row: number, column: number, path: PressPath): void {
    const view = this.results.get(key);
    const state = this.state;
    if (!view || this.active !== view || state.phase !== 'joined' || !view.rowShown[row] || view.doc.fade.peek() < 0.5) {
      return;
    }
    if (this.tweens.now - this.lastNullActivation < NULL_ACTIVATION_DEBOUNCE_SECONDS) {
      return;
    }
    this.lastNullActivation = this.tweens.now;
    if (import.meta.env.DEV && this.debug) {
      touchProbe.pressed(`NULL row ${row} ${view.result.columns[column].label}`, path);
    }
    const filter = filterForColumn(view.leftTable, view.rightTable, view.result, column);
    const span = view.doc.columnSpans[column];
    this._a.set((span.x0 + span.x1) / 2, rowCenterLocalY(view.doc, view.rowSlot[row]), 0);
    view.object.updateWorldMatrix(true, false);
    view.object.localToWorld(this._a);
    sounds.playClick(this._a);
    this.dips.dip(view.doc.rowViews.get(row)?.nullOutlines?.get(column) ?? null, this.tweens.now);
    if (import.meta.env.DEV && this.debug) {
      this.debug.note(`NULL cell poked: row ${row}, ${view.result.columns[column].label} (${filter.tableId}.${filter.column})`);
    }
    const event = nullPokeEvent(state.filter ?? null, filter);
    if (event === 'none') {
      if (import.meta.env.DEV && this.debug) {
        this.debug.note(`NULL cell press on the column already filtered: no change (Clear removes the filter)`);
      }
      this.pulseWhereLine(view);
      joinBridge.challenge?.onNullFilterRepeat();
      return;
    }
    this.applyTransition({ type: 'setFilter', filter });
  }

  /** The caption's WHERE line dips and returns once (a press on the column already filtered). */
  private pulseWhereLine(view: ResultView): void {
    const opacity = view.doc.captionOpacity[2];
    if (opacity) {
      this.tweens.to(opacity, 0.3, 0.15, 0, easeOutCubic, () => this.tweens.to(opacity, 1, 0.3, 0, easeInOutCubic));
    }
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
    // A fingertip pokes through the contact poke (updateNullRayAndPoke), not the SDK's flickering touch pointer.
    if (isTouchPointerClick(event)) {
      return;
    }
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
      this.activateNullCell(key, this._nullHit.row, this._nullHit.column, 'uikit-click');
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
    // Back to its own size before anything measures it (the dock pose, the glide home).
    source.object.scale.setScalar(1);
    const docking =
      (this.state.phase === 'previewing' && this.state.moving === source.id) ||
      (this.state.phase === 'joined' && (source.id === this.state.left || source.id === this.state.right));
    // The dock has its own snap; anything else is put down.
    if (!docking) {
      sounds.playPutDown(source.object.position);
    }
    if (import.meta.env.DEV && this.debug) {
      this.debug.note(`grab feedback: ${source.id} released: ${docking ? 'docking (its snap, no put-down sound)' : 'put down'}`);
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
      return;
    }
    if (this.state.phase === 'idle' && !this.homeAfterSeparate) {
      // Moved without docking: no use leaving it wherever it was dropped (possibly out of view).
      this.glideSlabHome(source);
    }
  }

  /** Eases one released slab back to its home pose (HOME_GLIDE_SECONDS), if it's away from it. */
  private glideSlabHome(source: SourceSlab): void {
    const home = this.homes.get(source.id);
    const glide = this.glides.get(source.id);
    if (!home?.set || !glide) {
      return;
    }
    const away = source.object.position.distanceTo(home.pos);
    if (away < HOME_RETURN_MIN_METERS && source.object.quaternion.angleTo(home.quat) < HOME_RETURN_MIN_RAD) {
      return;
    }
    glide.active = true;
    glide.slab = source;
    glide.fromPos.copy(source.object.position);
    glide.fromQuat.copy(source.object.quaternion);
    glide.toPos.copy(home.pos);
    glide.toQuat.copy(home.quat);
    glide.elapsed = 0;
    glide.duration = HOME_GLIDE_SECONDS;
    this.layoutDirty = true;
    if (import.meta.env.DEV && this.debug) {
      this.debug.note(`slab returned home: ${source.id}, ${away.toFixed(2)} m (released outside preview range)`);
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
    // Before the dock moves anything (a debug join moves a slab without a grab).
    this.captureHome(left);
    this.captureHome(right);
    if (this.challengeLayout) {
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
    // Its height for this join before placing it (anchored by its bottom
    // edge, it's positioned for its height now; the sequence sets the same).
    if (view.doc.panelHeightCm) {
      const rows = view.matchedRowCount + (joinType === 'left' ? view.ghostRows.length : 0) + view.placeholdersShown;
      this.tweens.set(view.doc.panelHeightCm, view.doc.heightForRowsMeters(rows) * 100);
    }
    this.readHead();
    this.placeResult(view, left, right);
    // A pair joined high (lifted toward the eyes) stacks the control, result
    // and card above the view's top: the pair glides down, with the dock,
    // until the group fits. Placement and the join sequence use the lowered
    // pose; the LEFT slab then glides there from where it is.
    const drop = this.fitDropForGroup(view, left, right);
    if (drop > 0) {
      left.object.position.y -= drop;
      this.dock.toPos.y -= drop;
      this.placeResult(view, left, right);
    }
    const t1 = import.meta.env.DEV ? performance.now() : 0;

    this.playJoinSequence(view, left, right, joinType);
    const t2 = import.meta.env.DEV ? performance.now() : 0;
    this.warnIfOutOfView(view, left, right);
    if (drop > 0) {
      this.glideDown(left, drop);
      if (import.meta.env.DEV && this.debug) {
        this.debug.note(
          `join lowered the pair ${cm(drop)} so the group fits the view's top (+${VIEW_MAX_ABOVE_GAZE_DEG}°)`,
        );
      }
    }

    if (import.meta.env.DEV && this.debug) {
      const t3 = performance.now();
      this.debug.note(
        `join start work: setup+placement ${(t1 - t0).toFixed(1)} ms, sequence ${(t2 - t1).toFixed(1)} ms, ` +
          `debug readout ${(t3 - t2).toFixed(1)} ms`,
      );
    }
  }

  /** Top edge (degrees from the natural gaze) of the joined group: the higher of the result slab (badge included) and the card beside it. */
  private groupTopDeg(view: ResultView): number {
    view.object.updateWorldMatrix(true, false);
    this._groupTop.set(0, slabVisualTopLocalY(view.doc), 0);
    view.object.localToWorld(this._groupTop);
    let top = degreesFromForward(this._head, this.headPitchDown, this._groupTop);
    const card = this.challengeLayout?.card;
    if (card) {
      card.object.updateWorldMatrix(true, false);
      this._groupTop.set(0, card.heightMeters / 2, 0);
      card.object.localToWorld(this._groupTop);
      top = Math.max(top, degreesFromForward(this._head, this.headPitchDown, this._groupTop));
    }
    return top;
  }

  /**
   * How far to lower the pair at a join so the group's top fits
   * VIEW_MAX_ABOVE_GAZE_DEG: the smallest drop that fits, but never below
   * where the LEFT slab rested before this puzzle moved it (its home), nor
   * more than JOIN_MAX_FIT_DROP_METERS. 0 when it already fits. Leaves the
   * pair and the dock target as they were (the caller applies the drop).
   */
  private fitDropForGroup(view: ResultView, left: SourceSlab, right: SourceSlab): number {
    if (this.groupTopDeg(view) <= VIEW_MAX_ABOVE_GAZE_DEG + FIT_DROP_TOLERANCE_DEG) {
      return 0;
    }
    const home = this.homes.get(left.id);
    const maxDrop = home?.set
      ? Math.min(JOIN_MAX_FIT_DROP_METERS, Math.max(0, left.object.position.y - home.pos.y))
      : JOIN_MAX_FIT_DROP_METERS;
    if (maxDrop <= 1e-3) {
      return 0;
    }
    const startY = left.object.position.y;
    const dockY = this.dock.toPos.y;
    const topAt = (drop: number): number => {
      left.object.position.y = startY - drop;
      this.dock.toPos.y = dockY - drop;
      this.placeResult(view, left, right);
      return this.groupTopDeg(view);
    };
    let drop = maxDrop;
    if (topAt(maxDrop) <= VIEW_MAX_ABOVE_GAZE_DEG) {
      // The smallest drop that fits.
      let lo = 0;
      let hi = maxDrop;
      for (let i = 0; i < FIT_DROP_SEARCH_STEPS; i++) {
        const mid = (lo + hi) / 2;
        if (topAt(mid) <= VIEW_MAX_ABOVE_GAZE_DEG) {
          hi = mid;
        } else {
          lo = mid;
        }
      }
      drop = hi;
    }
    left.object.position.y = startY;
    this.dock.toPos.y = dockY;
    this.placeResult(view, left, right);
    return drop;
  }

  /** Glides the LEFT slab down by `drop` over the dock's duration (the RIGHT slab docks to it). */
  private glideDown(slab: SourceSlab, drop: number): void {
    const glide = this.glides.get(slab.id);
    if (!glide) {
      return;
    }
    glide.active = true;
    glide.slab = slab;
    glide.fromPos.copy(slab.object.position);
    glide.fromQuat.copy(slab.object.quaternion);
    glide.toPos.copy(slab.object.position);
    glide.toPos.y -= drop;
    glide.toQuat.copy(slab.object.quaternion);
    glide.elapsed = 0;
    glide.duration = DOCK_DURATION_SECONDS;
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
    // Dev: an apply waiting for the separation (it joins again at once: no glide).
    const apply = this.pendingApply;
    if (apply) {
      this.pendingApply = null;
      this.debugApply(apply);
    } else {
      // Both slabs glide home once released (updateHomeAfterSeparate).
      this.homeAfterSeparate = true;
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

    // The panel's height follows the rows shown. Its bottom edge stays put
    // (followResultHeight), so it grows and shrinks at the top: it grows as
    // the incoming rows slide in, and shrinks once the outgoing rows have slid out.
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
    // edge -- tops differ, since docked slabs align their bottoms. planGroup
    // then turns it to its place in the group.
    const rightX = this.dockSide * (left.doc.widthMeters / 2 + DOCK_GAP_METERS + right.doc.widthMeters / 2);
    this._c.set(rightX / 2, pairTopLocalY(left, right), 0);
    left.object.localToWorld(this._c);

    // Left to right: the control column, the result, the card; the result
    // stands above the pair, the column level with its bottom.
    // Its status badge (challenge mode) rises above its top edge. Fitted for
    // its tallest state, anchored by its bottom edge at its height now.
    const shown = shownHeightMeters(view.doc);
    const plan = this.placeInGroup(left, right, true, view.object, view.doc.widthMeters, view.doc.heightMeters, view.doc.tabHeightMeters, shown);
    this.placeColumn(true);
    const card = this.challengeLayout?.card;
    this._resultBottom.copy(this._placedBottom);
    this._resultUp.copy(this._placedUp);
    this.resultPlaced = view;
    this.resultPlacedHeight = shown;
    if (card) {
      // On the right, clear of the pair's top edge (the RIGHT slab may still
      // be docking: measured at its dock pose); beside the width it's planned for.
      this.placeCard(view.object, plan.resultWidth, shown, card, plan.pairTopDeg);
    }
  }

  /**
   * Places a top-anchored slab (`object`) whose bottom-edge midpoint starts
   * at `_c` (on the pair's top-edge line, in the frame of `_q1`): moved back
   * to RESULT_TARGET_DISTANCE_METERS from the eyes (behind the pair), its
   * bottom edge on the line `floorDeg` (degrees from the natural gaze: just
   * above the pair's top edge in view), leaning to face the eyes, pushed
   * back if its top would leave the view. Fitted for its tallest state
   * (`height` m: the result's 12-row reserve), but anchored by its bottom
   * edge: positioned for `shownHeight` (its height now), so a short result
   * sits low and only grows upward. Leaves that bottom edge in
   * `_placedBottom` and the slab's up axis in `_placedUp`. Overwrites `_c`.
   */
  private placeAboveBand(
    object: Object3D,
    height: number,
    floorDeg: number,
    above = 0,
    shownHeight = height,
    yawDeg = 0,
    distance = RESULT_TARGET_DISTANCE_METERS,
  ): void {
    this._up.copy(UP).applyQuaternion(this._q1);
    this._normal.set(0, 0, 1).applyQuaternion(this._q1);
    this._c.addScaledVector(this._normal, -RESULT_BEHIND_METERS);
    const minBottomRad = MathUtils.degToRad(floorDeg) - this.headPitchDown;
    // The bottom edge on the floor line, at its horizontal distance.
    const toFloor = () => {
      this._f.subVectors(this._c, this._head);
      this._c.y = this._head.y + Math.hypot(this._f.x, this._f.z) * Math.tan(minBottomRad);
    };
    toFloor();

    // Its bearing from the eyes: `yawDeg` right of the pair's forward (it
    // faces the eyes), and the horizontal "away from the viewer" axis it implies.
    this._euler.setFromQuaternion(this._q1, 'YXZ');
    const yaw = this._euler.y - MathUtils.degToRad(yawDeg);
    this._b.set(0, 0, -1).applyAxisAngle(UP, yaw);
    this._f.subVectors(this._c, this._head);
    const startHorizontal = Math.hypot(this._f.x, this._f.z);
    this._c.x = this._head.x + this._b.x * startHorizontal;
    this._c.z = this._head.z + this._b.z * startHorizontal;

    // Lean to face the eyes from the slab's own center, and move it (along
    // the away axis) until that center is RESULT_TARGET_DISTANCE_METERS from
    // the eyes: farther than the pair, so it reads as behind it. Never past
    // RESULT_MAX_PUSHED_DISTANCE_METERS (row text at least
    // RESULT_MIN_PUSHED_ROW_TEXT_DEG); a pair pushed far away pulls it in by
    // at most RESULT_MAX_PULL_METERS. Its bottom stays on the floor line.
    let lean = 0;
    let pulled = 0;
    const target = Math.min(distance, RESULT_MAX_PUSHED_DISTANCE_METERS);
    for (let i = 0; i < RESULT_FIT_ITERATIONS; i++) {
      this._a.subVectors(this._c, this._head);
      lean = eyeFacingLeanFromBottom(this._head.y - this._c.y, this._a.dot(this._b), height);
      this._a
        .copy(this._c)
        .addScaledVector(this._b, (height / 2) * Math.sin(lean))
        .addScaledVector(UP, (height / 2) * Math.cos(lean));
      let move = target - this._a.distanceTo(this._head);
      if (move < 0) {
        move = -Math.min(-move, RESULT_MAX_PULL_METERS - pulled);
        pulled -= move;
      }
      if (Math.abs(move) <= 1e-4) {
        break;
      }
      this._c.addScaledVector(this._b, move);
      toFloor();
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

    // Top-anchored document: origin = bottom edge + slab-up * its height now.
    this._euler.set(-lean, yaw, 0, 'YXZ');
    this._q2.setFromEuler(this._euler);
    this._up.copy(UP).applyQuaternion(this._q2);
    object.quaternion.copy(this._q2);
    object.position.copy(this._c).addScaledVector(this._up, shownHeight);
    this._placedBottom.copy(this._c);
    this._placedUp.copy(this._up);
  }

  /**
   * Keeps the result slab's bottom edge where it was placed while its height
   * changes (rows, placeholders, INNER / LEFT, a filter): it's top-anchored,
   * so it moves up by exactly its height. Each frame; writes only on a change.
   */
  private followResultHeight(): void {
    const view = this.active;
    if (!view || view !== this.resultPlaced || (this.state.phase !== 'joined' && this.state.phase !== 'separating')) {
      return;
    }
    const height = shownHeightMeters(view.doc);
    if (Math.abs(height - this.resultPlacedHeight) < 1e-5) {
      return;
    }
    this.resultPlacedHeight = height;
    view.object.position.copy(this._resultBottom).addScaledVector(this._resultUp, height);
  }

  /**
   * Plans the group, left to right: the control column, the result (or its
   * slot before the join), the card. Centered on straight ahead (the pair's
   * forward from the eyes) so every outer edge stays within
   * VIEW_HALF_WIDTH_DEG; if the result is too wide for that, it moves back
   * (up to RESULT_MAX_FIT_DISTANCE_METERS). The result's floor (and the
   * column's bottom edge) is RESULT_FLOOR_GAP_DEG above the pair's top edge
   * in view. Laid out for the pair's result in either order (the wider):
   * nothing moves at the join. `joined`: the RIGHT slab may still be
   * docking, so it's measured at its dock pose. Sets the pair's frame
   * (`_colFwd` / `_colRight`).
   */
  private planGroup(a: SourceSlab, b: SourceSlab, joined: boolean, slotWidth: number, nearFactor = 1): GroupPlan {
    const plan = this.plan;
    plan.pairTopDeg = this.pairTopDeg(a, b, joined);
    plan.floorDeg = plan.pairTopDeg + RESULT_FLOOR_GAP_DEG;
    let width = slotWidth;
    for (const key of [resultKey(a.id, b.id), resultKey(b.id, a.id)]) {
      width = Math.max(width, this.results.get(key)?.doc.widthMeters ?? 0);
    }
    plan.resultWidth = width;
    const bar = this.challengeLayout?.bar ?? this.freeBarPlaced;
    const r = BAND_ARC_RADIUS_METERS;
    // The column's angular width on its arc (at its bottom edge's height: fixed as its filter area grows).
    const bottomElevation = MathUtils.degToRad(plan.floorDeg) - this.headPitchDown;
    // The column's own width: the open picker's extension to the left never moves the group.
    const columnDeg = bar ? MathUtils.radToDeg(arcAngle(bar.widthMeters - columnExtension(bar), r, bottomElevation)) : 0;
    const columnGap = bar ? COLUMN_RESULT_GAP_DEG : 0;
    const card = this.challengeLayout?.card;
    const cardDeg = card
      ? MathUtils.radToDeg(2 * Math.atan(card.widthMeters / 2 / PLANNED_CARD_DISTANCE_METERS)) + CARD_SIDE_GAP_DEG
      : 0;
    // Its width in view at its bottom edge (the nearest, horizontally: it leans back): `nearFactor` of its distance.
    const resultDeg = (distance: number) => MathUtils.radToDeg(2 * Math.atan(width / 2 / (distance * nearFactor)));
    const rest = columnDeg + columnGap + cardDeg;
    let distance = RESULT_TARGET_DISTANCE_METERS;
    if (rest + resultDeg(distance) > 2 * VIEW_HALF_WIDTH_DEG) {
      const room = Math.max(1, 2 * VIEW_HALF_WIDTH_DEG - rest);
      distance = Math.min(RESULT_MAX_FIT_DISTANCE_METERS, width / 2 / Math.tan(MathUtils.degToRad(room / 2)) / nearFactor);
    }
    plan.resultDistance = distance;
    const left = -(rest + resultDeg(distance)) / 2;
    plan.columnLeftYawDeg = left;
    plan.resultYawDeg = left + columnDeg + columnGap + resultDeg(distance) / 2;
    return plan;
  }

  /**
   * Places a top-anchored slot (the result, or its outline) in the planned
   * group (placeAboveBand from `_c`, as there). Twice: the first pass
   * measures how much nearer (horizontally) its bottom edge is than its
   * center -- it leans back -- which sets its width in view for the second.
   */
  private placeInGroup(
    a: SourceSlab,
    b: SourceSlab,
    joined: boolean,
    object: Object3D,
    slotWidth: number,
    height: number,
    above: number,
    shownHeight: number,
  ): GroupPlan {
    this._slotStart.copy(this._c);
    let nearFactor = 1;
    for (let pass = 0; pass < 2; pass++) {
      this._c.copy(this._slotStart);
      const plan = this.planGroup(a, b, joined, slotWidth, nearFactor);
      this.placeAboveBand(object, height, plan.floorDeg, above, shownHeight, plan.resultYawDeg, plan.resultDistance);
      this._f.subVectors(this._placedBottom, this._head);
      nearFactor = Math.hypot(this._f.x, this._f.z) / plan.resultDistance;
    }
    return this.plan;
  }
  private readonly _slotStart = new Vector3();

  /** The group's plan (planGroup), reused in place. */
  private readonly plan: GroupPlan = {
    pairTopDeg: 0,
    floorDeg: 0,
    resultWidth: 0,
    resultDistance: RESULT_TARGET_DISTANCE_METERS,
    resultYawDeg: 0,
    columnLeftYawDeg: 0,
  };

  /**
   * The pair's top edge in view (degrees from the natural gaze: its highest
   * top corner, name tabs included), and its frame (`_colFwd` / `_colRight`:
   * its yaw, no lean or roll). `joined`: the docking slab at its dock pose.
   */
  private pairTopDeg(a: SourceSlab, b: SourceSlab, joined: boolean): number {
    a.object.updateWorldMatrix(true, false);
    a.object.getWorldQuaternion(this._colQ);
    this._euler.setFromQuaternion(this._colQ, 'YXZ');
    this._colFwd.set(0, 0, -1).applyAxisAngle(UP, this._euler.y);
    this._colRight.set(1, 0, 0).applyAxisAngle(UP, this._euler.y);
    let topDeg = -Infinity;
    for (const slab of [a, b]) {
      const docking = joined && this.dock.active && this.dock.slab === slab;
      slab.object.updateWorldMatrix(true, false);
      for (const sx of [-1, 1]) {
        this._colA.set((sx * slab.doc.widthMeters) / 2, slabVisualTopLocalY(slab.doc), 0);
        if (docking) {
          this._colA.applyQuaternion(this.dock.toQuat).add(this.dock.toPos);
        } else {
          slab.object.localToWorld(this._colA);
        }
        topDeg = Math.max(topDeg, degreesFromForward(this._head, this.headPitchDown, this._colA));
      }
    }
    return topDeg;
  }

  /**
   * The control column (the puzzle bar, or free play's bar), as planned
   * (planGroup): left of the result, its bottom edge level with the
   * result's, BAND_ARC_RADIUS_METERS from the eyes, its items on an arc
   * around them (band-arc.ts), each facing them with no roll. Bottom-
   * anchored: its filter area grows upward. Once joined, INNER | LEFT sits
   * in its row (it never moves).
   */
  private placeColumn(joined: boolean): void {
    const bar = this.challengeLayout?.bar ?? this.freeBarPlaced;
    if (!bar) {
      return;
    }
    const r = BAND_ARC_RADIUS_METERS;
    // The bar's origin (its left edge's middle) on the arc, facing the eyes.
    const elevation = MathUtils.degToRad(this.plan.floorDeg) - this.headPitchDown + bar.heightMeters / 2 / r;
    // The open picker extends the bar to the left: its origin moves left by that much, the column stays put.
    const extension = columnExtension(bar);
    const yaw = MathUtils.degToRad(this.plan.columnLeftYawDeg) - arcAngle(extension, r, elevation);
    this._colA
      .copy(this._colFwd)
      .multiplyScalar(Math.cos(yaw))
      .addScaledVector(this._colRight, Math.sin(yaw))
      .multiplyScalar(Math.cos(elevation))
      .addScaledVector(UP, Math.sin(elevation));
    bar.object.position.copy(this._head).addScaledVector(this._colA, r);
    bar.object.lookAt(this._head);
    bar.object.updateWorldMatrix(true, false);
    // It leans back to face the eyes by their elevation seen from it: its curved buttons correct for that, staying level.
    this.bandLean = -elevation;
    this._bandEyes.copy(this._head);
    bar.onArcLean?.(this.bandLean);
    if (joined) {
      const control = this.control;
      this.arcWorld(bar.object, extension + (bar.widthMeters - extension) / 2, bar.leadCenterYMeters, 0, control.document.position);
      // Facing the eyes, level (no roll).
      control.document.lookAt(this._head);
      control.document.updateWorldMatrix(true, false);
    }
  }

  /** A world point's yaw from the eyes in the pair's frame (degrees, + right): `_colFwd` / `_colRight` from placeBand. */
  private yawInPair(point: Vector3): number {
    this._colB.subVectors(point, this._head);
    return MathUtils.radToDeg(Math.atan2(this._colB.dot(this._colRight), this._colB.dot(this._colFwd)));
  }

  /**
   * Dev: the column and the group: every button's distance from the eyes and
   * from each shoulder (assumed 0.18 m to the side of and 0.25 m below the
   * eyes), and every element's extent in view -- yaw from straight ahead
   * (+ right), pitch from the natural gaze -- and distance; warns past
   * VIEW_HALF_WIDTH_DEG. Only a changed layout is logged. Allocates (dev only, per layout).
   */
  private noteBand(
    a: SourceSlab,
    b: SourceSlab,
    joined: boolean,
    slot: { object: Object3D; width: number; top: number; bottom: number } | null,
  ): void {
    const bar = this.challengeLayout?.bar ?? this.freeBarPlaced;
    if (!import.meta.env.DEV || !this.debug || !bar || this.world.visibilityState.peek() === VisibilityState.NonImmersive) {
      return;
    }
    const shoulder = (side: number) =>
      new Vector3().copy(this._head).addScaledVector(this._colRight, side * 0.18).addScaledVector(UP, -0.25);
    const leftShoulder = shoulder(-1);
    const rightShoulder = shoulder(1);
    const p = new Vector3();
    const reach: string[] = [];
    const note = (name: string, point: Vector3) => {
      reach.push(
        `${name} ${point.distanceTo(this._head).toFixed(3)}/${point.distanceTo(leftShoulder).toFixed(2)}/` +
          `${point.distanceTo(rightShoulder).toFixed(2)}`,
      );
    };
    if (joined) {
      for (const [name, x] of [['INNER', this.control.innerCenterX], ['LEFT', this.control.leftCenterX]] as const) {
        note(name, this.control.document.localToWorld(p.set(x, 0, 0)));
      }
    }
    let worstRoll = 0;
    const q = new Quaternion();
    const euler = new Euler();
    for (const button of bar.buttons) {
      note(button.name, this.arcWorld(bar.object, button.centerX, button.centerY, 0, p, q));
      worstRoll = Math.max(worstRoll, Math.abs(MathUtils.radToDeg(euler.setFromQuaternion(q, 'YXZ').z)));
    }
    reach.push(`(column buttons roll at most ${worstRoll.toFixed(1)}°)`);
    // Each element's extent in view: yaw (+ right), pitch from the gaze, and its center's distance.
    type Part = {
      name: string;
      yaw0: number;
      yaw1: number;
      pitch0: number;
      pitch1: number;
      distance: number;
      /** The corners at yaw0 and yaw1, for the debug panel. */
      leftPoint: Vector3;
      rightPoint: Vector3;
    };
    const parts: Part[] = [];
    const span = (name: string, points: Vector3[], center: Vector3) => {
      const yaws = points.map((point) => this.yawInPair(point));
      const pitches = points.map((point) => degreesFromForward(this._head, this.headPitchDown, point));
      const at = (values: number[], pick: (x: number, y: number) => boolean) =>
        points[values.reduce((best, value, i) => (pick(value, values[best]) ? i : best), 0)];
      parts.push({
        name,
        yaw0: Math.min(...yaws),
        yaw1: Math.max(...yaws),
        pitch0: Math.min(...pitches),
        pitch1: Math.max(...pitches),
        distance: center.distanceTo(this._head),
        leftPoint: at(yaws, (x, y) => x < y),
        rightPoint: at(yaws, (x, y) => x > y),
      });
    };
    const corners = (object: Object3D, x0: number, x1: number, y0: number, y1: number) =>
      [x0, x1].flatMap((x) => [y0, y1].map((y) => object.localToWorld(new Vector3(x, y, 0))));
    for (const slab of [a, b]) {
      const w = slab.doc.widthMeters / 2;
      span(
        `${slab.id} slab`,
        corners(slab.object, -w, w, slabBottomLocalY(slab.doc), slabVisualTopLocalY(slab.doc)),
        slab.object.getWorldPosition(new Vector3()),
      );
    }
    const h = bar.heightMeters / 2;
    span(
      'column',
      [0, bar.widthMeters].flatMap((x) => [-h, h].map((y) => this.arcWorld(bar.object, x, y, 0, new Vector3()))),
      this.arcWorld(bar.object, bar.widthMeters / 2, 0, 0, new Vector3()),
    );
    if (slot) {
      const w = slot.width / 2;
      span(
        joined ? 'result' : 'outline',
        corners(slot.object, -w, w, slot.bottom, slot.top),
        slot.object.localToWorld(new Vector3(0, (slot.top + slot.bottom) / 2, 0)),
      );
    }
    const card = this.challengeLayout?.card;
    if (card) {
      const w = card.widthMeters / 2;
      const ch = card.heightMeters / 2;
      span('card', corners(card.object, -w, w, -ch, ch), card.object.getWorldPosition(new Vector3()));
    }
    const left = parts.reduce((m, part) => (part.yaw0 < m.yaw0 ? part : m));
    const right = parts.reduce((m, part) => (part.yaw1 > m.yaw1 ? part : m));
    const line =
      `layout (${joined ? 'joined' : 'before the join'}): column buttons from the eyes / left / right shoulder (m): ` +
      `${reach.join(', ')}; extents (yaw, pitch from the gaze, distance): ` +
      parts
        .map(
          (part) =>
            `${part.name} ${part.yaw0.toFixed(1)}° to ${part.yaw1.toFixed(1)}°, ${part.pitch0.toFixed(1)}° to ` +
            `${part.pitch1.toFixed(1)}°, ${part.distance.toFixed(2)} m`,
        )
        .join('; ') +
      `; group ${left.yaw0.toFixed(1)}° (${left.name}) to ${right.yaw1.toFixed(1)}° (${right.name}), ` +
      `${(right.yaw1 - left.yaw0).toFixed(1)}° wide (limit +/-${VIEW_HALF_WIDTH_DEG}°)`;
    if (line !== this.lastBandNote) {
      this.lastBandNote = line;
      // The debug panel places itself outside these (dev-layout.ts).
      Object.assign(devLayout.left, left.leftPoint);
      Object.assign(devLayout.right, right.rightPoint);
      Object.assign(devLayout.head, { x: this._head.x, y: this._head.y, z: this._head.z });
      Object.assign(devLayout.rightAxis, { x: this._colRight.x, y: 0, z: this._colRight.z });
      devLayout.leftName = left.name;
      devLayout.rightName = right.name;
      devLayout.version++;
      this.debug.note(line);
      this.noteReachPaths(a, b, joined, slot, bar);
      // The open picker extends the column left by design (to about -45°, while open).
      const pickerOpen = columnExtension(bar) > 0;
      const leftLimit = pickerOpen ? PICKER_LEFT_LIMIT_DEG : VIEW_HALF_WIDTH_DEG;
      if (left.yaw0 < -leftLimit - 0.5 || right.yaw1 > VIEW_HALF_WIDTH_DEG + 0.5) {
        this.debug.warn(
          `the group reaches ${left.yaw0.toFixed(1)}° (${left.name}) to ${right.yaw1.toFixed(1)}° (${right.name}), ` +
            `past -${leftLimit}° / +${VIEW_HALF_WIDTH_DEG}°${pickerOpen ? ' (picker open)' : ''}`,
        );
      } else if (pickerOpen) {
        this.debug.note(`puzzle picker open: the column reaches ${left.yaw0.toFixed(1)}° (allowed to -${PICKER_LEFT_LIMIT_DEG}° while open)`);
      }
    }
  }

  /** Dev: the last band readout (only changes are logged). */
  private lastBandNote = '';

  /** Dev: a flat rectangle from `object`'s local x0..x1, y0..y1 (z = 0), in world space. */
  private reachRect(name: string, object: Object3D, x0: number, x1: number, y0: number, y1: number): ReachRect {
    object.updateWorldMatrix(true, false);
    return rectFromCorners(
      name,
      object.localToWorld(new Vector3(x0, y0, 0)),
      object.localToWorld(new Vector3(x1, y0, 0)),
      object.localToWorld(new Vector3(x0, y1, 0)),
    );
  }

  /** Dev: both shoulders and every grab point of the source slabs (reach-path.ts), from the eyes now. */
  private reachPaths(): { from: Vector3[]; to: Vector3[] } {
    this.readHead();
    const right = new Vector3().copy(this._colRight).setY(0).normalize();
    const from = shoulders(this._head, right).map((p) => new Vector3(p.x, p.y, p.z));
    const to: Vector3[] = [];
    for (const slab of this.sources.values()) {
      const doc = slab.doc;
      if (!slab.object.visible) {
        continue;
      }
      slab.object.updateWorldMatrix(true, false);
      const w = doc.widthMeters / 2;
      const corner = (x: number, y: number) => slab.object.localToWorld(new Vector3(x, y, 0));
      const top = slabVisualTopLocalY(doc);
      const bottom = slabBottomLocalY(doc);
      for (const p of grabPoints(corner(-w, top), corner(w, top), corner(-w, bottom), corner(w, bottom))) {
        to.push(new Vector3(p.x, p.y, p.z));
      }
    }
    return { from, to };
  }

  /**
   * Dev: how close each UI element comes to the straight path from either
   * shoulder to any source slab's grab point (reach-path.ts) -- the card,
   * the column (as two flat halves of its arc), the result or its outline,
   * the INNER | LEFT control; warns under REACH_PATH_MIN_CLEARANCE_METERS.
   * (The reach banner and the debug panel report theirs where they're placed.)
   */
  private noteReachPaths(
    a: SourceSlab,
    b: SourceSlab,
    joined: boolean,
    slot: { object: Object3D; width: number; top: number; bottom: number } | null,
    bar: PlacedBar,
  ): void {
    if (!import.meta.env.DEV || !this.debug) {
      return;
    }
    const { from, to } = this.reachPaths();
    const rects: ReachRect[] = [];
    const card = this.challengeLayout?.card;
    if (card && card.object.visible) {
      const w = card.widthMeters / 2;
      const h = card.heightMeters / 2;
      rects.push(this.reachRect('card', card.object, -w, w, -h, h));
    }
    const h = bar.heightMeters / 2;
    const arc = (x: number, y: number) => this.arcWorld(bar.object, x, y, 0, new Vector3());
    for (const [x0, x1] of [
      [0, bar.widthMeters / 2],
      [bar.widthMeters / 2, bar.widthMeters],
    ]) {
      rects.push(rectFromCorners('column', arc(x0, -h), arc(x1, -h), arc(x0, h)));
    }
    if (slot) {
      rects.push(this.reachRect(joined ? 'result' : 'outline', slot.object, -slot.width / 2, slot.width / 2, slot.bottom, slot.top));
    }
    if (joined && this.control.document.visible) {
      const c = this.control;
      const x0 = Math.min(c.innerCenterX, c.leftCenterX) - c.optionWidthMeters / 2;
      const x1 = Math.max(c.innerCenterX, c.leftCenterX) + c.optionWidthMeters / 2;
      rects.push(this.reachRect('INNER | LEFT', c.document, x0, x1, -c.optionHeightMeters / 2, c.optionHeightMeters / 2));
    }
    // One entry per element: the column's two halves as one.
    const byName = new Map<string, number>();
    for (const c of reachClearances(from, to, rects)) {
      byName.set(c.name, Math.min(byName.get(c.name) ?? Infinity, c.meters));
    }
    const clearances = [...byName].map(([name, meters]) => ({ name, meters, shoulder: -1, point: -1 }));
    this.debug.note(
      `reach paths (${a.id} and ${b.id}, ${joined ? 'joined' : 'before the join'}; straight, shoulders to the slabs' ` +
        `grab points, at least ${REACH_PATH_MIN_CLEARANCE_METERS * 100} cm): ${reachClearanceText(clearances)}`,
    );
    const close = clearances.filter((c) => c.meters < REACH_PATH_MIN_CLEARANCE_METERS);
    if (close.length > 0) {
      this.debug.warn(`a hand reaching for a slab passes within ${reachClearanceText(close)}`);
    }
  }

  /** Dev: the reach banner's clearance from the shoulder-to-slab paths, for its placement note. */
  private bannerReachText(): string {
    if (!import.meta.env.DEV) {
      return '';
    }
    const banner = this.reachBanner;
    const { from, to } = this.reachPaths();
    // Its scale is in its world matrix: local corners at its built size.
    const w = banner.widthMeters / 2;
    const h = banner.heightMeters / 2;
    const rect = this.reachRect('banner', banner.document, -w, w, -h, h);
    return `reach paths: ${reachClearanceText(reachClearances(from, to, [rect]))}`;
  }

  /**
   * Challenge mode: the puzzle card beside a top-anchored slot (the result
   * slab, or the silhouette before the join), on the side away from the
   * INNER | LEFT control (CARD_SIDE), bottoms aligned (nearer the gaze than
   * tops aligned), then toed in to face the eyes. Never lower, in view, than
   * CARD_CLEARANCE_DEG above `minBottomDeg` (the highest top edge of the
   * band and the slabs below it), so it never covers them. Beside rather
   * than above keeps the stack short, so the whole group sits nearer the gaze.
   */
  private placeCard(slot: Object3D, slotWidth: number, slotHeight: number, card: PlacedElement, minBottomDeg: number): void {
    slot.updateWorldMatrix(true, false);
    // Its bottom edge (it leans back, so in its own frame): the nearest
    // part, so the widest it looks from the eyes (half its width, as an angle).
    this._f.set(0, -slotHeight, 0);
    slot.localToWorld(this._f);
    const slotBottomY = this._f.y;
    this._d.copy(this._f).sub(this._head);
    this._d.y = 0;
    const slotHorizontal = Math.max(this._d.length(), 1e-3);
    this._d.divideScalar(slotHorizontal);
    const slotHalfAngle = Math.atan(slotWidth / 2 / slotHorizontal);
    // On an arc at the card's planned distance (its fonts are sized for it),
    // turned to the side by the slot's half-width, a gap, and its own half-width.
    const cardHalfAngle = Math.atan(card.widthMeters / 2 / PLANNED_CARD_DISTANCE_METERS);
    const turn = slotHalfAngle + MathUtils.degToRad(CARD_SIDE_GAP_DEG) + cardHalfAngle;
    // +angle about +Y turns toward the viewer's left.
    this._d.applyAxisAngle(UP, -CARD_SIDE * turn);
    // Bottoms aligned, then raised (if needed) to clear what's below.
    const half = card.heightMeters / 2;
    let centerY = slotBottomY + half;
    const minBottomRad = MathUtils.degToRad(minBottomDeg + CARD_CLEARANCE_DEG) - this.headPitchDown;
    let horizontal = PLANNED_CARD_DISTANCE_METERS;
    for (let i = 0; i < 3; i++) {
      const rise = centerY - this._head.y;
      horizontal = Math.sqrt(Math.max(1e-4, PLANNED_CARD_DISTANCE_METERS ** 2 - rise * rise));
      const lowestBottomY = this._head.y + horizontal * Math.tan(minBottomRad);
      if (centerY - half >= lowestBottomY - 1e-4) {
        break;
      }
      centerY = lowestBottomY + half;
    }
    card.object.position.copy(this._head).addScaledVector(this._d, horizontal);
    card.object.position.y = centerY;
    // Toed in: its face (+Z) toward the eyes, no roll.
    card.object.lookAt(this._head);
  }

  /** The highest top edge, in view (degrees from the gaze), of these elements: centered documents, or slabs (name tabs included). */
  private topEdgeDeg(centered: readonly PlacedElement[], slabs: readonly SourceSlab[]): number {
    let top = -90;
    for (const element of centered) {
      element.object.updateWorldMatrix(true, false);
      this._g.set(0, element.heightMeters / 2, 0);
      element.object.localToWorld(this._g);
      top = Math.max(top, degreesFromForward(this._head, this.headPitchDown, this._g));
    }
    for (const slab of slabs) {
      slab.object.updateWorldMatrix(true, false);
      this._g.set(0, slabVisualTopLocalY(slab.doc), 0);
      slab.object.localToWorld(this._g);
      top = Math.max(top, degreesFromForward(this._head, this.headPitchDown, this._g));
    }
    return top;
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

    // The group as it will be once joined: the column, the slot, the card.
    const slot = this.silhouette;
    if (!slot) {
      this.planGroup(a, b, false, 0);
      this.placeColumn(false);
      return;
    }
    a.object.getWorldQuaternion(this._q1);
    this._c.set(midX, topY, 0);
    a.object.localToWorld(this._c);
    // Fitted like the result it stands in for (its tallest state), at its own
    // height: so the outline and the result share their bottom edge.
    let fitHeight = slot.heightMeters;
    for (const key of [resultKey(a.id, b.id), resultKey(b.id, a.id)]) {
      fitHeight = Math.max(fitHeight, this.results.get(key)?.doc.heightMeters ?? 0);
    }
    const plan = this.placeInGroup(a, b, false, slot.object, slot.widthMeters, fitHeight, 0, slot.heightMeters);
    this.placeColumn(false);
    // Beside the slot (right), where it will be beside the result, and clear
    // of both slabs, measured at their highest top corners (a short target's
    // silhouette once let the card hang down onto a slab).
    this.placeCard(slot.object, plan.resultWidth, slot.heightMeters, layout.card, Math.max(plan.pairTopDeg, this.topEdgeDeg([], [a, b])));
    if (import.meta.env.DEV && this.debug) {
      this.noteBand(a, b, false, { object: slot.object, width: slot.widthMeters, top: 0, bottom: -slot.heightMeters });
    }
    if (import.meta.env.DEV && this.debug && this.world.visibilityState.peek() !== VisibilityState.NonImmersive) {
      // The result will share this bottom edge (compare its "edges ... bottom" line once joined).
      slot.object.updateWorldMatrix(true, false);
      this._g.set(0, -slot.heightMeters, 0);
      slot.object.localToWorld(this._g);
      this.debug.note(
        `target outline: bottom edge ${degreesFromForward(this._head, this.headPitchDown, this._g).toFixed(1)}° from the ` +
          `natural gaze, ${cm(slot.heightMeters)} tall (one row and its label)`,
      );
    }
    if (import.meta.env.DEV && this.debug) {
      this.noteCardClearance('before the join', [
        { name: `${a.id} slab`, object: a.object, width: a.doc.widthMeters, top: slabVisualTopLocalY(a.doc), bottom: slabBottomLocalY(a.doc) },
        { name: `${b.id} slab`, object: b.object, width: b.doc.widthMeters, top: slabVisualTopLocalY(b.doc), bottom: slabBottomLocalY(b.doc) },
        { name: 'column', object: layout.bar.object, width: layout.bar.widthMeters, top: layout.bar.heightMeters / 2, bottom: -layout.bar.heightMeters / 2, left: 0 },
        { name: 'silhouette', object: slot.object, width: slot.widthMeters, top: 0, bottom: -slot.heightMeters },
      ]);
    }
  }

  /**
   * Dev: the card's clearance in view from each element: the angular gap
   * between their view rectangles (yaw and pitch from the eyes), the larger
   * of the horizontal and vertical gaps; 0 or less is an overlap. Warns
   * below CARD_MIN_CLEARANCE_WARN_DEG. Allocates (dev only, per layout).
   */
  private noteCardClearance(
    when: string,
    /** `left`: the element's left edge in its frame (default: centered). */
    elements: { name: string; object: Object3D; width: number; top: number; bottom: number; left?: number }[],
  ): void {
    const card = this.challengeLayout?.card;
    // Not before a session: the cold-start layout uses a default head pose.
    if (!import.meta.env.DEV || !this.debug || !card || this.world.visibilityState.peek() === VisibilityState.NonImmersive) {
      return;
    }
    const rect = (object: Object3D, width: number, top: number, bottom: number, left = -width / 2) => {
      object.updateWorldMatrix(true, false);
      const r = { yaw0: Infinity, yaw1: -Infinity, pitch0: Infinity, pitch1: -Infinity };
      for (const x of [left, left + width]) {
        for (const y of [bottom, top]) {
          this._g.set(x, y, 0);
          object.localToWorld(this._g);
          const yaw = MathUtils.radToDeg(Math.atan2(this._g.x - this._head.x, -(this._g.z - this._head.z)));
          const pitch = degreesFromForward(this._head, this.headPitchDown, this._g);
          r.yaw0 = Math.min(r.yaw0, yaw);
          r.yaw1 = Math.max(r.yaw1, yaw);
          r.pitch0 = Math.min(r.pitch0, pitch);
          r.pitch1 = Math.max(r.pitch1, pitch);
        }
      }
      return r;
    };
    const c = rect(card.object, card.widthMeters, card.heightMeters / 2, -card.heightMeters / 2);
    const parts: string[] = [];
    let worst = Infinity;
    for (const element of elements) {
      const e = rect(element.object, element.width, element.top, element.bottom, element.left);
      const gapYaw = Math.max(e.yaw0 - c.yaw1, c.yaw0 - e.yaw1);
      const gapPitch = Math.max(e.pitch0 - c.pitch1, c.pitch0 - e.pitch1);
      const clearance = Math.max(gapYaw, gapPitch);
      worst = Math.min(worst, clearance);
      parts.push(`${element.name} ${clearance.toFixed(1)}°`);
    }
    card.object.updateWorldMatrix(true, false);
    this._g.setFromMatrixPosition(card.object.matrixWorld);
    const distance = this._g.distanceTo(this._head);
    const text = card.textFontMeters ? `, row text ${textAngleDeg(card.textFontMeters, distance).toFixed(2)}°` : '';
    this.debug.note(
      `puzzle card clearance in view (${when}): ${parts.join(', ')}; card ${distance.toFixed(2)} m from the eyes${text}, ` +
        `edges ${c.pitch0.toFixed(1)}° to ${c.pitch1.toFixed(1)}° from the gaze, ${c.yaw0.toFixed(1)}° to ${c.yaw1.toFixed(1)}° across`,
    );
    if (worst < CARD_MIN_CLEARANCE_WARN_DEG) {
      this.debug.warn(`puzzle card is only ${worst.toFixed(1)}° from another element (${when}); see the line above`);
    }
  }

  // --- Pinch and trigger presses -------------------------------------------------------

  /**
   * Every select start (a hand's pinch, a controller's trigger): a hand's
   * pinch presses only through its pointer, and only as a pinch motion
   * (PinchMotion); its pointer presses the first thing it hits: a control
   * option, a bar button (Filter and its chips included) or a result NULL
   * cell. A slab in front blocks it. Close to a button (the pointer hides) a
   * pinch does nothing -- only a fingertip poke presses there -- and at a
   * slab the pinch grabs (GrabSystem). A controller's trigger presses
   * through its ray the same way. The UIKit click a ray may also send counts
   * once (each target's debounce). Every select is logged (`debug`).
   */
  private updateSelect(): void {
    const controlLive =
      this.state.phase === 'joined' && this.control.document.visible && this.control.fade.peek() >= 0.5;
    // Challenge mode's bar (and free play's Recenter bar) takes presses before a join, too.
    if (!controlLive && !this.challengeLayout && !this.freeBarPlaced) {
      return;
    }
    for (const hand of HANDS) {
      // A pinch confirmed as clear this frame: it presses what its pointer was on when it started.
      if (this.pinchConfirmed[hand]) {
        this.pinchConfirmed[hand] = false;
        const now = this.tweens.now;
        this.pointers[hand].freeze.pressed(now);
        this.pinchMotion[hand].pressed(now);
        this.pinchMotionNull[hand].pressed(now);
        if (import.meta.env.DEV && this.debug) {
          const target = this.pinchTarget[hand];
          this.debug.note(
            `${hand} pinch confirmed after ${Math.round((now - this.pinchConfirm[hand].startAt) * 1000)} ms ` +
              `(closed to ${cm(this.pinchConfirm[hand].minGap)}): pressing ${target.name || target.target}` +
              (target.through ? `; the press ray passed through the ${target.through.id} slab` : ''),
          );
        }
        this.pressHit(hand, this.pinchTarget[hand], 'ray');
      }
      if (!this.input.xr.gamepads[hand]?.getSelectStart()) {
        continue;
      }
      const source = this.input.xr.getPrimaryInputSource(hand);
      if (source?.hand) {
        // Only from a pointer shown long enough, as a pinch motion, starting closed enough (pinchStartVerdict).
        if (!this.pinchStartOk[hand]) {
          if (import.meta.env.DEV && this.debug) {
            this.notePointerPinch(hand, this.pointers[hand], controlLive);
            this.debug.note(`${hand} pinch ignored: ${this.pinchBlockNote(hand)}`);
          }
          continue;
        }
        if (import.meta.env.DEV && this.debug) {
          this.debug.note(`${hand} pinch motion: tips opened to ${this.widestNote(hand)} in the last ${PINCH_OPENING_WINDOW_SECONDS} s`);
        }
        // Otherwise the hand pointer presses what it's on (its ray froze as the fingers closed).
        const pointer = this.pointers[hand];
        if (import.meta.env.DEV && this.debug) {
          this.notePointerPinch(hand, pointer, controlLive);
        }
        if (pointer.active) {
          // Every platform pinch may press once: never from a stale pose, nor a flicker of a pinch that pressed.
          const now = this.tweens.now;
          const block = pointer.freeze.pinchStart(pointer.fresh, now);
          const target = this.pinchTarget[hand];
          if (import.meta.env.DEV && this.debug) {
            this.noteNullAim(hand, target);
          }
          if (block === '') {
            // It presses once it closes (samplePinchMotion), what the pointer showed at its start (or just before).
            if (pressable(target)) {
              this.pinchConfirm[hand].pending = true;
            }
          } else if (import.meta.env.DEV && this.debug) {
            this.notePressBlocked(hand, pointer, block, now);
          }
        }
        continue;
      }
      // A controller: its target ray at the trigger (the SDK's pointer may click too; each target counts once).
      if (!this.readRay(hand)) {
        continue;
      }
      this.castRay(controlLive, HAND_POINTER_MAX_METERS);
      const hit = this._rayHit;
      if (import.meta.env.DEV && this.debug) {
        this.debug.note(
          `${hand} ray select (controller): ` +
            (hit.target === 'none' ? 'hit nothing' : `${hit.name} at ${hit.distance.toFixed(2)} m`) +
            (viewOnly(hit.target) ? ' (not a button: no press)' : '') +
            (hit.through ? `; it passed through the ${hit.through.id} slab` : ''),
        );
      }
      this.pressHit(hand, hit, 'ray');
    }
  }

  /**
   * Dev log, at a pinch start: the target lock (if the target came from just
   * before), a slab the ray passed through, and -- on the result -- how far
   * the ray was from the nearest NULL cell (it counts within NULL_RAY_TOLERANCE_METERS).
   */
  private noteNullAim(hand: (typeof HANDS)[number], target: RayHit): void {
    if (!import.meta.env.DEV || !this.debug) {
      return;
    }
    const parts: string[] = [];
    const age = this.pinchTargetAge[hand];
    if (age >= 0) {
      parts.push(`target locked from ${Math.round(age * 1000)} ms before (${target.name || target.target})`);
    }
    if (target.through) {
      parts.push(`the press ray passed through the ${target.through.id} slab`);
    }
    const view = this.active;
    if (view && (target.target === 'null' || target.target === 'result') && this.nearestNullCell(view, target.point)) {
      const { row, column, distance } = this._nullHit;
      parts.push(
        `ray ${cm(distance)} from the nearest NULL cell (row ${row}, column ${column}; counts within ${cm(NULL_RAY_TOLERANCE_METERS)})`,
      );
    }
    if (parts.length > 0) {
      this.debug.note(`${hand} pinch aim: ${parts.join('; ')}`);
    }
  }

  /** Dev log: why this frame's pinch start may not press. */
  private pinchBlockNote(hand: (typeof HANDS)[number]): string {
    if (!import.meta.env.DEV) {
      return '';
    }
    const pointer = this.pointers[hand];
    switch (this.pinchStartBlock[hand]) {
      case 'not-visible':
        return pointer.active
          ? `pointer shown only ${Math.round((this.tweens.now - pointer.activeSince) * 1000)} ms (needs ${POINTER_PRESS_MIN_VISIBLE_SECONDS * 1000} ms)`
          : `pointer not shown (${pointer.offReason || 'off'})`;
      case 'start-open':
        return `tips ${this.pinchStartGap[hand] < 0 ? 'untracked' : cm(this.pinchStartGap[hand])} apart at its start (needs <= ${cm(PINCH_START_MAX_METERS)})`;
      default: {
        // Why: the re-arm state since the last press (the tips must drop below the opening, then reach it).
        const kind = this.pinchStartKind[hand];
        const motion = (kind === 'other' ? this.pinchMotion : this.pinchMotionNull)[hand];
        const now = this.tweens.now;
        const ago = (t: number) => (Number.isFinite(t) ? `${Math.round((now - t) * 1000)} ms ago` : 'never');
        return (
          `no opening motion (widest ${this.widestNote(hand)} in the last ${PINCH_OPENING_WINDOW_SECONDS} s; ` +
          `needs ${cm(pinchOpenMetersFor(kind))}${kind === 'other' ? '' : ` (${kind === 'null' ? 'a NULL cell' : 'Prev or Next'})`}, ` +
          `opened again after a press; last press ${ago(motion.pressedAt)}, closed below it after that ${ago(motion.closedAfterPressAt)}, ` +
          `last at or above it ${ago(motion.lastOpenAt)})`
        );
      }
    }
  }

  /** Which opening a pinch on `target` needs: a NULL cell, Prev or Next (the bar's steppers), or anything else. */
  private pinchTargetKind(target: RayHit): PinchTargetKind {
    if (target.target === 'null') {
      return 'null';
    }
    if (target.target === 'bar') {
      const index = this.barButtonIndexAt(target.point);
      const name = index >= 0 ? this.challengeLayout?.bar.buttons[index]?.name : undefined;
      if (name === 'prev' || name === 'next') {
        return 'stepper';
      }
    }
    return 'other';
  }

  /** Dev log: the widest tip distance before this frame's pinch start. */
  private widestNote(hand: (typeof HANDS)[number]): string {
    const widest = this.pinchStartWidest[hand];
    return widest < 0 ? 'untracked' : cm(widest);
  }

  /** Presses what a ray hit (a control option, a bar button, a result NULL cell, Recenter); nothing for a slab or the result. */
  private pressHit(hand: (typeof HANDS)[number], hit: RayHit, path: PressPath): void {
    if (hit.target === 'control') {
      this.pressControl(hit.option, path);
    } else if (hit.target === 'bar') {
      joinBridge.challenge?.pressBarAt(hit.point, hand, path);
    } else if (hit.target === 'null' && this.active) {
      this.activateNullCell(this.active.key, hit.row, hit.column, path);
    } else if (hit.target === 'recenter') {
      this.pressRecenter(path);
    }
  }

  // --- The hand pointer ------------------------------------------------------------------

  /**
   * Each frame, per hand: the pointer (the hand's WebXR target ray, smoothed,
   * frozen as a pinch closes, at most HAND_POINTER_MAX_METERS long, drawn as
   * a thin ray with a cursor dot) while the hand is raised in front of the
   * body -- seated and leaning back counts -- and isn't doing something near:
   * a fingertip at a band button (poke) or the palm at a slab (near grab).
   * What it's on is hovered if it's pressable (outlined, or a NULL's outline
   * strengthened; a slab, the card or the result between NULL cells get only
   * the cursor dot), and a pinch presses it (updateSelect). The SDK's
   * own hand ray is off, so there's never a double line; controllers keep it.
   */
  private updateHandPointers(delta: number): void {
    const controlLive =
      this.state.phase === 'joined' && this.control.document.visible && this.control.fade.peek() >= 0.5;
    const head = this.player.head;
    head.updateWorldMatrix(true, false);
    this._pointerHead.setFromMatrixPosition(head.matrixWorld);
    head.getWorldQuaternion(this._q2);
    this._pointerFwd.set(0, 0, -1).applyQuaternion(this._q2);
    this._pointerFwd.y = 0;
    if (this._pointerFwd.lengthSq() < 1e-6) {
      this._pointerFwd.set(0, 0, -1);
    }
    this._pointerFwd.normalize();
    const now = this.tweens.now;

    HANDS.forEach((hand, index) => {
      const p = this.pointers[hand];
      // The platform's pinch ended: the freeze re-arms, and the flicker rule times the opening.
      if (this.input.xr.gamepads[hand]?.getSelectEnd()) {
        p.freeze.released(now);
      }
      const source = this.input.xr.getPrimaryInputSource(hand);
      const isHand = !!source?.hand;
      if (this.sdkRayOff[hand] !== isHand) {
        this.input.xr.multiPointers[hand].toggleSubPointer('ray', !isHand);
        this.sdkRayOff[hand] = isHand;
      }
      // Why it's off, as a short code (the words are only in the dev log).
      let reason: PointerOffReason | '' = '';
      if (!source || !isHand) {
        reason = 'untracked';
      } else if (!readWristPoint(this.world, this.player, source, this._pointerWrist)) {
        reason = 'lost';
      } else {
        this._pointerLocal.subVectors(this._pointerWrist, this._pointerHead);
        p.forward = this._pointerLocal.dot(this._pointerFwd);
        p.below = -this._pointerLocal.y;
        if (!pointerRaised(p.forward, p.below, p.active)) {
          reason = p.below > HAND_POINTER_MAX_BELOW_EYES_METERS ? 'lowered' : 'body';
        } else if (this.fingertipAtButton(source, controlLive)) {
          reason = 'poke';
        } else if (this.nearGrab(hand)) {
          reason = 'grab';
        }
      }
      // The ray straight from this frame: none (tracking lost) or unchanged too long (stale) hides it.
      p.fresh = false;
      if (!reason && source) {
        if (!readTargetRay(this.world, this.player, source, this._rayOrigin, this._rayDir)) {
          reason = 'noray';
        } else if (
          p.stale.step(now, this._rayOrigin.x, this._rayOrigin.y, this._rayOrigin.z, this._rayDir.x, this._rayDir.y, this._rayDir.z) &&
          !EMULATED_HANDS
        ) {
          reason = 'stale';
        } else {
          p.fresh = true;
        }
      }
      if (reason || !source) {
        if (reason !== 'stale') {
          p.stale.reset();
        }
        this.setPointerActive(hand, p, false, reason || 'untracked');
        this.pointerLines.progress[index].value = 0;
        this.pointerDots[hand].hide();
        return;
      }

      // The platform ray, tilted up by the tuning offset (0 by default).
      if (HAND_POINTER_PITCH_OFFSET_DEG !== 0) {
        this._pointerAxis.crossVectors(this._rayDir, UP).normalize();
        this._rayDir.applyAxisAngle(this._pointerAxis, MathUtils.degToRad(HAND_POINTER_PITCH_OFFSET_DEG));
      }
      p.history.push(
        now,
        this._rayOrigin.x,
        this._rayOrigin.y,
        this._rayOrigin.z,
        this._rayDir.x,
        this._rayDir.y,
        this._rayDir.z,
      );
      // Frozen while a pinch closes (at most HAND_POINTER_FREEZE_MAX_SECONDS):
      // at the pose from just before the fingers started closing.
      const tipsTracked =
        readJointsPoint(this.world, this.player, source, THUMB_TIP, this._pointerThumb) &&
        readJointsPoint(this.world, this.player, source, INDEX_TIP, this._pointerIndex);
      const event = p.freeze.step(tipsTracked ? this._pointerThumb.distanceTo(this._pointerIndex) : null, now);
      const frozen = p.freeze.frozen;
      if (import.meta.env.DEV && this.debug && event === 'expired') {
        this.debug.note(
          `${hand} pointer unfrozen: the fingers stayed closed for over ${HAND_POINTER_FREEZE_MAX_SECONDS} s ` +
            `(the ray follows the hand again; the next pinch still presses)`,
        );
      }
      if (event === 'started' && p.history.at(now, HAND_POINTER_FREEZE_LOOKBACK_SECONDS, this._poseBuffer)) {
        const b = this._poseBuffer;
        p.origin.set(b[0], b[1], b[2]);
        p.dir.set(b[3], b[4], b[5]).normalize();
      } else if (!frozen) {
        if (!p.active) {
          p.origin.copy(this._rayOrigin);
          p.dir.copy(this._rayDir);
        } else {
          const alpha = smoothingAlpha(delta);
          p.origin.lerp(this._rayOrigin, alpha);
          p.dir.lerp(this._rayDir, alpha).normalize();
        }
      }
      p.frozen = frozen;
      this.setPointerActive(hand, p, true, '');

      // What it's on.
      this._rayOrigin.copy(p.origin);
      this._rayDir.copy(p.dir);
      this.castRay(controlLive, HAND_POINTER_MAX_METERS);
      copyRayHit(this._rayHit, p.hit);
      p.barIndex = p.hit.target === 'bar' ? this.barButtonIndexAt(p.hit.point) : -1;

      // The ray and its cursor.
      if (p.hit.target !== 'none') {
        this._pointerEnd.copy(p.hit.point);
        this.pointerDots[hand].place(p.hit.point, this._pointerHead);
      } else {
        this._pointerEnd.copy(p.origin).addScaledVector(p.dir, POINTER_STUB_METERS);
        this.pointerDots[hand].hide();
      }
      this.pointerLines.setEndpoints(index, p.origin, this._pointerEnd);
      this.pointerLines.progress[index].value = 1;
      if (import.meta.env.DEV && this.debug) {
        this.notePointerHover(hand, p);
      }
    });
    this.pointerLines.update();
    this.applyPointerHover();
  }

  /** Turns a hand's pointer on or off; off forgets its aim and hit. Dev: logs each change, with where the hand is. */
  private setPointerActive(hand: (typeof HANDS)[number], p: HandPointer, active: boolean, reason: PointerOffReason | ''): void {
    if (p.active === active && (active || p.offReason === reason)) {
      return;
    }
    const was = p.active;
    p.active = active;
    p.offReason = reason;
    if (active && !was) {
      p.activeSince = this.tweens.now;
    }
    if (!active) {
      // Unfrozen, but the press gate stays (a flicker off and on mid-pinch mustn't allow a second press).
      p.frozen = false;
      p.freeze.frozen = false;
      p.history.clear();
      p.hit.target = 'none';
      p.barIndex = -1;
    }
    if (import.meta.env.DEV && this.debug && was !== active) {
      const lost =
        reason === 'stale'
          ? ` for ${Math.round(p.stale.unchangedFor(this.tweens.now) * 1000)} ms: pointer hidden`
          : reason === 'noray'
            ? ': pointer hidden'
            : '';
      this.debug.note(
        `${hand} pointer ${active ? 'on' : `off (${pointerOffText(reason)}${lost})`}: wrist ${p.forward.toFixed(2)} m ahead ` +
          `of the head, ${p.below.toFixed(2)} m below the eyes`,
      );
    }
  }

  /** Whether `source`'s index fingertip is just in front of a band button (the control's, the bar's, Recenter): poke applies. */
  private fingertipAtButton(source: XRInputSource, controlLive: boolean): boolean {
    if (!readJointsPoint(this.world, this.player, source, INDEX_TIP, this._pointerIndex)) {
      return false;
    }
    if (controlLive && this.nearButtons(this.control.document, this.controlTargets, this.control.optionHeightMeters)) {
      return true;
    }
    const bar = this.challengeLayout?.bar ?? this.freeBarPlaced;
    return !!bar && bar.object.visible && this.nearButtons(bar.object, bar.buttons, bar.buttonHeightMeters, true);
  }

  /**
   * `_pointerIndex` (a fingertip) just in front of one of `buttons` on
   * `object` (within a poke's margin). `curved`: the band's bars, whose
   * buttons sit on its arc (unrolled first).
   */
  private nearButtons(object: Object3D, buttons: readonly ButtonRect[], height: number, curved = false): boolean {
    object.updateWorldMatrix(true, false);
    this._pointerLocal.copy(this._pointerIndex);
    object.worldToLocal(this._pointerLocal);
    if (curved) {
      unrollArc(this._pointerLocal, BAND_ARC_RADIUS_METERS, this.bandLean);
    }
    const z = this._pointerLocal.z;
    if (z > HAND_POINTER_NEAR_BUTTON_METERS || z < -CONTACT_HOVER_BEHIND_METERS * 3) {
      return false;
    }
    for (const button of buttons) {
      if (
        Math.abs(this._pointerLocal.x - button.centerX) <= button.width / 2 + CONTROL_PINCH_MARGIN_METERS &&
        Math.abs(this._pointerLocal.y - (button.centerY ?? 0)) <= height / 2 + CONTROL_PINCH_MARGIN_METERS
      ) {
        return true;
      }
    }
    return false;
  }

  /** Which of the puzzle bar's buttons a world point on its face is on, or -1. */
  private barButtonIndexAt(point: Vector3): number {
    const bar = this.challengeLayout?.bar;
    if (!bar) {
      return -1;
    }
    bar.object.updateWorldMatrix(true, false);
    this._pointerLocal.copy(point);
    bar.object.worldToLocal(this._pointerLocal);
    unrollArc(this._pointerLocal, BAND_ARC_RADIUS_METERS, this.bandLean);
    // The nearest button within the bar's press margin (as a press there would choose).
    let best = -1;
    let bestDistance = CONTROL_PINCH_MARGIN_METERS;
    for (let i = 0; i < bar.buttons.length; i++) {
      const distance = buttonDistance(this._pointerLocal, bar.buttons[i], bar.buttonHeightMeters);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  /**
   * Both hands' pointers as one hover state, applied only on a change: the
   * control option outlined, the bar button outlined (via the challenge
   * layout), free play's Recenter outlined: pressable targets only. (NULL
   * cells: updateNullPokeAndHover; Recenter's label: updateRecenterHover.)
   */
  private applyPointerHover(): void {
    let option: JoinType | null = null;
    let barIndex = -1;
    let recenter = false;
    let exit = false;
    for (const hand of HANDS) {
      const p = this.pointers[hand];
      if (!p.active) {
        continue;
      }
      if (p.hit.target === 'control' && option === null) {
        option = p.hit.option;
      } else if (p.hit.target === 'bar' && barIndex < 0) {
        barIndex = p.barIndex;
      } else if (p.hit.target === 'recenter') {
        recenter = true;
      } else if (p.hit.target === 'exit') {
        exit = true;
      }
    }
    const hover = this.pointerHover;
    // A fingertip just in front of an option hovers it too (updateControlPoke).
    option ??= this.controlFingerOption;
    if (option !== hover.option) {
      setTargetHover(this.control.inner, option === 'inner');
      setTargetHover(this.control.left, option === 'left');
      hover.option = option;
    }
    if (barIndex !== hover.barIndex) {
      this.challengeLayout?.bar.onPointerHover?.(barIndex, hover.barIndex);
      hover.barIndex = barIndex;
    }
    if (recenter !== hover.recenter && this.freeBar) {
      setTargetHover(this.freeBar.recenter.container, recenter);
    }
    hover.recenter = recenter;
    if (exit !== hover.exit && this.freeBar) {
      setTargetHover(this.freeBar.exit.container, exit);
    }
    hover.exit = exit;
  }

  /** Dev: a pointer pinch that wasn't allowed to press, and why. */
  private notePressBlocked(hand: (typeof HANDS)[number], p: HandPointer, block: PressBlock, now: number): void {
    if (!import.meta.env.DEV || !this.debug) {
      return;
    }
    const target = p.hit.target === 'none' ? 'nothing' : p.hit.target === 'bar' ? `bar button ${p.barIndex}` : p.hit.name;
    const why =
      block === 'stale'
        ? `stale pose (ray unchanged for ${Math.round(p.stale.unchangedFor(now) * 1000)} ms)`
        : block === 'flicker'
          ? `flicker: the pinch ended only ${Math.round(p.freeze.openFor(now) * 1000)} ms ago and had already pressed ` +
            `(same pinch; needs ${HAND_POINTER_FLICKER_OPEN_SECONDS * 1000} ms open)`
          : `repeat pinch ${Math.round(p.freeze.sinceLastPress(now) * 1000)} ms after the last press ` +
            `(needs ${HAND_POINTER_PRESS_GAP_SECONDS * 1000} ms)`;
    this.debug.note(`${hand} pointer press blocked: ${why}; it was on ${target}`);
  }

  /** Dev: a hand pointer's hover changes (at most every POINTER_HOVER_LOG_SECONDS). */
  private notePointerHover(hand: (typeof HANDS)[number], p: HandPointer): void {
    if (!import.meta.env.DEV || !this.debug) {
      return;
    }
    const name = p.hit.target === 'none' ? 'nothing' : p.hit.target === 'bar' ? `bar button ${p.barIndex}` : p.hit.name;
    if (name === p.hoverKey || this.tweens.now - p.hoverLogAt < POINTER_HOVER_LOG_SECONDS) {
      return;
    }
    p.hoverKey = name;
    p.hoverLogAt = this.tweens.now;
    this.debug.note(
      `${hand} pointer on ${name}${p.hit.target === 'none' ? '' : ` at ${p.hit.distance.toFixed(2)} m`}` +
        `${p.frozen ? ' (frozen: pinch closing)' : ''}`,
    );
  }

  /**
   * Dev: a pinch with the pointer: what it hit (or the nearest band target),
   * the angle between the ray and that target's center and how far above or
   * below it the ray points (to tune HAND_POINTER_PITCH_OFFSET_DEG from data),
   * the ray's pitch and yaw, and where the hand was.
   */
  private notePointerPinch(hand: (typeof HANDS)[number], p: HandPointer, controlLive: boolean): void {
    if (!import.meta.env.DEV || !this.debug) {
      return;
    }
    if (!p.active) {
      this.debug.note(`${hand} pointer pinch with the pointer off (${pointerOffText(p.offReason)}): no far press`);
      return;
    }
    // Candidate centers: the hit's, else every band target's (the nearest by angle).
    const candidates: { name: string; center: Vector3 }[] = [];
    const at = (object: Object3D, x: number, y: number) => {
      object.updateWorldMatrix(true, false);
      return object.localToWorld(new Vector3(x, y, 0));
    };
    const hit = p.hit;
    const view = this.active;
    if (hit.target === 'control') {
      candidates.push({ name: hit.name, center: at(this.control.document, hit.option === 'inner' ? this.control.innerCenterX : this.control.leftCenterX, 0) });
    } else if (hit.target === 'bar' && this.challengeLayout && p.barIndex >= 0) {
      const button = this.challengeLayout.bar.buttons[p.barIndex];
      candidates.push({ name: `bar button "${button.name}"`, center: this.arcWorld(this.challengeLayout.bar.object, button.centerX, button.centerY, 0, new Vector3()) });
    } else if (hit.target === 'recenter' && this.freeBarPlaced) {
      const recenter = this.freeBarPlaced.buttons[0];
      candidates.push({ name: hit.name, center: this.arcWorld(this.freeBarPlaced.object, recenter.centerX, recenter.centerY, 0, new Vector3()) });
    } else if (hit.target === 'null' && view) {
      const span = view.doc.columnSpans[hit.column];
      candidates.push({ name: hit.name, center: at(view.object, (span.x0 + span.x1) / 2, rowCenterLocalY(view.doc, view.rowSlot[hit.row])) });
    } else if (hit.target === 'slab' && hit.slab) {
      candidates.push({ name: hit.name, center: at(hit.slab.object, 0, 0) });
    } else {
      if (controlLive) {
        candidates.push({ name: 'INNER', center: at(this.control.document, this.control.innerCenterX, 0) });
        candidates.push({ name: 'LEFT', center: at(this.control.document, this.control.leftCenterX, 0) });
      }
      const bar = this.challengeLayout?.bar ?? this.freeBarPlaced;
      if (bar && bar.object.visible) {
        for (const button of bar.buttons) {
          candidates.push({ name: `bar button "${button.name}"`, center: this.arcWorld(bar.object, button.centerX, button.centerY, 0, new Vector3()) });
        }
      }
    }
    let best: { name: string; angle: number; pitchDelta: number } | null = null;
    for (const candidate of candidates) {
      const to = candidate.center.sub(p.origin);
      const angle = angleBetweenDeg(p.dir.x, p.dir.y, p.dir.z, to.x, to.y, to.z);
      if (!best || angle < best.angle) {
        best = { name: candidate.name, angle, pitchDelta: pitchDeg(p.dir.x, p.dir.y, p.dir.z) - pitchDeg(to.x, to.y, to.z) };
      }
    }
    const aim = best
      ? `aim ${best.angle.toFixed(1)}° off ${hit.target === 'none' ? `the nearest target, ${best.name}` : 'its center'} ` +
        `(ray ${Math.abs(best.pitchDelta).toFixed(1)}° ${best.pitchDelta >= 0 ? 'above' : 'below'} it)`
      : 'no band target to compare';
    const yaw = MathUtils.radToDeg(Math.atan2(p.dir.x, -p.dir.z));
    this.debug.note(
      `${hand} pointer pinch: ${hit.target === 'none' ? 'hit nothing' : `${hit.name} at ${hit.distance.toFixed(2)} m`}` +
        `${viewOnly(hit.target) ? ' (not a button: no press)' : ''}; ${aim}; ` +
        `ray pitch ${pitchDeg(p.dir.x, p.dir.y, p.dir.z).toFixed(1)}°, yaw ${yaw.toFixed(1)}°` +
        `${p.frozen ? ' (frozen)' : ''}; wrist ${p.forward.toFixed(2)} m ahead, ${p.below.toFixed(2)} m below the eyes; ` +
        `released ${Number.isFinite(p.freeze.openFor(this.tweens.now)) ? `${Math.round(p.freeze.openFor(this.tweens.now) * 1000)} ms` : 'never'} before`,
    );
  }

  /** Whether `hand`'s grip is at a source slab's grab surface (its pinch grabs; it presses nothing far away). */
  private nearGrab(hand: (typeof HANDS)[number]): boolean {
    const grip = this.player.gripSpaces[hand];
    grip.updateWorldMatrix(true, false);
    this._g.setFromMatrixPosition(grip.matrixWorld);
    for (const slab of this.sources.values()) {
      if (distanceToSlab(this._g, slab, this._e) <= GRAB_SPHERE_RADIUS_METERS + NEAR_GRAB_MARGIN_METERS) {
        return true;
      }
    }
    return false;
  }

  /** `hand`'s target ray (world) into `_rayOrigin` / `_rayDir`; false without an input source. */
  private readRay(hand: (typeof HANDS)[number]): boolean {
    if (!this.input.xr.getPrimaryInputSource(hand)) {
      return false;
    }
    const raySpace = this.player.raySpaces[hand];
    raySpace.updateWorldMatrix(true, false);
    this._rayOrigin.setFromMatrixPosition(raySpace.matrixWorld);
    raySpace.getWorldQuaternion(this._q2);
    this._rayDir.set(0, 0, -1).applyQuaternion(this._q2);
    return true;
  }

  /**
   * Intersects the ray in `_rayOrigin` / `_rayDir` with `object`'s face (its
   * local z = 0, hit from the front) into `outLocal`; returns the distance
   * along the ray (meters), or Infinity. Objects aren't scaled.
   */
  /**
   * Intersects the ray in `_rayOrigin` / `_rayDir` with a band bar's arc
   * (band-arc.ts) into `outLocal`, unrolled (x its arc length, y its height,
   * z 0); returns the distance along the ray (meters), or Infinity.
   */
  private rayArc(object: Object3D, outLocal: Vector3): number {
    // The band's arc: a level circle around the eyes it was placed for.
    const t = rayCircleDistance(
      this._rayOrigin.x - this._bandEyes.x,
      this._rayOrigin.z - this._bandEyes.z,
      this._rayDir.x,
      this._rayDir.z,
      BAND_ARC_RADIUS_METERS * Math.cos(this.bandLean),
    );
    if (!Number.isFinite(t)) {
      return Infinity;
    }
    object.updateWorldMatrix(true, false);
    outLocal.copy(this._rayOrigin).addScaledVector(this._rayDir, t);
    object.worldToLocal(outLocal);
    unrollArc(outLocal, BAND_ARC_RADIUS_METERS, this.bandLean);
    return t;
  }

  /**
   * A point on a band bar's arc, in world space, into `out`: arc length `s`
   * from its left edge, height `y`, `lift` off the face toward the eyes. With
   * `outQuat`: the orientation facing the eyes there (no roll).
   */
  private arcWorld(object: Object3D, s: number, y: number, lift: number, out: Vector3, outQuat?: Quaternion): Vector3 {
    const place = arcPlace(s, y, BAND_ARC_RADIUS_METERS, this.bandLean, this._arcPlace);
    out.set(place.x, place.y, place.z);
    // Lifted toward the eyes, which sit at (0, 0, radius) in the bar's frame.
    this._arcLift.set(-place.x, -place.y, BAND_ARC_RADIUS_METERS - place.z).normalize();
    out.addScaledVector(this._arcLift, lift);
    object.updateWorldMatrix(true, false);
    object.localToWorld(out);
    if (outQuat) {
      // As the view turns it (challenge-view.ts): Euler XYZ, facing the eyes, level.
      object.getWorldQuaternion(outQuat);
      outQuat.multiply(this._arcQ.setFromEuler(this._arcEuler.set(place.rx, place.ry, place.rz, 'XYZ')));
    }
    return out;
  }

  private rayPlane(object: Object3D, outLocal: Vector3): number {
    object.updateWorldMatrix(true, false);
    this._rayLocalO.copy(this._rayOrigin);
    object.worldToLocal(this._rayLocalO);
    this._rayLocalD.copy(this._rayOrigin).add(this._rayDir);
    object.worldToLocal(this._rayLocalD);
    this._rayLocalD.sub(this._rayLocalO);
    if (this._rayLocalO.z <= 0 || this._rayLocalD.z >= -1e-6) {
      return Infinity;
    }
    const distance = -this._rayLocalO.z / this._rayLocalD.z;
    outLocal.copy(this._rayLocalO).addScaledVector(this._rayLocalD, distance);
    return distance;
  }

  /**
   * The first thing the ray in `_rayOrigin` / `_rayDir` hits, into
   * `_rayHit`: a control option (while live), a puzzle bar button, a result
   * NULL cell -- or, blocking what's behind, the result slab elsewhere or a
   * source slab.
   */
  private castRay(controlLive: boolean, maxDistance = Infinity): void {
    const hit = this._rayHit;
    hit.target = 'none';
    hit.distance = Infinity;
    hit.name = '';
    hit.slab = null;
    hit.through = null;
    const local = this._rayLocal;
    // Names are only for the dev log (the pointer casts every frame: no strings in production).
    const naming = import.meta.env.DEV && !!this.debug;

    if (controlLive) {
      const control = this.control;
      const t = this.rayPlane(control.document, local);
      if (t < hit.distance) {
        const dy = Math.max(0, Math.abs(local.y) - control.optionHeightMeters / 2);
        const inner = Math.hypot(Math.max(0, Math.abs(local.x - control.innerCenterX) - control.optionWidthMeters / 2), dy);
        const left = Math.hypot(Math.max(0, Math.abs(local.x - control.leftCenterX) - control.optionWidthMeters / 2), dy);
        if (Math.min(inner, left) <= RAY_BUTTON_TOLERANCE_METERS) {
          hit.target = 'control';
          hit.distance = t;
          hit.option = inner <= left ? 'inner' : 'left';
          hit.name = naming ? `the ${hit.option.toUpperCase()} option` : '';
        }
      }
    }

    const bar = this.challengeLayout?.bar;
    if (bar && bar.object.visible) {
      // Its buttons sit on the band's arc: the ray meets that.
      const t = this.rayArc(bar.object, local);
      if (t < hit.distance) {
        this._rayWorld.copy(this._rayOrigin).addScaledVector(this._rayDir, t);
        if ((joinBridge.challenge?.barDistance(this._rayWorld) ?? Infinity) < Infinity) {
          hit.target = 'bar';
          hit.distance = t;
          hit.point.copy(this._rayWorld);
          hit.name = 'a puzzle bar button';
        }
      }
    }

    const freeBar = this.freeBarPlaced;
    if (freeBar && freeBar.object.visible) {
      const t = this.rayArc(freeBar.object, local);
      if (t < hit.distance && this.freeBarDistance(local) <= RAY_BUTTON_TOLERANCE_METERS) {
        hit.target = 'recenter';
        hit.distance = t;
        hit.name = naming ? 'the Recenter button' : '';
      } else if (t < hit.distance && this.freeBarDistance(local, 1) <= RAY_BUTTON_TOLERANCE_METERS) {
        hit.target = 'exit';
        hit.distance = t;
        hit.name = naming ? 'the Exit button' : '';
      }
    }

    const view = this.active;
    if (view && this.state.phase === 'joined' && view.doc.fade.peek() >= 0.5) {
      const t = this.rayPlane(view.object, local);
      if (t < hit.distance) {
        this._rayWorld.copy(local);
        view.object.localToWorld(this._rayWorld);
        if (this.nearestNullCell(view, this._rayWorld) && this._nullHit.distance <= NULL_RAY_TOLERANCE_METERS) {
          hit.target = 'null';
          hit.distance = t;
          hit.row = this._nullHit.row;
          hit.column = this._nullHit.column;
          hit.name = naming ? `the NULL cell at row ${hit.row}, ${view.result.columns[hit.column].label}` : '';
        } else if (
          Math.abs(local.x) <= view.doc.widthMeters / 2 &&
          local.y <= slabVisualTopLocalY(view.doc) &&
          local.y >= slabBottomLocalY(view.doc)
        ) {
          hit.target = 'result';
          hit.distance = t;
          hit.name = 'the result slab (not on a NULL cell)';
        }
      }
    }

    // Source slabs never block a press: the ray passes through them to what's
    // behind (the result, the card, the controls); a slab is the hit only when
    // nothing is behind it (the cursor dot rests on it). Near grab is GrabSystem's, unaffected.
    let slabHit: SourceSlab | null = null;
    let slabDistance = Infinity;
    for (const slab of this.sources.values()) {
      const t = this.rayPlane(slab.object, local);
      if (
        t < slabDistance &&
        Math.abs(local.x) <= slab.doc.widthMeters / 2 &&
        local.y <= slabVisualTopLocalY(slab.doc) &&
        local.y >= slabBottomLocalY(slab.doc)
      ) {
        slabHit = slab;
        slabDistance = t;
      }
    }
    if (slabHit && hit.target === 'none') {
      hit.target = 'slab';
      hit.distance = slabDistance;
      hit.slab = slabHit;
      hit.name = naming ? `the ${slabHit.id} slab` : '';
    } else if (slabHit && slabDistance < hit.distance) {
      hit.through = slabHit;
    }

    // The card (challenge mode): view only, never a press, and never in front
    // of a slab -- the cursor dot rests on it only when nothing else is on the ray.
    const card = this.challengeLayout?.card;
    if (hit.target === 'none' && card && card.object.visible) {
      const t = this.rayPlane(card.object, local);
      if (t < Infinity && Math.abs(local.x) <= card.widthMeters / 2 && Math.abs(local.y) <= card.heightMeters / 2) {
        hit.target = 'card';
        hit.distance = t;
        hit.name = naming ? 'the puzzle card' : '';
      }
    }

    // Out of range is a miss; otherwise where it hit.
    if (hit.distance > maxDistance) {
      hit.target = 'none';
      hit.distance = Infinity;
      hit.slab = null;
    } else if (hit.target !== 'none') {
      hit.point.copy(this._rayOrigin).addScaledVector(this._rayDir, hit.distance);
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

    // The result's height now (it's anchored by its bottom edge).
    const shownHeight = shownHeightMeters(view.doc);
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
        `${slab.id} slab: center ${distance.toFixed(2)} m from the eyes (view target ${SLAB_VIEW_DISTANCE_METERS} m; ` +
          `near reach: ${distance <= TOUCH_REACH_MAX_METERS + 0.005 ? 'yes' : 'no (ray grab)'}); ` +
          `${textNote(`${slab.id} slab`, slab.doc.rowFontMeters, distance)}; ${edges}`,
      );
    }

    // The pair's top edge at the seam (where the result's floor is measured), not at the slabs' centers.
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
    // On the band's arc it turns to face the eyes (a yaw against the pair is expected); it never rolls.
    if (Math.abs(controlRollDeg) > 0.5) {
      debug.warn(`join-type control rolls ${controlRollDeg.toFixed(1)}° (it should face the eyes level)`);
    }
    if (controlDistance > TOUCH_REACH_MAX_METERS + 0.005) {
      debug.warn(`join-type control is ${controlDistance.toFixed(2)} m from the eyes, beyond the reach limit`);
    }
    if (clearance < CONTROL_SLAB_CLEARANCE_METERS - 0.005) {
      debug.warn(`join-type control is only ${cm(clearance)} from a source slab (target ${cm(CONTROL_SLAB_CLEARANCE_METERS)})`);
    }

    // Challenge mode's puzzle bar (the column): touched, like the control. Its
    // buttons sit on an arc (band-arc.ts): measured where they really are.
    const bar = this.challengeLayout?.bar;
    if (bar) {
      // Every touch target in the column: size, distance from the eyes, and
      // clearance to the slabs (its four corners and center).
      type Target = { name: string; at: (x: number, y: number, out: Vector3) => Vector3; centerX: number; centerY: number; width: number; height: number };
      const onControl = (x: number, y: number, out: Vector3) => control.document.localToWorld(out.set(x, y, 0));
      const onArc = (x: number, y: number, out: Vector3) => this.arcWorld(bar.object, x, y, 0, out);
      const targets: Target[] = [
        { name: 'INNER', at: onControl, centerX: control.innerCenterX, centerY: 0, width: control.optionWidthMeters, height: control.optionHeightMeters },
        { name: 'LEFT', at: onControl, centerX: control.leftCenterX, centerY: 0, width: control.optionWidthMeters, height: control.optionHeightMeters },
        ...bar.buttons.map((button) => ({
          name: button.name,
          at: onArc,
          centerX: button.centerX,
          centerY: button.centerY,
          width: button.width,
          height: bar.buttonHeightMeters,
        })),
      ];
      const lines = targets.map((target) => {
        target.at(target.centerX, target.centerY, this._d);
        const distance = this._d.distanceTo(this._head);
        let targetClearance = Infinity;
        for (const [sx, sy] of [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
          target.at(target.centerX + (sx * target.width) / 2, target.centerY + (sy * target.height) / 2, this._d);
          targetClearance = Math.min(targetClearance, distanceToSlab(this._d, left, this._e), distanceToSlab(this._d, right, this._e));
        }
        if (distance > TOUCH_REACH_MAX_METERS + 0.005 || targetClearance < CONTROL_SLAB_CLEARANCE_METERS - 0.005) {
          debug.warn(`${target.name} target: ${distance.toFixed(2)} m from the eyes, ${cm(targetClearance)} from a slab`);
        }
        return `${target.name} ${cm(target.width)} x ${cm(target.height)}, ${distance.toFixed(2)} m, clearance ${cm(targetClearance)}`;
      });
      debug.note(`column touch targets (size, distance from the eyes, clearance to the slabs): ${lines.join('; ')}`);
    }

    // The card against every element (the RIGHT slab still at its dock pose).
    this.noteCardClearance('joined', [
      { name: `${left.id} slab`, object: left.object, width: left.doc.widthMeters, top: slabVisualTopLocalY(left.doc), bottom: slabBottomLocalY(left.doc) },
      { name: `${right.id} slab`, object: right.object, width: right.doc.widthMeters, top: slabVisualTopLocalY(right.doc), bottom: slabBottomLocalY(right.doc) },
      { name: 'control', object: control.document, width: control.widthMeters, top: control.heightMeters / 2, bottom: -control.heightMeters / 2 },
      ...(bar
        ? [{ name: 'column', object: bar.object, width: bar.widthMeters, top: bar.heightMeters / 2, bottom: -bar.heightMeters / 2, left: 0 }]
        : []),
      { name: 'result', object: view.object, width: view.doc.widthMeters, top: slabVisualTopLocalY(view.doc), bottom: -shownHeight },
    ]);

    // The column's buttons (reach) and the group's extent, the RIGHT slab at its dock pose.
    this.noteBand(left, right, true, { object: view.object, width: view.doc.widthMeters, top: slabVisualTopLocalY(view.doc), bottom: -shownHeight });
    // The column against the result (left of it, by COLUMN_RESULT_GAP_DEG) and the slabs (above them, never over one).
    const column = this.challengeLayout?.bar ?? this.freeBarPlaced;
    let columnNote = '';
    if (column) {
      this._d.set(-view.doc.widthMeters / 2, -shownHeight, 0);
      view.object.localToWorld(this._d);
      const resultLeftDeg = this.yawInPair(this._d);
      this.arcWorld(column.object, column.widthMeters, -column.heightMeters / 2, 0, this._e);
      const columnRightDeg = this.yawInPair(this._e);
      const columnBottomDeg = degreesFromForward(this._head, this.headPitchDown, this._e);
      let slabTopDeg = -Infinity;
      for (const slab of [left, right]) {
        this._d.set(0, slabVisualTopLocalY(slab.doc), 0);
        slab.object.localToWorld(this._d);
        slabTopDeg = Math.max(slabTopDeg, degreesFromForward(this._head, this.headPitchDown, this._d));
      }
      columnNote =
        `; column right edge ${columnRightDeg.toFixed(1)}° -> result left edge ${resultLeftDeg.toFixed(1)}° ` +
        `(gap ${(resultLeftDeg - columnRightDeg).toFixed(1)}°, target ${COLUMN_RESULT_GAP_DEG}°); column bottom ` +
        `${columnBottomDeg.toFixed(1)}° from the gaze, the slabs' highest top ${slabTopDeg.toFixed(1)}°`;
      if (resultLeftDeg - columnRightDeg < COLUMN_RESULT_GAP_DEG - 0.5) {
        debug.warn(`the column is only ${(resultLeftDeg - columnRightDeg).toFixed(1)}° left of the result in view`);
      }
      if (columnBottomDeg < slabTopDeg) {
        debug.warn(`the column's bottom edge (${columnBottomDeg.toFixed(1)}°) is below a slab's top (${slabTopDeg.toFixed(1)}°) in view`);
      }
    }

    right.object.position.copy(restore);
    right.object.quaternion.copy(this._q2);

    // Result slab: viewed, not touched. Anchored by its bottom edge at its
    // height now; also where its top reaches at its tallest (the reserve).
    measureSlabEdges(
      this._head,
      this.headPitchDown,
      view.object,
      slabTopLocalY(view.doc),
      -shownHeight,
      this._a,
      this._edges,
    );
    const resultBottomDeg = this._edges.bottomDeg;
    this._a.set(0, view.doc.heightMeters - shownHeight + view.doc.tabHeightMeters, 0);
    view.object.localToWorld(this._a);
    const tallestTopDeg = degreesFromForward(this._head, this.headPitchDown, this._a);
    const resultEdges =
      `${edgeNote('result slab', this._edges.topDeg, resultBottomDeg)}; at its tallest ` +
      `(${cm(view.doc.heightMeters)}) its top reaches ${tallestTopDeg.toFixed(1)}° (view top +${VIEW_MAX_ABOVE_GAZE_DEG}°)`;
    if (tallestTopDeg > VIEW_MAX_ABOVE_GAZE_DEG + FIT_DROP_TOLERANCE_DEG) {
      debug.warn(`result slab at its tallest would reach ${tallestTopDeg.toFixed(1)}°, above the view's top`);
    }
    this._a.set(0, -shownHeight / 2, 0);
    view.object.localToWorld(this._a);
    const resultDistance = this._a.distanceTo(this._head);
    const resultTextDeg = textAngleDeg(view.doc.rowFontMeters, resultDistance);
    debug.note(
      `result slab (view only): ${resultDistance.toFixed(2)} m from the eyes (cap ` +
        `${RESULT_MAX_PUSHED_DISTANCE_METERS.toFixed(2)} m, where its rows are ${RESULT_MIN_PUSHED_ROW_TEXT_DEG}°); ` +
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

    // Challenge mode's puzzle card: viewed, beside the result slab.
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
      // Horizontally (degrees to the right of the result slab's center
      // direction): the card's inner and outer edges, against the result's
      // right edge -- the card must not cover the result in view.
      const yawOf = (point: Vector3) =>
        MathUtils.radToDeg(Math.atan2(point.x - this._head.x, -(point.z - this._head.z)));
      this._d.set(0, -view.doc.heightMeters / 2, 0);
      view.object.localToWorld(this._d);
      const reference = yawOf(this._d);
      this._d.set((CARD_SIDE * view.doc.widthMeters) / 2, -view.doc.heightMeters / 2, 0);
      view.object.localToWorld(this._d);
      const resultEdge = CARD_SIDE * (yawOf(this._d) - reference);
      this._d.set(-CARD_SIDE * (card.widthMeters / 2), 0, 0);
      card.object.localToWorld(this._d);
      const cardInner = CARD_SIDE * (yawOf(this._d) - reference);
      this._d.set(CARD_SIDE * (card.widthMeters / 2), 0, 0);
      card.object.localToWorld(this._d);
      const cardOuter = CARD_SIDE * (yawOf(this._d) - reference);
      debug.note(
        `puzzle card (view only, beside the result): center ${cardDistance.toFixed(2)} m from the eyes; ${cardEdges}; ` +
          `${cm(card.widthMeters)} x ${cm(card.heightMeters)}; horizontally ${cardInner.toFixed(1)}° to ` +
          `${cardOuter.toFixed(1)}° from the result's center (its edge at ${resultEdge.toFixed(1)}°)`,
      );
      if (cardInner < resultEdge) {
        debug.warn(`puzzle card overlaps the result slab in view (card inner edge ${cardInner.toFixed(1)}°, result edge ${resultEdge.toFixed(1)}°)`);
      }
    }
    debug.note(
      `layout gaps in view: pair top -> result bottom ${(resultBottomDeg - pairTopDeg).toFixed(1)}° (its bottom edge ` +
        `stays put; it grows upward)${columnNote}`,
    );
    if (resultBottomDeg < pairTopDeg) {
      debug.warn(
        `result slab's bottom edge (${resultBottomDeg.toFixed(1)}°) is below the pair's top edge ` +
          `(${pairTopDeg.toFixed(1)}°) in view: they overlap`,
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
   * Grab feedback (grab-feedback.ts), every frame: a held slab shows the
   * grabbed outline, 2% larger, with its shadow on the desk when it rests on
   * one; otherwise the one slab a pinch would grab now -- the nearest whose
   * panel is within the grab sphere of a free hand's grip (GrabSystem's rule:
   * the nearest hit wins) -- shows the soft outline. Dev: logs each change.
   */
  private updateGrabFeedback(): void {
    const immersive = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    // Which hands already hold a slab (they can't grab another).
    let leftHolds = false;
    let rightHolds = false;
    for (const entity of this.queries.held.entities) {
      const hand = this.grabSystem?.getHolderHand(entity) ?? null;
      leftHolds ||= hand === 'left';
      rightHolds ||= hand === 'right';
    }
    let canGrab: SourceSlab | null = null;
    let canGrabHand: (typeof HANDS)[number] = 'right';
    let canGrabDistance = Infinity;
    if (immersive && deskReady()) {
      for (const hand of HANDS) {
        if ((hand === 'left' ? leftHolds : rightHolds) || !this.input.xr.getPrimaryInputSource(hand)) {
          continue;
        }
        const grip = this.player.gripSpaces[hand];
        grip.updateWorldMatrix(true, false);
        this._g.setFromMatrixPosition(grip.matrixWorld);
        for (const slab of this.sources.values()) {
          if (!slab.object.visible || slab.entity.hasComponent(Grabbed)) {
            continue;
          }
          const distance = distanceToSlab(this._g, slab, this._e);
          if (distance <= GRAB_SPHERE_RADIUS_METERS && distance < canGrabDistance) {
            canGrab = slab;
            canGrabHand = hand;
            canGrabDistance = distance;
          }
        }
      }
    }
    const deskY = deskBridge.desk?.deskSurfaceY ?? null;
    let i = 0;
    for (const slab of this.sources.values()) {
      if (i >= this.grabOutlines.length) {
        // Grows once per slab ever shown (two), never per frame.
        const outline = new SlabOutline();
        const shadow = new DeskShadow();
        this.grabOutlines.push(outline);
        this.grabShadows.push(shadow);
        this.visualsRoot.add(outline.mesh, shadow.mesh);
      }
      const outline = this.grabOutlines[i];
      const shadow = this.grabShadows[i];
      i++;
      const held = immersive && slab.entity.hasComponent(Grabbed);
      const look: GrabLook = held ? 'grabbed' : slab === canGrab ? 'canGrab' : 'none';
      const doc = slab.doc;
      const top = slabTopLocalY(doc);
      const bottom = slabBottomLocalY(doc);
      if (held) {
        // Re-applied each frame: the grab's handle owns the transform while held.
        slab.object.scale.setScalar(GRABBED_SCALE);
      }
      if (look === 'none') {
        outline.hide();
      } else {
        const accent = DATASETS[datasetOfTable(slab.id) ?? 'shop'].theme.accent;
        // The panel's corner radius: 1.2 cm at the 1.6 cm base row font (slab-metrics.ts).
        outline.show(slab.object, doc.widthMeters, bottom, top, doc.rowFontMeters * 0.75, accent, look);
      }
      if (held && deskY !== null) {
        shadow.show(slab.object, doc.widthMeters, bottom, top, deskY);
      } else {
        shadow.hide();
      }
      if (import.meta.env.DEV && this.debug && this.grabLooks.get(slab.id) !== look) {
        this.noteGrabLook(slab, look, canGrabHand, canGrabDistance, deskY);
      }
    }
    for (; i < this.grabOutlines.length; i++) {
      this.grabOutlines[i].hide();
      this.grabShadows[i].hide();
    }
  }

  /** Dev: one slab's grab look changed. */
  private noteGrabLook(
    slab: SourceSlab,
    look: GrabLook,
    hand: (typeof HANDS)[number],
    distance: number,
    deskY: number | null,
  ): void {
    if (!import.meta.env.DEV || !this.debug) {
      return;
    }
    this.grabLooks.set(slab.id, look);
    let text: string;
    if (look === 'canGrab') {
      text = `can grab (${hand} grip ${(distance * 100).toFixed(1)} cm from it, sphere ${(GRAB_SPHERE_RADIUS_METERS * 100).toFixed(0)} cm): soft outline`;
    } else if (look === 'grabbed') {
      slab.object.updateWorldMatrix(true, false);
      this._e.set(0, slabBottomLocalY(slab.doc), 0);
      slab.object.localToWorld(this._e);
      text =
        `grabbed: bright outline, ${Math.round((GRABBED_SCALE - 1) * 100)}% larger, ` +
        (deskY === null ? 'no shadow (floating, no desk)' : `shadow on the desk ${Math.max(0, this._e.y - deskY).toFixed(2)} m below its bottom edge`);
    } else {
      text = 'no highlight';
    }
    this.debug.note(`grab feedback: ${slab.id} ${text}`);
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

/** Whether `local` (a bar's frame, on or near its face) is on `button` (within a ray's tolerance). */
function onButton(local: Vector3, button: ButtonRect, height: number): boolean {
  return (
    Math.abs(local.x - button.centerX) <= button.width / 2 + RAY_BUTTON_TOLERANCE_METERS &&
    Math.abs(local.y - (button.centerY ?? 0)) <= height / 2 + RAY_BUTTON_TOLERANCE_METERS
  );
}

/** A button's rectangle in its document's frame: its center (y 0 when omitted: a one-row, centered document) and width. */
type ButtonRect = { centerX: number; centerY?: number; width: number };

/** In-plane distance from `local` to `button`'s rectangle (0 on it). */
function buttonDistance(local: Vector3, button: ButtonRect, height: number): number {
  return Math.hypot(
    Math.max(0, Math.abs(local.x - button.centerX) - button.width / 2),
    Math.max(0, Math.abs(local.y - (button.centerY ?? 0)) - height / 2),
  );
}

/**
 * In-plane distance from `local` (in a source slab's frame) to the nearest
 * of its NULL cells' rectangles; Infinity if it shows none. Allocates nothing.
 */
function nearestSourceNull(slab: SourceSlab, local: Vector3): number {
  const halfRow = slab.doc.rowHeightMeters / 2;
  let best = Infinity;
  for (const cell of slab.nullCells) {
    const span = slab.doc.columnSpans[cell.column];
    const dx = Math.max(0, span.x0 - local.x, local.x - span.x1);
    const dy = Math.max(0, Math.abs(local.y - rowCenterLocalY(slab.doc, cell.row)) - halfRow);
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}

/**
 * Distance from world `point` to a source slab's panel rectangle, measured
 * in the slab's own frame (the grab surface the palm sphere must reach).
 * Uses `scratch`; allocates nothing.
 */
/** Dev: `?hz=<rate>` (or the stored `spatialql.hz`) asks for that rate instead of the preferred one; null: none given. */
function devFrameRateChoice(): number | null {
  if (!import.meta.env.DEV) {
    return null;
  }
  let value: string | null = null;
  try {
    value = new URLSearchParams(location.search).get('hz') ?? localStorage.getItem('spatialql.hz');
  } catch {
    value = null;
  }
  const rate = Number(value);
  return value && Number.isFinite(rate) && rate > 0 ? rate : null;
}

/** How far the bar extends left of the column's own place (the open puzzle picker; free play's bar: never). */
function columnExtension(bar: { extendLeftMeters?: number }): number {
  return bar.extendLeftMeters ?? 0;
}

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
