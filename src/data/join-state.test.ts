import { describe, expect, it } from 'vitest';
import { INITIAL_JOIN_STATE, transition, type JoinEvent, type JoinState } from './join-state.js';

const run = (events: JoinEvent[], from: JoinState = INITIAL_JOIN_STATE): JoinState =>
  events.reduce(transition, from);

describe('join state machine', () => {
  it('previews when the held slab comes into range and stops when it leaves', () => {
    const previewing = run([{ type: 'enterRange', moving: 'orders', stationary: 'customers' }]);
    expect(previewing).toEqual({ phase: 'previewing', moving: 'orders', stationary: 'customers' });
    expect(transition(previewing, { type: 'exitRange' })).toEqual({ phase: 'idle' });
  });

  it('commits on release of the moving slab: stationary is LEFT, moved is RIGHT, INNER by default', () => {
    const joined = run([
      { type: 'enterRange', moving: 'orders', stationary: 'customers' },
      { type: 'release', slab: 'orders' },
    ]);
    expect(joined).toEqual({ phase: 'joined', left: 'customers', right: 'orders', joinType: 'inner' });
  });

  it('bringing customers to orders makes orders the LEFT table', () => {
    const joined = run([
      { type: 'enterRange', moving: 'customers', stationary: 'orders' },
      { type: 'release', slab: 'customers' },
    ]);
    expect(joined).toMatchObject({ left: 'orders', right: 'customers' });
  });

  it('ignores releasing a slab that is not the moving one', () => {
    const previewing = run([{ type: 'enterRange', moving: 'orders', stationary: 'customers' }]);
    expect(transition(previewing, { type: 'release', slab: 'customers' })).toBe(previewing);
  });

  it('does not commit from idle on release (no preview, no join)', () => {
    expect(transition(INITIAL_JOIN_STATE, { type: 'release', slab: 'orders' })).toBe(INITIAL_JOIN_STATE);
  });

  it('re-targets the preview when the pair changes', () => {
    const state = run([
      { type: 'enterRange', moving: 'orders', stationary: 'customers' },
      { type: 'enterRange', moving: 'customers', stationary: 'orders' },
    ]);
    expect(state).toEqual({ phase: 'previewing', moving: 'customers', stationary: 'orders' });
  });

  it('toggles and sets the join type only while joined', () => {
    const joined = run([{ type: 'commit', left: 'customers', right: 'orders' }]);
    const left = transition(joined, { type: 'toggleJoinType' });
    expect(left).toMatchObject({ phase: 'joined', joinType: 'left' });
    expect(transition(left, { type: 'toggleJoinType' })).toMatchObject({ joinType: 'inner' });
    expect(transition(left, { type: 'setJoinType', joinType: 'left' })).toBe(left);
    expect(transition(INITIAL_JOIN_STATE, { type: 'toggleJoinType' })).toBe(INITIAL_JOIN_STATE);
  });

  it('separates, returns to idle, and can join again', () => {
    const separating = run([
      { type: 'commit', left: 'customers', right: 'orders' },
      { type: 'setJoinType', joinType: 'left' },
      { type: 'pullApart' },
    ]);
    expect(separating).toEqual({ phase: 'separating', left: 'customers', right: 'orders', joinType: 'left' });
    // Nothing else is accepted mid-separation.
    expect(transition(separating, { type: 'toggleJoinType' })).toBe(separating);
    expect(transition(separating, { type: 'enterRange', moving: 'orders', stationary: 'customers' })).toBe(
      separating,
    );

    const idle = transition(separating, { type: 'separated' });
    expect(idle).toEqual({ phase: 'idle' });
    const rejoined = run(
      [
        { type: 'enterRange', moving: 'orders', stationary: 'customers' },
        { type: 'release', slab: 'orders' },
      ],
      idle,
    );
    expect(rejoined).toEqual({ phase: 'joined', left: 'customers', right: 'orders', joinType: 'inner' });
  });

  it('rejects degenerate self-joins', () => {
    expect(
      transition(INITIAL_JOIN_STATE, { type: 'enterRange', moving: 'orders', stationary: 'orders' }),
    ).toBe(INITIAL_JOIN_STATE);
    expect(transition(INITIAL_JOIN_STATE, { type: 'commit', left: 'a', right: 'a' })).toBe(INITIAL_JOIN_STATE);
  });
});
