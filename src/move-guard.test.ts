import { afterEach, describe, expect, it } from 'vitest';
import { activeMoveReasons, allowMoves, checkMove, resetMoveGuardForTests, type Tracked } from './move-guard.js';

afterEach(() => resetMoveGuardForTests());

const at = (x: number, y = 1, z = -0.6) => ({ x, y, z });

describe('the move guard (slabs, result and card move only for an allowed reason)', () => {
  it('a move with no reason active is flagged, with how far it went', () => {
    const track: Tracked = { last: null, warned: false };
    expect(checkMove(track, at(0), 10)).toBeNull(); // first sighting
    expect(checkMove(track, at(0), 10.01)).toBeNull(); // still
    expect(checkMove(track, at(0.05), 10.02)).toBeCloseTo(0.05, 6);
  });

  it('the same move while a reason is active is fine', () => {
    const track: Tracked = { last: null, warned: false };
    checkMove(track, at(0), 10);
    allowMoves('recenter', 10, 0.7);
    expect(activeMoveReasons(10.5)).toEqual(['recenter']);
    expect(checkMove(track, at(0.05), 10.5)).toBeNull();
    // ...but not once the reason has run out.
    expect(activeMoveReasons(10.8)).toEqual([]);
    expect(checkMove(track, at(0.1), 10.8)).toBeCloseTo(0.05, 6);
  });

  it('warns once per run of unexplained moves, again after it stood still', () => {
    const track: Tracked = { last: null, warned: false };
    checkMove(track, at(0), 0);
    expect(checkMove(track, at(0.01), 1)).not.toBeNull();
    expect(checkMove(track, at(0.02), 1.01)).toBeNull();
    expect(checkMove(track, at(0.02), 1.02)).toBeNull(); // stood still: re-armed
    expect(checkMove(track, at(0.03), 1.03)).not.toBeNull();
  });

  it('drift under a millimetre is not a move', () => {
    const track: Tracked = { last: null, warned: false };
    checkMove(track, at(0), 0);
    expect(checkMove(track, at(0.0005), 1)).toBeNull();
  });

  it('every allowed reason is one of the listed movers', () => {
    for (const reason of ['placement', 'recenter', 'dataset-switch', 'puzzle-switch', 'join', 'dock', 'pull-apart', 'glide-home', 'grab'] as const) {
      allowMoves(reason, 0, 1);
    }
    expect(activeMoveReasons(0.5)).toHaveLength(9);
  });
});
