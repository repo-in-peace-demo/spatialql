import { describe, expect, it } from 'vitest';
import {
  canEvaluate,
  canStartSwitch,
  deskTableIds,
  deskTransition,
  resumePuzzle,
  startupDataset,
  type DeskEvent,
  type DeskState,
} from './desk-session.js';
import { INITIAL_JOIN_STATE, type JoinState } from './join-state.js';
import { emptyProgress, markSolved } from './progress.js';
import { canActivatePuzzle, getPuzzle, PRACTICE_ORDER } from './puzzles.js';

const run = (events: DeskEvent[], from: DeskState): DeskState => events.reduce(deskTransition, from);
const SHOP: DeskState = { phase: 'ready', dataset: 'shop' };
const joined = (left: string, right: string): JoinState => ({ phase: 'joined', left, right, joinType: 'left' });

describe('desk switching', () => {
  it('runs leave -> build -> arrive -> ready', () => {
    const leaving = deskTransition(SHOP, { type: 'request', dataset: 'library' });
    expect(leaving).toEqual({ phase: 'leaving', from: 'shop', to: 'library' });
    expect(run([{ type: 'leftDone' }, { type: 'built' }, { type: 'arrived' }], leaving)).toEqual({
      phase: 'ready',
      dataset: 'library',
    });
  });

  it('a request for the loaded dataset, or mid-switch, changes nothing', () => {
    expect(deskTransition(SHOP, { type: 'request', dataset: 'shop' })).toBe(SHOP);
    const building = run([{ type: 'request', dataset: 'library' }, { type: 'leftDone' }], SHOP);
    expect(deskTransition(building, { type: 'request', dataset: 'cafe' })).toBe(building);
    expect(deskTransition(building, { type: 'arrived' })).toBe(building);
  });

  it('no tables are playable mid-switch', () => {
    expect(deskTableIds(SHOP).sort()).toEqual(['customers', 'orders']);
    const states = [
      deskTransition(SHOP, { type: 'request', dataset: 'library' }),
      run([{ type: 'request', dataset: 'library' }, { type: 'leftDone' }], SHOP),
      run([{ type: 'request', dataset: 'library' }, { type: 'leftDone' }, { type: 'built' }], SHOP),
    ];
    for (const state of states) {
      expect(deskTableIds(state), state.phase).toEqual([]);
      // Phase 2's activation guard, given the desk's tables: nothing can load mid-switch.
      expect(canActivatePuzzle('library-fanout', PRACTICE_ORDER, deskTableIds(state)), state.phase).toBe(false);
    }
  });
});

describe('evaluation guard', () => {
  const library = getPuzzle('library-fanout');
  const shop3 = getPuzzle('shop-never-ordered');

  it('judges a join only on the ready desk of the puzzle, on its tables', () => {
    expect(canEvaluate(SHOP, shop3, joined('customers', 'orders'))).toBe(true);
    expect(canEvaluate(SHOP, shop3, INITIAL_JOIN_STATE)).toBe(false);
  });

  it('switching mid-join: the old join is never judged against the next puzzle', () => {
    // Next was pressed on puzzle 3 while joined; puzzle 4 (library) is pending.
    expect(canStartSwitch(joined('customers', 'orders'), false, false)).toBe(false);
    expect(canEvaluate(SHOP, library, joined('customers', 'orders'))).toBe(false);
    // Separated, but a slab still held or gliding home: still waiting.
    expect(canStartSwitch(INITIAL_JOIN_STATE, true, false)).toBe(false);
    expect(canStartSwitch(INITIAL_JOIN_STATE, false, true)).toBe(false);
    expect(canStartSwitch(INITIAL_JOIN_STATE, false, false)).toBe(true);
  });

  it('during the switch animation: nothing is judged, even a matching join', () => {
    const phases = [
      deskTransition(SHOP, { type: 'request', dataset: 'library' }),
      run([{ type: 'request', dataset: 'library' }, { type: 'leftDone' }], SHOP),
      run([{ type: 'request', dataset: 'library' }, { type: 'leftDone' }, { type: 'built' }], SHOP),
    ];
    for (const desk of phases) {
      expect(canEvaluate(desk, library, joined('borrowers', 'books')), desk.phase).toBe(false);
    }
    const ready = run(
      [{ type: 'request', dataset: 'library' }, { type: 'leftDone' }, { type: 'built' }, { type: 'arrived' }],
      SHOP,
    );
    expect(canEvaluate(ready, library, joined('borrowers', 'books'))).toBe(true);
    expect(canEvaluate(ready, shop3, joined('customers', 'orders'))).toBe(false);
  });

  it('after a reload: the resume puzzle\'s dataset loads first, and nothing is judged before it is ready', () => {
    let progress = emptyProgress();
    for (const id of PRACTICE_ORDER.slice(0, 8)) {
      progress = markSolved(progress, id, 20_000, 0);
    }
    progress = { ...progress, lastPuzzle: 'library-every-book' };
    expect(resumePuzzle(progress, PRACTICE_ORDER)).toBe('library-every-book');
    expect(startupDataset(progress, PRACTICE_ORDER)).toBe('library');
    // Before the library tables have arrived, a join can't be judged.
    const arriving: DeskState = { phase: 'arriving', to: 'library' };
    expect(canEvaluate(arriving, getPuzzle('library-every-book'), joined('books', 'borrowers'))).toBe(false);
    // A fresh device starts on the shop.
    expect(startupDataset(emptyProgress(), PRACTICE_ORDER)).toBe('shop');
  });
});
