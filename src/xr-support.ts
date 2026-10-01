/**
 * Browser support notices, shown outside the 3D scene (plain DOM over the
 * page) so they work even where WebXR doesn't:
 *
 * - No immersive AR (desktop browsers, browsers without WebXR): a short
 *   full-page message pointing to the Meta Quest Browser.
 * - Immersive AR but not the Quest Browser (e.g. Chrome on an Android
 *   phone, where AR works but hand interaction can't): a small dismissible
 *   "Best on Meta Quest Browser" note.
 *
 * The scene and its Enter XR panel stay untouched underneath. In dev the
 * emulator (IWER) provides immersive AR, and the Quest-browser note is
 * skipped because the emulator stands in for a Quest.
 */

const NOTICE_ID = 'spatialql-xr-notice';

/** Whether this is the Meta Quest Browser. Adjust detection here only. */
export function isQuestBrowser(userAgent: string = navigator.userAgent): boolean {
  return /OculusBrowser/i.test(userAgent);
}

type XrLike = { isSessionSupported?: (mode: string) => Promise<boolean> };

/** Whether the browser can start an immersive AR session (what SpatialQL uses). */
export async function supportsImmersiveAr(): Promise<boolean> {
  const xr = (navigator as unknown as { xr?: XrLike }).xr;
  if (!xr?.isSessionSupported) {
    return false;
  }
  try {
    return await xr.isSessionSupported('immersive-ar');
  } catch {
    return false;
  }
}

/** Checks support once at startup and shows the matching notice, if any. */
export async function installXrSupportNotice(): Promise<void> {
  if (await supportsImmersiveAr()) {
    if (!import.meta.env.DEV && !isQuestBrowser()) {
      showQuestBrowserNote();
    }
    return;
  }
  showUnsupportedMessage();
}

function showUnsupportedMessage(): void {
  const overlay = document.createElement('div');
  overlay.id = NOTICE_ID;
  overlay.setAttribute('role', 'alert');
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '1000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    background: 'rgba(20, 20, 20, 0.72)',
    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
  });

  const card = document.createElement('div');
  Object.assign(card.style, {
    maxWidth: '420px',
    padding: '24px',
    borderRadius: '12px',
    background: '#f5f3ef',
    color: '#1c1c1c',
    lineHeight: '1.45',
    textAlign: 'center',
  });

  const title = document.createElement('h1');
  title.textContent = 'SpatialQL';
  Object.assign(title.style, { margin: '0 0 8px', fontSize: '22px' });

  const body = document.createElement('p');
  body.textContent =
    'SpatialQL is a mixed-reality app. Open this link in the Meta Quest Browser to try it.';
  Object.assign(body.style, { margin: '0 0 16px', fontSize: '16px' });

  const url = document.createElement('code');
  url.textContent = `${location.origin}${location.pathname}`;
  Object.assign(url.style, {
    display: 'block',
    padding: '8px',
    borderRadius: '6px',
    background: '#e2ddd0',
    fontSize: '14px',
    wordBreak: 'break-all',
    userSelect: 'all',
  });

  card.append(title, body, url);
  overlay.append(card);
  document.body.append(overlay);
}

function showQuestBrowserNote(): void {
  const note = document.createElement('div');
  note.id = NOTICE_ID;
  note.setAttribute('role', 'status');
  Object.assign(note.style, {
    position: 'fixed',
    top: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '1000',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    maxWidth: 'calc(100% - 32px)',
    padding: '8px 10px 8px 14px',
    borderRadius: '999px',
    background: '#2f2b24',
    color: '#f5f3ef',
    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
    fontSize: '14px',
  });

  const text = document.createElement('span');
  text.textContent = 'Best on Meta Quest Browser';

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Dismiss');
  Object.assign(close.style, {
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    fontSize: '18px',
    lineHeight: '1',
    cursor: 'pointer',
    padding: '0 4px',
  });
  close.addEventListener('click', () => note.remove(), { once: true });

  note.append(text, close);
  document.body.append(note);
}
