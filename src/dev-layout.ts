/**
 * Dev-only: the table group's outermost points as the join system last laid
 * it out (its layout readout, `noteBand`): the leftmost and rightmost corners
 * in view, and the eyes and the pair's horizontal right they were laid out
 * for. The debug panel places itself outside them -- beyond the card on the
 * right, beyond the column on the left -- from that same head pose, never
 * from wherever the head is now. Written and read only behind
 * `import.meta.env.DEV` and the `debug` flag; world coordinates.
 */
export const devLayout = {
  left: { x: 0, y: 0, z: 0 },
  right: { x: 0, y: 0, z: 0 },
  /** The eyes, and the pair's horizontal right (unit), at that layout. */
  head: { x: 0, y: 0, z: 0 },
  rightAxis: { x: 1, y: 0, z: 0 },
  /** The element each point belongs to (for the panel's placement line). */
  leftName: '',
  rightName: '',
  /** Bumped on every changed layout (0: none yet). */
  version: 0,
};
