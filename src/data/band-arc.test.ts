import { describe, expect, it } from 'vitest';
import { arcAngle, arcPlace, BAND_ARC_RADIUS_METERS, rayCircleDistance, unrollArc } from '../band-arc.js';

const R = BAND_ARC_RADIUS_METERS;
/** The band 10 degrees below the eyes: it leans back 10 degrees. */
const LEAN = (10 * Math.PI) / 180;
const place = (s: number, y: number) => arcPlace(s, y, R, LEAN, { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
/** World up in the band's frame. */
const up = { x: 0, y: Math.cos(LEAN), z: Math.sin(LEAN) };
const heightOf = (p: { x: number; y: number; z: number }) => p.x * up.x + p.y * up.y + (p.z - R) * up.z;

describe('the band arc', () => {
  it('keeps every item at its height and the same distance from the eyes', () => {
    for (const s of [0, 0.05, 0.2, 0.4, -0.1]) {
      const p = place(s, 0);
      expect(Math.hypot(p.x, p.y, p.z - R)).toBeCloseTo(R, 9);
      // Same height (along world up) as the band's origin: the row stays level.
      expect(heightOf(p)).toBeCloseTo(heightOf({ x: 0, y: 0, z: 0 }), 9);
    }
    // A row 2 cm up stays 2 cm up (in the band's frame), wherever along the arc.
    expect(heightOf(place(0.3, 0.02))).toBeCloseTo(heightOf({ x: 0, y: 0.02, z: 0 }), 9);
  });

  it('turns each item about the vertical: facing the eyes, with no roll', () => {
    for (const s of [0.05, 0.3]) {
      const p = place(s, 0);
      // Euler XYZ -> its forward (+Z) and right (+X) axes.
      const [cx, sx, cy, sy, cz, sz] = [Math.cos(p.rx), Math.sin(p.rx), Math.cos(p.ry), Math.sin(p.ry), Math.cos(p.rz), Math.sin(p.rz)];
      const forward = { x: sy, y: -sx * cy, z: cx * cy };
      const right = { x: cy * cz, y: cx * sz + sx * sy * cz, z: sx * sz - cx * sy * cz };
      // Forward points at the eyes.
      const toEyes = { x: -p.x, y: -p.y, z: R - p.z };
      const n = Math.hypot(toEyes.x, toEyes.y, toEyes.z);
      expect(forward.x).toBeCloseTo(toEyes.x / n, 6);
      expect(forward.y).toBeCloseTo(toEyes.y / n, 6);
      expect(forward.z).toBeCloseTo(toEyes.z / n, 6);
      // Right is level (no roll).
      expect(right.x * up.x + right.y * up.y + right.z * up.z).toBeCloseTo(0, 9);
    }
  });

  it('unrolls a placed point back to its flat place; in front of it, a positive depth', () => {
    const p = place(0.3, 0.015);
    const onArc = { x: p.x, y: p.y, z: p.z };
    unrollArc(onArc, R, LEAN);
    expect(onArc.x).toBeCloseTo(0.3, 9);
    expect(onArc.y).toBeCloseTo(0.015, 9);
    expect(onArc.z).toBeCloseTo(0, 9);
    // 2 cm toward the eyes from it.
    const toEyes = { x: -p.x, y: -p.y, z: R - p.z };
    const n = Math.hypot(toEyes.x, toEyes.y, toEyes.z);
    const inFront = { x: p.x + (0.02 * toEyes.x) / n, y: p.y + (0.02 * toEyes.y) / n, z: p.z + (0.02 * toEyes.z) / n };
    unrollArc(inFront, R, LEAN);
    expect(inFront.x).toBeCloseTo(0.3, 3);
    expect(inFront.z).toBeCloseTo(0.02 * Math.cos(0), 3);
    expect(arcAngle(0.3, R, LEAN)).toBeCloseTo(0.3 / (R * Math.cos(LEAN)), 12);
  });

  it('meets a ray from the hand (inside the circle) on the circle', () => {
    const t = rayCircleDistance(0.1, -0.2, Math.sin(0.4), -Math.cos(0.4), 0.49);
    expect(Number.isFinite(t)).toBe(true);
    expect(Math.hypot(0.1 + t * Math.sin(0.4), -0.2 - t * Math.cos(0.4))).toBeCloseTo(0.49, 9);
  });
});
