/**
 * Challenge mode: puzzles on the existing join interaction.
 *
 * Owns the puzzle card, the puzzle bar (Hint, Next, the filter chip) and the
 * target silhouette; the join system places them (see `join-bridge.ts`).
 * After every join, toggle or filter change settles, this compares the
 * player's query with the puzzle's target (`data/compare.ts`) and shows the
 * difference on the result slab; the first match wins. Progress is saved
 * per device (guarded localStorage).
 *
 * All 20 practice puzzles, over four datasets. A puzzle on another dataset
 * switches the desk first (`desk-placement.ts`): Next separates and glides
 * the slabs home, waits until no table is held (the never-yank rule; the
 * card says so), then the old tables leave and the new ones arrive; only
 * then does the puzzle become active. Nothing is evaluated mid-switch, or
 * against a puzzle whose tables aren't the joined ones (`canEvaluate`).
 *
 * Inert in free play (`CHALLENGE_MODE` false): it builds nothing.
 */

import {
  createSystem,
  PokeInteractable,
  RayInteractable,
  Vector3,
  VisibilityState,
  type Entity,
  type Signal,
  type UIKit,
} from '@iwsdk/core';
import { CHALLENGE_MODE } from './challenge-mode.js';
import { challengeStart, PLAYABLE, publishProgress, takePickedPuzzle } from './challenge-start.js';
import {
  type BarButton,
  barButtonContainer,
  type BarButtonTarget,
  buildPuzzleBar,
  buildPuzzleCard,
  MAX_FILTER_CHIPS,
  type PickerTileView,
  type PuzzleBarView,
  type PuzzleCardView,
  setArcLean,
  setBarContents,
  setBarHover,
  setCardIntro,
  setCardTheme,
  setCardWin,
  setHintLabel,
  setNextAvailable,
  setNextLabel,
  setNextWaiting,
  setPrevAvailable,
  setRecenterHover,
} from './challenge-view.js';
import { compareToTarget, fanOutGroups, type Comparison } from './data/compare.js';
import { BAR, CARD, COMPLETE, CONCEPT_INTROS, NULL_EXPLAINER, TARGET_OUTLINE, WELCOME } from './data/copy.js';
import { dailyPuzzleId, isoFromDay } from './data/daily.js';
import {
  advanceResume,
  aheadConcepts,
  completionLines,
  finishAction,
  isTodaysDaily,
  nextPuzzle,
  prevPuzzle,
  puzzleTiles,
  type FinishAction,
} from './data/daily-flow.js';
import { DATASETS } from './data/datasets.js';
import { canEvaluate, canStartSwitch, deskTableIds, type DeskState } from './data/desk-session.js';
import type { JoinState } from './data/join-state.js';
import { buildWhereSql } from './data/join-sql.js';
import {
  currentStreak,
  dailyCompletedToday,
  dailySolvedToday,
  isRevealed,
  isSolved,
  markConceptSeen,
  markStreakExplained,
  markDailyRevealed,
  markDailySolved,
  markSolved,
  recordSkip,
  saveProgress,
  type KeyValueStorage,
  type Progress,
} from './data/progress.js';
import { PUZZLE_CHECKS } from './data/puzzle-checks.js';
import {
  answerRevealed,
  latestHintIndex,
  sessionTransition,
  startSession,
  type PuzzleSession,
} from './data/puzzle-session.js';
import { puzzleText, resultHeader, type PuzzleText } from './data/puzzle-text.js';
import {
  canActivatePuzzle,
  getPuzzle,
  introducesConcept,
  PRACTICE_ORDER,
  puzzleTables,
  puzzleTarget,
  runPuzzleQuery,
  type Puzzle,
  type PuzzleId,
} from './data/puzzles.js';
import { visibleRowIndices, type QueryOutput } from './data/query.js';
import type { Table } from './data/types.js';
import { deskBridge } from './desk-bridge.js';
import { devFlag } from './dev-flags.js';
import { ChallengeDebug, type ChallengeDebugHost } from './challenge-debug.js';
import {
  joinBridge,
  type ChallengeHooks,
  type ChallengeLayout,
  type JoinControls,
  type NullFilterChoice,
} from './join-bridge.js';
import { buildQueue, type BuildJob } from './build-queue.js';
import { keepDatasets } from './dataset-cache.js';
import { PressDips } from './press-dip.js';
import { sounds } from './sound.js';
import { isTouchPointerClick, setRect, touchProbe, type PressPath } from './touch-probe.js';
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
} from './contact-poke.js';
import { indexStraightness, readJointsPoint } from './pinch.js';
import { HINT_PRESS_GAP_SECONDS, HintGate, SHOW_ANSWER_HOLD_SECONDS } from './hint-gate.js';
import {
  joinTypeControlSizeCm,
  MAX_RESULT_ROWS,
  startTableSlabBuild,
  type SlabBuild,
  type TableSlabDocument,
} from './table-slab-view.js';
import { BAND_ARC_RADIUS_METERS, unrollArc } from './band-arc.js';
import { cardMetrics } from './card-metrics.js';
import { PLANNED_CONTROL_DISTANCE_METERS, PLANNED_RESULT_DISTANCE_METERS, slabTextSizeAt } from './view-comfort.js';

/** A pinch presses a bar button within this of it in plane (and BUTTON_PINCH_*_DEPTH_METERS off its face). */
const BAR_PINCH_MARGIN_METERS = 0.015;
const HANDS = ['left', 'right'] as const;
const INDEX_TIP: readonly XRHandJoint[] = ['index-finger-tip'];
/** A ray select and a pinch on the same press count once. */
const BAR_PRESS_DEBOUNCE_SECONDS = 0.3;
/** How long "Solve it first, or use Hint." shows after pressing an inactive Next. */
const STATUS_FLASH_SECONDS = 2.5;
/** The bar's WHERE label pulse (a press on a NULL in the column already filtered). */
const WHERE_PULSE_SECONDS = 0.45;
/** How long "Poke a NULL in the result above, or use Filter." shows in the message area. */
const MESSAGE_FLASH_SECONDS = 3;
/** The bar's touch-readout names for the filter chips (no per-frame strings). */
/** Where cached documents wait out of sight (as the join system parks its result slabs). */
const PARKED_Y = -100;
const CHIP_NAMES = Array.from({ length: MAX_FILTER_CHIPS }, (_, i) => `chip ${i + 1}`);
/** A bar target's name for the logs: a chip's or a picker tile's own name. */
function targetName(name: BarButton, index: number): string {
  return name === 'chip' ? CHIP_NAMES[index] : name === 'tile' ? `tile ${index + 1}` : name;
}
/** The card fades back in this fast when it changes puzzle (per second). */
const CARD_FADE_IN_PER_SECOND = 3;
/**
 * During a dataset switch the card, bar and silhouette fade out with the
 * leaving tables (over their 0.35 s), and fade back in only once placed for
 * the new tables, so their move is part of the switch, never a jump after it.
 */
const SWITCH_FADE_OUT_PER_SECOND = 1 / 0.35;
/** Frames to wait after activation before fading in: the join system places them first. */
const REVEAL_DELAY_FRAMES = 2;
/** Every label the Next button shows. */
const NEXT_LABELS = [BAR.next, BAR.skip, BAR.finish, BAR.daily, BAR.done] as const;
/** The completion's sound: the win, again a moment later, then a chime. */
const COMPLETION_ECHO_SECONDS = 0.45;
const COMPLETION_CHIME_SECONDS = 0.9;

export class ChallengeSystem extends createSystem({}) implements ChallengeHooks, ChallengeDebugHost {
  private join: JoinControls | null = null;
  private storage: KeyValueStorage | null = null;
  private progress!: Progress;
  /** The day this page plays (fixed at load; dev `?day=` overrides it). */
  private today = 0;
  /** Whether the active puzzle is played as today's daily (its title, and its win extends the streak). */
  private isDaily = false;
  /** Whether the card shows the daily's concept intros in its query and note rows. */
  private introShown = false;

  private card!: PuzzleCardView;
  private bar!: PuzzleBarView;
  /** Shared with the join system, which places the card and bar; the bar's width is kept in sync here. */
  private layout!: ChallengeLayout;
  private cardEntity!: Entity;
  /** The card shows the one-time streak explanation, not yet marked as given (see update). */
  private streakExplainShowing = false;
  private barEntity!: Entity;
  private silhouette: Silhouette | null = null;
  /**
   * Target outlines kept built (the puzzle on the desk, the previous and
   * the next: `prefetchNeighbors`), each built a step at a time in the
   * background (build-queue.ts); others are disposed.
   */
  private readonly silhouettes = new Map<PuzzleId, Silhouette>();

  /** The active puzzle (its tables are on the desk). */
  private puzzle!: Puzzle;
  private text!: PuzzleText;
  private target!: QueryOutput;
  private session!: PuzzleSession;
  /** A puzzle on another dataset, waiting for the desk to switch to it. */
  private pending: PuzzleId | null = null;
  private switchRequested = false;
  /** The antijoin intro waits for the first NULLs to appear. */
  private nullCoachPending = false;
  private lastComparison: { output: QueryOutput; comparison: Comparison } | null = null;
  private lastState: JoinState | null = null;
  private lastPress = -Infinity;
  /** Hint's press gate: presses spaced out (hint-gate.ts); the answer itself needs a hold (`holdButton`). */
  private readonly hintGate = new HintGate();
  /** Recenter was pressed: "Recentered" shows once its glide starts (after the countdown). */
  private awaitingRecenter = false;
  private clock = 0;
  /** The card's message text and puzzle, as last set. */
  private messageText = '';
  private cardPuzzleId: PuzzleId | null = null;
  /** Frames left before the card, bar and silhouette fade in after activation. */
  private revealFrames = 0;
  /** When a brief status line ("Solve it first") gives way again (clock seconds; 0 = none). */
  private statusFlashUntil = 0;
  /** The card's intro lines under the message (the daily's intros, or "Make these moves..."), as last set. */
  private introLines: readonly string[] = [];
  /** A brief message ("Poke a NULL in the result above...") showing until then (clock seconds; 0 = none)... */
  private messageFlashUntil = 0;
  /** ...over this message and its intro lines, restored after it. */
  private flashRestore: { text: string; lines: readonly string[] } = { text: '', lines: [] };
  /** Whether the status line says "Move closer to your table" (a table was found out of reach). */
  /** The NULL cells' first-time cue waits for the first result with a NULL. */
  private nullCuePending = false;
  /** The card shows the completion state (every puzzle done; after "Finish"). */
  private completionShowing = false;
  /** The Filter chips are open (Back and one chip per choice). */
  private filterOpen = false;
  /** The chips' columns, in the order shown (from the join, at the last bar update). */
  private filterChoices: NullFilterChoice[] = [];
  /** The bar's contents as last set (only a change resizes and re-places it). */
  private barKey = '';
  /** When the bar's WHERE label started its pulse (clock seconds; -1 = none). */
  private wherePulseStart = -1;
  private debug: ChallengeDebug | null = null;
  private readonly _point = new Vector3();
  private readonly _local = new Vector3();
  /** Contact pokes on the bar's buttons. */
  private readonly barPoke = new ContactPoke();
  private _pokeSource: XRInputSource | null = null;
  private pokedTarget: BarButtonTarget | null = null;
  /** Press feedback: the pressed button dips (press-dip.ts). */
  private readonly dips = new PressDips();
  /** Hover: the button a fingertip is just in front of (-1: none), the hand pointer's (from the join system), and the one shown. */
  private fingerHover = -1;
  private pointerHover = -1;
  private shownHover = -1;
  private readonly _straightA = new Vector3();
  private readonly _straightB = new Vector3();
  /** Contact-poke hit test on the bar's shown buttons (the poke asks only at a contact). */
  private readonly pokeOnBar = (): boolean => {
    const bar = this.bar;
    let best = Infinity;
    this.pokedTarget = null;
    for (const button of bar.buttons) {
      const dy = Math.max(0, Math.abs(this._local.y - button.centerY) - bar.buttonHeightMeters / 2);
      const distance = Math.hypot(Math.max(0, Math.abs(this._local.x - button.centerX) - button.width / 2), dy);
      if (distance < best) {
        best = distance;
        this.pokedTarget = button;
      }
    }
    return best <= POKE_TARGET_TOLERANCE_METERS;
  };
  private readonly pokeStraightness = (): number | null =>
    this._pokeSource ? indexStraightness(this.world, this.player, this._pokeSource, this._straightA, this._straightB) : null;

  init(): void {
    if (!CHALLENGE_MODE) {
      return;
    }
    this.join = joinBridge.join;
    if (!this.join || !deskBridge.desk) {
      console.warn('[challenge] the join or desk system is not registered; challenge mode is off.');
      return;
    }

    // Progress was loaded and sanitized once, shared with desk placement
    // (which already put the start puzzle's tables on the desk).
    const start = challengeStart();
    this.storage = start.storage;
    this.progress = start.progress;
    this.today = start.today;

    // The card and bar, each on its own non-grabbable entity.
    this.card = buildPuzzleCard();
    this.cardEntity = this.world.createTransformEntity(this.card.document);
    const labelFontCm = slabTextSizeAt(PLANNED_CONTROL_DISTANCE_METERS).headerFontCm;
    this.bar = buildPuzzleBar(labelFontCm, {
      prev: BAR.prev,
      hint: BAR.hintLabels,
      // Every label Next shows (it's sized for the widest, so relabeling never resizes the bar).
      next: NEXT_LABELS,
      recenter: BAR.recenter,
      exit: BAR.exit,
      clear: BAR.clearFilter,
      filter: BAR.filter,
      filterBack: BAR.filterBack,
      puzzles: BAR.puzzles,
      pickerBack: BAR.pickerBack,
      today: BAR.pickerToday,
    }, joinTypeControlSizeCm(labelFontCm));
    this.barEntity = this.world.createTransformEntity(this.bar.document);
    // Poke and ray select arrive as UIKit clicks; pinches and hand rays come
    // from the join system (barDistance / pressBarAt), which also weighs the control.
    this.barEntity.addComponent(PokeInteractable, {});
    this.barEntity.addComponent(RayInteractable, {});
    // Rays (and controllers) only: a fingertip presses through the contact poke (updateBarPoke).
    const clickables: [InstanceType<typeof UIKit.Container>, BarButton, number][] = [
      [this.bar.prev, 'prev', -1],
      [this.bar.hint, 'hint', -1],
      [this.bar.next, 'next', -1],
      [this.bar.recenter.container, 'recenter', -1],
      [this.bar.clear, 'clear', -1],
      [this.bar.filter, 'filter', -1],
      [this.bar.filterBack, 'filterBack', -1],
      ...this.bar.filterChips.map((chip, i): [InstanceType<typeof UIKit.Container>, BarButton, number] => [
        chip.container,
        'chip',
        i,
      ]),
      [this.bar.puzzles, 'puzzles', -1],
      [this.bar.pickerBack, 'pickerBack', -1],
      ...this.bar.pickerTiles.map((tile, i): [InstanceType<typeof UIKit.Container>, BarButton, number] => [tile.container, 'tile', i]),
    ];
    for (const [container, name, chip] of clickables) {
      const onClick = (event: unknown) => {
        if (!isTouchPointerClick(event)) {
          this.press(name, 'uikit-click', chip);
        }
      };
      container.addEventListener('click', onClick);
      this.cleanupFuncs.push(() => container.removeEventListener('click', onClick));
    }

    joinBridge.challenge = this;
    this.layout = {
      card: {
        object: this.card.document,
        widthMeters: this.card.widthMeters,
        heightMeters: this.card.heightMeters,
        textFontMeters: cardMetrics().smallFont / 100,
      },
      bar: {
        object: this.bar.document,
        widthMeters: this.bar.widthMeters,
        heightMeters: this.bar.heightMeters,
        buttons: this.bar.buttons,
        buttonHeightMeters: this.bar.buttonHeightMeters,
        // Built with only Prev, Hint, Next and Recenter.
        leadCenterYMeters: this.bar.leadCenterYMeters,
        extendLeftMeters: 0,
        holdButton: null,
        onRecenterHover: (hovered) => setRecenterHover(this.bar.recenter, hovered),
        onExitHover: (hovered) => setRecenterHover(this.bar.exit, hovered),
        onArcLean: (leanRad) => setArcLean(this.bar, leanRad),
        onPointerHover: (index) => {
          this.pointerHover = index;
          this.applyBarHover();
        },
      },
    };
    this.join.setChallengeLayout(this.layout);

    this.debug = import.meta.env.DEV && devFlag('debug') ? new ChallengeDebug(this) : null;
    if (import.meta.env.DEV && this.debug) {
      // The bar's buttons, for the touch readout (touch-debug.ts).
      const bar = this.bar;
      // The SDK's own poke pointer (a UIKit "touch" pointer): its down / up on each button.
      const debug = this.debug;
      for (const [name, button] of [
        ['prev', bar.prev],
        ['hint', bar.hint],
        ['next', bar.next],
        ['recenter', bar.recenter.container],
        ['clear', bar.clear],
        ['filter', bar.filter],
        ['filterBack', bar.filterBack],
        ['puzzles', bar.puzzles],
        ['pickerBack', bar.pickerBack],
        ...bar.filterChips.map((chip, i) => [CHIP_NAMES[i], chip.container] as const),
      ] as const) {
        for (const type of ['pointerdown', 'pointerup'] as const) {
          const listener = (event: unknown) => {
            if ((event as { pointerType?: string } | null)?.pointerType === 'touch') {
              debug.note(`SDK poke pointer ${type === 'pointerdown' ? 'down' : 'up'} on ${name}`);
            }
          };
          button.addEventListener(type, listener);
          this.cleanupFuncs.push(() => button.removeEventListener(type, listener));
        }
      }
      touchProbe.addSurface({
        name: 'puzzle bar',
        // Its buttons sit on the band's arc: x is an arc length from the left edge.
        arc: () => ({ radius: BAND_ARC_RADIUS_METERS, lean: this.bar.leanRad }),
        object: () => (bar.fade.peek() >= 0.5 ? bar.document : null),
        rects: (out) => {
          const count = Math.min(bar.buttons.length, out.length);
          for (let i = 0; i < count; i++) {
            const button = bar.buttons[i];
            const name = targetName(button.name, button.chip);
            setRect(out[i], name, button.centerX, button.centerY, button.width, bar.buttonHeightMeters);
          }
          return count;
        },
      });
      const solved = Object.keys(this.progress.solved).length;
      this.debug.note(
        `progress: ${solved} solved; starting at ${start.puzzleId} on ${start.datasetId}` +
          (start.sanitized ? ' (sanitized: dropped entries this build cannot have made)' : ''),
      );
      const streak = currentStreak(this.progress.daily, this.today);
      this.debug.note(
        start.reason === 'daily'
          ? `start: daily ${start.puzzleId} for ${isoFromDay(this.today)}, streak ${streak}`
          : start.reason === 'practice'
            ? `start: practice ${start.puzzleId} on ${isoFromDay(this.today)} (` +
              (dailySolvedToday(this.progress.daily, this.today)
                ? 'daily already solved'
                : dailyCompletedToday(this.progress.daily, this.today)
                  ? 'daily already done with the answer'
                  : 'daily not offered yet') +
              `), streak ${streak}`
            : `start: ${start.puzzleId} from ?puzzle= on ${isoFromDay(this.today)}, streak ${streak}`,
      );
    }

    this.cleanupFuncs.push(() => {
      for (const entry of this.silhouettes.values()) {
        buildQueue.remove(entry.job);
        entry.entity.dispose();
      }
      this.cardEntity.dispose();
      this.barEntity.dispose();
      this.debug?.dispose();
      if (joinBridge.challenge === this) {
        joinBridge.challenge = null;
      }
    });

    this.loadPuzzle(start.puzzleId);
  }

  update(delta: number): void {
    const join = this.join;
    if (!join || !this.card) {
      return;
    }
    this.clock += delta;
    this.dips.update(this.clock);
    this.updateFade(delta);
    // The streak explanation counts as given once it's on the card in a session (not on the flat page).
    if (this.streakExplainShowing && this.world.visibilityState.peek() !== VisibilityState.NonImmersive) {
      this.streakExplainShowing = false;
      this.progress = markStreakExplained(this.progress);
      this.save();
      if (import.meta.env.DEV && this.debug) {
        this.debug.note('streak explained on the card (shown once)');
      }
    }
    if (this.awaitingRecenter && deskBridge.desk?.recenterGliding) {
      this.awaitingRecenter = false;
      if (!this.pending) {
        this.card.status.setProperties({ text: CARD.recentered });
        this.statusFlashUntil = this.clock + STATUS_FLASH_SECONDS;
      }
    }
    // A puzzle picked on the welcome screen (not mid-switch: it waits for that to finish).
    if (!this.pending && this.puzzle) {
      const picked = takePickedPuzzle();
      if (picked && picked !== this.puzzle.id) {
        if (import.meta.env.DEV && this.debug) {
          this.debug.note(`picked on the welcome screen: puzzle ${PRACTICE_ORDER.indexOf(picked) + 1} (${picked})`);
        }
        join.resetToHome();
        this.loadPuzzle(picked);
      }
    }
    if (this.pending) {
      this.updatePendingSwitch(join);
      return;
    }
    if (!this.puzzle) {
      return;
    }
    const state = join.joinState;
    if (state !== this.lastState) {
      this.lastState = state;
      this.updateBar();
    }
    // Next pulses once the puzzle is won, until it's pressed (Finish too).
    if (this.session.solved && (this.nextAvailable() || this.finishAction() === 'finish')) {
      this.bar.nextOpacity.value = 0.75 + 0.25 * Math.sin(this.clock * 4);
    }
    // "Solve it first" (an inactive Next) gives way to the status it covered.
    if (this.statusFlashUntil > 0 && this.clock >= this.statusFlashUntil) {
      this.statusFlashUntil = 0;
      this.card.status.setProperties({ text: this.restingStatus() });
    }
    // "Poke a NULL in the result above" gives way to the message it covered.
    if (this.messageFlashUntil > 0 && this.clock >= this.messageFlashUntil) {
      this.messageFlashUntil = 0;
      setCardIntro(this.card, this.flashRestore.text, this.flashRestore.lines);
    }
    this.updateWherePulse();
    this.updateBarPoke();
  }

  /** The bar's WHERE label dips once and returns (a press on the column already filtered). */
  private updateWherePulse(): void {
    if (this.wherePulseStart < 0) {
      return;
    }
    const t = (this.clock - this.wherePulseStart) / WHERE_PULSE_SECONDS;
    if (t >= 1) {
      this.wherePulseStart = -1;
      this.bar.whereOpacity.value = 1;
      return;
    }
    this.bar.whereOpacity.value = 1 - 0.7 * Math.sin(Math.PI * t);
  }

  /**
   * The status line when nothing brief covers it: finished, the diff, a
   * replay's "Solved before" / "Done with answer before", or nothing. (Being
   * out of reach is the join system's reach banner, not the card's.)
   */
  private restingStatus(): string {
    if (this.session.solved || this.completionShowing) {
      return this.solvedStatus();
    }
    if (this.lastComparison) {
      return diffSummary(this.lastComparison.comparison);
    }
    return this.puzzle ? this.beforeStatus(this.puzzle.id) : '';
  }

  /** A replay of a finished puzzle says so (the takeaway shows again once it's re-solved). */
  private beforeStatus(id: PuzzleId): string {
    if (isRevealed(this.progress, id)) {
      return CARD.doneWithAnswerBefore;
    }
    return isSolved(this.progress, id) ? CARD.solvedBefore : '';
  }

  /**
   * Briefly shows `text` in the card's message area, then restores what it
   * covered. Not over a win, nor mid-switch. A new message (a hint, the win)
   * replaces it at once.
   */
  private flashMessage(text: string): void {
    if (this.pending || this.session.solved) {
      return;
    }
    if (this.messageFlashUntil === 0) {
      this.flashRestore = { text: this.messageText, lines: this.introLines };
    }
    this.messageFlashUntil = this.clock + MESSAGE_FLASH_SECONDS;
    setCardIntro(this.card, text, []);
  }

  /**
   * Contact pokes on the bar's buttons (contact-poke.ts): on contact, from
   * the viewer's side, index finger extended. The UIKit click stays as a
   * second path; `press` counts a press once (its debounce).
   */
  private updateBarPoke(): void {
    const bar = this.bar;
    if (bar.fade.peek() < 0.5 || this.pending) {
      this.barPoke.reset('left');
      this.barPoke.reset('right');
      this.fingerHover = -1;
      this.applyBarHover();
      return;
    }
    let fingerHover = -1;
    bar.document.updateWorldMatrix(true, false);
    for (const hand of HANDS) {
      const source = this.input.xr.getPrimaryInputSource(hand);
      // A hand holding a slab doesn't poke the column (the arm passes it on the way to the right slab).
      if (
        !source?.hand ||
        this.join?.handHoldsSlab(hand) ||
        !readJointsPoint(this.world, this.player, source, INDEX_TIP, this._point)
      ) {
        this.barPoke.reset(hand);
        continue;
      }
      this._pokeSource = source;
      this._local.copy(this._point);
      bar.document.worldToLocal(this._local);
      // The band's buttons sit on an arc: unrolled, its flat targets apply.
      unrollArc(this._local, BAND_ARC_RADIUS_METERS, this.bar.leanRad);
      const verdict = this.barPoke.update(hand, this._local, this.pokeOnBar, this.pokeStraightness);
      const target = this.pokedTarget;
      if (import.meta.env.DEV && this.debug) {
        const miss = this.barPoke.takeMiss(hand);
        if (miss) {
          this.debug.note(`${hand} fingertip on the puzzle bar, no press: ${pokeMissText(miss)}`);
        }
      }
      // Hover: the fingertip just in front of a button (the hand pointer's outline).
      if (fingerHover < 0 && this._local.z <= POKE_HOVER_DEPTH_METERS && this._local.z >= -CONTACT_DEPTH_METERS && this.pokeOnBar()) {
        fingerHover = this.pokedTarget ? bar.buttons.indexOf(this.pokedTarget) : -1;
        this.pokedTarget = target;
      }
      if (verdict === 'press' && target) {
        this.press(target.name, 'poke', target.chip);
      } else if (verdict !== 'none' && verdict !== 'press' && import.meta.env.DEV && this.debug) {
        const { toward, sideways, straightness } = this.barPoke.last;
        const cm = (m: number) => `${(m * 100).toFixed(1)} cm`;
        const name = target ? targetName(target.name, target.chip) : 'the bar';
        this.debug.note(
          verdict === 'rejected-direction'
            ? `${hand} fingertip contact on ${name} rejected: it came in along the face (${cm(toward)} ` +
                `toward it, ${cm(sideways)} sideways: ${approachAngleDeg(toward, sideways).toFixed(0)}° off straight, max ${MAX_POKE_APPROACH_DEG}°)`
            : `${hand} fingertip contact on ${name} rejected: index finger not extended (straightness ` +
                `${straightness === null ? 'n/a' : straightness.toFixed(2)}, needs ${MIN_INDEX_STRAIGHTNESS})`,
        );
      }
    }
    this.fingerHover = fingerHover;
    this.applyBarHover();
  }

  /**
   * The card's, bar's and silhouette's fade: out while the desk switches
   * datasets; in again once the new puzzle is active and placed.
   */
  private updateFade(delta: number): void {
    const switching = this.pending !== null && this.deskState().phase !== 'ready';
    let target = 1;
    let rate = CARD_FADE_IN_PER_SECOND;
    if (switching) {
      target = 0;
      rate = SWITCH_FADE_OUT_PER_SECOND;
    } else if (this.revealFrames > 0) {
      this.revealFrames--;
      return;
    }
    const step = delta * rate;
    stepFade(this.card.fade, target, step);
    stepFade(this.bar.fade, target, step);
    if (this.silhouette) {
      stepFade(this.silhouette.doc.fade, target, step);
    }
  }

  // --- ChallengeHooks ------------------------------------------------------------------

  onSettled(): void {
    const join = this.join;
    const state = join?.joinState;
    if (!join || !state || state.phase !== 'joined' || !this.puzzle) {
      return;
    }
    // Never judge a result mid-switch, or against a puzzle on other tables: no diff, no win.
    if (this.pending || !canEvaluate(this.deskState(), this.puzzle, state)) {
      if (import.meta.env.DEV && this.debug) {
        this.debug.error(
          `evaluation refused: the active puzzle ${this.puzzle.id} is on ${this.puzzle.tables.join(' + ')}, ` +
            `the join is ${state.left} + ${state.right}, the desk is ${this.deskState().phase}` +
            (this.pending ? ` (switching to ${this.pending})` : ''),
        );
      }
      this.lastComparison = null;
      join.applyDiff(null, 0);
      join.setWinLook(false);
      join.setResultBadge(null, 'neutral');
      this.card.status.setProperties({ text: '' });
      return;
    }
    const output = runPuzzleQuery(this.puzzle, {
      left: state.left,
      right: state.right,
      joinType: state.joinType,
      filter: state.filter ?? null,
    });
    const comparison = compareToTarget(output, this.target);
    this.lastComparison = { output, comparison };
    join.applyDiff(comparison.rowStatus, comparison.missing.length);
    // The gold win look only for a real solve, never after "Show answer".
    join.setWinLook(comparison.solved && !answerRevealed(this.session));
    this.card.status.setProperties({ text: this.session.solved ? this.solvedStatus() : diffSummary(comparison) });

    // The antijoin intro: the first time a LEFT result shows NULLs.
    if (this.nullCoachPending && state.joinType === 'left' && join.hasVisibleNull()) {
      this.nullCoachPending = false;
      this.progress = markConceptSeen(this.progress, this.puzzle.concept);
      this.save();
      if (!this.session.solved && this.session.hintsShown === 0) {
        this.setMessage(`${CONCEPT_INTROS[this.puzzle.concept]} ${NULL_EXPLAINER}`);
      }
    }
    // The first result with pokeable NULLs (practice puzzle 3, or a daily
    // ahead of it): their outlines brighten once, gently.
    if (this.nullCuePending && join.hasVisibleNull()) {
      this.nullCuePending = false;
      join.pulseNullCells();
    }

    if (comparison.solved && !this.session.solved) {
      this.win();
    }
    this.updateBadge();
    // Filter (or its chips) follows the NULLs now shown.
    this.updateBar();
    if (import.meta.env.DEV && this.debug) {
      this.debug.logComparison(this.puzzle, output, comparison);
    }
  }

  /**
   * The result slab's badge mirrors the card's state where the player is
   * looking (the card is off to the side): "Solved!" in gold, "Completed",
   * or the diff summary; hidden when there's nothing to say.
   */
  private updateBadge(): void {
    const join = this.join;
    if (!join) {
      return;
    }
    if (this.completionShowing) {
      join.setResultBadge(COMPLETE.badge, 'won');
      return;
    }
    if (this.session.solved) {
      const revealed = answerRevealed(this.session);
      join.setResultBadge(revealed ? CARD.completedHeadline : CARD.headline, revealed ? 'neutral' : 'won');
      return;
    }
    join.setResultBadge(this.lastComparison ? diffSummary(this.lastComparison.comparison) || null : null, 'neutral');
  }

  onPhase(phase: JoinState['phase']): void {
    if ((phase === 'separating' || phase === 'idle') && this.session && !this.pending) {
      this.lastComparison = null;
      this.filterOpen = false;
      if (this.statusFlashUntil === 0) {
        this.card.status.setProperties({ text: this.restingStatus() });
      }
    }
  }

  barDistance(point: Vector3): number {
    return this.barButtonAt(point) ? this.lastPinchDistance : Infinity;
  }

  pressBarAt(point: Vector3, hand: string, path: PressPath): void {
    const target = this.barButtonAt(point);
    const name = target ? targetName(target.name, target.chip) : null;
    if (import.meta.env.DEV && this.debug && path === 'pinch') {
      this.debug.notePinch(hand, name, this.lastPinchDistance);
    }
    if (target) {
      this.press(target.name, path, target.chip);
    }
  }

  /** Recenter (held, or the debug key): the group glides back in front of the player (desk placement; it waits for a held slab). */
  private recenter(path: string): void {
    if (import.meta.env.DEV && this.debug) {
      this.debug.note(`Recenter (${path})`);
    }
    this.bar.document.updateWorldMatrix(true, false);
    this._point.setFromMatrixPosition(this.bar.document.matrixWorld);
    // After its countdown ("Look straight ahead"); the card says so once the tables move.
    deskBridge.desk?.requestRecenter(this._point);
    this.awaitingRecenter = true;
  }

  onHoldComplete(name: string): void {
    if (name === 'recenter') {
      this.bar.document.updateWorldMatrix(true, false);
      this._point.setFromMatrixPosition(this.bar.document.matrixWorld);
      sounds.playClick(this._point);
      this.recenter('hold');
      return;
    }
    // Show answer, held its full time: the answer.
    if (name === 'hint' && this.nextHintRevealsAnswer()) {
      this.hintGate.pressed(this.clock);
      this.showHint();
    }
  }

  onHoldCancelled(name: string): void {
    // Let go before its time: nothing happened, and the card says why.
    if (name === 'hint' && this.nextHintRevealsAnswer() && !this.pending) {
      this.card.status.setProperties({ text: CARD.holdForAnswer });
      this.statusFlashUntil = this.clock + STATUS_FLASH_SECONDS;
    }
  }

  onNullFilterRepeat(): void {
    this.wherePulseStart = this.clock;
  }

  onWrongNull(tableId: string, path: PressPath): void {
    if (import.meta.env.DEV && this.debug) {
      this.debug.note(`${path} on a NULL in the ${tableId} table (a source): "${CARD.wrongNull}" (no click)`);
    }
    this.flashMessage(CARD.wrongNull);
  }

  // --- ChallengeDebugHost --------------------------------------------------------------

  debugHint(): void {
    this.showHint();
  }

  debugNext(): void {
    this.lastPress = -Infinity;
    this.press('next', 'debug-key');
  }

  debugPrev(): void {
    const index = PLAYABLE.indexOf(this.puzzle.id);
    if (index > 0 && !this.pending) {
      this.join?.resetToHome();
      this.loadPuzzle(PLAYABLE[index - 1]);
    }
  }

  debugRecenter(): void {
    this.lastPress = -Infinity;
    this.press('recenter', 'debug-key');
  }

  debugPoke(): boolean {
    return this.join?.debugPokeFirstNull() ?? false;
  }

  /** Dev only (`G` / `X`, from ChallengeDebug): applies the puzzle's solution or its authored wrong state. */
  debugApply(which: 'solution' | 'wrong'): void {
    if (!import.meta.env.DEV || !this.debug) {
      return;
    }
    const switching = !!this.pending || this.deskState().phase !== 'ready';
    const check = PUZZLE_CHECKS[this.puzzle.id];
    this.debug.noteApply(this.puzzle.id, which, check, switching);
    if (!switching) {
      this.join?.debugApply(which === 'solution' ? this.puzzle.solution : check.wrong);
    }
  }

  debugSnapshot(): { puzzle: Puzzle; output: QueryOutput; comparison: Comparison } | null {
    return this.lastComparison ? { puzzle: this.puzzle, ...this.lastComparison } : null;
  }

  // --- Puzzles -----------------------------------------------------------------------------

  private deskState(): DeskState {
    return deskBridge.desk?.deskState ?? { phase: 'ready', dataset: 'shop' };
  }

  /**
   * The one gate for making a puzzle active: in the playable range, and on
   * exactly the tables of the ready desk (mid-switch, no tables count).
   */
  private canLoad(id: string): id is PuzzleId {
    return canActivatePuzzle(id, PLAYABLE, deskTableIds(this.deskState()));
  }

  /**
   * Opens `id`: at once if its tables are on the desk, else switches the
   * desk to its dataset first (the puzzle becomes active once they've
   * arrived). The card shows the coming puzzle right away.
   */
  private loadPuzzle(id: PuzzleId): void {
    // Any switch closes the picker (a tile closes it first; the debug keys may not).
    if (this.pickerOpen) {
      this.pickerOpen = false;
      this.updateBar();
    }
    if (!PLAYABLE.includes(id)) {
      if (import.meta.env.DEV && this.debug) {
        this.debug.error(`load refused: ${id} is outside the playable puzzles`);
      }
      return;
    }
    if (this.canLoad(id)) {
      this.activate(id);
      return;
    }
    // Another dataset: the switch runs in update(); the card shows what's coming.
    this.pending = id;
    this.switchRequested = false;
    const puzzle = getPuzzle(id);
    this.showCardFor(puzzle);
    this.setMessage('');
    this.parkSilhouette();
    this.join?.setSilhouette(null);
    this.lastComparison = null;
    setNextAvailable(this.bar, false);
    setPrevAvailable(this.bar, false);
    if (import.meta.env.DEV && this.debug) {
      this.debug.note(`switching to ${puzzle.datasetId} for ${id}`);
    }
  }

  /**
   * While a switch is pending: separate and glide home first (Next already
   * asked), then wait until no table is held -- the card says so, and Next
   * looks pressed -- then ask the desk to switch, and activate the puzzle
   * once its tables are ready.
   */
  private updatePendingSwitch(join: JoinControls): void {
    const desk = deskBridge.desk;
    const id = this.pending;
    if (!desk || !id) {
      return;
    }
    const target = getPuzzle(id).datasetId;
    const state = desk.deskState;
    if (state.phase === 'ready' && state.dataset === target) {
      this.pending = null;
      this.activate(id);
      return;
    }
    const held = desk.anySlabHeld();
    if (held && state.phase === 'ready') {
      // Never-yank: the switch waits for the release, with feedback.
      if (this.messageText !== CARD.letGo) {
        this.setMessage(CARD.letGo);
        setNextWaiting(this.bar);
      }
    } else if (this.messageText === CARD.letGo) {
      this.setMessage('');
      setNextAvailable(this.bar, false);
    }
    if (!this.switchRequested && canStartSwitch(join.joinState, held, join.isGliding())) {
      this.switchRequested = true;
      desk.requestDataset(target);
    }
  }

  /** Makes `id` the active puzzle; refused (and logged) unless `canLoad` allows it. */
  private activate(id: PuzzleId): void {
    const join = this.join;
    if (!join) {
      return;
    }
    if (!this.canLoad(id)) {
      if (import.meta.env.DEV && this.debug) {
        this.debug.error(`load refused: ${id} isn't on the desk's tables (${deskTableIds(this.deskState()).join(' + ')})`);
      }
      return;
    }
    this.puzzle = getPuzzle(id);
    this.text = puzzleText(this.puzzle);
    this.target = puzzleTarget(this.puzzle);
    this.session = startSession(id);
    this.completionShowing = false;
    this.hintGate.reset();
    this.updateHintLabel();
    this.lastComparison = null;
    this.lastState = null;

    // The silhouette (target outline): the target's headers, one empty row and the row count, in the result slot.
    // Built ahead (prefetchNeighbors), or now: only its header and one row, so it's quick.
    this.parkSilhouette();
    const buildStart = performance.now();
    const entry = this.silhouetteFor(this.puzzle, this.target, true);
    const prebuilt = entry.build.done;
    if (!prebuilt) {
      entry.build.step(Infinity);
      buildQueue.remove(entry.job);
    }
    if (import.meta.env.DEV && this.debug) {
      this.debug.note(
        `perf: target outline for ${id} ${prebuilt ? 'prebuilt (cached)' : `built now in ${(performance.now() - buildStart).toFixed(1)} ms`}`,
      );
    }
    const doc = entry.doc;
    // It appears with the card: hidden until placed (after a switch the card
    // is faded out too), then they fade in together.
    doc.fade.value = Math.min(1, this.card.fade.peek());
    doc.document.visible = true;
    this.revealFrames = REVEAL_DELAY_FRAMES;
    this.silhouette = entry;
    // Its height as shown: one row (the rest are hidden; they only size the columns).
    join.setSilhouette({ object: doc.document, widthMeters: doc.widthMeters, heightMeters: doc.heightForRowsMeters(1) });

    // The card.
    this.isDaily = isTodaysDaily(this.progress, id, this.today, PRACTICE_ORDER);
    this.showCardFor(this.puzzle);
    const concept = this.puzzle.concept;
    // A daily ahead of practice introduces what it uses, without marking it
    // seen: practice still introduces it properly when it gets there.
    const ahead = this.isDaily ? aheadConcepts(this.progress, this.puzzle) : [];
    const freshConcept = introducesConcept(this.puzzle) && !this.progress.seenConcepts.includes(concept);
    // The antijoin intro waits until NULLs are on screen (see onSettled).
    this.nullCoachPending = ahead.length === 0 && freshConcept && concept === 'antijoin';
    // So does the NULL cells' first-time cue (also for a daily that introduces it ahead of practice).
    this.nullCuePending = (freshConcept && concept === 'antijoin') || ahead.includes('antijoin');
    this.filterOpen = false;
    this.messageFlashUntil = 0;
    // The first daily explains the streak, once: in the message area, or in a
    // free intro line; a concept intro keeps the slot (it waits for a later daily).
    let explainStreak = this.isDaily && !this.progress.streakExplained;
    if (ahead.length > 0) {
      const intros = ahead.map((c) => CONCEPT_INTROS[c]);
      if (explainStreak && intros.length < 2) {
        intros.push(CARD.streakExplainer);
      } else {
        explainStreak = false;
      }
      this.introLines = intros;
      setCardIntro(this.card, CARD.dailyAhead, this.introLines);
      this.messageText = CARD.dailyAhead;
      this.introShown = true;
    } else if (freshConcept && concept !== 'antijoin') {
      explainStreak = false;
      this.setMessage(CONCEPT_INTROS[concept]);
      this.progress = markConceptSeen(this.progress, concept);
    } else {
      this.setMessage(explainStreak ? CARD.streakExplainer : '');
    }
    // Marked once seen in a session (update): the card is also built on the flat page, unseen.
    this.streakExplainShowing = explainStreak;

    // A daily (possibly locked) is never the resume point; practice is, and
    // it only moves forward (a replay via Prev never sends the next session back).
    if (!this.isDaily) {
      this.progress = advanceResume(this.progress, id, PLAYABLE);
    }
    this.save();
    this.updateNextLook();
    this.prefetchNeighbors();
    if (import.meta.env.DEV && this.debug) {
      this.debug.note(
        `puzzle ${PRACTICE_ORDER.indexOf(id) + 1} (${id}) loaded on ${this.puzzle.datasetId}` +
          `${this.isDaily ? ` as the daily for ${isoFromDay(this.today)}` : ''}; ` +
          `target ${visibleRowIndices(this.target).length} rows` +
          (ahead.length > 0 ? `; ahead of practice: ${ahead.join(', ')}` : ''),
      );
    }
  }

  /** The card for `puzzle`: its dataset's look, title and goal, not won; it fades in when the puzzle changes. */
  private showCardFor(puzzle: Puzzle): void {
    const fresh = this.cardPuzzleId !== puzzle.id;
    this.cardPuzzleId = puzzle.id;
    setCardTheme(this.card, DATASETS[puzzle.datasetId].theme);
    setCardWin(this.card, null);
    this.introShown = false;
    this.introLines = [];
    this.messageFlashUntil = 0;
    const daily = isTodaysDaily(this.progress, puzzle.id, this.today, PRACTICE_ORDER);
    this.card.title.setProperties({
      text: daily
        ? CARD.dailyTitle(PRACTICE_ORDER.indexOf(puzzle.id) + 1)
        : CARD.practiceTitle(PRACTICE_ORDER.indexOf(puzzle.id) + 1, puzzle.datasetId),
    });
    this.card.goal.setProperties({ text: puzzleText(puzzle).goal });
    this.card.status.setProperties({ text: this.beforeStatus(puzzle.id) });
    if (fresh) {
      this.card.fade.value = 0;
    }
  }

  /**
   * The puzzle matches its target. Solved (at most two hints): the win --
   * "Solved!", gold, the win sound, streak credit for a daily. After "Show
   * answer": completed, not solved -- "Completed" in the neutral look, a soft
   * confirmation, recorded as revealed, and a daily only bridges the streak.
   * The takeaway shows either way: the learning still matters.
   */
  private win(): void {
    this.session = sessionTransition(this.session, { type: 'evaluate', solved: true });
    const revealed = answerRevealed(this.session);
    // Recorded first, so Next and the streak below see it.
    this.progress = markSolved(this.progress, this.puzzle.id, this.today, this.session.hintsShown, revealed);
    if (this.isDaily) {
      this.progress = revealed
        ? markDailyRevealed(this.progress, this.today)
        : markDailySolved(this.progress, this.today);
    }
    this.save();
    // The next puzzle may have just unlocked: build it ahead.
    this.prefetchNeighbors();
    this.introShown = false;
    this.introLines = [];
    this.messageFlashUntil = 0;
    this.filterOpen = false;
    // Nowhere further: "More puzzles soon." -- unless every puzzle is done (Next says Finish).
    const lastNote = this.nextId() === null && this.finishAction() === null ? CARD.morePuzzlesSoon : null;
    if (revealed) {
      // A daily says why the streak didn't grow. A fan-out takeaway takes two
      // lines, so there the note stands in for the query line (the caption
      // on the result slab shows the query anyway).
      const note = this.isDaily ? CARD.streakNeedsSolve : lastNote;
      const twoLineTakeaway = !!this.puzzle.fanOutHighlight;
      setCardWin(this.card, {
        headline: CARD.completedHeadline,
        takeaway: this.text.takeaway,
        query: note && twoLineTakeaway ? null : CARD.winWithAnswer,
        note,
        completed: true,
      });
    } else {
      // Solved! / why it worked / the query it wrote.
      setCardWin(this.card, { headline: CARD.headline, takeaway: this.text.takeaway, query: CARD.win, note: lastNote });
    }
    // The title row's right-hand slot (the diff summary while playing).
    this.card.status.setProperties({ text: this.solvedStatus() });
    this.card.document.updateWorldMatrix(true, false);
    this._point.setFromMatrixPosition(this.card.document.matrixWorld);
    if (revealed) {
      sounds.playComplete(this._point);
    } else {
      sounds.playWin(this._point);
    }
    // A fan-out win explains its surprise: the rows that repeat pulse while
    // the takeaway says why.
    const cause = this.puzzle.fanOutHighlight;
    if (cause && this.lastComparison) {
      const rows = fanOutGroups(this.lastComparison.output)
        .filter((group) => group.cause === cause)
        .flatMap((group) => group.resultRows);
      this.join?.pulseRows(rows);
    }
    this.updateNextLook();
  }

  /** Saves progress (best effort) and publishes it for the welcome screen. */
  private save(): void {
    publishProgress(this.progress, saveProgress(this.storage, this.progress));
  }

  private showHint(): void {
    if (this.pending) {
      return;
    }
    const before = this.session;
    this.session = sessionTransition(this.session, { type: 'showHint' });
    this.updateHintLabel();
    const index = latestHintIndex(this.session);
    if (index === null) {
      return;
    }
    if (!this.session.solved) {
      if (answerRevealed(this.session)) {
        // The answer, then what to do with it: the moves still finish it, or
        // Next (now Skip) moves on.
        this.messageFlashUntil = 0;
        this.introLines = [CARD.answerNext];
        setCardIntro(this.card, this.text.hints[index], this.introLines);
        this.messageText = this.text.hints[index];
        this.introShown = true;
      } else {
        this.setMessage(this.text.hints[index]);
      }
    }
    this.updateNextLook();
    this.bar.document.updateWorldMatrix(true, false);
    this._point.setFromMatrixPosition(this.bar.document.matrixWorld);
    if (this.session !== before) {
      sounds.playHint(this._point);
    }
  }

  /** Whether the next hint would reveal the answer for the first time (it asks "Show answer?" first). */
  private nextHintRevealsAnswer(): boolean {
    return !answerRevealed(this.session) && this.session.hintsShown >= BAR.hintLabels.length - 1;
  }

  /**
   * The hint button says what it shows next: "Hint" before the first,
   * "Another hint" after it, "Show answer" before the third (and after it,
   * where a press shows the answer again).
   */
  private updateHintLabel(): void {
    const labels = BAR.hintLabels;
    setHintLabel(this.bar, labels[Math.min(this.session.hintsShown, labels.length - 1)]);
    // Before the answer, Show answer acts only when held (the join system times it: onHoldComplete).
    if (this.layout) {
      this.layout.bar.holdButton = this.nextHintRevealsAnswer() ? { name: 'hint', seconds: SHOW_ANSWER_HOLD_SECONDS } : null;
    }
  }

  private next(): void {
    if (this.canSkip()) {
      this.skip();
      return;
    }
    const nextId = this.nextAvailable() ? this.nextId() : null;
    if (!nextId) {
      return;
    }
    this.join?.resetToHome();
    this.loadPuzzle(nextId);
  }

  /**
   * Skip is offered once the answer is showing and the puzzle isn't done:
   * not solved now, and not completed before (a replay of a completed
   * puzzle just has Next).
   */
  private canSkip(): boolean {
    return (
      !this.pending &&
      !!this.puzzle &&
      !this.session.solved &&
      answerRevealed(this.session) &&
      !isSolved(this.progress, this.puzzle.id)
    );
  }

  /**
   * Skip: records the puzzle as revealed (it unlocks the next one; a daily
   * gets no streak credit, only the one-day bridge) and goes to the next.
   */
  private skip(): void {
    this.progress = recordSkip(this.progress, this.puzzle.id, this.today, this.session.hintsShown, this.isDaily);
    this.save();
    const nextId = this.nextId();
    if (import.meta.env.DEV && this.debug) {
      this.debug.note(`skipped ${this.puzzle.id} after the answer (recorded as revealed); next: ${nextId ?? 'none'}`);
    }
    if (!nextId) {
      this.updateNextLook();
      return;
    }
    this.join?.resetToHome();
    this.loadPuzzle(nextId);
  }

  /** Where Next goes: the next puzzle number, if it's unlocked. */
  private nextId(): PuzzleId | null {
    return nextPuzzle(this.progress, this.puzzle.id, PLAYABLE);
  }

  /** Where Prev goes: the previous puzzle number (the highest unlocked one below); null on puzzle 1. */
  private prevId(): PuzzleId | null {
    return this.puzzle ? prevPuzzle(this.progress, this.puzzle.id, PLAYABLE) : null;
  }

  private prevAvailable(): boolean {
    return !this.pending && this.prevId() !== null;
  }

  /**
   * Prev: back to an earlier puzzle, through the same switch as Next
   * (separate, glide home, wait for a held slab, or switch datasets).
   * Progress doesn't change: a replay keeps a solve, and the resume point
   * only moves forward (`advanceResume`).
   */
  private prev(): void {
    const prevId = this.prevAvailable() ? this.prevId() : null;
    if (!prevId) {
      return;
    }
    if (import.meta.env.DEV && this.debug) {
      this.debug.note(
        `Prev: puzzle ${PRACTICE_ORDER.indexOf(this.puzzle.id) + 1}${this.isDaily ? ' (the daily)' : ''} -> ` +
          `puzzle ${PRACTICE_ORDER.indexOf(prevId) + 1}`,
      );
    }
    this.join?.resetToHome();
    this.loadPuzzle(prevId);
  }

  /**
   * The status line once finished: after "Show answer", that all three hints
   * were used; for a solved daily, the streak; else how many hints it took.
   */
  private solvedStatus(): string {
    if (this.completionShowing) {
      return completionLines(this.progress, PLAYABLE, this.today).streak ?? '';
    }
    if (answerRevealed(this.session)) {
      return CARD.usedAllHints;
    }
    if (this.isDaily && dailySolvedToday(this.progress.daily, this.today)) {
      return WELCOME.streak(currentStreak(this.progress.daily, this.today));
    }
    return this.session.hintsShown > 0 ? CARD.solvedWithHints(this.session.hintsShown) : '';
  }

  private nextAvailable(): boolean {
    if (this.canSkip()) {
      // Where Skip would go, with the skip recorded.
      const skipped = recordSkip(this.progress, this.puzzle.id, this.today, this.session.hintsShown, this.isDaily);
      return nextPuzzle(skipped, this.puzzle.id, PLAYABLE) !== null;
    }
    return (
      !this.pending && this.nextId() !== null && (this.session.solved || isSolved(this.progress, this.puzzle.id))
    );
  }

  /**
   * Next's look (active or not) and label: "Skip" while the answer is
   * showing and the puzzle isn't done; on the last puzzle with every puzzle
   * done, "Finish", then "Today" or "Done".
   */
  private updateNextLook(): void {
    setPrevAvailable(this.bar, this.prevAvailable());
    const finish = this.finishAction();
    setNextAvailable(this.bar, finish !== null || this.nextAvailable());
    setNextLabel(
      this.bar,
      finish === 'finish'
        ? BAR.finish
        : finish === 'today'
          ? BAR.daily
          : finish === 'done'
            ? BAR.done
            : this.canSkip()
              ? BAR.skip
              : BAR.next,
    );
  }

  /** Next's role on the last puzzle once every puzzle is done (null: Next as usual). */
  private finishAction(): FinishAction | null {
    if (this.pending || !this.puzzle) {
      return null;
    }
    return finishAction(this.progress, this.puzzle.id, PLAYABLE, this.today, this.completionShowing);
  }

  /** Finish, Today or Done (Next on the last puzzle, every puzzle done). */
  private pressFinish(action: FinishAction): void {
    if (action === 'finish') {
      this.showCompletion();
    } else if (action === 'today') {
      const id = dailyPuzzleId(this.today);
      if (import.meta.env.DEV && this.debug) {
        this.debug.note(`Today pressed: today's daily ${id}`);
      }
      this.join?.resetToHome();
      this.loadPuzzle(id);
    } else {
      // A deliberate last step: no hold. Back to the welcome screen.
      if (import.meta.env.DEV && this.debug) {
        this.debug.note('Done pressed: ending the XR session');
      }
      void this.xrManager.getSession()?.end();
    }
  }

  /**
   * Every puzzle done: the card's completion state (gold), with its own
   * sound -- the win, its echo, a chime -- and the badge. Next becomes
   * "Today" (today's daily open) or "Done".
   */
  private showCompletion(): void {
    const lines = completionLines(this.progress, PLAYABLE, this.today);
    this.completionShowing = true;
    this.messageFlashUntil = 0;
    this.statusFlashUntil = 0;
    this.introShown = false;
    this.introLines = [];
    setCardWin(this.card, { headline: lines.headline, takeaway: lines.summary, query: lines.next, note: null });
    this.card.status.setProperties({ text: lines.streak ?? '' });
    this.updateBadge();
    this.card.document.updateWorldMatrix(true, false);
    this._point.setFromMatrixPosition(this.card.document.matrixWorld);
    sounds.playWin(this._point);
    sounds.playWin(this._point, COMPLETION_ECHO_SECONDS);
    sounds.playHint(this._point, COMPLETION_CHIME_SECONDS);
    this.bar.nextOpacity.value = 1;
    this.updateNextLook();
    if (import.meta.env.DEV && this.debug) {
      this.debug.note(`completion: ${lines.headline} ${lines.summary} ${lines.next}`);
    }
  }

  private setMessage(text: string): void {
    this.messageText = text;
    this.introLines = [];
    if (this.messageFlashUntil > 0) {
      // Replaces a brief message at once (and every line it covered).
      this.messageFlashUntil = 0;
      this.introShown = false;
      setCardIntro(this.card, text, []);
      return;
    }
    if (this.introShown) {
      // A hint (or any other message) replaces the daily's intro lines.
      this.introShown = false;
      setCardIntro(this.card, text, []);
      return;
    }
    this.card.message.setProperties({ text });
  }

  /**
   * The bar's filter part follows the join: with a filter set, its WHERE
   * clause and Clear; joined with NULLs shown, Filter (or, once pressed,
   * Back and one chip per column with a NULL, labeled as the result's
   * header); otherwise nothing. Resizes and re-places the bar only when its
   * contents change (state changes and settles, never per frame).
   */
  private updateBar(): void {
    const join = this.join;
    const state = join?.joinState;
    if (!join || !state || !this.puzzle) {
      return;
    }
    const joined = state.phase === 'joined' && !this.pending;
    const filter = state.phase === 'joined' && !this.pending ? (state.filter ?? null) : null;
    // The filter as the bar shows it: short, like its chip ("BR.ID is NULL";
    // the caption shows the SQL), so the widest bar stays within reach.
    let where: string | null = null;
    if (filter) {
      const header = resultHeader(this.puzzle, filter.tableId, filter.column);
      const [a, b] = puzzleTables(this.puzzle);
      where = header ? BAR.filterChip(header) : buildWhereSql(a, b, filter);
    }
    this.filterChoices = joined && !filter ? join.nullFilterChoices().slice(0, MAX_FILTER_CHIPS) : [];
    if (this.filterChoices.length === 0) {
      this.filterOpen = false;
    }
    const chips = this.filterOpen ? this.filterChoices.map((choice) => BAR.filterChip(choice.header)) : null;
    const picker = this.pickerOpen ? this.pickerTileViews() : null;
    const key =
      `${where ?? ''}|${this.filterChoices.length > 0}|${chips ? chips.join('|') : '-'}|` +
      (picker ? picker.map((t) => `${t.status[0]}${t.today ? 't' : ''}${t.current ? 'c' : ''}${t.selectable ? '' : 'x'}`).join('') : '-');
    if (key === this.barKey) {
      return;
    }
    this.barKey = key;
    // The bar resizes to its buttons; re-place it so it stays clear of the control.
    setBarContents(this.bar, { where, filter: this.filterChoices.length > 0, chips, picker });
    // Its outlines were reset: the hover is drawn again for the new buttons.
    this.shownHover = -1;
    this.fingerHover = -1;
    this.applyBarHover();
    this.layout.bar.extendLeftMeters = this.bar.extendLeftMeters;
    this.layout.bar.widthMeters = this.bar.widthMeters;
    this.layout.bar.heightMeters = this.bar.heightMeters;
    this.layout.bar.leadCenterYMeters = this.bar.leadCenterYMeters;
    join.requestLayout();
  }

  // --- The bar's buttons -----------------------------------------------------------------

  /** One press on a bar button from any path; `chip` says which filter chip (else -1). */
  private press(button: BarButton, path: PressPath, chip = -1): void {
    // Exit and Recenter act only when held (the join system times the hold); a press does nothing
    // (the debug key still recenters).
    if (button === 'exit' || (button === 'recenter' && path !== 'debug-key')) {
      return;
    }
    if (this.clock - this.lastPress < BAR_PRESS_DEBOUNCE_SECONDS) {
      return;
    }
    const state = this.join?.joinState;
    const joined = state?.phase === 'joined' && !this.pending;
    const hasFilter = state?.phase === 'joined' && !this.pending && !!state.filter;
    // Only what's shown can be pressed (a ray click can come from a hidden button's last frame).
    const pickerHides = button === 'prev' || button === 'next' || button === 'hint' || button === 'clear' || button === 'filter';
    if (
      (this.pickerOpen && (pickerHides || button === 'filterBack' || button === 'chip')) ||
      (!this.pickerOpen && (button === 'tile' || button === 'pickerBack')) ||
      (button === 'clear' && !hasFilter) ||
      (button === 'filter' && (!joined || hasFilter || this.filterChoices.length === 0)) ||
      (button === 'filterBack' && !this.filterOpen) ||
      (button === 'chip' && (!this.filterOpen || !this.filterChoices[chip]))
    ) {
      return;
    }
    this.lastPress = this.clock;
    if (import.meta.env.DEV && this.debug) {
      touchProbe.pressed(targetName(button, chip), path);
    }
    // The picker: Puzzles opens and closes it, Back closes it, a tile switches (and closes it).
    if (button === 'puzzles' || button === 'pickerBack' || button === 'tile') {
      this.pressPicker(button, path, chip);
      return;
    }
    // Next on the last puzzle with every puzzle done: Finish, then Today or Done.
    const finish = button === 'next' ? this.finishAction() : null;
    if (finish) {
      this.clickAndDip(button, chip);
      this.pressFinish(finish);
      return;
    }
    // An inactive Next does nothing, so it makes no click either. The card
    // says why, briefly: solve it first, or (the last puzzle, done) there's
    // no next one yet -- a press always shows it was felt.
    if (button === 'next' && !this.nextAvailable()) {
      const done = !!this.puzzle && (this.session.solved || isSolved(this.progress, this.puzzle.id));
      if (!this.pending) {
        this.card.status.setProperties({ text: done ? CARD.morePuzzlesSoon : CARD.solveFirst });
        this.statusFlashUntil = this.clock + STATUS_FLASH_SECONDS;
      }
      if (import.meta.env.DEV && this.debug) {
        this.debug.note(`Next pressed while inactive (${done ? 'no next puzzle' : 'not solved yet'}): no click`);
      }
      return;
    }
    // An inactive Prev (the first puzzle, or mid-switch) is silent too.
    if (button === 'prev' && !this.prevAvailable()) {
      if (import.meta.env.DEV && this.debug) {
        this.debug.note(`Prev pressed while inactive (${this.pending ? 'switching' : 'the first puzzle'}): no click`);
      }
      return;
    }
    // Hint: spaced presses; Show answer (before the answer) only acts when held, so a press does nothing.
    if (button === 'hint') {
      if (this.nextHintRevealsAnswer()) {
        return;
      }
      if (this.hintGate.press(this.clock) === 'ignored') {
        if (import.meta.env.DEV && this.debug) {
          this.debug.note(`Hint pressed again within ${HINT_PRESS_GAP_SECONDS} s (${path}): ignored, no click`);
        }
        return;
      }
    }
    this.clickAndDip(button, chip);
    if (button === 'prev') {
      this.prev();
    } else if (button === 'recenter') {
      this.recenter(path);
    } else if (button === 'hint') {
      this.showHint();
    } else if (button === 'next') {
      this.next();
    } else if (button === 'filter' || button === 'filterBack') {
      this.filterOpen = button === 'filter';
      if (import.meta.env.DEV && this.debug) {
        this.debug.note(
          this.filterOpen
            ? `Filter opened (${path}): ${this.filterChoices.map((choice) => BAR.filterChip(choice.header)).join(', ')}`
            : `Filter closed (${path})`,
        );
      }
      this.updateBar();
    } else if (button === 'chip') {
      // Exactly the filter a poke on one of that column's NULLs makes.
      const column = this.filterChoices[chip].column;
      this.filterOpen = false;
      this.join?.applyNullFilter(column, path);
      this.updateBar();
    } else {
      this.join?.requestClearFilter();
    }
  }

  // --- The puzzle picker ------------------------------------------------------------------

  /** Whether the in-XR puzzle picker is open (in place of Prev | Next, Hint and the filter area). */
  private pickerOpen = false;

  /** The picker's tiles: the welcome grid's status data (`puzzleTiles`), the puzzle on the desk, each dataset's accent. */
  private pickerTileViews(): PickerTileView[] {
    const current = this.pending ?? this.puzzle?.id ?? null;
    return puzzleTiles(this.progress, this.today, PLAYABLE).map((tile) => ({
      number: tile.number,
      status: tile.status,
      today: tile.today,
      selectable: tile.selectable,
      current: tile.id === current,
      accent: DATASETS[getPuzzle(tile.id).datasetId].theme.accent,
    }));
  }

  /** Opens or closes the picker (the bar re-lays out; the join system re-places it). */
  private setPickerOpen(open: boolean): void {
    if (this.pickerOpen === open) {
      return;
    }
    this.pickerOpen = open;
    if (open) {
      this.filterOpen = false;
    }
    this.updateBar();
  }

  /**
   * Puzzles (toggles the picker), Back (closes it), or a tile: an unlocked
   * one switches to its puzzle through the same path as Prev and Next
   * (separate, glide home, wait for a held slab, or switch datasets) and
   * closes the picker; the puzzle on the desk just closes it; a locked one
   * says so on the card, silently.
   */
  private pressPicker(button: 'puzzles' | 'pickerBack' | 'tile', path: PressPath, index: number): void {
    if (button === 'tile') {
      const data = this.bar.pickerTiles[index]?.data;
      const id = PLAYABLE[index];
      if (!data || !id) {
        return;
      }
      if (!data.selectable) {
        if (!this.pending) {
          this.card.status.setProperties({ text: CARD.tileLocked });
          this.statusFlashUntil = this.clock + STATUS_FLASH_SECONDS;
        }
        if (import.meta.env.DEV && this.debug) {
          this.debug.note(`picker: tile ${index + 1} pressed (${path}) while locked: no click`);
        }
        return;
      }
      if (this.pending) {
        if (import.meta.env.DEV && this.debug) {
          this.debug.note(`picker: tile ${index + 1} pressed (${path}) mid-switch: no click`);
        }
        return;
      }
    }
    this.clickAndDip(button, index);
    if (button !== 'tile') {
      if (import.meta.env.DEV && this.debug) {
        this.debug.note(`picker ${button === 'puzzles' && !this.pickerOpen ? 'opened' : 'closed'} (${button}, ${path})`);
      }
      this.setPickerOpen(button === 'puzzles' ? !this.pickerOpen : false);
      return;
    }
    const id = PLAYABLE[index];
    this.setPickerOpen(false);
    if (id === this.puzzle?.id) {
      if (import.meta.env.DEV && this.debug) {
        this.debug.note(`picker: tile ${index + 1} is the puzzle on the desk (${path}): closed`);
      }
      return;
    }
    if (import.meta.env.DEV && this.debug) {
      this.debug.note(
        `picker: puzzle ${PRACTICE_ORDER.indexOf(this.puzzle.id) + 1} -> puzzle ${index + 1} (${path})` +
          `${this.isDaily ? ' (from the daily)' : ''}`,
      );
    }
    this.join?.resetToHome();
    this.loadPuzzle(id);
  }

  /** The column's hover: a fingertip just in front of a button wins over the hand pointer; drawn only on a change. */
  private applyBarHover(): void {
    const hover = this.fingerHover >= 0 ? this.fingerHover : this.pointerHover;
    if (hover !== this.shownHover) {
      setBarHover(this.bar, hover, this.shownHover);
      this.shownHover = hover;
    }
  }

  /** A press felt: the click, and the pressed button dips (press-dip.ts). */
  private clickAndDip(button: BarButton, index: number): void {
    this.bar.document.updateWorldMatrix(true, false);
    this._point.setFromMatrixPosition(this.bar.document.matrixWorld);
    sounds.playClick(this._point);
    this.dips.dip(barButtonContainer(this.bar, button, index), this.clock);
  }

  // --- Target outlines, cached -------------------------------------------------------------

  /** `puzzle`'s target outline: kept, or started now (hidden, parked; built in the background unless `urgent`). */
  private silhouetteFor(puzzle: Puzzle, target: QueryOutput, urgent = false): Silhouette {
    const cached = this.silhouettes.get(puzzle.id);
    if (cached) {
      return cached;
    }
    const build = startSilhouetteBuild(puzzle, target);
    build.doc.fade.value = 0;
    build.doc.document.visible = false;
    build.doc.document.position.set(0, PARKED_Y, 0);
    const entity = this.world.createTransformEntity(build.doc.document);
    const job: BuildJob = { name: `target outline ${puzzle.id}`, step: (deadline) => build.step(deadline) };
    const entry: Silhouette = { doc: build.doc, entity, build, job };
    this.silhouettes.set(puzzle.id, entry);
    if (!build.done) {
      buildQueue.add(job, urgent);
    }
    return entry;
  }

  /** The outline on the desk leaves it (hidden; kept if it's a neighbor, see `prefetchNeighbors`). */
  private parkSilhouette(): void {
    const entry = this.silhouette;
    if (!entry) {
      return;
    }
    entry.doc.fade.value = 0;
    entry.doc.document.visible = false;
    this.silhouette = null;
  }

  /**
   * Builds ahead, in the background, what the previous and the next puzzle
   * need -- their target outlines, and their datasets' tables and result
   * slabs (desk placement and the join system keep those) -- and lets go of
   * everything else: the current puzzle and its neighbors stay cached.
   */
  private prefetchNeighbors(): void {
    if (!this.puzzle) {
      return;
    }
    const ids = [this.puzzle.id, this.prevId(), nextPuzzle(this.progress, this.puzzle.id, PLAYABLE)].filter(
      (id): id is PuzzleId => id !== null,
    );
    for (const [id, entry] of this.silhouettes) {
      if (!ids.includes(id) && entry !== this.silhouette) {
        buildQueue.remove(entry.job);
        entry.entity.dispose();
        this.silhouettes.delete(id);
      }
    }
    for (const id of ids) {
      const puzzle = getPuzzle(id);
      this.silhouetteFor(puzzle, puzzleTarget(puzzle));
    }
    const datasets = [...new Set(ids.map((id) => getPuzzle(id).datasetId))];
    keepDatasets(datasets);
    if (import.meta.env.DEV && this.debug) {
      this.debug.note(`cache: puzzles ${ids.join(', ')}; datasets ${datasets.join(', ')} (built ahead in the background)`);
    }
  }

  private lastPinchDistance = Infinity;

  /**
   * The bar button a pinch at `point` (or a hand's ray hit on the bar)
   * lands on, if any. Only shown buttons are targets (Clear only while a
   * filter is set; the WHERE label never is), and only while the bar is.
   */
  private barButtonAt(point: Vector3): BarButtonTarget | null {
    const bar = this.bar;
    if (!bar || bar.fade.peek() < 0.5) {
      return null;
    }
    bar.document.updateWorldMatrix(true, false);
    this._local.copy(point);
    bar.document.worldToLocal(this._local);
    unrollArc(this._local, BAND_ARC_RADIUS_METERS, this.bar.leanRad);
    this.lastPinchDistance = Infinity;
    // Up to 6 cm in front of the face (players pinch in front of a button), 3 cm behind it.
    if (this._local.z > BUTTON_PINCH_FRONT_DEPTH_METERS || this._local.z < -BUTTON_PINCH_BACK_DEPTH_METERS) {
      return null;
    }
    let best: BarButtonTarget | null = null;
    for (const button of bar.buttons) {
      const dx = Math.max(0, Math.abs(this._local.x - button.centerX) - button.width / 2);
      const dy = Math.max(0, Math.abs(this._local.y - button.centerY) - bar.buttonHeightMeters / 2);
      const distance = Math.hypot(dx, dy);
      if (distance < this.lastPinchDistance) {
        this.lastPinchDistance = distance;
        best = button;
      }
    }
    return this.lastPinchDistance <= BAR_PINCH_MARGIN_METERS ? best : null;
  }
}

/** Moves a fade signal `step` toward `target` (no write once it's there). */
function stepFade(fade: Signal<number>, target: number, step: number): void {
  const value = fade.peek();
  if (value !== target) {
    fade.value = target > value ? Math.min(target, value + step) : Math.max(target, value - step);
  }
}

/** The card's short diff line: how many rows are missing and how many aren't in the answer. */
function diffSummary(comparison: Comparison): string {
  if (comparison.visibleCount === 0) {
    return CARD.emptyResult;
  }
  const extra = comparison.rowStatus.filter((status) => status === 'extra').length;
  if (comparison.missing.length === 0 && extra === 0) {
    return '';
  }
  return CARD.diffStatus(comparison.missing.length, extra);
}

/**
 * The target outline, the same for every puzzle: the target's headers, one
 * empty row, and "Answer: N rows" where the result's SQL caption will be.
 * Its columns are sized from every target row (as the result's will be), but
 * only the first row shows, as an empty outline.
 */
/** One cached target outline: its document, entity, and background build. */
type Silhouette = { doc: TableSlabDocument; entity: Entity; build: SlabBuild; job: BuildJob };

/**
 * The target outline's build: its headers, one empty row and the row count.
 * Only that row is built; the columns still fit every target row (the
 * other rows only sized them, and building them cost up to 75 ms on the Quest).
 */
function startSilhouetteBuild(puzzle: Puzzle, target: QueryOutput): SlabBuild {
  const visible = visibleRowIndices(target);
  const columns = target.result.table.columns;
  const rows = visible.map((row) => target.result.table.rows[row]);
  if (rows.length === 0) {
    rows.push(Object.fromEntries(columns.map((column) => [column, null])));
  }
  const table: Table = {
    id: `silhouette-${puzzle.id}`,
    columns,
    columnLabels: target.result.table.columnLabels,
    rows,
  };
  const label = TARGET_OUTLINE.answerRows(visible.length);
  return startTableSlabBuild({ ...table, rows: rows.slice(0, 1) }, {
    maxRows: MAX_RESULT_ROWS,
    sizeRows: rows.slice(0, MAX_RESULT_ROWS),
    caption: { lines: [label], fitLines: [label] },
    anchorTop: true,
    text: slabTextSizeAt(PLANNED_RESULT_DISTANCE_METERS),
    silhouette: { revealRow: null },
    accent: DATASETS[puzzle.datasetId].theme.accent,
  });
}
