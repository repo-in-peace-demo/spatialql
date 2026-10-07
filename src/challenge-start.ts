/**
 * Challenge mode's start, resolved once and shared: desk placement needs
 * the first dataset before the challenge system exists (after a reload the
 * desk loads the start puzzle's tables, not always the shop), the challenge
 * system needs the same progress and puzzle, and the welcome screen shows
 * the same progress.
 *
 * Loads saved progress (guarded localStorage), clears it first with the dev
 * `?resetProgress`, sanitizes it (drops what this build couldn't have
 * made), fixes today (the dev `?day=YYYY-MM-DD` overrides it), and picks the
 * puzzle: today's daily while it's offered and unsolved, else practice
 * (`data/daily-flow.ts`); a dev `?puzzle=<id>` wins over both.
 *
 * The challenge system publishes progress back here as it changes
 * (`publishProgress`), so the welcome screen shows it after a session even
 * when storage is blocked.
 */

import { dayFromIso, localDay } from './data/daily.js';
import { startPuzzle } from './data/daily-flow.js';
import { getPuzzle, isPuzzleId, PRACTICE_ORDER, type PuzzleId } from './data/puzzles.js';
import type { DatasetId } from './data/datasets.js';
import {
  emptyProgress,
  loadProgress,
  sanitizeProgress,
  saveProgress,
  type KeyValueStorage,
  type Progress,
} from './data/progress.js';

/** Every practice puzzle (and so every daily). */
export const PLAYABLE: readonly PuzzleId[] = PRACTICE_ORDER;

export type ChallengeStart = {
  storage: KeyValueStorage | null;
  progress: Progress;
  /** Whether sanitizing dropped anything (it's saved back). */
  sanitized: boolean;
  /** The day this page plays (fixed at load). */
  today: number;
  puzzleId: PuzzleId;
  datasetId: DatasetId;
  /** Why this puzzle: today's daily, practice, or the dev `?puzzle=`. */
  reason: 'daily' | 'practice' | 'dev';
};

let start: ChallengeStart | null = null;
/** The latest progress and whether saving works, as the challenge system last published them. */
let live: { progress: Progress; saveWorks: boolean } | null = null;

function safeStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function challengeStart(): ChallengeStart {
  if (start) {
    return start;
  }
  const storage = safeStorage();
  const params = new URLSearchParams(window.location.search);
  if (import.meta.env.DEV && params.has('resetProgress')) {
    clearSavedProgress(storage);
  }
  const loaded = loadProgress(storage, isPuzzleId);
  // Dailies can solve puzzles out of practice order, so solves aren't
  // required to be in order; unknown ids and a bad resume point still go.
  const progress = sanitizeProgress(loaded, PLAYABLE, PRACTICE_ORDER, false);
  // Saved back now either way: writes what was sanitized, and finds out
  // whether saving works (storage can read but refuse writes).
  const saveWorks = saveProgress(storage, progress);
  let today = localDay(new Date());
  if (import.meta.env.DEV) {
    const day = params.get('day');
    const override = day ? dayFromIso(day) : null;
    if (override !== null) {
      today = override;
    }
  }
  const choice = startPuzzle(progress, today, PLAYABLE);
  let puzzleId = choice.puzzleId;
  let reason: ChallengeStart['reason'] = choice.reason;
  if (import.meta.env.DEV) {
    const requested = params.get('puzzle');
    if (requested && isPuzzleId(requested) && PLAYABLE.includes(requested)) {
      puzzleId = requested;
      reason = 'dev';
    }
  }
  start = {
    storage,
    progress,
    sanitized: progress !== loaded,
    today,
    puzzleId,
    datasetId: getPuzzle(puzzleId).datasetId,
    reason,
  };
  live = { progress, saveWorks };
  return start;
}

/** Saves empty progress: every puzzle, the streak, the resume point and the seen concepts. */
function clearSavedProgress(storage: KeyValueStorage | null): void {
  saveProgress(storage, emptyProgress());
}

/**
 * The welcome screen's "Reset progress" (after its confirmation): clears the
 * saved progress, as the dev `?resetProgress` does, and reloads the page so
 * everything starts fresh on puzzle 1.
 */
export function resetAllProgress(): void {
  clearSavedProgress(safeStorage());
  window.location.reload();
}

/** A puzzle picked on the welcome screen, waiting for the challenge system to load it. */
let picked: PuzzleId | null = null;

/** The welcome screen's picker: the challenge system loads `id` (switching tables if needed). */
export function pickPuzzle(id: PuzzleId): void {
  picked = id;
}

/** The picked puzzle, once (null when none is waiting). */
export function takePickedPuzzle(): PuzzleId | null {
  const id = picked;
  picked = null;
  return id;
}

/** The challenge system's latest progress, and whether its last save went through. */
export function publishProgress(progress: Progress, saveWorks: boolean): void {
  live = { progress, saveWorks };
}

/** The latest progress (published, else as loaded at start). */
export function liveProgress(): { progress: Progress; saveWorks: boolean } {
  if (!live) {
    challengeStart();
  }
  return live as { progress: Progress; saveWorks: boolean };
}
