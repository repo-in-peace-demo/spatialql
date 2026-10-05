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
export const PLANNED_SOURCE_DISTANCE_METERS = 0.55;
// Measured at join in the emulator (seated, desk); 0.65 m gave 1.33° text.
export const PLANNED_RESULT_DISTANCE_METERS = 0.56;
export const PLANNED_CONTROL_DISTANCE_METERS = 0.45;
/** Challenge mode's puzzle card, just above the result slot (view only). */
export const PLANNED_CARD_DISTANCE_METERS = 0.6;

/** Physical font size (cm) that subtends `angleDeg` at `distance` meters. */
export function fontCmForAngle(angleDeg: number, distance: number): number {
  return 2 * distance * Math.tan((angleDeg * Math.PI) / 180 / 2) * 100;
}

/** Row and header font sizes (cm) for a slab `distance` meters from the eyes. */
export function slabTextSizeAt(distance: number): { rowFontCm: number; headerFontCm: number } {
  const rowFontCm = Math.max(MIN_ROW_FONT_CM, fontCmForAngle(ROW_TEXT_TARGET_DEG, distance));
  return { rowFontCm, headerFontCm: Math.max(rowFontCm, fontCmForAngle(HEADER_TEXT_TARGET_DEG, distance)) };
}
