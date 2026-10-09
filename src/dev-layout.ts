/**
 * Dev-only: the table group's outermost points as the join system last laid
 * it out (its layout readout, `noteBand`): the leftmost and rightmost corners
 * in view, and the lowest. The debug panel places itself outside them --
 * beyond the card on the right, beyond the column on the left -- instead of
 * guessing from the source slabs alone. Written and read only behind
 * `import.meta.env.DEV` and the `debug` flag; world coordinates.
 */
export const devLayout = {
  left: { x: 0, y: 0, z: 0 },
  right: { x: 0, y: 0, z: 0 },
  bottom: { x: 0, y: 0, z: 0 },
  /** The element each point belongs to (for the panel's placement line). */
  leftName: '',
  rightName: '',
  /** Bumped on every changed layout (0: none yet). */
  version: 0,
};
