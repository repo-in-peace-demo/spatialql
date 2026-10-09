import { describe, expect, it } from 'vitest';
import {
  grabPoints,
  reachClearances,
  REACH_PATH_MIN_CLEARANCE_METERS,
  rectFromCorners,
  segmentRectDistance,
  shoulders,
  type Vec3,
} from '../reach-path.js';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
/** A 20 x 10 cm rectangle facing +z at z = 1, centered on the z axis. */
const square = rectFromCorners('square', v(-0.1, -0.05, 1), v(0.1, -0.05, 1), v(-0.1, 0.05, 1));

describe('segment to rectangle distance', () => {
  it('is zero for a segment passing through the rectangle', () => {
    expect(segmentRectDistance(v(0, 0, 0), v(0, 0, 2), square)).toBe(0);
    expect(segmentRectDistance(v(0.09, 0.04, 0.5), v(0.09, 0.04, 1.5), square)).toBe(0);
  });

  it('measures past an edge (perpendicular approach beside it)', () => {
    expect(segmentRectDistance(v(0.15, 0, 0), v(0.15, 0, 2), square)).toBeCloseTo(0.05, 6);
    expect(segmentRectDistance(v(0, 0.12, 0), v(0, 0.12, 2), square)).toBeCloseTo(0.07, 6);
  });

  it('measures from an endpoint short of the face', () => {
    expect(segmentRectDistance(v(0, 0, 0), v(0, 0, 0.9), square)).toBeCloseTo(0.1, 6);
  });

  it('measures a segment parallel to the face', () => {
    expect(segmentRectDistance(v(-1, 0, 1.03), v(1, 0, 1.03), square)).toBeCloseTo(0.03, 6);
  });

  it('measures a skew segment against the nearest corner', () => {
    // Passes the corner (0.1, 0.05, 1) diagonally, 2 cm out along x and y each.
    const d = segmentRectDistance(v(0.12, 0.07, 0), v(0.12, 0.07, 2), square);
    expect(d).toBeCloseTo(Math.hypot(0.02, 0.02), 6);
  });
});

describe('shoulders and grab points', () => {
  it('shoulders sit 0.18 m to each side of and 0.25 m below the eyes', () => {
    expect(shoulders(v(0, 1.6, 0), v(1, 0, 0))).toEqual([v(-0.18, 1.35, 0), v(0.18, 1.35, 0)]);
  });

  it('three points on the top edge and three on the near edge', () => {
    const points = grabPoints(v(-0.1, 1, 0), v(0.1, 1, 0), v(-0.1, 0.8, 0), v(0.1, 0.8, 0));
    expect(points.map((p) => [Number(p.x.toFixed(3)), p.y])).toEqual([
      [-0.09, 1],
      [0, 1],
      [0.09, 1],
      [-0.09, 0.8],
      [0, 0.8],
      [0.09, 0.8],
    ]);
  });
});

/**
 * Regression: the library layout from the 2026-10-10 headset log (before the
 * join, 01:51:00.981), rebuilt in the head's frame (x right, y up, z ahead;
 * eyes at the origin) from the readout's angles and the placement log's
 * slab poses. The card at 0.75 m sat with its bottom edge 2 cm above the
 * books slab's top edge at the same depth: a hand reaching for that slab
 * passed through it. At 0.85 m (the result's depth) it's behind the slabs.
 */
describe('the reach paths in the 2026-10-10 layout', () => {
  const head = v(0, 0, 0);
  const from = shoulders(head, v(1, 0, 0));
  const borrowers = grabPoints(v(-0.38, -0.166, 0.64), v(-0.058, -0.166, 0.64), v(-0.38, -0.398, 0.544), v(-0.058, -0.398, 0.544));
  const books = grabPoints(v(0.053, -0.092, 0.668), v(0.452, -0.092, 0.668), v(0.053, -0.403, 0.539), v(0.452, -0.403, 0.539));
  const to = [...borrowers, ...books];
  const column = rectFromCorners('column', v(-0.339, -0.051, 0.377), v(-0.248, -0.051, 0.442), v(-0.334, 0.107, 0.37));

  it('the card at 0.75 m: under 5 cm from the path to the books slab (2.4 cm)', () => {
    const card = rectFromCorners('card', v(0.252, -0.075, 0.734), v(0.52, -0.075, 0.577), v(0.238, 0.221, 0.709));
    const [result] = reachClearances(from, to, [card]);
    expect(result.meters).toBeLessThan(REACH_PATH_MIN_CLEARANCE_METERS);
    expect(result.meters).toBeCloseTo(0.024, 2);
    expect(result.point).toBeGreaterThanOrEqual(borrowers.length); // a books grab point
  });

  it('the card at 0.85 m and the column: at least 5 cm from every path', () => {
    const card = rectFromCorners('card', v(0.286, -0.085, 0.832), v(0.589, -0.085, 0.654), v(0.269, 0.25, 0.804));
    for (const result of reachClearances(from, to, [card, column])) {
      expect(result.meters, result.name).toBeGreaterThanOrEqual(REACH_PATH_MIN_CLEARANCE_METERS);
    }
  });
});
