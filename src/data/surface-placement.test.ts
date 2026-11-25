import { describe, expect, it } from 'vitest';
import { DESK_EDGE_BEYOND_REACH_MAX_METERS, surfacePlacementCase } from '../surface-placement.js';

describe('surface placement: reach wins', () => {
  it('rests on the surface when its near edge is within reach', () => {
    expect(surfacePlacementCase(0.32, 0.4)).toBe('on-surface');
    expect(surfacePlacementCase(0.4, 0.4)).toBe('on-surface');
  });

  it('sits at reach in front of the desk edge when the edge is a little beyond reach', () => {
    // The headset session: the table's near edge 0.50 m away, reach for the bottom line ~0.40 m.
    expect(surfacePlacementCase(0.5, 0.4)).toBe('desk-edge');
    expect(surfacePlacementCase(0.4 + DESK_EDGE_BEYOND_REACH_MAX_METERS, 0.4)).toBe('desk-edge');
  });

  it('floats when the surface is farther than that', () => {
    expect(surfacePlacementCase(0.4 + DESK_EDGE_BEYOND_REACH_MAX_METERS + 0.01, 0.4)).toBe('floating');
    expect(surfacePlacementCase(0.96, 0.4)).toBe('floating');
  });
});
