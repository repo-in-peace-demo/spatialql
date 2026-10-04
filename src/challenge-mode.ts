/**
 * Whether this page runs challenge mode (puzzles) or the free-play sandbox.
 *
 * - Production: the sandbox, unless the URL has `?challenge=1`. This is a
 *   real (not dev-only) switch, so challenge mode can be tested from the
 *   deployed build on a headset.
 * - Dev: challenge mode, unless `?mode=free` (or `?challenge=0`), or
 *   `localStorage['spatialql.mode'] = 'free'` for the managed browser window,
 *   which has no address bar.
 *
 * Read once at startup.
 */

function resolveChallengeMode(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (import.meta.env.DEV) {
      if (params.get('mode') === 'free' || params.get('challenge') === '0') {
        return false;
      }
      if (params.has('mode') || params.has('challenge')) {
        return true;
      }
      try {
        return window.localStorage.getItem('spatialql.mode') !== 'free';
      } catch {
        return true;
      }
    }
    return params.get('challenge') === '1';
  } catch {
    return false;
  }
}

export const CHALLENGE_MODE = resolveChallengeMode();
