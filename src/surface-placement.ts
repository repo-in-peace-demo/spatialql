/**
 * Where the slabs go when a surface (a desk) was found: the rule, kept pure
 * (no IWSDK imports) so it's tested in Node. Reach wins over the surface:
 *
 * - **on-surface:** the surface's near edge is within reach: the slabs rest
 *   on it (bottom edges on the surface, clamped into its footprint).
 * - **desk-edge:** the near edge is beyond reach, but by at most
 *   DESK_EDGE_BEYOND_REACH_MAX_METERS: the slabs sit at reach distance at the
 *   desk's height, just in front of its edge. That close, it reads as "at
 *   the desk" in passthrough.
 * - **floating:** the surface is farther than that: the normal floating
 *   placement. Slabs hovering at desk height well in front of a desk look
 *   wrong.
 *
 * Distances are horizontal, from the eyes to the slabs' bottom-edge line
 * along the viewing direction.
 */

/** How far beyond reach a surface's near edge may be for the slabs to sit at its edge (at reach). */
export const DESK_EDGE_BEYOND_REACH_MAX_METERS = 0.12;

export type SurfacePlacementCase = 'on-surface' | 'desk-edge' | 'floating';

/**
 * `surfaceForward`: where the bottom-edge line would be on the surface (after
 * clamping into its footprint). `reachForward`: the farthest the line can be
 * with every slab's center within reach.
 */
export function surfacePlacementCase(surfaceForward: number, reachForward: number): SurfacePlacementCase {
  const beyond = surfaceForward - reachForward;
  if (beyond <= 1e-3) {
    return 'on-surface';
  }
  return beyond <= DESK_EDGE_BEYOND_REACH_MAX_METERS ? 'desk-edge' : 'floating';
}
