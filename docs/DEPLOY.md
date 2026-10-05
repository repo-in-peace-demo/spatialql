# Deploying SpatialQL

SpatialQL is a static Vite build (`dist/`), so any static HTTPS host works.
This guide uses **Vercel**: it detects Vite with no configuration, serves over
HTTPS (WebXR requires it), and redeploys on every push.

The goal is a public link that opens in the **Meta Quest Browser**. People tap
Enter XR and use their real hands and passthrough. No dev flags apply in
production.

## What's in a production build

`npm run build` writes `dist/`. Dev-only code is not included:

| Dev-only | How it's excluded |
| --- | --- |
| The XR emulator (IWER) | Injected by the dev server only, never imported by app code |
| Dev flags `debug` / `seated` / `forceSurface`, their `localStorage` reads and the Option+Shift hotkeys | `devFlag()` returns `false` and the hotkeys never install when `import.meta.env.DEV` is false |
| Grab readout, seated head | Dynamically imported only inside `import.meta.env.DEV` checks |
| Placement and join readouts, outlines, J / Shift+J / T / U / R keys | Only constructed when `import.meta.env.DEV` and the `debug` flag are on |
| Challenge mode's readouts and keys: H / F / N / P / I, G (apply the solution) and X (apply the wrong state) | `ChallengeDebug`, only constructed when `import.meta.env.DEV` and the `debug` flag are on |
| Challenge `?resetProgress`, `?puzzle=` and `?day=`, and the start-choice readout | Read or logged only inside `import.meta.env.DEV` checks |
| The `[Slab]` truncation warning | Inside an `import.meta.env.DEV` check |
| The in-headset debug panel (`src/debug-hud.ts`): console tap, frame-time line, swap button, `debugSide` | Dynamically imported only inside an `import.meta.env.DEV` check, with the `debug` flag on |

Challenge mode itself ships, and is the default: the puzzles, the daily
puzzle and its streak. The welcome screen's **Free play** button reloads the
page in the sandbox (`?mode=free`), and its **Puzzles** button reloads back.
Challenge mode's `?day=` override is dev-only.

Vite sets `import.meta.env.DEV` to `false` in a production build, so the bundler
can remove all of this. To confirm it did, see "Verify the build locally" below.

Other production facts:

- **Asset paths:** `vite.config.ts` uses `base: './'` and `src/assets.ts` builds
  URLs from `import.meta.env.BASE_URL`, so the app works from a domain root
  (and from a subpath).
- **XR features:** come from `iwsdk.config.json` in dev and production alike:
  immersive AR (passthrough), hand tracking, anchors, plane and mesh detection,
  hit test.
- **No `vercel.json` needed.** Vercel's Vite defaults (build `npm run build`,
  output `dist`) are correct, there's no client-side routing to rewrite, and
  WebXR needs no extra headers. It needs HTTPS, which Vercel provides, and
  `xr-spatial-tracking` is allowed for the top-level page by default. A
  `Permissions-Policy` header would only matter if the app were embedded in
  an iframe.
- **Browsers without immersive AR** (desktop browsers, most phones) show a
  short message: "SpatialQL is a mixed-reality app. Open this link in the
  Meta Quest Browser to try it." Browsers that support AR but aren't the
  Quest Browser (for example Chrome on an Android phone) show a small
  dismissible "Best on Meta Quest Browser" note. Detection is in
  `src/xr-support.ts` (`isQuestBrowser`).

## Node version

The project declares Node in two places, and they agree:

- `.nvmrc`: `22.12.0`
- `package.json` `engines.node`: `>=20.19.0 <21.0.0-0 || >=22.12.0 <23.0.0-0 || >=24.0.0`
  (22.12.0 is inside this range)

**Set Vercel to Node 22.x.** `engines` also allows 20 and 24, so
Vercel could pick another major on its own; setting 22.x matches `.nvmrc`.
After the first deploy, check the build log's Node version line to confirm.

## Verify the build locally

```
npm run typecheck
npm test
npm run build
```

Then check that no dev-only code made it into `dist/`. This should print
nothing:

```
grep -rlE "\[Grab debug\]|\[Join debug\]|\[DeskPlacement|\[seated\]|\[dev flags\]|spatialql\.debug|Option\+Shift|join: bring orders|@iwer|slab \(touch\)|pinch evaluated|group: top|\[Challenge debug\]|applying the solution|applying the wrong state|apply the puzzle|resetProgress|\[Slab\]|cut off with an ellipsis|switched to|\[HUD\]|frame p50|debugSide|start: daily|start: practice|from \?puzzle=" dist/
```

If it lists a file, some dev code survived the build (it can't run, because
it's gated, but it shouldn't ship). To see which pattern matched:

```
grep -oE "<same pattern as above>" dist/assets/index-*.js | sort | uniq -c
```

Then serve the build:

```
npm run preview
```

Open the URL it prints, usually `http://localhost:4173/`, in a desktop browser.
You should see the SpatialQL message over the page ("Open this link in the
Meta Quest Browser…"), because desktop browsers can't start an immersive AR
session. No HTTPS or extra flag is needed for this: `localhost` counts as a
secure context.

`npm run preview` is for checking on the desktop. To test on a Quest, use the
deployed HTTPS link, or the dev server over Wi-Fi (see "Testing on a Quest
over Wi-Fi" below). Over plain HTTP on your LAN the Quest Browser won't
expose WebXR at all.

## Deploy, recommended: import the GitHub repo in Vercel

Every push to `main` then deploys automatically.

1. Push the branch you want to deploy and merge it into `main` on GitHub.
2. Sign in at https://vercel.com (GitHub login is simplest).
3. **Add New… → Project**, then **Import** the `spatialql` repository. If it
   isn't listed, use "Adjust GitHub App Permissions" to give Vercel access to it.
4. On the configure screen, confirm:

   | Setting | Value |
   | --- | --- |
   | Framework Preset | **Vite** |
   | Root Directory | `./` |
   | Build Command | `npm run build` |
   | Output Directory | `dist` |
   | Install Command | `npm install` |
   | Environment Variables | none needed |

5. **Deploy.** The first build installs dev dependencies too (including the
   IWSDK CLI and reference package). If it is slow or fails during install,
   the build log shows which package.
6. **Settings → General → Node.js Version: 22.x**, then redeploy if it was
   different (see "Node version" above).
7. Your public link is the production address, `https://<project>.vercel.app`.
   Share that one.
   - Vercel also creates a hashed URL for every deployment
     (`https://<project>-<hash>-<team>.vercel.app`). Preview deployments are
     protected by default, so those can ask visitors to log in. Don't share them.
   - If the production address also asks for a login, open **Settings →
     Deployment Protection** and turn protection off for production.

Branch pushes and pull requests get their own preview deployments. Only
`main` updates the production address.

## Deploy, alternative: the Vercel CLI

From the project root:

```
npx vercel login
npx vercel link
npx vercel deploy --prod
```

- `login` opens a browser to sign in.
- `link` asks which account or team and project to use. Accept the detected
  Vite settings (build `npm run build`, output `dist`).
- `deploy --prod` builds on Vercel and prints the production URL. Share the
  `https://<project>.vercel.app` address, not the hashed one.

Redeploy after any change by running `npx vercel deploy --prod` again.

## Test on a Quest

1. Put on the headset and open the **Meta Quest Browser**.
2. Type the production address (`https://<project>.vercel.app`) and open it.
3. You'll see the SpatialQL welcome screen: today's puzzle (or "Start with 3
   short practice puzzles." on a first visit), the streak, practice progress,
   and the **Start** button (it enters XR). Tap Start.
4. Allow the permission prompts. The browser asks to use your surroundings
   (passthrough / spatial data) and hand tracking. Choose **Allow**.
5. You're in passthrough AR. Two table slabs appear in front of you, within
   reach, with a puzzle card above them. If a desk is detected they rest on
   it; otherwise they float at desk height. Put your controllers down to use
   your hands.
6. Pinch a slab with your palm close to it to grab it. Bring one table next to
   the other until the edges glow, and release to join. The INNER | LEFT
   control above the pair switches the join type; pull a slab away to undo.
   Hint and Next sit beside the control.
7. To leave, use the Quest's system menu (or the browser's exit control). The
   welcome screen comes back, with the progress updated.

A first-time user sees the same flow, starting with practice puzzle 1. The
daily puzzle is offered once practice 1-3 are solved. **Free play** on the
welcome screen gives the sandbox (no card, no puzzles). There are no dev
flags, debug lines, outlines or keyboard shortcuts in production.

## Testing on a Quest over Wi-Fi

The dev server can run on the Quest directly, so changes show up on the
headset as you save, with no deploy.

1. **Same network.** The Quest and the Mac must be on the same Wi-Fi.
   Guest networks that isolate devices won't work.
2. **Start the dev server** on the Mac with `npm run dev`, then find its
   network URL with `npx @iwsdk/cli dev status` (`data.runtimeUrls.network`),
   for example `https://192.168.29.98:8081/`. Vite already listens on all
   interfaces (`server.host: '0.0.0.0'` in `vite.config.ts`). If the Quest
   can't reach it, allow incoming connections for Node in the macOS firewall
   (System Settings, Network, Firewall).
3. **Open the URL in the Meta Quest Browser.** The dev server uses a
   self-signed certificate, so the browser shows a warning ("Your connection
   is not private"). Choose **Advanced**, then **Proceed to 192.168.x.x
   (unsafe)**. That's expected for the local dev certificate, and WebXR works
   once you're through. The warning comes back if the cached certificate is
   regenerated (`.iwsdk/https`) or the Mac's IP address changes.
4. **The emulator stays off on the Quest.** No configuration needed: the
   IWSDK dev plugin injects the XR emulator (IWER) only when the page's
   host is `localhost` or `127.0.0.1` (its `activation` option defaults to
   `'localhost'`), and it also skips any user agent matching
   `/OculusBrowser/` (`userAgentException`). The startup log line
   `[IWSDK Dev] Configuration: {... activation: localhost ...
   "userAgentException":"/OculusBrowser/" ...}` shows both. On the Quest you
   get native WebXR: real passthrough, real hands, and the desk from real
   plane detection. With `?debug=1`, the debug panel's title shows the host
   and "Quest Browser".
5. **Dev flags go in the URL.** For example
   `https://192.168.29.98:8081/?debug=1`. Also available: `mute=1`,
   `puzzle=<id>`, `day=YYYY-MM-DD` (pretend it's that day, for the daily and
   the streak), `resetProgress`, `mode=free` (the sandbox), and
   `debugSide=left|right` for the debug panel.
   - **Keep `seated` and `forceSurface` off on the Quest.** `seated` is an
     emulator aid that fights the real head pose; `forceSurface` replaces the
     real desk with a synthetic one.
   - The Quest has its own `localStorage`: flags stored on the Mac (with the
     Option+Shift hotkeys) don't carry over. The keyboard shortcuts need a
     keyboard paired with the Quest.
6. **Live changes.** Saving on the Mac hot-reloads the page on the Quest. The
   managed Chromium window on the Mac can stay open alongside it.

### The in-headset debug panel (`?debug=1`)

A small dark text panel beside the tables, outside their view window, about
0.5 m away. It shows:

- the latest tagged debug lines: grab attempts and why they did or didn't
  grab (`grab`), join and toggle transitions, the filter and sounds with
  their peaks (`join`), placement (`desk`), puzzle evaluations (`puzzle`);
- every warning (yellow) and error (red), including uncaught errors;
- a frame-time line: p50, p95 and max over the last 360 frames (about
  4-5 s), and the long-task count with the latest one. The VR budget is
  11-14 ms per frame.

It refreshes at most four times a second. Its **Move left / Move right**
button (on the edge nearest the tables) swaps it to the other side: poke it,
pinch on it, or point a ray and select. The side is remembered on that
device; `?debugSide=left|right` overrides it. The panel is never grabbable
and its placement line (`hud placed ...`) reports the button's distance and
its clearance from the nearest slab.

For the full console, connect the Quest over USB and open `chrome://inspect`
in Chrome on the Mac.
