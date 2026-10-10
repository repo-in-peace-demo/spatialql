import { describe, expect, it } from 'vitest';
import type { Vector3 } from '@iwsdk/core';
import {
  approachAngleDeg,
  CONTACT_DEPTH_METERS,
  ContactPoke,
  MAX_POKE_APPROACH_DEG,
  type PokeVerdict,
} from '../contact-poke.js';

/** A fingertip path in the surface's frame (meters); returns each frame's verdict. */
function run(
  poke: ContactPoke,
  path: [number, number, number][],
  options: { onTarget?: boolean; straightness?: number | null; hand?: string } = {},
): PokeVerdict[] {
  const point = { x: 0, y: 0, z: 0 };
  return path.map(([x, y, z]) => {
    point.x = x;
    point.y = y;
    point.z = z;
    return poke.update(
      options.hand ?? 'right',
      point as unknown as Vector3,
      () => options.onTarget ?? true,
      () => (options.straightness === undefined ? 0.95 : options.straightness),
    );
  });
}

const straightIn: [number, number, number][] = [
  [0, 0, 0.08],
  [0, 0, 0.05],
  [0, 0, 0.03],
  [0, 0, 0.005],
];

describe('contact poke', () => {
  it('presses on contact, coming straight in from the front', () => {
    expect(run(new ContactPoke(), straightIn)).toEqual(['none', 'none', 'none', 'press']);
  });

  it('presses once per touch: re-arms only after pulling back 3 cm', () => {
    const poke = new ContactPoke();
    run(poke, straightIn);
    // Jitter at the surface: no second press.
    expect(run(poke, [[0, 0, 0.015], [0, 0, 0.004], [0, 0, 0.02], [0, 0, 0.003]])).not.toContain('press');
    // Pull back past 3 cm, come in again: a second press.
    expect(run(poke, [[0, 0, 0.04], [0, 0, 0.02], [0, 0, 0.004]])).toContain('press');
  });

  it("rejects a fingertip sliding along the face (a hand reaching past to a slab)", () => {
    const sliding: [number, number, number][] = [
      [0, 0.12, 0.08],
      [0, 0.09, 0.045],
      [0, 0.05, 0.035],
      [0, 0.01, 0.02],
      [0, 0, 0.008],
    ];
    expect(run(new ContactPoke(), sliding)).toContain('rejected-direction');
  });

  it('rejects a curled index finger, but allows untracked joints (controllers)', () => {
    expect(run(new ContactPoke(), straightIn, { straightness: 0.6 })).toContain('rejected-finger');
    expect(run(new ContactPoke(), straightIn, { straightness: null })).toContain('press');
  });

  it('ignores a crossing off target, from behind, or at the first tracked frame', () => {
    expect(run(new ContactPoke(), straightIn, { onTarget: false })).not.toContain('press');
    expect(run(new ContactPoke(), [[0, 0, -0.08], [0, 0, -0.01], [0, 0, 0.005]])).not.toContain('press');
    expect(run(new ContactPoke(), [[0, 0, 0.005]])).toEqual(['none']);
  });

  it('tracks each hand separately', () => {
    const poke = new ContactPoke();
    run(poke, straightIn, { hand: 'left' });
    expect(run(poke, straightIn, { hand: 'right' })).toContain('press');
  });

  it('the steepest approach that presses is 60° off straight', () => {
    expect(MAX_POKE_APPROACH_DEG).toBe(60);
  });

  /**
   * Replay (headset logs 2026-10-07 to 2026-10-10, scripts/headset_log.py
   * pokes): each logged approach as travel toward the face and sideways (cm).
   * A straight path at that angle, 8 cm out to just inside contact, at 90 fps.
   */
  const replay = (towardCm: number, sidewaysCm: number) => {
    const poke = new ContactPoke();
    const angle = Math.atan2(sidewaysCm, towardCm);
    const path: [number, number, number][] = [];
    const contactZ = CONTACT_DEPTH_METERS - 0.001;
    for (let z = 0.08; z > contactZ - 0.0045; z -= 0.004) {
      const depth = Math.max(z, contactZ - 0.004);
      // Sideways travel grows with the travel toward the face, at the logged angle.
      path.push([(0.08 - depth) * Math.tan(angle), 0, depth]);
    }
    const verdicts = run(poke, path);
    const firstContact = path.findIndex(([, , z]) => z <= CONTACT_DEPTH_METERS);
    return { verdict: verdicts.find((v) => v !== 'none') ?? 'none', atFirstContact: verdicts[firstContact] !== 'none' };
  };

  it("replay: the 2026-10-10 tile and chip pokes rejected at 45° (47-58°) press now, at first contact with the face", () => {
    const rejected: [string, number, number][] = [
      ['tile 9', 3.8, 4.7],
      ['tile 13', 3.7, 3.9],
      ['Filter', 3.8, 4.6],
      ['chip 1', 4.0, 5.7],
      ['chip 1', 3.3, 5.2],
      ['chip 1', 3.9, 5.2],
    ];
    for (const [name, toward, sideways] of rejected) {
      expect(approachAngleDeg(toward, sideways), name).toBeGreaterThan(45);
      expect(replay(toward, sideways), `${name} at ${approachAngleDeg(toward, sideways).toFixed(0)}°`).toEqual({
        verdict: 'press',
        atFirstContact: true,
      });
    }
  });

  it('replay: the pokes that pressed still press at first contact', () => {
    for (const [toward, sideways] of [
      [3.9, 1.9],
      [3.8, 1.1],
      [4.0, 0.8],
      [4.0, 2.1],
      [3.9, 2.1],
    ]) {
      expect(replay(toward, sideways)).toEqual({ verdict: 'press', atFirstContact: true });
    }
  });

  it('replay: earlier rejections at 47-59° press; the slides along the face (61°, 68°, 77°) are still rejected', () => {
    for (const [toward, sideways] of [
      [3.9, 4.2],
      [3.8, 4.7],
      [3.5, 4.3],
      [4.4, 6.0],
      [3.8, 5.4],
      [3.2, 4.5],
      [3.9, 6.2],
      [2.9, 4.9],
    ]) {
      expect(replay(toward, sideways).verdict, `${toward}/${sideways}`).toBe('press');
    }
    for (const [toward, sideways] of [
      [4.2, 7.6],
      [4.3, 10.4],
      [4.0, 17.8],
    ]) {
      expect(replay(toward, sideways).verdict, `${toward}/${sideways}`).toBe('rejected-direction');
    }
  });

  it('a missed contact is reported once the fingertip is back out, with its angle and how deep it went', () => {
    const poke = new ContactPoke();
    // In at 70° off straight, on through the face to 1.5 cm behind it, then back out.
    run(poke, [
      [0, 0, 0.06],
      [0.11, 0, 0.02],
      [0.14, 0, 0.008],
      [0.14, 0, -0.015],
      [0.14, 0, -0.01],
    ]);
    expect(poke.takeMiss('right')).toBeNull(); // still in
    run(poke, [[0.14, 0, 0.03]]);
    const miss = poke.takeMiss('right');
    expect(miss?.verdict).toBe('rejected-direction');
    expect(miss?.deepest).toBeCloseTo(-0.015, 6);
    expect(miss?.angleDeg).toBeGreaterThan(60);
    expect(poke.takeMiss('right')).toBeNull(); // reported once
  });
});
