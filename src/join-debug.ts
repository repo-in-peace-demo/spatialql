/**
 * Dev-only join testing aids, enabled with `?debug=1`: keyboard shortcuts
 * that drive the join flow without grabbing, and a log line per state
 * transition. Only constructed behind `import.meta.env.DEV`, so production
 * builds drop this module.
 */

import type { JoinEvent, JoinState } from './data/join-state.js';
import type { JoinType } from './data/types.js';
import { heapText } from './scene-census.js';

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
  /** Logs every placed element's world position (slabs, result, card, column, control) and the layout anchor. */
  debugLayoutSnapshot(): void;
}

const LOG_PREFIX = '[Join debug]';

// Letters chosen to stay clear of the emulator's movement keys (WASD/QE).
const KEY_HELP = [
  'J        join: bring orders to customers  (customers is LEFT)',
  'Shift+J  join: bring customers to orders  (orders is LEFT)',
  'T        toggle INNER / LEFT',
  'U        un-join: slide the RIGHT slab away and separate',
  'R        replay the join animation and sounds (while joined)',
  'L        log the layout: every placed element\'s world position, and the layout anchor',
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
/** How long a GC sentinel is held before it's dropped (it must survive the minor GCs meanwhile). */
const GC_SENTINEL_MS = 2000;
/** Sentinel finalizations closer together than this are one major GC (well under GC_SENTINEL_MS). */
const GC_BURST_MS = 500;
/** FinalizationRegistry (ES2021; this project's TypeScript lib predates it), where the browser has it. */
const Registry = (
  globalThis as { FinalizationRegistry?: new (onFinalize: (held: number) => void) => { register(target: object, held: number): void } }
).FinalizationRegistry;

export class JoinDebug {
  private readonly host: JoinDebugHost;
  private longTasks: PerformanceObserver | null = null;
  private joinStartMs = -1;
  /**
   * Major garbage collections, seen through a sentinel: an object held
   * GC_SENTINEL_MS (long enough to be promoted to the old generation) and
   * then dropped can only be reclaimed by a major GC, whose finalization
   * callback follows shortly after it. One live sentinel at a time; but a
   * major GC reclaims every sentinel dropped since the last one (the Quest
   * collected 54 at once on 2026-10-14), so finalizations within
   * GC_BURST_MS of each other count as one collection.
   */
  private sentinel: object | null = null;
  private lastMajorGcMs = -Infinity;
  private majorGcs = 0;
  private readonly gcRegistry = Registry
    ? new Registry(() => {
        const now = performance.now();
        if (now - this.lastMajorGcMs > GC_BURST_MS) {
          this.majorGcs++;
        }
        this.lastMajorGcMs = now;
      })
    : null;
  private readonly sentinelTimer = window.setInterval(() => {
    // The old one is dropped here; the new one is held until the next tick.
    this.sentinel = {};
    this.gcRegistry?.register(this.sentinel, 0);
  }, GC_SENTINEL_MS);

  constructor(host: JoinDebugHost) {
    this.host = host;
    window.addEventListener('keydown', this.onKeyDown);
    console.info(`${LOG_PREFIX} keyboard shortcuts:\n  ${KEY_HELP.join('\n  ')}`);
    // Main-thread stalls over 50 ms, timed against the last join start.
    try {
      this.longTasks = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const since = this.joinStartMs < 0 ? '' : ` at +${((entry.startTime - this.joinStartMs) / 1000).toFixed(3)} s from join start`;
          // A major GC finalized within a second of the task's end: the stall was most likely that collection.
          const gcAgo = performance.now() - this.lastMajorGcMs;
          const gc =
            gcAgo < entry.duration + 1000
              ? `; major GC ${gcAgo.toFixed(0)} ms ago (${this.majorGcs} so far)`
              : `; no major GC near it (${this.majorGcs} so far)`;
          console.warn(`${LOG_PREFIX} long task: ${entry.duration.toFixed(0)} ms${since}${heapText()}${gc}`);
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

  /** `, major GCs N (last S s ago)`, for the scene census line. */
  gcText(): string {
    const ago = this.majorGcs > 0 ? ` (last ${((performance.now() - this.lastMajorGcMs) / 1000).toFixed(1)} s ago)` : '';
    return `, major GCs ${this.majorGcs}${ago}`;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.longTasks?.disconnect();
    window.clearInterval(this.sentinelTimer);
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
      case 'l':
        this.host.debugLayoutSnapshot();
        break;
    }
  };
}
