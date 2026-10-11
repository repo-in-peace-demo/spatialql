/**
 * Dev-only feature flags: `debug`, `seated`, `forceSurface`, `mute`.
 *
 * Read from the URL query first (`?debug=1`; `?debug=0` turns it off), then
 * from `localStorage` (`spatialql.debug = '1'`), so they also work in the
 * CLI-managed browser window, which has no address bar. `devFlag()` returns
 * false outside `import.meta.env.DEV`, so production builds never read them.
 *
 * `installDevFlagHotkeys()` toggles the stored value with Option+Shift+D / S /
 * F / M (Alt+Shift on Windows/Linux) and reloads. It matches physical keys
 * (`event.code`), because Option+Shift+letter types a special character on
 * macOS.
 */

export type DevFlag = 'debug' | 'seated' | 'forceSurface' | 'mute';

export const DEV_FLAG_STORAGE_PREFIX = 'spatialql.';

const LOG_PREFIX = '[dev flags]';
const ALL_FLAGS: readonly DevFlag[] = ['debug', 'seated', 'forceSurface', 'mute'];
const HOTKEY_CODES: Record<string, DevFlag> = {
  KeyD: 'debug',
  KeyS: 'seated',
  KeyF: 'forceSurface',
  KeyM: 'mute',
};

type ReadableStorage = Pick<Storage, 'getItem'>;

/**
 * Pure resolution rule: a flag present in the query decides by its value
 * (`0`, `false` or `off` mean off; anything else, including an empty value,
 * means on); otherwise the stored value must be exactly `'1'`.
 */
export function resolveDevFlag(name: DevFlag, search: string, storage: ReadableStorage | null): boolean {
  const params = new URLSearchParams(search);
  if (params.has(name)) {
    const value = (params.get(name) ?? '').trim().toLowerCase();
    return value !== '0' && value !== 'false' && value !== 'off';
  }
  try {
    return storage?.getItem(DEV_FLAG_STORAGE_PREFIX + name) === '1';
  } catch {
    return false;
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function devFlag(name: DevFlag): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }
  return resolveDevFlag(name, window.location.search, safeLocalStorage());
}

/** Dev-only: logs the effective flags and installs the toggle hotkeys. */
/**
 * Dev only: the stored day (`spatialql.day`, read like `?day=`; the managed
 * browser window has no address bar): Option+Shift+Right one day on,
 * Option+Shift+Up a week on, Option+Shift+0 back to the real date. Each reloads.
 */
const DAY_HOTKEYS: Record<string, number> = { ArrowRight: 1, ArrowUp: 7, Digit0: 0 };
const DAY_STORAGE_KEY = `${DEV_FLAG_STORAGE_PREFIX}day`;

function shiftDevDay(storage: Storage, days: number): void {
  const base = storage.getItem(DAY_STORAGE_KEY) ?? new Date().toLocaleDateString('en-CA');
  const [y, m, d] = base.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  try {
    if (days === 0) {
      storage.removeItem(DAY_STORAGE_KEY);
    } else {
      storage.setItem(DAY_STORAGE_KEY, next);
    }
  } catch {
    console.warn(`${LOG_PREFIX} couldn't write localStorage; the day is unchanged.`);
    return;
  }
  console.info(`${LOG_PREFIX} day ${days === 0 ? 'back to the real date' : `now ${next}`}; reloading.`);
  window.location.reload();
}

export function installDevFlagHotkeys(): void {
  if (!import.meta.env.DEV) {
    return;
  }
  const states = ALL_FLAGS.map((flag) => `${flag}=${devFlag(flag) ? 'on' : 'off'}`).join(', ');
  console.info(`${LOG_PREFIX} ${states}. Toggle with Option+Shift+D / S / F / M (Alt+Shift on Windows/Linux); the day: Option+Shift+Right / Up / 0.`);

  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.repeat) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      return;
    }
    const flag = HOTKEY_CODES[event.code];
    const storage = safeLocalStorage();
    if (storage && DAY_HOTKEYS[event.code] !== undefined) {
      event.preventDefault();
      shiftDevDay(storage, DAY_HOTKEYS[event.code]);
      return;
    }
    if (!flag || !storage) {
      return;
    }
    event.preventDefault();
    const key = DEV_FLAG_STORAGE_PREFIX + flag;
    const next = storage.getItem(key) !== '1';
    try {
      if (next) {
        storage.setItem(key, '1');
      } else {
        storage.removeItem(key);
      }
    } catch {
      console.warn(`${LOG_PREFIX} couldn't write localStorage; ${flag} unchanged.`);
      return;
    }
    if (new URLSearchParams(window.location.search).has(flag)) {
      console.warn(`${LOG_PREFIX} stored ${flag}=${next ? 'on' : 'off'}, but the URL's ?${flag} takes precedence.`);
    }
    console.info(`${LOG_PREFIX} stored ${flag}=${next ? 'on' : 'off'}; reloading.`);
    window.location.reload();
  });
}
