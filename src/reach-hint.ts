/**
 * The reach hint ("Move closer, or hold Recenter."), kept pure (no IWSDK
 * imports) so it's tested in Node. It's about the player's reach, not the
 * desk: it shows once the nearest control is beyond REACH_HINT_CONTROL_METERS
 * from the nearer shoulder, or the nearer source slab beyond
 * REACH_HINT_SLAB_METERS from the eyes, for REACH_HINT_SUSTAIN_SECONDS (a
 * brief lean back doesn't show it); it hides once both are back within their
 * limits less REACH_HINT_HYSTERESIS_METERS, or at once on a Recenter. Measured
 * from the head and shoulders, so it works the same seated or standing.
 *
 * Placement-time distances in four headset sessions (2026-10-09): controls
 * 0.45-0.54 m from the nearer shoulder, slabs 0.62-0.76 m from the eyes.
 */

export const REACH_HINT_CONTROL_METERS = 0.65;
export const REACH_HINT_SLAB_METERS = 0.9;
export const REACH_HINT_SUSTAIN_SECONDS = 2;
export const REACH_HINT_HYSTERESIS_METERS = 0.05;

/** What a measurement did: nothing, show the hint, or hide it. */
export type ReachHintStep = 'none' | 'show' | 'hide';

export class ReachHint {
  shown = false;
  /** Seconds either limit has been exceeded, continuously. */
  private beyondFor = 0;

  /** A Recenter (or a new session): hidden, the timer reset. Returns 'hide' if it was shown. */
  reset(): ReachHintStep {
    const was = this.shown;
    this.shown = false;
    this.beyondFor = 0;
    return was ? 'hide' : 'none';
  }

  /**
   * One measurement, `dt` seconds after the last: the nearest control's
   * distance from the nearer shoulder and the nearer slab's from the eyes
   * (meters; Infinity when there's none to measure).
   */
  step(dt: number, controlMeters: number, slabMeters: number): ReachHintStep {
    if (!this.shown) {
      const beyond = controlMeters > REACH_HINT_CONTROL_METERS || slabMeters > REACH_HINT_SLAB_METERS;
      this.beyondFor = beyond ? this.beyondFor + dt : 0;
      if (this.beyondFor >= REACH_HINT_SUSTAIN_SECONDS - 1e-9) {
        this.shown = true;
        return 'show';
      }
      return 'none';
    }
    const back =
      controlMeters <= REACH_HINT_CONTROL_METERS - REACH_HINT_HYSTERESIS_METERS &&
      slabMeters <= REACH_HINT_SLAB_METERS - REACH_HINT_HYSTERESIS_METERS;
    if (back) {
      this.shown = false;
      this.beyondFor = 0;
      return 'hide';
    }
    return 'none';
  }

  /** Seconds the limits have been exceeded (for the log). */
  get exceededFor(): number {
    return this.beyondFor;
  }
}
