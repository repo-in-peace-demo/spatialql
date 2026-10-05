/**
 * Which dataset is on the desk, and the switch between datasets, as a pure
 * state machine; plus the guards that keep a puzzle from being played or
 * judged on the wrong tables. The scene animates each phase; this decides
 * what's allowed.
 *
 *   ready(A) --request(B)--> leaving(A, B) --leftDone--> building(B)
 *            --built--> arriving(B) --arrived--> ready(B)
 *
 * A request for the dataset already on the desk, or any request mid-switch,
 * changes nothing (the caller waits for `ready`). Events that don't apply
 * return the same state object.
 */

import { DATASETS, type DatasetId } from './datasets.js';
import type { JoinState } from './join-state.js';
import { isUnlocked, nextPracticePuzzle, type Progress } from './progress.js';
import { getPuzzle, puzzleMatchesTables, type Puzzle, type PuzzleId } from './puzzles.js';

export type DeskState =
  | { phase: 'ready'; dataset: DatasetId }
  | { phase: 'leaving'; from: DatasetId; to: DatasetId }
  | { phase: 'building'; to: DatasetId }
  | { phase: 'arriving'; to: DatasetId };

export type DeskEvent =
  | { type: 'request'; dataset: DatasetId }
  | { type: 'leftDone' }
  | { type: 'built' }
  | { type: 'arrived' };

export function deskTransition(state: DeskState, event: DeskEvent): DeskState {
  switch (state.phase) {
    case 'ready':
      return event.type === 'request' && event.dataset !== state.dataset
        ? { phase: 'leaving', from: state.dataset, to: event.dataset }
        : state;
    case 'leaving':
      return event.type === 'leftDone' ? { phase: 'building', to: state.to } : state;
    case 'building':
      return event.type === 'built' ? { phase: 'arriving', to: state.to } : state;
    case 'arriving':
      return event.type === 'arrived' ? { phase: 'ready', dataset: state.to } : state;
  }
}

/** The tables a puzzle may play on right now: the desk's, only once it's ready. */
export function deskTableIds(desk: DeskState): string[] {
  return desk.phase === 'ready' ? DATASETS[desk.dataset].tables.map((table) => table.id) : [];
}

/**
 * Whether a switch may start: never mid-join (separate first), never while
 * a slab is held (the never-yank rule: wait for the release), and not while
 * slabs are still gliding home.
 */
export function canStartSwitch(join: JoinState, anySlabHeld: boolean, gliding: boolean): boolean {
  return join.phase === 'idle' && !anySlabHeld && !gliding;
}

/**
 * Whether the current join may be judged against `puzzle`: the desk is
 * ready on the puzzle's dataset, and the joined tables are the puzzle's.
 * Anything else (mid-switch, or a join left over from another dataset) is
 * never evaluated: no diff, no win.
 */
export function canEvaluate(desk: DeskState, puzzle: Puzzle, join: JoinState): boolean {
  return (
    desk.phase === 'ready' &&
    desk.dataset === puzzle.datasetId &&
    join.phase === 'joined' &&
    puzzleMatchesTables(puzzle, [join.left, join.right])
  );
}

/**
 * The puzzle to resume: the last one played if it's playable and unlocked,
 * else the next unsolved one, else the last playable.
 */
export function resumePuzzle(progress: Progress, playable: readonly PuzzleId[]): PuzzleId {
  const last = progress.lastPuzzle;
  if (last && playable.includes(last) && isUnlocked(progress, last, playable)) {
    return last;
  }
  return nextPracticePuzzle(progress, playable) ?? playable[playable.length - 1];
}

/** After a reload, the desk first loads the resume puzzle's dataset (not always the shop). */
export function startupDataset(progress: Progress, playable: readonly PuzzleId[]): DatasetId {
  return getPuzzle(resumePuzzle(progress, playable)).datasetId;
}
