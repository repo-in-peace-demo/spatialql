/**
 * Press feedback for a touch target: on a press it dips (shrinks to
 * PRESS_DIP_SCALE for PRESS_DIP_SECONDS, then springs back), with the click
 * the caller plays, so a poke is seen and heard at the surface. Works on any
 * UIKit container (a column button, a picker tile, an INNER | LEFT option, a
 * NULL cell's outline). A few fixed slots, no allocation per frame.
 */

type Scalable = { setProperties(properties: object): void };

export const PRESS_DIP_SCALE = 0.93;
export const PRESS_DIP_SECONDS = 0.12;
const SLOTS = 4;

export class PressDips {
  private readonly targets: (Scalable | null)[] = new Array<Scalable | null>(SLOTS).fill(null);
  private readonly until = new Float64Array(SLOTS);

  /** Dips `target` now (`now`: the caller's clock, seconds); a repeat restarts it. */
  dip(target: Scalable | null, now: number): void {
    if (!target) {
      return;
    }
    let slot = this.targets.indexOf(target);
    if (slot < 0) {
      slot = this.targets.indexOf(null);
    }
    if (slot < 0) {
      // All busy: the one ending soonest gives way.
      slot = 0;
      for (let i = 1; i < SLOTS; i++) {
        if (this.until[i] < this.until[slot]) {
          slot = i;
        }
      }
      this.targets[slot]?.setProperties({ transformScaleX: 1, transformScaleY: 1 });
    }
    this.targets[slot] = target;
    this.until[slot] = now + PRESS_DIP_SECONDS;
    target.setProperties({ transformScaleX: PRESS_DIP_SCALE, transformScaleY: PRESS_DIP_SCALE });
  }

  /** Each frame: springs back what has dipped long enough. */
  update(now: number): void {
    for (let i = 0; i < SLOTS; i++) {
      const target = this.targets[i];
      if (target && now >= this.until[i]) {
        target.setProperties({ transformScaleX: 1, transformScaleY: 1 });
        this.targets[i] = null;
      }
    }
  }
}
