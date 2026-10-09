/**
 * Dev-only in-headset readout (`debug` flag): a small text panel off to one
 * side of the table group, mirroring the tagged debug log lines (grab, join,
 * placement, sound, puzzle), every warning and error, and a frame-time line.
 * On a Quest there's no console in view, so this is where the readouts go.
 * Only loaded behind `import.meta.env.DEV`, so production builds drop it.
 *
 * - **Console tap** (`installHudConsoleTap`, installed as soon as this
 *   module loads): `console.log/info` lines that start with a debug tag, and
 *   every `console.warn/error`, uncaught error and unhandled rejection, go
 *   into a small ring of entries (first line of each message; a repeat bumps
 *   a counter instead of taking a slot). A long entry wraps onto up to
 *   HUD_ENTRY_MAX_LINES lines rather than being cut; the log area keeps the
 *   newest at the bottom, and the oldest scroll off the top. The console
 *   itself is unchanged.
 * - **Panel**: world-locked beside the group, outside its view window
 *   (inner edge HUD_GROUP_MARGIN_DEG past the group's outermost element on
 *   that side -- the card, the column, a slab, the result -- as the join
 *   system's layout readout last measured it, `dev-layout.ts`), at
 *   HUD_DISTANCE_METERS, its center at eye level, facing the eyes. If
 *   its outer edge would pass HUD_MAX_OUTER_DEG from the group's middle, it
 *   goes centered below the tables instead. Placed once the desk is ready,
 *   and again only when the desk re-places the tables, the layout changes,
 *   a new session starts, or the side is swapped. It refreshes
 *   its text at most HUD_REFRESH_HZ times a second, and only lines that
 *   changed. View only: no pointer events, no interactable components.
 * - **Swap button** (on the panel's inner edge): moves the panel to the
 *   other side. Its own hit target, tested here against the button's
 *   rectangle: a fingertip poke, a pinch whose pinch point lands on it, or a
 *   ray select. The panel sits far from the slabs (the placement readout
 *   logs the clearance), so a pinch there never reaches a slab's grab sphere.
 *   The side is remembered in localStorage (`spatialql.debugSide`);
 *   `?debugSide=left|right` overrides it. Default: left.
 * - **Frame line**: p50 / p95 / max frame time over the last HUD_FRAME_WINDOW
 *   frames (preallocated ring, sorted in place at refresh time), and the
 *   long-task count with the latest one; written to the log file every 5 s.
 * - **Log file** (`debug-log-sink.ts`): every mirrored line, complete, plus
 *   whatever a tagged console group holds, goes to `logs/` via the dev
 *   server. A head-height change of more than 25 cm after placement is
 *   logged (e.g. sitting down after entering XR standing).
 *
 * No per-frame allocation: frame times go into a typed array; strings are
 * built only at refresh time (a few times a second) and on log lines.
 */

import {
  createSystem,
  Euler,
  Grabbed,
  OneHandGrabbable,
  Quaternion,
  UIKit,
  UIKitDocument,
  Vector3,
  VisibilityState,
  type Entity,
} from '@iwsdk/core';
import { formatArgs, formatTable, logToFile, startLogSink } from './debug-log-sink.js';
import { deskBridge } from './desk-bridge.js';
import { DEV_FLAG_STORAGE_PREFIX } from './dev-flags.js';
import { devLayout } from './dev-layout.js';
import { grabPoints, reachClearances, reachClearanceText, rectFromCorners, shoulders, type Vec3 } from './reach-path.js';
import { readJointsPoint, readPinchPoint } from './pinch.js';
import { sounds } from './sound.js';
import { JoinResultSlab, TableSlab, TableSlabRuntime } from './table-slab-component.js';
import {
  CONTROL_OPTION_MIN_HEIGHT_CM,
  CONTROL_OPTION_MIN_WIDTH_CM,
  controlOptionStyle,
  FONT_FAMILIES,
  measureHeaderTextCm,
  slabBottomLocalY,
  slabTopLocalY,
  slabVisualTopLocalY,
  type TableSlabDocument,
} from './table-slab-view.js';
import {
  fontCmForAngle,
  MIN_ROW_FONT_CM,
  NATURAL_GAZE_PITCH_DEG,
  TOUCH_REACH_MAX_METERS,
} from './view-comfort.js';

type Container = InstanceType<typeof UIKit.Container>;
type Text = InstanceType<typeof UIKit.Text>;
type Side = 'left' | 'right';
type LineKind = 'info' | 'warn' | 'error';

const LOG_PREFIX = '[HUD]';
const SIDE_STORAGE_KEY = `${DEV_FLAG_STORAGE_PREFIX}debugSide`;

// --- Lines -------------------------------------------------------------------------
/** Log entries kept (newest at the bottom); the oldest scroll off the top when the log area is full. */
const HUD_LOG_LINES = 8;
/** Each entry wraps onto at most this many lines (never cut mid-number within them). */
const HUD_ENTRY_MAX_LINES = 3;
/** Height of the log area, in lines: the newest entries always fit. */
const HUD_LOG_AREA_LINES = 13;
/** The frame-time line may wrap onto this many lines. */
const HUD_FRAME_LINES = 2;
/** Characters kept per entry: about HUD_ENTRY_MAX_LINES lines' worth (the entry also clips to its lines). */
const HUD_LINE_CHARS = 200;
/** Tagged `console.log/info` lines to mirror, and the short tag shown for each. */
const MIRRORED_TAGS: readonly (readonly [string, string])[] = [
  ['[Grab debug]', 'grab'],
  ['[Join debug]', 'join'],
  ['[DeskPlacement debug]', 'desk'],
  ['[DeskPlacement', 'desk'],
  ['[Challenge debug]', 'puzzle'],
  ['[Touch debug]', 'touch'],
  [LOG_PREFIX, 'hud'],
];

// --- Panel ---------------------------------------------------------------------------
/** Eye distance of the panel: within reach, so the swap button can be poked. */
const HUD_DISTANCE_METERS = 0.5;
/** Before the join system's first layout readout: the inner edge this far (yaw) from the slabs' center direction. */
const HUD_INNER_EDGE_DEG = 45;
/** Beside the group: the inner edge this far (yaw) past the group's outermost element on that side. */
const HUD_GROUP_MARGIN_DEG = 5;
/** ...unless the outer edge would then be more than this from the group's middle: below the tables instead. */
const HUD_MAX_OUTER_DEG = 85;
/**
 * Beside the group, its center at eye level (not the natural gaze, 4° lower):
 * a right hand reaching for the right slab's outer corner passes below it
 * with 6.6 cm to spare rather than 5.2 (reach-path.ts, 2026-10-10 layout).
 */
const HUD_PITCH_RAD = 0;
/** Text size by angle (small: it's a readout, read on purpose, not at a glance). */
const HUD_TEXT_DEG = 1.0;
const HUD_WIDTH_EM = 34;
const HUD_REFRESH_HZ = 4;
/** Re-place when the group's center direction moves this far from where the panel was placed for... */
const HUD_REPLACE_YAW_DEG = 20;
/** ...and only once no table is held and they've been still this long (within this tolerance). */
const HUD_STILL_SECONDS = 1;
const HUD_STILL_TOLERANCE_METERS = 0.01;
/** Seconds into a session before the first placement (the head pose and the desk settle). */
const HUD_SETTLE_SECONDS = 1;
const LINE_HEIGHT_FACTOR = 1.25;
const COLOR_PANEL = '#15181d';
const COLOR_PANEL_BORDER = '#3a414c';
const COLOR_TITLE = '#9fb4cc';
const COLOR_FRAME = '#8fd18f';
const COLOR_LINE: Record<LineKind, string> = { info: '#e6e6e6', warn: '#f5c542', error: '#ff7a7a' };

// --- Swap button --------------------------------------------------------------------
/** A pinch presses the button when its pinch point is this close to it in plane... */
const BUTTON_PINCH_MARGIN_METERS = 0.015;
/** ...and at most this far off the panel's surface. */
const BUTTON_PINCH_DEPTH_METERS = 0.03;
/** A fingertip pokes when it crosses to within this of the surface, over the button (plus a small tolerance). */
const BUTTON_POKE_DEPTH_METERS = 0.01;
const BUTTON_TOLERANCE_METERS = 0.005;
/** A poke, pinch and ray on the same press count once. */
const BUTTON_DEBOUNCE_SECONDS = 0.4;
/** Grab sphere radius around the palm (IWSDK's grab pointer), for the clearance readout. */
const GRAB_SPHERE_RADIUS_METERS = 0.07;
const SWAP_LABELS: Record<Side, string> = { left: 'Move right', right: 'Move left' };

// --- Frame time --------------------------------------------------------------------
/** Frames in the frame-time window (~4-5 s at 72-90 Hz). */
const HUD_FRAME_WINDOW = 360;
/** The frame-time line goes to the log file every this many refreshes (every 5 s at HUD_REFRESH_HZ). */
const HUD_FRAME_LOG_EVERY_REFRESHES = 20;
/** Head pitch samples per pitch line: 10 s at HUD_REFRESH_HZ. */
const HEAD_PITCH_SAMPLES = 40;
/** After placement, a head-height change of more than this is logged (e.g. sitting down after entering standing). */
const HEAD_HEIGHT_CHANGE_METERS = 0.25;

const HANDS = ['left', 'right'] as const;
const INDEX_TIP: readonly XRHandJoint[] = ['index-finger-tip'];
const UP = new Vector3(0, 1, 0);

/** `angle` (radians) wrapped into -PI..PI. */
function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

// --- Console tap (module state: installed before the system exists) ---------------

const ring = {
  text: new Array<string>(HUD_LOG_LINES).fill(''),
  kind: new Array<LineKind>(HUD_LOG_LINES).fill('info'),
  /** Lines pushed so far (the newest is at (count - 1) % HUD_LOG_LINES). */
  count: 0,
  /** Bumped on every change, so the panel knows when to refresh. */
  version: 0,
  lastRaw: '',
  repeats: 1,
};

let tapInstalled = false;

function pushLine(kind: LineKind, raw: string): void {
  if (raw === ring.lastRaw && ring.count > 0) {
    ring.repeats++;
    ring.text[(ring.count - 1) % HUD_LOG_LINES] = clip(`(x${ring.repeats}) ${raw}`);
  } else {
    ring.lastRaw = raw;
    ring.repeats = 1;
    const slot = ring.count % HUD_LOG_LINES;
    ring.text[slot] = clip(raw);
    ring.kind[slot] = kind;
    ring.count++;
  }
  ring.version++;
}

function clip(text: string): string {
  return text.length > HUD_LINE_CHARS ? `${text.slice(0, HUD_LINE_CHARS - 3)}...` : text;
}

function firstLine(text: string): string {
  const end = text.indexOf('\n');
  return end < 0 ? text : text.slice(0, end);
}

function describeArg(arg: unknown): string {
  if (typeof arg === 'string') {
    return arg;
  }
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}`;
  }
  if (arg === null || typeof arg !== 'object') {
    return String(arg);
  }
  return `[${(arg as object).constructor?.name ?? 'object'}]`;
}

/** A tagged debug line, re-tagged short (`grab ...`), or null if it isn't one to mirror. */
function taggedLine(arg: unknown): string | null {
  if (typeof arg !== 'string') {
    return null;
  }
  for (const [tag, short] of MIRRORED_TAGS) {
    if (arg.startsWith(tag)) {
      const rest = arg.slice(tag.length);
      // `[DeskPlacement debug]` and friends: drop the rest of the bracket too.
      const body = rest.startsWith(']') || /^\w*\]/.test(rest) ? rest.slice(rest.indexOf(']') + 1) : rest;
      return `${short} ${firstLine(body.trim())}`;
    }
  }
  return null;
}

/**
 * Mirrors tagged `console.log/info` lines and every warning and error into
 * the HUD's ring, and sends them complete to the log file (idempotent).
 * Inside a tagged `console.group`/`groupCollapsed` (e.g. a placement
 * report), every line and `console.table` goes to the file too, indented
 * under the group's title. Calls through to the original console.
 */
export function installHudConsoleTap(): void {
  if (tapInstalled) {
    return;
  }
  tapInstalled = true;
  startLogSink();
  let inTap = false;
  /** Per open console group: whether it (or an enclosing group) is tagged. */
  const groups: boolean[] = [];
  const inTaggedGroup = () => groups.length > 0 && groups[groups.length - 1];
  const indent = () => '  '.repeat(groups.length);
  /** Runs `fn` guarded: a readout must never break the app, nor log itself. */
  const guarded = (fn: () => void) => {
    if (inTap) {
      return;
    }
    inTap = true;
    try {
      fn();
    } catch {
      // Ignore.
    } finally {
      inTap = false;
    }
  };

  const wrap = (method: 'log' | 'info' | 'warn' | 'error', kind: LineKind) => {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      guarded(() => {
        const tagged = taggedLine(args[0]);
        if (kind === 'info') {
          if (tagged !== null) {
            pushLine('info', tagged);
          }
          if (tagged !== null || inTaggedGroup()) {
            logToFile('info', indent() + formatArgs(args));
          }
          return;
        }
        pushLine(kind, tagged ?? firstLine(args.map(describeArg).join(' ')));
        logToFile(kind, indent() + formatArgs(args));
      });
    };
  };
  wrap('log', 'info');
  wrap('info', 'info');
  wrap('warn', 'warn');
  wrap('error', 'error');

  for (const method of ['group', 'groupCollapsed'] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      guarded(() => {
        const tagged = taggedLine(args[0]) !== null;
        if (tagged) {
          pushLine('info', taggedLine(args[0]) as string);
        }
        if (tagged || inTaggedGroup()) {
          logToFile('info', indent() + formatArgs(args));
        }
        groups.push(tagged || inTaggedGroup());
      });
    };
  }
  const originalGroupEnd = console.groupEnd.bind(console);
  console.groupEnd = () => {
    originalGroupEnd();
    groups.pop();
  };
  const originalTable = console.table.bind(console);
  console.table = (data?: unknown, columns?: string[]) => {
    originalTable(data, columns);
    guarded(() => {
      if (inTaggedGroup()) {
        logToFile('info', indent() + formatTable(data).replace(/\n/g, `\n${indent()}`));
      }
    });
  };

  window.addEventListener('error', (event) => {
    const where = event.filename ? ` (${event.filename.split('/').pop()}:${event.lineno})` : '';
    pushLine('error', `uncaught: ${event.message}${where}`);
    logToFile('error', `uncaught: ${event.message}${where}${event.error instanceof Error ? `\n${event.error.stack ?? ''}` : ''}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    pushLine('error', `unhandled rejection: ${firstLine(describeArg(event.reason))}`);
    logToFile('error', `unhandled rejection: ${formatArgs([event.reason])}`);
  });
}

// --- Side preference --------------------------------------------------------------

function initialSide(): Side {
  const param = new URLSearchParams(window.location.search).get('debugSide');
  if (param === 'left' || param === 'right') {
    return param;
  }
  try {
    const stored = window.localStorage.getItem(SIDE_STORAGE_KEY);
    return stored === 'right' ? 'right' : 'left';
  } catch {
    return 'left';
  }
}

function storeSide(side: Side): void {
  try {
    window.localStorage.setItem(SIDE_STORAGE_KEY, side);
  } catch {
    console.warn(`${LOG_PREFIX} couldn't write localStorage; the side won't be remembered.`);
  }
}

/** Short device line for the title: the host and the browser (Quest Browser or not). */
function deviceSummary(): string {
  const ua = navigator.userAgent;
  const quest = /OculusBrowser\/([\d.]+)/.exec(ua);
  const browser = quest ? `Quest Browser ${quest[1]}` : 'desktop browser';
  return `${window.location.hostname} - ${browser}`;
}

// --- Panel view ----------------------------------------------------------------------

type HudView = {
  document: UIKitDocument;
  root: Container;
  titleRow: Container;
  button: Container;
  buttonText: Text;
  frameLine: Text;
  lines: Text[];
  widthMeters: number;
  heightMeters: number;
  /** The swap button's center (meters, panel frame) with the button on the right edge, and its size. */
  buttonInsetX: number;
  buttonCenterY: number;
  buttonWidth: number;
  buttonHeight: number;
};

function buildHud(): HudView {
  const font = Math.max(MIN_ROW_FONT_CM, fontCmForAngle(HUD_TEXT_DEG, HUD_DISTANCE_METERS));
  const lineHeight = font * LINE_HEIGHT_FACTOR;
  const padding = font * 0.7;
  const border = 0.15;
  const buttonHeight = Math.max(CONTROL_OPTION_MIN_HEIGHT_CM, lineHeight);
  const buttonWidth = Math.max(
    CONTROL_OPTION_MIN_WIDTH_CM,
    ...Object.values(SWAP_LABELS).map((label) => measureHeaderTextCm(label, font) + 2 * font * 0.6),
  );
  const widthCm = HUD_WIDTH_EM * font;
  const titleHeight = Math.max(buttonHeight, lineHeight);
  const heightCm = 2 * (padding + border) + titleHeight + (HUD_FRAME_LINES + HUD_LOG_AREA_LINES) * lineHeight;

  const root = new UIKit.Container({
    flexDirection: 'column',
    width: widthCm,
    height: heightCm,
    anchorX: 'center',
    anchorY: 'center',
    // View only: rays pass through it to whatever is behind.
    pointerEvents: 'none',
    fontFamilies: FONT_FAMILIES,
    backgroundColor: COLOR_PANEL,
    borderColor: COLOR_PANEL_BORDER,
    borderTopWidth: border,
    borderLeftWidth: border,
    borderRightWidth: border,
    borderBottomWidth: border,
    borderTopLeftRadius: padding,
    borderTopRightRadius: padding,
    borderBottomLeftRadius: padding,
    borderBottomRightRadius: padding,
    paddingTop: padding,
    paddingBottom: padding,
    paddingLeft: padding,
    paddingRight: padding,
  });

  const titleRow = new UIKit.Container({
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: titleHeight,
    flexShrink: 0,
  });
  const titleClip = new UIKit.Container({ height: lineHeight, flexGrow: 1, flexShrink: 1, overflow: 'hidden' });
  titleClip.add(
    new UIKit.Text({
      text: `debug - ${deviceSummary()}`,
      fontSize: font,
      fontWeight: 'bold',
      color: COLOR_TITLE,
      wordBreak: 'keep-all',
    }),
  );
  const style = controlOptionStyle(false);
  const button = new UIKit.Container({
    width: buttonWidth,
    minWidth: buttonWidth,
    height: buttonHeight,
    flexShrink: 0,
    justifyContent: 'center',
    alignItems: 'center',
    borderTopLeftRadius: font * 0.5,
    borderTopRightRadius: font * 0.5,
    borderBottomLeftRadius: font * 0.5,
    borderBottomRightRadius: font * 0.5,
    backgroundColor: style.backgroundColor,
    color: style.color,
  });
  const buttonText = new UIKit.Text({ text: '', fontSize: font, fontWeight: 'bold', wordBreak: 'keep-all' });
  button.add(buttonText);
  titleRow.add(titleClip, button);

  // A long entry wraps (up to `maxLines` lines, then clips), so its numbers stay readable.
  // Log entries start hidden (empty); the frame line is always shown.
  const entry = (parent: Container, color: string, maxLines: number, hidden = true): Text => {
    const clip = new UIKit.Container({ maxHeight: maxLines * lineHeight, flexShrink: 0, overflow: 'hidden' });
    const text = new UIKit.Text({ text: '', fontSize: font, color, display: hidden ? 'none' : 'flex' });
    clip.add(text);
    parent.add(clip);
    return text;
  };
  root.add(titleRow);
  const frameArea = new UIKit.Container({ height: HUD_FRAME_LINES * lineHeight, flexShrink: 0, overflow: 'hidden' });
  root.add(frameArea);
  const frameLine = entry(frameArea, COLOR_FRAME, HUD_FRAME_LINES, false);
  // The log: newest at the bottom; entries that no longer fit scroll off the top.
  const logArea = new UIKit.Container({
    flexDirection: 'column',
    justifyContent: 'flex-end',
    height: HUD_LOG_AREA_LINES * lineHeight,
    flexShrink: 0,
    overflow: 'hidden',
  });
  root.add(logArea);
  const lines: Text[] = [];
  for (let i = 0; i < HUD_LOG_LINES; i++) {
    lines.push(entry(logArea, COLOR_LINE.info, HUD_ENTRY_MAX_LINES));
  }

  return {
    document: new UIKitDocument(root),
    root,
    titleRow,
    button,
    buttonText,
    frameLine,
    lines,
    widthMeters: widthCm / 100,
    heightMeters: heightCm / 100,
    buttonInsetX: (widthCm / 2 - padding - border - buttonWidth / 2) / 100,
    buttonCenterY: (heightCm / 2 - padding - border - titleHeight / 2) / 100,
    buttonWidth: buttonWidth / 100,
    buttonHeight: buttonHeight / 100,
  };
}

// --- System ----------------------------------------------------------------------------

export class DebugHudSystem extends createSystem({
  // Grabbable source slabs (the result slab is view only).
  slabs: { required: [TableSlab, TableSlabRuntime, OneHandGrabbable], excluded: [JoinResultSlab] },
  held: { required: [TableSlab, Grabbed] },
}) {
  private hud!: HudView;
  /** `?debugPanel=0`: no panel (to compare frame times without it); logging continues. */
  private readonly panelHidden = new URLSearchParams(window.location.search).get('debugPanel') === '0';
  private stillSince = 0;
  private readonly _lastCenter = new Vector3();
  /** Head pitch samples (degrees down) for the 10 s pitch line. */
  private readonly pitchSamples = new Float32Array(HEAD_PITCH_SAMPLES);
  private pitchCount = 0;
  private readonly _quat = new Quaternion();
  private readonly _euler = new Euler();
  private hudEntity: Entity | null = null;
  private side: Side = 'left';
  private placed = false;
  /** The group's center direction (yaw, radians) the panel was placed for. */
  private placedYaw = 0;
  /** The layout readout (`devLayout.version`) the panel was placed for. */
  private placedLayout = 0;
  private deskWasReady = false;
  private immersiveSeconds = 0;

  // Text refresh.
  private refreshTimer = 0;
  private shownVersion = -1;
  private readonly shownText: string[] = new Array<string>(HUD_LOG_LINES).fill('');
  private readonly shownKind: LineKind[] = new Array<LineKind>(HUD_LOG_LINES).fill('info');

  // Frame time.
  private readonly frames = new Float32Array(HUD_FRAME_WINDOW);
  private readonly sorted = new Float32Array(HUD_FRAME_WINDOW);
  private frameIndex = 0;
  private frameCount = 0;
  private longTasks: PerformanceObserver | null = null;
  private frameLogCounter = 0;
  /** Head height the last head-height line was measured against (NaN until placed this session). */
  private headRefY = NaN;
  private longTaskCount = 0;
  private lastLongTaskMs = 0;
  private lastLongTaskAt = -1;

  // Swap button.
  private lastPress = -Infinity;
  private clock = 0;
  private readonly pokeDepth = { left: Infinity, right: Infinity };

  // Scratch -- allocated once, never in update().
  private readonly _head = new Vector3();
  private readonly _center = new Vector3();
  private readonly _dir = new Vector3();
  private readonly _a = new Vector3();
  private readonly _b = new Vector3();
  private readonly _local = new Vector3();

  init(): void {
    installHudConsoleTap();
    this.side = initialSide();
    this.hud = buildHud();
    this.hud.document.visible = false;
    this.hudEntity = this.world.createTransformEntity(this.hud.document, { parent: this.world.sceneEntity, persistent: true });
    this.applySide();

    try {
      this.longTasks = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.longTaskCount++;
          this.lastLongTaskMs = entry.duration;
          this.lastLongTaskAt = performance.now();
        }
      });
      this.longTasks.observe({ type: 'longtask', buffered: false });
    } catch {
      this.longTasks = null;
    }

    // A new session (or leaving one): re-place, and start the frame window over.
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe(() => {
        this.placed = false;
        this.frameCount = 0;
        this.frameIndex = 0;
        // A new session: the head height is measured afresh once placed.
        this.headRefY = NaN;
      }),
      () => {
        this.longTasks?.disconnect();
        this.hudEntity?.dispose();
      },
    );
    console.info(
      this.panelHidden
        ? `${LOG_PREFIX} panel hidden (?debugPanel=0): logging and the frame-time line continue.`
        : `${LOG_PREFIX} in-headset readout on the ${this.side} (swap with its button; ?debugSide=left|right overrides).`,
    );
  }

  update(delta: number): void {
    this.clock += delta;
    const immersive = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    this.recordFrame(delta);

    // Placement: once the desk is ready, and again after it re-places the tables.
    const desk = deskBridge.desk;
    const deskReady = !desk || desk.deskState.phase === 'ready';
    if (deskReady && !this.deskWasReady) {
      this.placed = false;
    }
    this.deskWasReady = deskReady;

    this.refreshTimer += delta;
    const refresh = this.refreshTimer >= 1 / HUD_REFRESH_HZ;
    if (refresh) {
      this.refreshTimer = 0;
    }

    if (!immersive) {
      this.hud.document.visible = false;
      this.immersiveSeconds = 0;
      return;
    }
    // Let the session's head pose and the desk placement settle first.
    this.immersiveSeconds += delta;
    const settled = this.immersiveSeconds >= HUD_SETTLE_SECONDS;
    if (!this.panelHidden && refresh && deskReady && settled) {
      if (!this.placed) {
        this.place();
      } else if (this.groupAtRest() && (this.groupYawMoved() || devLayout.version !== this.placedLayout)) {
        // Follows the tables only once they're put down and still: never
        // while they're being carried around.
        this.place();
      }
    }
    // Hidden (?debugPanel=0): the log file still gets the frame line and head-height changes.
    if (!(this.placed || (this.panelHidden && settled))) {
      return;
    }
    if (refresh) {
      this.refreshText();
      this.checkHeadHeight();
      this.samplePitch();
    }
    if (!this.panelHidden) {
      this.updateButton();
    }
  }

  /**
   * The head's pitch while the tables are on screen, sampled at refresh rate;
   * every HEAD_PITCH_SAMPLES (10 s) its median and range go to the log, so
   * the natural gaze (NATURAL_GAZE_PITCH_DEG) can be tuned from real data.
   */
  private samplePitch(): void {
    if (!this.groupCenter()) {
      return;
    }
    this.player.head.updateWorldMatrix(true, false);
    this._quat.setFromRotationMatrix(this.player.head.matrixWorld);
    this._euler.setFromQuaternion(this._quat, 'YXZ');
    this.pitchSamples[this.pitchCount++] = -(this._euler.x * 180) / Math.PI;
    if (this.pitchCount < HEAD_PITCH_SAMPLES) {
      return;
    }
    this.pitchCount = 0;
    this.pitchSamples.sort();
    const median = this.pitchSamples[Math.floor(HEAD_PITCH_SAMPLES / 2)];
    const down = (deg: number) => `${deg.toFixed(1)}° ${deg >= 0 ? 'down' : 'up'}`;
    console.info(
      `${LOG_PREFIX} head pitch over ${(HEAD_PITCH_SAMPLES / HUD_REFRESH_HZ).toFixed(0)} s: median ${down(median)}, ` +
        `range ${down(this.pitchSamples[0])} to ${down(this.pitchSamples[HEAD_PITCH_SAMPLES - 1])} ` +
        `(natural gaze ${NATURAL_GAZE_PITCH_DEG}° down)`,
    );
  }

  /**
   * Whether the tables are at rest: none held, and their center hasn't
   * moved for HUD_STILL_SECONDS (checked at refresh rate).
   */
  private groupAtRest(): boolean {
    if (this.queries.held.entities.size > 0 || !this.groupCenter()) {
      this.stillSince = this.clock;
      return false;
    }
    if (this._center.distanceTo(this._lastCenter) > HUD_STILL_TOLERANCE_METERS) {
      this._lastCenter.copy(this._center);
      this.stillSince = this.clock;
      return false;
    }
    return this.clock - this.stillSince >= HUD_STILL_SECONDS;
  }

  // --- Placement ----------------------------------------------------------------------

  /** World center of the visible source slabs into `_center`; false if none. */
  private groupCenter(): boolean {
    this._center.set(0, 0, 0);
    let count = 0;
    for (const entity of this.queries.slabs.entities) {
      const object = entity.object3D;
      if (!object || !object.visible) {
        continue;
      }
      object.updateWorldMatrix(true, false);
      this._a.setFromMatrixPosition(object.matrixWorld);
      this._center.add(this._a);
      count++;
    }
    if (count === 0) {
      return false;
    }
    this._center.divideScalar(count);
    return true;
  }

  private readHead(): void {
    this.player.head.updateWorldMatrix(true, false);
    this._head.setFromMatrixPosition(this.player.head.matrixWorld);
  }

  /** Yaw (radians) of the horizontal direction from the eyes to `_center`. */
  private centerYaw(): number {
    return Math.atan2(-(this._center.x - this._head.x), -(this._center.z - this._head.z));
  }

  private groupYawMoved(): boolean {
    if (!this.groupCenter()) {
      return false;
    }
    this.readHead();
    let diff = this.centerYaw() - this.placedYaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    return Math.abs(diff) > (HUD_REPLACE_YAW_DEG * Math.PI) / 180;
  }

  /** Yaw (radians, + left) of the horizontal direction from the eyes to `point`. */
  private yawTo(point: { x: number; z: number }): number {
    return Math.atan2(-(point.x - this._head.x), -(point.z - this._head.z));
  }

  /**
   * Beside the group, outside its whole extent: the inner edge
   * HUD_GROUP_MARGIN_DEG (yaw) past the outermost element on this side, at
   * HUD_DISTANCE_METERS along the natural gaze pitch, facing the eyes. If the
   * outer edge would then pass HUD_MAX_OUTER_DEG from the group's middle,
   * centered below the group's lowest edge instead. Before the join system's
   * first layout readout: HUD_INNER_EDGE_DEG from the slabs' center.
   */
  private place(): void {
    if (!this.groupCenter()) {
      return;
    }
    this.readHead();
    const yaw = this.centerYaw();
    const halfWidthRad = Math.atan(this.hud.widthMeters / 2 / HUD_DISTANCE_METERS);
    const margin = (HUD_GROUP_MARGIN_DEG * Math.PI) / 180;
    const sign = this.side === 'left' ? 1 : -1;
    let panelYaw = yaw + sign * ((HUD_INNER_EDGE_DEG * Math.PI) / 180 + halfWidthRad);
    let pitch = HUD_PITCH_RAD;
    let how = `${this.side}: inner edge ${HUD_INNER_EDGE_DEG} deg from the slabs' center (no layout readout yet)`;
    if (devLayout.version > 0) {
      const leftYaw = this.yawTo(devLayout.left);
      const rightYaw = this.yawTo(devLayout.right);
      const middle = leftYaw + wrapAngle(rightYaw - leftYaw) / 2;
      const edgeYaw = this.side === 'left' ? leftYaw : rightYaw;
      panelYaw = edgeYaw + sign * (margin + halfWidthRad);
      const outerDeg = ((Math.abs(wrapAngle(panelYaw - middle)) + halfWidthRad) * 180) / Math.PI;
      const edgeName = this.side === 'left' ? devLayout.leftName : devLayout.rightName;
      how =
        `${this.side}: inner edge ${HUD_GROUP_MARGIN_DEG} deg past the ${edgeName} ` +
        `(${((Math.abs(wrapAngle(edgeYaw - middle)) * 180) / Math.PI).toFixed(0)} deg from the group's middle), ` +
        `outer edge ${outerDeg.toFixed(0)} deg`;
      if (outerDeg > HUD_MAX_OUTER_DEG) {
        // No room beside it: centered below the group's lowest edge.
        const b = devLayout.bottom;
        const bottomPitch = Math.atan2(b.y - this._head.y, Math.hypot(b.x - this._head.x, b.z - this._head.z));
        const halfHeightRad = Math.atan(this.hud.heightMeters / 2 / HUD_DISTANCE_METERS);
        panelYaw = middle;
        pitch = bottomPitch - margin - halfHeightRad;
        how =
          `below the tables (beside, its outer edge would be ${outerDeg.toFixed(0)} deg out, past ${HUD_MAX_OUTER_DEG}): ` +
          `top edge ${HUD_GROUP_MARGIN_DEG} deg under the lowest edge`;
      }
    }
    this._dir.set(0, 0, -1).applyAxisAngle(UP, panelYaw);
    const object = this.hud.document;
    object.position
      .copy(this._head)
      .addScaledVector(this._dir, HUD_DISTANCE_METERS * Math.cos(pitch))
      .addScaledVector(UP, HUD_DISTANCE_METERS * Math.sin(pitch));
    object.lookAt(this._head);
    object.visible = true;
    object.updateWorldMatrix(true, false);
    this.placed = true;
    this.placedYaw = yaw;
    this.placedLayout = devLayout.version;
    this.shownVersion = -1;
    this.reportPlacement(how);
  }

  /** One readout line: where the panel went, the button's reach, and its clearance from the slabs. */
  private reportPlacement(how: string): void {
    this.buttonCenter(this._a);
    const buttonDistance = this._a.distanceTo(this._head);
    let clearance = Infinity;
    for (const entity of this.queries.slabs.entities) {
      clearance = Math.min(clearance, distanceToSlab(this._a, entity, this._b));
    }
    const clearanceText = Number.isFinite(clearance) ? `${(clearance * 100).toFixed(0)} cm` : 'n/a';
    console.info(
      `${LOG_PREFIX} placed ${how}; button ${buttonDistance.toFixed(2)} m (reach ${TOUCH_REACH_MAX_METERS} m), ` +
        `${clearanceText} from a slab; ${this.reachPathText()}`,
    );
    if (clearance < GRAB_SPHERE_RADIUS_METERS + 0.05) {
      console.warn(`${LOG_PREFIX} swap button is only ${clearanceText} from a slab: a pinch there could grab it`);
    }
  }

  /**
   * How close the panel comes to the straight path from either shoulder to
   * any slab's grab point (reach-path.ts). Dev only, per placement: allocates.
   */
  private reachPathText(): string {
    const object = this.hud.document;
    const w = this.hud.widthMeters / 2;
    const h = this.hud.heightMeters / 2;
    const corner = (target: { localToWorld(v: Vector3): Vector3 }, x: number, y: number): Vec3 =>
      target.localToWorld(new Vector3(x, y, 0));
    const rect = rectFromCorners('debug panel', corner(object, -w, -h), corner(object, w, -h), corner(object, -w, h));
    // Horizontal right of the panel's facing direction toward the group: the head's own right.
    this.player.head.updateWorldMatrix(true, false);
    const right = new Vector3(1, 0, 0).applyQuaternion(this.player.head.getWorldQuaternion(new Quaternion())).setY(0).normalize();
    const to: Vec3[] = [];
    for (const entity of this.queries.slabs.entities) {
      const slab = entity.object3D;
      const doc = entity.getValue(TableSlabRuntime, 'layout') as TableSlabDocument | undefined;
      if (!slab || !doc || !slab.visible) {
        continue;
      }
      slab.updateWorldMatrix(true, false);
      const sw = doc.widthMeters / 2;
      const top = slabVisualTopLocalY(doc);
      const bottom = slabBottomLocalY(doc);
      to.push(...grabPoints(corner(slab, -sw, top), corner(slab, sw, top), corner(slab, -sw, bottom), corner(slab, sw, bottom)));
    }
    return `reach paths: ${reachClearanceText(reachClearances(shoulders(this._head, right), to, [rect]))}`;
  }

  /** The swap button sits on the panel's inner edge (toward the group). */
  private applySide(): void {
    this.hud.titleRow.setProperties({ flexDirection: this.side === 'left' ? 'row' : 'row-reverse' });
    this.hud.buttonText.setProperties({ text: SWAP_LABELS[this.side] });
  }

  private buttonCenterX(): number {
    return this.side === 'left' ? this.hud.buttonInsetX : -this.hud.buttonInsetX;
  }

  private buttonCenter(out: Vector3): Vector3 {
    out.set(this.buttonCenterX(), this.hud.buttonCenterY, 0);
    return this.hud.document.localToWorld(out);
  }

  /**
   * Logs a head-height change of more than HEAD_HEIGHT_CHANGE_METERS since
   * placement (or since the last such line), with the time into the session.
   * Checked at refresh rate, not per frame.
   */
  private checkHeadHeight(): void {
    this.readHead();
    if (Number.isNaN(this.headRefY)) {
      this.headRefY = this._head.y;
      return;
    }
    const change = this._head.y - this.headRefY;
    if (Math.abs(change) > HEAD_HEIGHT_CHANGE_METERS) {
      console.info(
        `${LOG_PREFIX} head height changed by ${change > 0 ? '+' : ''}${change.toFixed(2)} m ` +
          `(${this.headRefY.toFixed(2)} -> ${this._head.y.toFixed(2)} m) at ${this.immersiveSeconds.toFixed(1)} s ` +
          `into the session; the tables were placed for the earlier height`,
      );
      this.headRefY = this._head.y;
    }
  }

  // --- Swap button -------------------------------------------------------------------

  /** In-plane distance (meters) from panel-local `_local` to the button's rectangle (0 inside). */
  private buttonPlanarDistance(): number {
    const dx = Math.max(0, Math.abs(this._local.x - this.buttonCenterX()) - this.hud.buttonWidth / 2);
    const dy = Math.max(0, Math.abs(this._local.y - this.hud.buttonCenterY) - this.hud.buttonHeight / 2);
    return Math.hypot(dx, dy);
  }

  private updateButton(): void {
    const object = this.hud.document;
    object.updateWorldMatrix(true, false);
    for (const hand of HANDS) {
      const source = this.input.xr.getPrimaryInputSource(hand);
      const selectStart = this.input.xr.gamepads[hand]?.getSelectStart() ?? false;

      // Pinch: the pinch point on the button.
      if (selectStart && source?.hand && readPinchPoint(this.world, this.player, source, this._a)) {
        this._local.copy(this._a);
        object.worldToLocal(this._local);
        if (Math.abs(this._local.z) <= BUTTON_PINCH_DEPTH_METERS && this.buttonPlanarDistance() <= BUTTON_PINCH_MARGIN_METERS) {
          this.press(`${hand} pinch`);
          continue;
        }
      }

      // Ray: the target ray hits the button (controllers, or a hand's far pinch).
      if (selectStart) {
        const raySpace = this.player.raySpaces[hand];
        raySpace.updateWorldMatrix(true, false);
        this._a.setFromMatrixPosition(raySpace.matrixWorld);
        this._b.set(0, 0, -1).transformDirection(raySpace.matrixWorld).add(this._a);
        object.worldToLocal(this._a);
        object.worldToLocal(this._b);
        this._b.sub(this._a);
        if (this._b.z < -1e-4 && this._a.z > 0) {
          this._local.copy(this._a).addScaledVector(this._b, -this._a.z / this._b.z);
          if (this.buttonPlanarDistance() <= BUTTON_TOLERANCE_METERS) {
            this.press(`${hand} ray`);
            continue;
          }
        }
      }

      // Poke: the index fingertip crosses the surface over the button.
      if (!source?.hand || !readJointsPoint(this.world, this.player, source, INDEX_TIP, this._local)) {
        this.pokeDepth[hand] = Infinity;
        continue;
      }
      object.worldToLocal(this._local);
      const depth = this._local.z;
      const before = this.pokeDepth[hand];
      this.pokeDepth[hand] = depth;
      if (
        before > BUTTON_POKE_DEPTH_METERS &&
        depth <= BUTTON_POKE_DEPTH_METERS &&
        depth > -BUTTON_PINCH_DEPTH_METERS &&
        this.buttonPlanarDistance() <= BUTTON_TOLERANCE_METERS
      ) {
        this.press(`${hand} poke`);
      }
    }
  }

  private press(how: string): void {
    if (this.clock - this.lastPress < BUTTON_DEBOUNCE_SECONDS) {
      return;
    }
    this.lastPress = this.clock;
    sounds.playClick(this.buttonCenter(this._a));
    this.side = this.side === 'left' ? 'right' : 'left';
    storeSide(this.side);
    this.applySide();
    const urlSide = new URLSearchParams(window.location.search).get('debugSide');
    console.info(
      `${LOG_PREFIX} ${how} on the swap button: moving to the ${this.side}` +
        (urlSide ? ` (the URL's debugSide=${urlSide} still wins on reload)` : ''),
    );
    this.place();
  }

  // --- Text ------------------------------------------------------------------------------

  private recordFrame(delta: number): void {
    this.frames[this.frameIndex] = delta * 1000;
    this.frameIndex = (this.frameIndex + 1) % HUD_FRAME_WINDOW;
    if (this.frameCount < HUD_FRAME_WINDOW) {
      this.frameCount++;
    }
  }

  private refreshText(): void {
    // Frame line: sort a copy in place (a full window needs no subarray).
    const n = this.frameCount;
    if (n > 0) {
      this.sorted.set(this.frames);
      const times = n === HUD_FRAME_WINDOW ? this.sorted : this.sorted.subarray(0, n);
      times.sort();
      let total = 0;
      for (let i = 0; i < n; i++) {
        total += times[i];
      }
      const p50 = times[Math.floor(0.5 * (n - 1))];
      const p95 = times[Math.floor(0.95 * (n - 1))];
      const max = times[n - 1];
      const longTask =
        this.lastLongTaskAt < 0
          ? 'none'
          : `${this.longTaskCount}, last ${this.lastLongTaskMs.toFixed(0)} ms ` +
            `${((performance.now() - this.lastLongTaskAt) / 1000).toFixed(0)} s ago`;
      const frameText =
        `frame p50 ${p50.toFixed(1)}  p95 ${p95.toFixed(1)}  max ${max.toFixed(1)} ms ` +
        `(${(total / 1000).toFixed(1)} s) | long tasks ${longTask}`;
      if (!this.panelHidden) {
        this.hud.frameLine.setProperties({ text: frameText });
      }
      // The log file gets it every few seconds, not at every refresh.
      if (++this.frameLogCounter >= HUD_FRAME_LOG_EVERY_REFRESHES) {
        this.frameLogCounter = 0;
        logToFile('info', `${LOG_PREFIX} ${frameText}`);
      }
    }

    // With ?debugPanel=0 nothing is drawn: the panel's text costs nothing.
    if (this.panelHidden || ring.version === this.shownVersion) {
      return;
    }
    this.shownVersion = ring.version;
    // Oldest at the top, newest at the bottom; only lines that changed.
    const shown = Math.min(ring.count, HUD_LOG_LINES);
    for (let i = 0; i < HUD_LOG_LINES; i++) {
      const age = HUD_LOG_LINES - 1 - i;
      const slot = age < shown ? (ring.count - 1 - age) % HUD_LOG_LINES : -1;
      const text = slot >= 0 ? ring.text[slot] : '';
      const kind = slot >= 0 ? ring.kind[slot] : 'info';
      if (text !== this.shownText[i]) {
        this.shownText[i] = text;
        // An empty entry takes no space, so the log stays packed at the bottom.
        this.hud.lines[i].setProperties({ text, display: text === '' ? 'none' : 'flex' });
      }
      if (kind !== this.shownKind[i]) {
        this.shownKind[i] = kind;
        this.hud.lines[i].setProperties({ color: COLOR_LINE[kind] });
      }
    }
  }
}

/** Distance from world `point` to a source slab's panel rectangle (its grab surface). Uses `scratch`. */
function distanceToSlab(point: Vector3, entity: Entity, scratch: Vector3): number {
  const object = entity.object3D;
  const doc = entity.getValue(TableSlabRuntime, 'layout') as TableSlabDocument | undefined;
  if (!object || !doc) {
    return Infinity;
  }
  object.updateWorldMatrix(true, false);
  scratch.copy(point);
  object.worldToLocal(scratch);
  const top = slabTopLocalY(doc);
  const bottom = slabBottomLocalY(doc);
  const dx = Math.max(0, Math.abs(scratch.x) - doc.widthMeters / 2);
  const dy = scratch.y > top ? scratch.y - top : scratch.y < bottom ? bottom - scratch.y : 0;
  return Math.sqrt(dx * dx + dy * dy + scratch.z * scratch.z);
}
