/**
 * Dev-only (`?debug=1`): sends the debug output to the dev server, which
 * appends it to a file under `logs/` (see the `spatialql-debug-logs` plugin
 * in vite.config.ts): `headset-<date>-<time>.log` from the Quest Browser,
 * `desktop-<date>-<time>.log` otherwise, one file per page load.
 *
 * - Lines are complete (never cut like the in-headset panel's), with the
 *   time each was logged.
 * - Batched: sent every SEND_INTERVAL_MS, or sooner once SEND_BATCH_LINES
 *   are waiting; one request in flight at a time; `sendBeacon` when the
 *   page is hidden.
 * - Best effort: a failed request drops its batch silently (no retries), and
 *   the buffer is capped at MAX_BUFFERED_LINES (the oldest go first; the
 *   file then says how many were dropped).
 *
 * Only imported by debug-hud.ts, which is loaded behind
 * `import.meta.env.DEV`, so none of this ships.
 */

const ENDPOINT = '/__spatialql/log';
/** The dev server's code stamp (a hash of src/): fetched once at page load, it names the code this page runs. */
const CODE_ENDPOINT = '/__spatialql/code';
const SEND_INTERVAL_MS = 1000;
const SEND_BATCH_LINES = 50;
const MAX_BUFFERED_LINES = 500;

export type SinkKind = 'info' | 'warn' | 'error';
type SinkLine = { t: number; kind: SinkKind; text: string };

/**
 * A real Quest Browser: its user agent, on the dev server's network address.
 * The emulator (IWER) also reports an OculusBrowser user agent, but it only
 * runs on localhost (its `activation`), while the headset reaches the Mac
 * over Wi-Fi. (A headset on localhost through ADB reverse counts as desktop.)
 */
const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const isHeadset = /OculusBrowser/.test(navigator.userAgent) && !isLocalHost;

const session = {
  id: Math.random().toString(36).slice(2, 12).padEnd(10, '0'),
  device: isHeadset ? 'headset' : 'desktop',
  headerSent: false,
  fileAnnounced: false,
  /** The code this page loaded (the server's stamp at load), and when. */
  codeStamp: 'unknown',
  loadedAt: new Date().toISOString(),
  staleWarned: false,
};
let buffer: SinkLine[] = [];
let dropped = 0;
let inFlight = false;
let started = false;

/** Queues one complete line (any number of text lines) for the log file. */
export function logToFile(kind: SinkKind, text: string): void {
  if (buffer.length >= MAX_BUFFERED_LINES) {
    buffer.shift();
    dropped++;
  }
  buffer.push({ t: Date.now(), kind, text });
  if (buffer.length >= SEND_BATCH_LINES) {
    flush();
  }
}

/** The page's side of the file header: device, user agent, URL and the dev flags. */
function header(): Record<string, string> {
  let flags = '';
  try {
    const stored = Object.keys(localStorage)
      .filter((key) => key.startsWith('spatialql.') && !key.startsWith('spatialql.progress'))
      .map((key) => `${key}=${localStorage.getItem(key)}`);
    flags = stored.join(', ');
  } catch {
    flags = '(localStorage unavailable)';
  }
  return {
    device: `${session.device} (${isHeadset ? 'Quest Browser on the network address' : isLocalHost ? 'localhost: the emulator or a desktop browser' : 'not the Quest Browser'})`,
    'user agent': navigator.userAgent,
    url: location.href,
    'stored flags': flags || '(none)',
    'page code': `${session.codeStamp} (page loaded ${session.loadedAt})`,
    'reference space': "logged once a session starts ('reference space in use')",
  };
}

function takeBatch(): string | null {
  if (buffer.length === 0 && dropped === 0 && session.headerSent) {
    return null;
  }
  const lines = buffer;
  buffer = [];
  if (dropped > 0) {
    lines.unshift({ t: Date.now(), kind: 'warn', text: `(${dropped} lines dropped: the log buffer was full)` });
    dropped = 0;
  }
  const body = {
    id: session.id,
    device: session.device,
    code: session.codeStamp,
    loadedAt: session.loadedAt,
    header: session.headerSent ? null : header(),
    lines,
  };
  session.headerSent = true;
  return JSON.stringify(body);
}

function flush(): void {
  if (inFlight) {
    return;
  }
  const body = takeBatch();
  if (body === null) {
    return;
  }
  inFlight = true;
  fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true })
    .then(async (response) => {
      if (!response.ok) {
        return;
      }
      const { file, serverCode } = (await response.json()) as { file?: string; serverCode?: string };
      // Say once where this page's log goes (it shows on the panel, too).
      if (!session.fileAnnounced && file) {
        session.fileAnnounced = true;
        console.info(`[HUD] debug log: ${file}`);
      }
      // The dev server has newer code than this page runs (a tab left open across changes): say so, once.
      if (!session.staleWarned && serverCode && session.codeStamp !== 'unknown' && serverCode !== session.codeStamp) {
        session.staleWarned = true;
        console.warn(
          `[HUD] STALE PAGE: this page runs code ${session.codeStamp} (loaded ${session.loadedAt}); the dev server has ${serverCode}. Reload this tab.`,
        );
      }
    })
    .catch(() => {
      // Unreachable (e.g. the dev server stopped): this batch is dropped, by design.
    })
    .finally(() => {
      inFlight = false;
    });
}

/** Starts the timer and the page-hide flush (idempotent). */
export function startLogSink(): void {
  if (started) {
    return;
  }
  started = true;
  // The code this page runs: the server's stamp now (the page has just loaded
  // it), and again after a hot update (it then runs the updated modules).
  const readStamp = (why: string) =>
    fetch(CODE_ENDPOINT)
      .then(async (response) => {
        if (response.ok) {
          const { code } = (await response.json()) as { code?: string };
          if (code) {
            session.codeStamp = code;
            session.staleWarned = false;
            console.info(`[HUD] code ${code} (${why})`);
          }
        }
      })
      .catch(() => {
        // No stamp: staleness can't be told; the log still works.
      });
  void readStamp(`page loaded ${session.loadedAt}`);
  import.meta.hot?.on('vite:afterUpdate', () => void readStamp('after a hot update'));
  setInterval(flush, SEND_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      const body = takeBatch();
      if (body !== null) {
        try {
          navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
        } catch {
          // Best effort.
        }
      }
    }
  });
}

/** Formats console arguments completely (for the file, unlike the panel's first line). */
export function formatArgs(args: readonly unknown[]): string {
  return args.map(formatArg).join(' ');
}

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') {
    return arg;
  }
  if (arg instanceof Error) {
    return arg.stack ?? `${arg.name}: ${arg.message}`;
  }
  if (arg === null || typeof arg !== 'object') {
    return String(arg);
  }
  try {
    const json = JSON.stringify(arg);
    return json.length > 2000 ? `${json.slice(0, 2000)}... (${json.length} chars)` : json;
  } catch {
    return `[${(arg as object).constructor?.name ?? 'object'}]`;
  }
}

/** A `console.table` argument as text lines: one per row, `column=value` pairs. */
export function formatTable(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return formatArg(data);
  }
  const rows = Array.isArray(data) ? data : Object.values(data as object);
  return rows
    .map((row, index) =>
      row && typeof row === 'object'
        ? `  [${index}] ${Object.entries(row as object)
            .map(([key, value]) => `${key}=${formatArg(value)}`)
            .join(', ')}`
        : `  [${index}] ${formatArg(row)}`,
    )
    .join('\n');
}
