import { describe, expect, it } from 'vitest';
import type { Vector3 } from '@iwsdk/core';
import { ContactPoke, type PokeVerdict } from '../contact-poke.js';

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
});
