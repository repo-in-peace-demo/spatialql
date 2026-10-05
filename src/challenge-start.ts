/**
 * Challenge mode's start, resolved once and shared: desk placement needs
 * the first dataset before the challenge system exists (after a reload the
 * desk loads the resume puzzle's tables, not always the shop), and the
 * challenge system needs the same progress and puzzle.
 *
 * Loads saved progress (guarded localStorage), clears it first with the dev
 * `?resetProgress`, sanitizes it (drops what this build couldn't have
 * made), and picks the puzzle: a dev `?puzzle=<id>` if playable, else the
 * resume puzzle.
 */

import { getPuzzle, isPuzzleId, PRACTICE_ORDER, type PuzzleId } from './data/puzzles.js';
import { resumePuzzle } from './data/desk-session.js';
import type { DatasetId } from './data/datasets.js';
import {
  emptyProgress,
  loadProgress,
  sanitizeProgress,
  saveProgress,
  type KeyValueStorage,
  type Progress,
} from './data/progress.js';

/** Phase 3: every practice puzzle. */
export const PLAYABLE: readonly PuzzleId[] = PRACTICE_ORDER;

export type ChallengeStart = {
  storage: KeyValueStorage | null;
  progress: Progress;
  /** Whether sanitizing dropped anything (it's saved back). */
  sanitized: boolean;
  puzzleId: PuzzleId;
  datasetId: DatasetId;
};

let start: ChallengeStart | null = null;

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
    saveProgress(storage, emptyProgress());
  }
  const loaded = loadProgress(storage, isPuzzleId);
  // No daily yet, so every solve came from strict practice order.
  const progress = sanitizeProgress(loaded, PLAYABLE, PRACTICE_ORDER, true);
  if (progress !== loaded) {
    saveProgress(storage, progress);
  }
  let puzzleId = resumePuzzle(progress, PLAYABLE);
  if (import.meta.env.DEV) {
    const requested = params.get('puzzle');
    if (requested && isPuzzleId(requested) && PLAYABLE.includes(requested)) {
      puzzleId = requested;
    }
  }
  start = { storage, progress, sanitized: progress !== loaded, puzzleId, datasetId: getPuzzle(puzzleId).datasetId };
  return start;
}
