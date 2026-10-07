/**
 * Dev-only challenge-mode aids (with `?debug=1`): keys that drive the
 * puzzle without hands, and a log line per evaluation. Only constructed
 * behind `import.meta.env.DEV`, so production builds drop this module.
 *
 * Keys (clear of the emulator's WASD/QE and the join debug keys J/T/U/R):
 *   H  show the next hint
 *   F  poke the first shown NULL cell (filter on its column; never clears)
 *   N  next puzzle
 *   P  previous puzzle
 *   I  print the last diff, row by row
 *   G  apply the active puzzle's solution (through the real transitions)
 *   X  apply its authored wrong state (data/puzzle-checks.ts)
 *   C  recenter (as the Recenter button)
 */

import type { Comparison } from './data/compare.js';
import type { PuzzleCheck } from './data/puzzle-checks.js';
import { rowLabel, type Puzzle } from './data/puzzles.js';
import { visibleRowIndices, type QueryOutput } from './data/query.js';

export interface ChallengeDebugHost {
  debugHint(): void;
  debugNext(): void;
  debugPrev(): void;
  debugApply(which: 'solution' | 'wrong'): void;
  debugPoke(): boolean;
  debugRecenter(): void;
  debugSnapshot(): { puzzle: Puzzle; output: QueryOutput; comparison: Comparison } | null;
}

const LOG_PREFIX = '[Challenge debug]';

const KEY_HELP = [
  'H  hint (next tier)',
  'F  poke the first shown NULL cell',
  'N  next puzzle',
  'P  previous puzzle (dev only; ignores the unlock order)',
  'I  print the diff',
  'G  apply the puzzle\'s solution (the goal)',
  'X  apply its authored wrong state (the trap, for puzzles 10, 18, 20)',
  'C  recenter: the group glides back in front of you (as the Recenter button)',
];

export class ChallengeDebug {
  private readonly host: ChallengeDebugHost;

  constructor(host: ChallengeDebugHost) {
    this.host = host;
    window.addEventListener('keydown', this.onKeyDown);
    console.info(`${LOG_PREFIX} keyboard shortcuts:\n  ${KEY_HELP.join('\n  ')}`);
  }

  note(message: string): void {
    console.log(`${LOG_PREFIX} ${message}`);
  }

  error(message: string): void {
    console.error(`${LOG_PREFIX} ${message}`);
  }

  logComparison(puzzle: Puzzle, output: QueryOutput, comparison: Comparison): void {
    const { spec } = output;
    const extra = comparison.rowStatus.filter((status) => status === 'extra').length;
    const filter = spec.filter ? ` WHERE ${spec.filter.tableId}.${spec.filter.column} IS NULL` : '';
    this.note(
      `${puzzle.id}: ${spec.left} <- ${spec.right} ${spec.joinType.toUpperCase()}${filter}: ` +
        `${comparison.visibleCount} rows shown, ${extra} extra, ${comparison.missing.length} missing -> ` +
        (comparison.solved ? 'SOLVED' : 'not yet'),
    );
  }

  /** G / X: what's being applied, and what the diff should then show. */
  noteApply(puzzleId: string, which: 'solution' | 'wrong', check: PuzzleCheck, switching: boolean): void {
    if (switching) {
      this.note(`${which} not applied: the tables are switching`);
      return;
    }
    const { shown, extra, missing } = check.expect;
    this.note(
      which === 'solution'
        ? `applying the solution for ${puzzleId} (expect SOLVED)`
        : `applying the wrong state for ${puzzleId}${check.trap ? ' (the trap)' : ''} ` +
            `(expect ${shown} shown, ${extra} extra, ${missing} missing)`,
    );
  }

  /** One pinch evaluated against the bar. */
  notePinch(hand: string, button: string | null, distance: number): void {
    const where = Number.isFinite(distance) ? `${(distance * 100).toFixed(1)} cm in plane from the nearest button` : 'off the bar surface';
    this.note(`${hand} pinch evaluated against the puzzle bar: ${where} -> ${button ? `pressed ${button}` : 'no press'}`);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
  }

  private printDiff(): void {
    const snapshot = this.host.debugSnapshot();
    if (!snapshot) {
      this.note('no diff yet (join first)');
      return;
    }
    const { puzzle, output, comparison } = snapshot;
    const lines = visibleRowIndices(output).map(
      (row) => `  ${comparison.rowStatus[row] === 'extra' ? '+ extra ' : '  match '} ${rowLabel(puzzle, output, row)}`,
    );
    this.note(
      `diff for ${puzzle.id} (${comparison.solved ? 'solved' : 'not solved'}):\n${lines.join('\n')}\n` +
        `  missing: ${comparison.missing.length}`,
    );
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || target?.isContentEditable) {
      return;
    }
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      return;
    }
    switch (event.key.toLowerCase()) {
      case 'h':
        this.host.debugHint();
        break;
      case 'f':
        if (!this.host.debugPoke()) {
          this.note('F ignored: no NULL cell shown (join with LEFT first)');
        }
        break;
      case 'n':
        this.host.debugNext();
        break;
      case 'p':
        this.host.debugPrev();
        break;
      // G, not A as planned: A is one of the emulator's WASD movement keys.
      case 'g':
        this.host.debugApply('solution');
        break;
      case 'x':
        this.host.debugApply('wrong');
        break;
      case 'i':
        this.printDiff();
        break;
      case 'c':
        this.host.debugRecenter();
        break;
    }
  };
}
