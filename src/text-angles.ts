/**
 * Text sized by angle: the angular targets, the planned eye distances the
 * fonts are sized for, and the conversion. Pure (no IWSDK imports), so the
 * data-layer tests can check that every cell fits its column at the sizes
 * the app really uses. `view-comfort.ts` re-exports all of this.
 */

/** Row text should subtend this many degrees. Tune on a headset. */
export const ROW_TEXT_TARGET_DEG = 1.15;
/** Header text should subtend this many degrees. */
export const HEADER_TEXT_TARGET_DEG = 1.3;
/** Row text is never physically smaller than this (cm). */
export const MIN_ROW_FONT_CM = 0.9;
/**
 * Planned eye distances the fonts are sized for: computed once at startup
 * (slab documents aren't rebuilt when placed). The placement and join
 * readouts log the actual distance and resulting angle.
 */
// The slabs' home (SLAB_VIEW_DISTANCE_METERS): 0.6 m since 2026-10-12 (the
// player kept pulling them to 0.50-0.63 m before joining, and each switch's
// glide home to 0.7 m felt like the group backing away); text keeps its
// angle, so it's a little smaller physically (rows 1.20 cm, from 1.41).
export const PLANNED_SOURCE_DISTANCE_METERS = 0.6;
/**
 * The result slab follows the pair, above it and set back behind it (with
 * the controls moved to the side column, it no longer sits right over a
 * band; at 0.72 m it felt too close).
 */
export const PLANNED_RESULT_DISTANCE_METERS = 0.85;
/** The side column (INNER | LEFT, the puzzle bar): poked and pinched, so within near reach (it sits at 0.48 m). */
export const PLANNED_CONTROL_DISTANCE_METERS = 0.5;
/**
 * Challenge mode's puzzle card, on an arc beside the result slot (view only),
 * at the result's depth: behind the slabs, so a hand reaching for one never
 * passes through it (at 0.75 m its bottom edge sat at the right slab's top
 * edge, 2 cm above it: 2026-10-10 log). Its text is sized by angle, so it
 * looks the same.
 */
export const PLANNED_CARD_DISTANCE_METERS = 0.85;
/**
 * The card's own text targets: larger than the slabs', since it sits well
 * off-axis beside the result (the headset's lenses are least sharp there).
 */
export const CARD_ROW_TEXT_TARGET_DEG = 1.3;
export const CARD_GOAL_TEXT_TARGET_DEG = 1.45;

/** Physical font size (cm) that subtends `angleDeg` at `distance` meters. */
export function fontCmForAngle(angleDeg: number, distance: number): number {
  return 2 * distance * Math.tan((angleDeg * Math.PI) / 180 / 2) * 100;
}

/** Row and header font sizes (cm) for a slab `distance` meters from the eyes. */
export function slabTextSizeAt(distance: number): { rowFontCm: number; headerFontCm: number } {
  const rowFontCm = Math.max(MIN_ROW_FONT_CM, fontCmForAngle(ROW_TEXT_TARGET_DEG, distance));
  return { rowFontCm, headerFontCm: Math.max(rowFontCm, fontCmForAngle(HEADER_TEXT_TARGET_DEG, distance)) };
}
