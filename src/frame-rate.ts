/**
 * The display rate a session asks for, kept pure (no IWSDK imports) so it's
 * tested in Node. 80 Hz gives a 12.5 ms budget: the 2026-10-11 headset logs
 * measured joined frames' work at p50 9.4 ms, p95 12.4 ms (inside it, if
 * only just), where 90 Hz (11.1 ms) would miss and 72 Hz (13.9 ms) leaves
 * motion less smooth than it needs to be.
 */

export const PREFERRED_FRAME_RATE_HZ = 80;

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
