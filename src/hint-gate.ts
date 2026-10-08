/**
 * The Hint button's press gate, kept pure (no IWSDK imports) so it's tested
 * in Node. A headset log had a resting hand's flickering pinch press Hint
 * three times in a second, all the way to the answer. So hints come at most
 * one per press, presses at least HINT_PRESS_GAP_SECONDS apart (closer ones
 * are ignored); and the press that would reveal the answer is a hold instead
 * (SHOW_ANSWER_HOLD_SECONDS, timed by the join system like Exit's).
 */

export const HINT_PRESS_GAP_SECONDS = 0.8;
/** Show answer (before the answer) acts only when held this long, with a ring filling. */
export const SHOW_ANSWER_HOLD_SECONDS = 0.8;

/** What a Hint press does: nothing (too soon), or the next hint. */
export type HintPress = 'ignored' | 'hint';

export class HintGate {
  private lastPressAt = -Infinity;

  reset(): void {
    this.lastPressAt = -Infinity;
  }

  /** A press at `now`. */
  press(now: number): HintPress {
    if (now - this.lastPressAt < HINT_PRESS_GAP_SECONDS) {
      return 'ignored';
    }
    this.lastPressAt = now;
    return 'hint';
  }

  /** A hint shown another way (the answer's hold): the next press waits as after a press. */
  pressed(now: number): void {
    this.lastPressAt = now;
  }
}
