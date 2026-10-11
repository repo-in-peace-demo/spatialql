/**
 * The display rate a session asks for, kept pure (no IWSDK imports) so it's
 * tested in Node. 72 Hz gives a 13.9 ms budget. 80 Hz (12.5 ms) was tried:
 * the 2026-10-12 headset session held it for about a minute, then frames
 * averaged 14-16 ms as per-frame work rose to 10-11 ms (see docs/STATUS.md);
 * back to 72 Hz until that's understood. `?hz=` (dev) still asks for another.
 */

export const PREFERRED_FRAME_RATE_HZ = 72;

/**
 * The rate to ask for: `preferred` if offered; else the highest offered rate
 * below it (never a faster one than asked); null if none is (or none are
 * listed): then the browser's own rate stays.
 */
export function chooseFrameRate(offered: readonly number[], preferred = PREFERRED_FRAME_RATE_HZ): number | null {
  if (offered.includes(preferred)) {
    return preferred;
  }
  let best: number | null = null;
  for (const rate of offered) {
    if (rate < preferred && (best === null || rate > best)) {
      best = rate;
    }
  }
  return best;
}
