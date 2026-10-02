/**
 * Dev-only join testing aids, enabled with `?debug=1`: keyboard shortcuts
 * that drive the join flow without grabbing, and a log line per state
 * transition. Only constructed behind `import.meta.env.DEV`, so production
 * builds drop this module.
 */

import type { JoinEvent, JoinState } from './data/join-state.js';
import type { JoinType } from './data/types.js';

export type JoinStats = {
  left: string;
  right: string;
  joinType: JoinType;
  matchedPairings: number;
  unmatchedLeft: number;
  unmatchedRight: number;
  resultRows: number;
};

export interface JoinDebugHost {
  debugJoin(reverse: boolean): void;
  toggleJoinType(): void;
  debugSeparate(): void;
  debugReplay(): void;
}

const LOG_PREFIX = '[Join debug]';

// Letters chosen to stay clear of the emulator's movement keys (WASD/QE).
const KEY_HELP = [
  'J        join: bring orders to customers  (customers is LEFT)',
  'Shift+J  join: bring customers to orders  (orders is LEFT)',
  'T        toggle INNER / LEFT',
  'U        un-join: slide the RIGHT slab away and separate',
  'R        replay the join animation and sounds (while joined)',
];

function describe(state: JoinState): string {
  switch (state.phase) {
    case 'idle':
      return 'idle';
    case 'previewing':
      return `previewing (${state.moving} -> ${state.stationary})`;
    case 'joined':
    case 'separating':
      return `${state.phase} (${state.left} ${state.joinType.toUpperCase()} JOIN ${state.right})`;
  }
}

export class JoinDebug {
  private readonly host: JoinDebugHost;
  private longTasks: PerformanceObserver | null = null;
  private joinStartMs = -1;

  constructor(host: JoinDebugHost) {
    this.host = host;
    window.addEventListener('keydown', this.onKeyDown);
    console.info(`${LOG_PREFIX} keyboard shortcuts:\n  ${KEY_HELP.join('\n  ')}`);
    // Main-thread stalls over 50 ms, timed against the last join start.
    try {
      this.longTasks = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const since = this.joinStartMs < 0 ? '' : ` at +${((entry.startTime - this.joinStartMs) / 1000).toFixed(3)} s from join start`;
          console.warn(`${LOG_PREFIX} long task: ${entry.duration.toFixed(0)} ms${since}`);
        }
      });
      this.longTasks.observe({ type: 'longtask', buffered: false });
    } catch {
      this.longTasks = null;
    }
  }

  /** Marks the start of a join (or replay) for the long-task readout. */
  markJoinStart(): void {
    this.joinStartMs = performance.now();
  }

  logTransition(event: JoinEvent, prev: JoinState, next: JoinState, stats: JoinStats | null): void {
    const summary = `${LOG_PREFIX} ${event.type}: ${describe(prev)} -> ${describe(next)}`;
    if (!stats) {
      console.log(summary);
      return;
    }
    console.log(
      `${summary}\n  pairings: ${stats.matchedPairings} matched, ${stats.unmatchedLeft} unmatched-left, ` +
        `${stats.unmatchedRight} unmatched-right; result rows (${stats.joinType.toUpperCase()}): ${stats.resultRows}`,
    );
  }

  note(message: string): void {
    console.log(`${LOG_PREFIX} ${message}`);
  }

  warn(message: string): void {
    console.warn(`${LOG_PREFIX} ${message}`);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.longTasks?.disconnect();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || target?.isContentEditable) {
      return;
    }
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      return;
    }
    switch (event.key.toLowerCase()) {
      case 'j':
        this.host.debugJoin(event.shiftKey);
        break;
      case 't':
        this.host.toggleJoinType();
        break;
      case 'u':
        this.host.debugSeparate();
        break;
      case 'r':
        this.host.debugReplay();
        break;
    }
  };
}
