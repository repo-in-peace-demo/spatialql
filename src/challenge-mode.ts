/**
 * Whether this page runs challenge mode (puzzles) or the free-play sandbox.
 *
 * Free play is DORMANT: removed from the product for now (no button), and
 * production always runs challenge mode, whatever the address says. The code
 * stays so it's easy to bring back. In dev only, `?mode=free` (or
 * `?challenge=0`) opens it, as does `localStorage['spatialql.mode'] = 'free'`
 * for the managed browser window, which has no address bar (the URL wins);
 * its Puzzles button reloads without it.
 *
 * Read once at startup: both modes build their slab documents at startup.
 */

export const MODE_PARAM = 'mode';
export const MODE_FREE = 'free';

function resolveChallengeMode(): boolean {
  if (!import.meta.env.DEV) {
    return true;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get(MODE_PARAM) === MODE_FREE || params.get('challenge') === '0') {
      return false;
    }
    if (params.has(MODE_PARAM) || params.has('challenge')) {
      return true;
    }
    try {
      return window.localStorage.getItem('spatialql.mode') !== MODE_FREE;
    } catch {
      return true;
    }
  } catch {
    return true;
  }
}

export const CHALLENGE_MODE = resolveChallengeMode();

/**
 * Reloads the page in the other mode, keeping its other query parameters:
 * free play adds `mode=free` (dev only: production ignores it); back to
 * puzzles removes the mode parameters.
 */
export function reloadInMode(freePlay: boolean): void {
  const params = new URLSearchParams(window.location.search);
  params.delete('challenge');
  if (freePlay) {
    params.set(MODE_PARAM, MODE_FREE);
  } else {
    params.delete(MODE_PARAM);
    // Dev: a stored `spatialql.mode = 'free'` would otherwise keep the sandbox.
    if (import.meta.env.DEV) {
      try {
        if (window.localStorage.getItem('spatialql.mode') === MODE_FREE) {
          params.set(MODE_PARAM, 'puzzles');
        }
      } catch {
        // No storage: nothing stored to override.
      }
    }
  }
  const query = params.toString();
  window.location.search = query ? `?${query}` : '';
}
