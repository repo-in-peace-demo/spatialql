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
 * Both share the welcome page's look (welcome.css); the welcome page stays
 * underneath. In dev the emulator (IWER) provides immersive AR, and the
 * Quest-browser note is skipped because the emulator stands in for a Quest.
 */

import './welcome.css';
import { BROWSER_NOTICE, WELCOME } from './data/copy.js';
import { WELCOME_MARK_SVG } from './welcome-icons.js';

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

/** A full page in the welcome page's look, over it: SpatialQL can't run in this browser. */
function showUnsupportedMessage(): void {
  const overlay = document.createElement('div');
  overlay.id = NOTICE_ID;
  overlay.className = 'wl-root';
  overlay.style.zIndex = '1000';
  overlay.setAttribute('role', 'alert');

  const card = document.createElement('main');
  card.className = 'wl-card wl-message';
  const brand = document.createElement('div');
  brand.className = 'wl-brandrow';
  brand.innerHTML = WELCOME_MARK_SVG;
  const title = document.createElement('h1');
  title.className = 'wl-title';
  title.textContent = WELCOME.title;
  brand.append(title);

  const lead = document.createElement('p');
  lead.className = 'wl-lead';
  lead.textContent = BROWSER_NOTICE.unsupportedLead;
  const body = document.createElement('p');
  body.textContent = BROWSER_NOTICE.unsupportedBody;
  const url = document.createElement('p');
  url.className = 'wl-url';
  url.textContent = `${location.origin}${location.pathname}`;
  url.style.userSelect = 'all';

  card.append(brand, lead, body, url);
  overlay.append(card);
  document.body.append(overlay);
}

/** A small dismissible note, in the welcome page's look, along the bottom. */
function showQuestBrowserNote(): void {
  const note = document.createElement('div');
  note.id = NOTICE_ID;
  note.className = 'wl-note';
  note.setAttribute('role', 'status');

  const text = document.createElement('span');
  text.textContent = BROWSER_NOTICE.questNote;

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = BROWSER_NOTICE.dismiss;
  close.addEventListener('click', () => note.remove(), { once: true });

  note.append(text, close);
  document.body.append(note);
}
