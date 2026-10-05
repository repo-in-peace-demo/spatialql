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

import { createSystem, PokeInteractable, RayInteractable, Vector3, type Entity } from '@iwsdk/core';
import { CHALLENGE_MODE } from './challenge-mode.js';
import { challengeStart, PLAYABLE } from './challenge-start.js';
import {
  buildPuzzleBar,
  buildPuzzleCard,
  setBarChip,
  setCardTheme,
  setCardWin,
  setNextAvailable,
  setNextWaiting,
  type BarButton,
  type PuzzleBarView,
  type PuzzleCardView,
} from './challenge-view.js';
import { compareToTarget, fanOutGroups, type Comparison } from './data/compare.js';
import { BAR, CARD, CONCEPT_INTROS, NULL_EXPLAINER } from './data/copy.js';
import { localDay } from './data/daily.js';
import { DATASETS } from './data/datasets.js';
import { canEvaluate, canStartSwitch, deskTableIds, type DeskState } from './data/desk-session.js';
import type { JoinState } from './data/join-state.js';
import { buildWhereSql } from './data/join-sql.js';
import { isSolved, markConceptSeen, markSolved, saveProgress, type KeyValueStorage, type Progress } from './data/progress.js';
import { PUZZLE_CHECKS } from './data/puzzle-checks.js';
import { latestHintIndex, sessionTransition, startSession, type PuzzleSession } from './data/puzzle-session.js';
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
import { buildTableSlabDocument, MAX_RESULT_ROWS, type TableSlabDocument } from './table-slab-view.js';
import { PLANNED_CONTROL_DISTANCE_METERS, PLANNED_RESULT_DISTANCE_METERS, slabTextSizeAt } from './view-comfort.js';

/** A pinch presses a bar button within this of it in plane, and this far off its surface. */
const BAR_PINCH_MARGIN_METERS = 0.015;
const BAR_PINCH_DEPTH_METERS = 0.03;
/** A ray select and a pinch on the same press count once. */
const BAR_PRESS_DEBOUNCE_SECONDS = 0.3;
/** The card fades back in this fast when it changes puzzle (per second). */
const CARD_FADE_IN_PER_SECOND = 3;

export class ChallengeSystem extends createSystem({}) implements ChallengeHooks, ChallengeDebugHost {
  private join: JoinControls | null = null;
  private storage: KeyValueStorage | null = null;
  private progress!: Progress;

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
  private debug: ChallengeDebug | null = null;
  private readonly _point = new Vector3();
  private readonly _local = new Vector3();

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

    // The card and bar, each on its own non-grabbable entity.
    this.card = buildPuzzleCard();
    this.cardEntity = this.world.createTransformEntity(this.card.document);
    this.bar = buildPuzzleBar(slabTextSizeAt(PLANNED_CONTROL_DISTANCE_METERS).headerFontCm, {
      hint: BAR.hint,
      next: BAR.next,
      clear: BAR.clearFilter,
    });
    this.barEntity = this.world.createTransformEntity(this.bar.document);
    // Poke and ray select arrive as UIKit clicks; pinches come from the join
    // system (barDistance / pressBarAt), which also weighs the control.
    this.barEntity.addComponent(PokeInteractable, {});
    this.barEntity.addComponent(RayInteractable, {});
    const onHint = () => this.press('hint');
    const onNext = () => this.press('next');
    const onClear = () => this.press('clear');
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
      const solved = Object.keys(this.progress.solved).length;
      this.debug.note(
        `progress: ${solved} solved; starting at ${start.puzzleId} on ${start.datasetId}` +
          (start.sanitized ? ' (sanitized: dropped entries this build cannot have made)' : ''),
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
    if (this.card.fade.peek() < 1) {
      this.card.fade.value = Math.min(1, this.card.fade.peek() + delta * CARD_FADE_IN_PER_SECOND);
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
      this.updateChip(state);
    }
    // Next pulses once the puzzle is won, until it's pressed.
    if (this.session.solved && this.nextAvailable()) {
      this.bar.nextOpacity.value = 0.75 + 0.25 * Math.sin(this.clock * 4);
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
    join.setWinLook(comparison.solved);
    this.card.status.setProperties({ text: this.session.solved ? this.solvedStatus() : diffSummary(comparison) });

    // The antijoin intro: the first time a LEFT result shows NULLs.
    if (this.nullCoachPending && state.joinType === 'left' && join.hasVisibleNull()) {
      this.nullCoachPending = false;
      this.progress = markConceptSeen(this.progress, this.puzzle.concept);
      saveProgress(this.storage, this.progress);
      if (!this.session.solved && this.session.hintsShown === 0) {
        this.setMessage(`${CONCEPT_INTROS[this.puzzle.concept]} ${NULL_EXPLAINER}`);
      }
      join.pulseNullRows();
    }

    if (comparison.solved && !this.session.solved) {
      this.win();
    }
    if (import.meta.env.DEV && this.debug) {
      this.debug.logComparison(this.puzzle, output, comparison);
    }
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
      this.press(button);
    }
  }

  // --- ChallengeDebugHost --------------------------------------------------------------

  debugHint(): void {
    this.showHint();
  }

  debugNext(): void {
    this.lastPress = -Infinity;
    this.press('next');
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
    this.lastComparison = null;
    this.lastState = null;

    // The silhouette: the target's headers and row outlines, in the result slot.
    this.silhouette?.entity.dispose();
    const doc = buildSilhouette(this.puzzle, this.target);
    const entity = this.world.createTransformEntity(doc.document);
    this.silhouette = { doc, entity };
    join.setSilhouette({ object: doc.document, widthMeters: doc.widthMeters, heightMeters: doc.heightMeters });

    // The card.
    this.showCardFor(this.puzzle);
    const concept = this.puzzle.concept;
    const freshConcept = introducesConcept(this.puzzle) && !this.progress.seenConcepts.includes(concept);
    // The antijoin intro waits until NULLs are on screen (see onSettled).
    this.nullCoachPending = freshConcept && concept === 'antijoin';
    if (freshConcept && concept !== 'antijoin') {
      this.setMessage(CONCEPT_INTROS[concept]);
      this.progress = markConceptSeen(this.progress, concept);
    } else {
      this.setMessage('');
    }

    this.progress = { ...this.progress, lastPuzzle: id };
    saveProgress(this.storage, this.progress);
    this.updateNextLook();
    if (import.meta.env.DEV && this.debug) {
      this.debug.note(
        `puzzle ${PRACTICE_ORDER.indexOf(id) + 1} (${id}) loaded on ${this.puzzle.datasetId}; ` +
          `target ${visibleRowIndices(this.target).length} rows`,
      );
    }
  }

  /** The card for `puzzle`: its dataset's look, title and goal, not won; it fades in when the puzzle changes. */
  private showCardFor(puzzle: Puzzle): void {
    const fresh = this.cardPuzzleId !== puzzle.id;
    this.cardPuzzleId = puzzle.id;
    setCardTheme(this.card, DATASETS[puzzle.datasetId].theme);
    setCardWin(this.card, null);
    this.card.title.setProperties({ text: CARD.practiceTitle(PRACTICE_ORDER.indexOf(puzzle.id) + 1, puzzle.datasetId) });
    this.card.goal.setProperties({ text: puzzleText(puzzle).goal });
    this.card.status.setProperties({ text: '' });
    if (fresh) {
      this.card.fade.value = 0;
    }
  }

  private win(): void {
    this.session = sessionTransition(this.session, { type: 'evaluate', solved: true });
    // Solved! / why it worked / the query it wrote (honest after the full answer).
    setCardWin(this.card, {
      headline: CARD.headline,
      takeaway: this.text.takeaway,
      query: this.session.solvedWithAnswer ? CARD.winWithAnswer : CARD.win,
      note: this.isLastPlayable() ? CARD.morePuzzlesSoon : null,
    });
    // The title row's right-hand slot (the diff summary while playing).
    this.card.status.setProperties({ text: this.solvedStatus() });
    this.card.document.updateWorldMatrix(true, false);
    this._point.setFromMatrixPosition(this.card.document.matrixWorld);
    sounds.playWin(this._point);
    // A fan-out win explains its surprise: the rows that repeat pulse while
    // the takeaway says why.
    const cause = this.puzzle.fanOutHighlight;
    if (cause && this.lastComparison) {
      const rows = fanOutGroups(this.lastComparison.output)
        .filter((group) => group.cause === cause)
        .flatMap((group) => group.resultRows);
      this.join?.pulseRows(rows);
    }

    this.progress = markSolved(this.progress, this.puzzle.id, localDay(new Date()), this.session.hintsShown);
    saveProgress(this.storage, this.progress);
    this.updateNextLook();
  }

  private showHint(): void {
    if (this.pending) {
      return;
    }
    const before = this.session;
    this.session = sessionTransition(this.session, { type: 'showHint' });
    const index = latestHintIndex(this.session);
    if (index === null) {
      return;
    }
    if (!this.session.solved) {
      this.setMessage(this.text.hints[index]);
    }
    this.bar.document.updateWorldMatrix(true, false);
    this._point.setFromMatrixPosition(this.bar.document.matrixWorld);
    if (this.session !== before) {
      sounds.playHint(this._point);
    }
  }

  private next(): void {
    if (!this.nextAvailable()) {
      return;
    }
    const nextId = PLAYABLE[PLAYABLE.indexOf(this.puzzle.id) + 1];
    this.join?.resetToHome();
    this.loadPuzzle(nextId);
  }

  /** The status line once solved: how many hints it took, if any. */
  private solvedStatus(): string {
    return this.session.hintsShown > 0 ? CARD.solvedWithHints(this.session.hintsShown) : '';
  }

  private nextAvailable(): boolean {
    const nextId = PLAYABLE[PLAYABLE.indexOf(this.puzzle.id) + 1];
    return !this.pending && nextId !== undefined && (this.session.solved || isSolved(this.progress, this.puzzle.id));
  }

  private isLastPlayable(): boolean {
    return PLAYABLE.indexOf(this.puzzle.id) === PLAYABLE.length - 1;
  }

  private updateNextLook(): void {
    setNextAvailable(this.bar, this.nextAvailable());
  }

  private setMessage(text: string): void {
    this.messageText = text;
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

  private press(button: BarButton): void {
    if (this.clock - this.lastPress < BAR_PRESS_DEBOUNCE_SECONDS) {
      return;
    }
    const state = this.join?.joinState;
    const hasFilter = state?.phase === 'joined' && !!state.filter;
    if (button === 'clear' && !hasFilter) {
      return;
    }
    this.lastPress = this.clock;
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
    if (Math.abs(this._local.z) > BAR_PINCH_DEPTH_METERS) {
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
