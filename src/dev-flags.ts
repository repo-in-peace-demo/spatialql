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
export function installDevFlagHotkeys(): void {
  if (!import.meta.env.DEV) {
    return;
  }
  const states = ALL_FLAGS.map((flag) => `${flag}=${devFlag(flag) ? 'on' : 'off'}`).join(', ');
  console.info(`${LOG_PREFIX} ${states}. Toggle with Option+Shift+D / S / F / M (Alt+Shift on Windows/Linux).`);

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
