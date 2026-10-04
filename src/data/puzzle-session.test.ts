import { describe, expect, it } from 'vitest';
import { latestHintIndex, sessionTransition, startSession, type PuzzleSession, type SessionEvent } from './puzzle-session.js';

const run = (events: SessionEvent[], from: PuzzleSession = startSession('shop-match')): PuzzleSession =>
  events.reduce(sessionTransition, from);

describe('puzzle session', () => {
  it('starts unsolved with no hints', () => {
    const session = startSession('shop-never-ordered');
    expect(session).toEqual({ puzzleId: 'shop-never-ordered', hintsShown: 0, solved: false, solvedWithAnswer: false });
    expect(latestHintIndex(session)).toBeNull();
  });

  it('shows hints one tier at a time, up to the full answer', () => {
    const one = run([{ type: 'showHint' }]);
    expect(latestHintIndex(one)).toBe(0);
    const three = run([{ type: 'showHint' }, { type: 'showHint' }, { type: 'showHint' }]);
    expect(latestHintIndex(three)).toBe(2);
    expect(sessionTransition(three, { type: 'showHint' })).toBe(three);
  });

  it('wins on the first matching evaluation and keeps the win', () => {
    const unsolved = run([{ type: 'evaluate', solved: false }]);
    expect(unsolved.solved).toBe(false);
    const won = sessionTransition(unsolved, { type: 'evaluate', solved: true });
    expect(won).toMatchObject({ solved: true, solvedWithAnswer: false });
    expect(sessionTransition(won, { type: 'evaluate', solved: false })).toBe(won);
    expect(sessionTransition(won, { type: 'evaluate', solved: true })).toBe(won);
  });

  it('records a win after the full-answer hint, but not after a partial hint', () => {
    const partial = run([{ type: 'showHint' }, { type: 'showHint' }, { type: 'evaluate', solved: true }]);
    expect(partial.solvedWithAnswer).toBe(false);
    const answered = run([
      { type: 'showHint' },
      { type: 'showHint' },
      { type: 'showHint' },
      { type: 'evaluate', solved: true },
    ]);
    expect(answered.solvedWithAnswer).toBe(true);
  });

  it('hints still work after a win', () => {
    const won = run([{ type: 'evaluate', solved: true }, { type: 'showHint' }]);
    expect(won).toMatchObject({ solved: true, hintsShown: 1, solvedWithAnswer: false });
  });
});
