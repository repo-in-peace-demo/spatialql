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
// The group sits back, out of the near field (headset logs of 2026-10-07:
// players leaned back, or pushed the slabs to 0.60-0.70 m themselves); the
// slabs are grabbed by ray from there, and only the side column (control,
// bar) stays within near reach.
export const PLANNED_SOURCE_DISTANCE_METERS = 0.7;
/**
 * The result slab follows the pair, above it and set back behind it (with
 * the controls moved to the side column, it no longer sits right over a
 * band; at 0.72 m it felt too close).
 */
export const PLANNED_RESULT_DISTANCE_METERS = 0.85;
/** The side column (INNER | LEFT, the puzzle bar): poked and pinched, so within near reach (it sits at 0.48 m). */
export const PLANNED_CONTROL_DISTANCE_METERS = 0.5;
/** Challenge mode's puzzle card, on an arc beside the result slot (view only). */
export const PLANNED_CARD_DISTANCE_METERS = 0.75;
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
