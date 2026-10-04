/**
 * One puzzle attempt: how many hint tiers have been shown and whether it's
 * won. Pure, so the rules are testable apart from the scene:
 *
 * - Hints go up one tier per press, to 3 (the full answer); more presses
 *   change nothing. Hints never block winning.
 * - The first evaluation that matches the target wins, and the win is kept:
 *   changing the query afterwards doesn't un-win.
 * - A win after the full-answer hint is recorded as such, for the honest
 *   win line ("That's this query:").
 */

import type { PuzzleId } from './puzzles.js';

export const HINT_TIERS = 3;

export type PuzzleSession = {
  puzzleId: PuzzleId;
  hintsShown: number;
  solved: boolean;
  solvedWithAnswer: boolean;
};

export type SessionEvent = { type: 'showHint' } | { type: 'evaluate'; solved: boolean };

export function startSession(puzzleId: PuzzleId): PuzzleSession {
  return { puzzleId, hintsShown: 0, solved: false, solvedWithAnswer: false };
}

/** Returns the same object when nothing changes. */
export function sessionTransition(session: PuzzleSession, event: SessionEvent): PuzzleSession {
  switch (event.type) {
    case 'showHint':
      return session.hintsShown >= HINT_TIERS ? session : { ...session, hintsShown: session.hintsShown + 1 };
    case 'evaluate':
      if (!event.solved || session.solved) {
        return session;
      }
      return { ...session, solved: true, solvedWithAnswer: session.hintsShown >= HINT_TIERS };
  }
}

/** Index (0-2) of the latest hint shown, or null before the first. */
export function latestHintIndex(session: PuzzleSession): number | null {
  return session.hintsShown === 0 ? null : session.hintsShown - 1;
}
