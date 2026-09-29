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
}

const LOG_PREFIX = '[Join debug]';

// Letters chosen to stay clear of the emulator's movement keys (WASD/QE).
const KEY_HELP = [
  'J        join: bring orders to customers  (customers is LEFT)',
  'Shift+J  join: bring customers to orders  (orders is LEFT)',
  'T        toggle INNER / LEFT',
  'U        un-join: slide the RIGHT slab away and separate',
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

  constructor(host: JoinDebugHost) {
    this.host = host;
    window.addEventListener('keydown', this.onKeyDown);
    console.info(`${LOG_PREFIX} keyboard shortcuts:\n  ${KEY_HELP.join('\n  ')}`);
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
    }
  };
}
