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

import { createSystem, PokeInteractable, RayInteractable, Vector3, type Entity, type Signal } from '@iwsdk/core';
import { CHALLENGE_MODE } from './challenge-mode.js';
import { challengeStart, PLAYABLE, publishProgress } from './challenge-start.js';
import {
  buildPuzzleBar,
  buildPuzzleCard,
  setBarChip,
  setCardIntro,
  setCardTheme,
  setCardWin,
  setHintLabel,
  setNextLabel,
  setNextAvailable,
  setNextWaiting,
  type BarButton,
  type PuzzleBarView,
  type PuzzleCardView,
} from './challenge-view.js';
import { compareToTarget, fanOutGroups, type Comparison } from './data/compare.js';
import { BAR, CARD, CONCEPT_INTROS, NULL_EXPLAINER, WELCOME } from './data/copy.js';
import { isoFromDay } from './data/daily.js';
import { aheadConcepts, isTodaysDaily, nextPuzzle } from './data/daily-flow.js';
import { DATASETS } from './data/datasets.js';
import { canEvaluate, canStartSwitch, deskTableIds, type DeskState } from './data/desk-session.js';
import type { JoinState } from './data/join-state.js';
import { buildWhereSql } from './data/join-sql.js';
import {
  currentStreak,
  dailyCompletedToday,
  dailySolvedToday,
  isSolved,
  markConceptSeen,
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
import { puzzleText, type PuzzleText } from './data/puzzle-text.js';
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
import { joinBridge, type ChallengeHooks, type ChallengeLayout, type JoinControls } from './join-bridge.js';
import { sounds } from './sound.js';
import { isTouchPointerClick, setRect, touchProbe, type PressPath } from './touch-probe.js';
import {
  BUTTON_PINCH_BACK_DEPTH_METERS,
  BUTTON_PINCH_FRONT_DEPTH_METERS,
  ContactPoke,
  MIN_INDEX_STRAIGHTNESS,
  POKE_TARGET_TOLERANCE_METERS,
} from './contact-poke.js';
import { indexStraightness, readJointsPoint } from './pinch.js';
import { buildTableSlabDocument, MAX_RESULT_ROWS, type TableSlabDocument } from './table-slab-view.js';
import { PLANNED_CONTROL_DISTANCE_METERS, PLANNED_RESULT_DISTANCE_METERS, slabTextSizeAt } from './view-comfort.js';

/** A pinch presses a bar button within this of it in plane (and BUTTON_PINCH_*_DEPTH_METERS off its face). */
const BAR_PINCH_MARGIN_METERS = 0.015;
const HANDS = ['left', 'right'] as const;
const INDEX_TIP: readonly XRHandJoint[] = ['index-finger-tip'];
/** A ray select and a pinch on the same press count once. */
const BAR_PRESS_DEBOUNCE_SECONDS = 0.3;
/** How long "Solve it first, or use Hint." shows after pressing an inactive Next. */
const STATUS_FLASH_SECONDS = 2.5;
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
  private barEntity!: Entity;
  private silhouette: { doc: TableSlabDocument; entity: Entity } | null = null;

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
  private clock = 0;
  /** The card's message text and puzzle, as last set. */
  private messageText = '';
  private cardPuzzleId: PuzzleId | null = null;
  /** Frames left before the card, bar and silhouette fade in after activation. */
  private revealFrames = 0;
  /** When a brief status line ("Solve it first") gives way again (clock seconds; 0 = none). */
  private statusFlashUntil = 0;
  private debug: ChallengeDebug | null = null;
  private readonly _point = new Vector3();
  private readonly _local = new Vector3();
  /** Contact pokes on the bar's buttons. */
  private readonly barPoke = new ContactPoke();
  private _pokeSource: XRInputSource | null = null;
  private pokedButton: BarButton | null = null;
  private readonly _straightA = new Vector3();
  private readonly _straightB = new Vector3();
  /** Contact-poke hit test on the bar's shown buttons (the poke asks only at a contact). */
  private readonly pokeOnBar = (): boolean => {
    const bar = this.bar;
    const dy = Math.max(0, Math.abs(this._local.y) - bar.buttonHeightMeters / 2);
    let best = Infinity;
    this.pokedButton = null;
    for (const button of bar.buttons) {
      const distance = Math.hypot(Math.max(0, Math.abs(this._local.x - button.centerX) - button.width / 2), dy);
      if (distance < best) {
        best = distance;
        this.pokedButton = button.name;
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
    this.bar = buildPuzzleBar(slabTextSizeAt(PLANNED_CONTROL_DISTANCE_METERS).headerFontCm, {
      hint: BAR.hintLabels,
      next: [BAR.next, BAR.skip],
      clear: BAR.clearFilter,
    });
    this.barEntity = this.world.createTransformEntity(this.bar.document);
    // Poke and ray select arrive as UIKit clicks; pinches come from the join
    // system (barDistance / pressBarAt), which also weighs the control.
    this.barEntity.addComponent(PokeInteractable, {});
    this.barEntity.addComponent(RayInteractable, {});
    // Rays (and controllers) only: a fingertip presses through the contact poke (updateBarPoke).
    const onHint = (event: unknown) => !isTouchPointerClick(event) && this.press('hint', 'uikit-click');
    const onNext = (event: unknown) => !isTouchPointerClick(event) && this.press('next', 'uikit-click');
    const onClear = (event: unknown) => !isTouchPointerClick(event) && this.press('clear', 'uikit-click');
    this.bar.hint.addEventListener('click', onHint);
    this.bar.next.addEventListener('click', onNext);
    this.bar.clear.addEventListener('click', onClear);

    joinBridge.challenge = this;
    this.layout = {
      card: { object: this.card.document, widthMeters: this.card.widthMeters, heightMeters: this.card.heightMeters },
      bar: {
        object: this.bar.document,
        widthMeters: this.bar.widthMeters,
        heightMeters: this.bar.heightMeters,
        buttons: this.bar.buttons,
        buttonHeightMeters: this.bar.buttonHeightMeters,
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
        ['hint', bar.hint],
        ['next', bar.next],
        ['clear', bar.clear],
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
        object: () => (bar.fade.peek() >= 0.5 ? bar.document : null),
        rects: (out) => {
          const count = Math.min(bar.buttons.length, out.length);
          for (let i = 0; i < count; i++) {
            const button = bar.buttons[i];
            setRect(out[i], button.name, button.centerX, 0, button.width, bar.buttonHeightMeters);
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
      this.bar.hint.removeEventListener('click', onHint);
      this.bar.next.removeEventListener('click', onNext);
      this.bar.clear.removeEventListener('click', onClear);
      this.silhouette?.entity.dispose();
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
    this.updateFade(delta);
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
      this.updateChip(state);
    }
    // Next pulses once the puzzle is won, until it's pressed.
    if (this.session.solved && this.nextAvailable()) {
      this.bar.nextOpacity.value = 0.75 + 0.25 * Math.sin(this.clock * 4);
    }
    // "Solve it first" (an inactive Next) gives way to the status it covered.
    if (this.statusFlashUntil > 0 && this.clock >= this.statusFlashUntil) {
      this.statusFlashUntil = 0;
      this.card.status.setProperties({
        text: this.session.solved ? this.solvedStatus() : this.lastComparison ? diffSummary(this.lastComparison.comparison) : '',
      });
    }
    this.updateBarPoke();
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
      return;
    }
    bar.document.updateWorldMatrix(true, false);
    for (const hand of HANDS) {
      const source = this.input.xr.getPrimaryInputSource(hand);
      if (!source?.hand || !readJointsPoint(this.world, this.player, source, INDEX_TIP, this._point)) {
        this.barPoke.reset(hand);
        continue;
      }
      this._pokeSource = source;
      this._local.copy(this._point);
      bar.document.worldToLocal(this._local);
      const verdict = this.barPoke.update(hand, this._local, this.pokeOnBar, this.pokeStraightness);
      if (verdict === 'press' && this.pokedButton) {
        this.press(this.pokedButton, 'poke');
      } else if (verdict !== 'none' && verdict !== 'press' && import.meta.env.DEV && this.debug) {
        const { toward, sideways, straightness } = this.barPoke.last;
        const cm = (m: number) => `${(m * 100).toFixed(1)} cm`;
        this.debug.note(
          verdict === 'rejected-direction'
            ? `${hand} fingertip contact on ${this.pokedButton} rejected: it came in along the face (${cm(toward)} ` +
                `toward it, ${cm(sideways)} sideways; needs at least as much toward the face as sideways)`
            : `${hand} fingertip contact on ${this.pokedButton} rejected: index finger not extended (straightness ` +
                `${straightness === null ? 'n/a' : straightness.toFixed(2)}, needs ${MIN_INDEX_STRAIGHTNESS})`,
        );
      }
    }
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
      join.pulseNullRows();
    }

    if (comparison.solved && !this.session.solved) {
      this.win();
    }
    this.updateBadge();
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
    if (this.session.solved) {
      const revealed = answerRevealed(this.session);
      join.setResultBadge(revealed ? CARD.completedHeadline : CARD.headline, revealed ? 'neutral' : 'won');
      return;
    }
    join.setResultBadge(this.lastComparison ? diffSummary(this.lastComparison.comparison) || null : null, 'neutral');
  }

  onPhase(phase: JoinState['phase']): void {
    if ((phase === 'separating' || phase === 'idle') && this.session && !this.pending) {
      this.card.status.setProperties({ text: this.session.solved ? this.solvedStatus() : '' });
      this.lastComparison = null;
    }
  }

  barDistance(point: Vector3): number {
    return this.barButtonAt(point) ? this.lastPinchDistance : Infinity;
  }

  pressBarAt(point: Vector3, hand: string): void {
    const button = this.barButtonAt(point);
    if (import.meta.env.DEV && this.debug) {
      this.debug.notePinch(hand, button, this.lastPinchDistance);
    }
    if (button) {
      this.press(button, 'pinch');
    }
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
    this.silhouette?.entity.dispose();
    this.silhouette = null;
    this.join?.setSilhouette(null);
    this.lastComparison = null;
    setNextAvailable(this.bar, false);
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
    this.updateHintLabel();
    this.lastComparison = null;
    this.lastState = null;

    // The silhouette: the target's headers and row outlines, in the result slot.
    this.silhouette?.entity.dispose();
    const doc = buildSilhouette(this.puzzle, this.target);
    // It appears with the card: hidden until placed (after a switch the card
    // is faded out too), then they fade in together.
    doc.fade.value = Math.min(doc.fade.peek(), this.card.fade.peek());
    this.revealFrames = REVEAL_DELAY_FRAMES;
    const entity = this.world.createTransformEntity(doc.document);
    this.silhouette = { doc, entity };
    join.setSilhouette({ object: doc.document, widthMeters: doc.widthMeters, heightMeters: doc.heightMeters });

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
    if (ahead.length > 0) {
      setCardIntro(this.card, CARD.dailyAhead, ahead.map((c) => CONCEPT_INTROS[c]));
      this.messageText = CARD.dailyAhead;
      this.introShown = true;
    } else if (freshConcept && concept !== 'antijoin') {
      this.setMessage(CONCEPT_INTROS[concept]);
      this.progress = markConceptSeen(this.progress, concept);
    } else {
      this.setMessage('');
    }

    // A daily (possibly locked) is never the resume point; practice is.
    if (!this.isDaily) {
      this.progress = { ...this.progress, lastPuzzle: id };
    }
    this.save();
    this.updateNextLook();
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
    const daily = isTodaysDaily(this.progress, puzzle.id, this.today, PRACTICE_ORDER);
    this.card.title.setProperties({
      text: daily
        ? CARD.dailyTitle(puzzle.datasetId)
        : CARD.practiceTitle(PRACTICE_ORDER.indexOf(puzzle.id) + 1, puzzle.datasetId),
    });
    this.card.goal.setProperties({ text: puzzleText(puzzle).goal });
    this.card.status.setProperties({ text: '' });
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
    this.introShown = false;
    const lastNote = this.nextId() === null ? CARD.morePuzzlesSoon : null;
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
        setCardIntro(this.card, this.text.hints[index], [CARD.answerNext]);
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

  /**
   * The hint button says what it shows next: "Hint" before the first,
   * "Another hint" after it, "Show answer" before the third (and after it,
   * where a press shows the answer again).
   */
  private updateHintLabel(): void {
    const labels = BAR.hintLabels;
    setHintLabel(this.bar, labels[Math.min(this.session.hintsShown, labels.length - 1)]);
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

  /** Where Next goes: today's daily if it's open, back to practice after it, else the next practice puzzle. */
  private nextId(): PuzzleId | null {
    return nextPuzzle(this.progress, this.puzzle.id, this.today, PLAYABLE);
  }

  /**
   * The status line once finished: after "Show answer", that all three hints
   * were used; for a solved daily, the streak; else how many hints it took.
   */
  private solvedStatus(): string {
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
      return nextPuzzle(skipped, this.puzzle.id, this.today, PLAYABLE) !== null;
    }
    return (
      !this.pending && this.nextId() !== null && (this.session.solved || isSolved(this.progress, this.puzzle.id))
    );
  }

  /** Next's look (active or not) and label ("Skip" while the answer is showing and the puzzle isn't done). */
  private updateNextLook(): void {
    setNextAvailable(this.bar, this.nextAvailable());
    setNextLabel(this.bar, this.canSkip() ? BAR.skip : BAR.next);
  }

  private setMessage(text: string): void {
    this.messageText = text;
    if (this.introShown) {
      // A hint (or any other message) replaces the daily's intro lines.
      this.introShown = false;
      setCardIntro(this.card, text, []);
      return;
    }
    this.card.message.setProperties({ text });
  }

  /** The chip shows the current filter's WHERE clause and its Clear button, or nothing. */
  private updateChip(state: JoinState): void {
    const filter = state.phase === 'joined' ? (state.filter ?? null) : null;
    const [a, b] = puzzleTables(this.puzzle);
    const text = filter ? buildWhereSql(a, b, filter) : null;
    const hadChip = this.bar.buttons.length > 2;
    if (!text && !hadChip) {
      return;
    }
    // The bar resizes to its buttons; re-place it so it stays clear of the control.
    setBarChip(this.bar, text);
    this.layout.bar.widthMeters = this.bar.widthMeters;
    this.join?.requestLayout();
  }

  // --- The bar's buttons -----------------------------------------------------------------

  private press(button: BarButton, path: PressPath): void {
    if (this.clock - this.lastPress < BAR_PRESS_DEBOUNCE_SECONDS) {
      return;
    }
    const state = this.join?.joinState;
    const hasFilter = state?.phase === 'joined' && !!state.filter;
    if (button === 'clear' && !hasFilter) {
      return;
    }
    this.lastPress = this.clock;
    if (import.meta.env.DEV && this.debug) {
      touchProbe.pressed(button, path);
    }
    // An inactive Next does nothing, so it makes no click either. Before the
    // puzzle is done, the card says why, briefly.
    if (button === 'next' && !this.nextAvailable()) {
      const done = !!this.puzzle && (this.session.solved || isSolved(this.progress, this.puzzle.id));
      if (!done && !this.pending) {
        this.card.status.setProperties({ text: CARD.solveFirst });
        this.statusFlashUntil = this.clock + STATUS_FLASH_SECONDS;
      }
      if (import.meta.env.DEV && this.debug) {
        this.debug.note(`Next pressed while inactive (${done ? 'no next puzzle' : 'not solved yet'}): no click`);
      }
      return;
    }
    this.bar.document.updateWorldMatrix(true, false);
    this._point.setFromMatrixPosition(this.bar.document.matrixWorld);
    sounds.playClick(this._point);
    if (button === 'hint') {
      this.showHint();
    } else if (button === 'next') {
      this.next();
    } else {
      this.join?.requestClearFilter();
    }
  }

  private lastPinchDistance = Infinity;

  /**
   * The bar button a pinch at `point` lands on, if any. Only shown buttons
   * are targets (Clear only while a filter is set; the chip's WHERE label
   * never is).
   */
  private barButtonAt(point: Vector3): BarButton | null {
    const bar = this.bar;
    if (!bar) {
      return null;
    }
    bar.document.updateWorldMatrix(true, false);
    this._local.copy(point);
    bar.document.worldToLocal(this._local);
    this.lastPinchDistance = Infinity;
    // Up to 6 cm in front of the face (players pinch in front of a button), 3 cm behind it.
    if (this._local.z > BUTTON_PINCH_FRONT_DEPTH_METERS || this._local.z < -BUTTON_PINCH_BACK_DEPTH_METERS) {
      return null;
    }
    let best: BarButton | null = null;
    const dy = Math.max(0, Math.abs(this._local.y) - bar.buttonHeightMeters / 2);
    for (const button of bar.buttons) {
      const dx = Math.max(0, Math.abs(this._local.x - button.centerX) - button.width / 2);
      const distance = Math.hypot(dx, dy);
      if (distance < this.lastPinchDistance) {
        this.lastPinchDistance = distance;
        best = button.name;
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
  const parts: string[] = [];
  if (comparison.missing.length > 0) {
    parts.push(CARD.missingRows(comparison.missing.length));
  }
  if (extra > 0) {
    parts.push(CARD.extraRows(extra));
  }
  return parts.join(', ');
}

/** The target silhouette: the target's headers and an outline per row; `revealRow` keeps its text. */
function buildSilhouette(puzzle: Puzzle, target: QueryOutput): TableSlabDocument {
  const visible = visibleRowIndices(target);
  const table: Table = {
    id: `silhouette-${puzzle.id}`,
    columns: target.result.table.columns,
    columnLabels: target.result.table.columnLabels,
    rows: visible.map((row) => target.result.table.rows[row]),
  };
  const reveal = puzzle.revealRow === undefined ? -1 : visible.indexOf(puzzle.revealRow);
  return buildTableSlabDocument(table, {
    maxRows: MAX_RESULT_ROWS,
    anchorTop: true,
    text: slabTextSizeAt(PLANNED_RESULT_DISTANCE_METERS),
    silhouette: { revealRow: reveal >= 0 ? reveal : null },
    accent: DATASETS[puzzle.datasetId].theme.accent,
  });
}
