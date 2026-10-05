# SpatialQL status

Where the project stands: what's built and verified, the key decisions, what
still needs a headset, and known limitations. Detailed testing steps live in
[`grab-debug.md`](grab-debug.md); deployment in [`DEPLOY.md`](DEPLOY.md);
plans in [`plans/`](plans/).

## What it is

A seated mixed-reality SQL join for Meta Quest. Two tables, `customers` and
`orders`, appear as slabs within arm's reach in passthrough. You pinch one,
bring it to the other, and release: the slabs snap together, match lines fan
out between rows with the same key, and the join result assembles above them,
row by row, from its source rows. An INNER | LEFT control switches the join
type; pulling a slab away undoes it.

Live: https://spatialql.vercel.app/ (production deploys from `main`).

## Built and verified

"Emulator" means verified in the IWSDK emulator (IWER) with real input
events and logged state; nothing has been tested on a real Quest yet.

| Area | What's built | Verified |
| --- | --- | --- |
| Placement | Slabs rest on a detected desk (or a synthetic one with `forceSurface`), or float at desk height; natural heights, bottom edges aligned. | Emulator: placement and reach logs, screenshots, nothing cut off |
| Reach and view | Touchable elements within 0.60 m; whole group within an 80° window around the 18° natural gaze. | Emulator: slabs 0.55–0.60 m, control 0.45–0.47 m, group 56.5–59.2° of 80° |
| Text size | Sized by angle (rows 1.15°, headers 1.3°) from planned distances; ≥ 0.9 cm. | Emulator: source rows 1.10–1.12°, result 1.08–1.11° |
| Grab | Hand pinch grabs a source slab when the palm is within 7 cm. | Emulator: grab and "no grab" reasons logged |
| Join | Preview within 6 cm, commit on release, dock with bottoms aligned. | Emulator: grab-and-release joins, J / Shift+J |
| Result slab | View only; above the pair; sized to its rows, grows/shrinks downward on INNER ↔ LEFT. | Emulator: J and Shift+J, INNER and LEFT, screenshots |
| Join-type control | Between the pair and the result slab; level with the pair (roll 0°); ≥ 10 cm from the slabs. | Emulator: pinch and ray select; clearance 10.0–10.1 cm; roll 0.0°, yaw vs pair 0.0° |
| Pull apart | Dragging a docked slab > 10 cm separates. | Emulator |
| Feel | Approach glow and hum, dock snap with overshoot, line ticks and pulses, rows flying in from their source rows (row backgrounds fade in only as the cells land), unmatched rows dropping 12% of a row within their slot, resolve; ~1.15–1.2 s. Synthesized spatial sound (`src/sound.ts`), balanced: ticks 11–14 dB and the resolve ~9 dB below the snap. | Emulator: sound order and output peaks from the log; drop offsets for J / Shift+J, INNER / LEFT and five toggles (no drift); mid-flight screenshots; frame times; no long tasks at join start. Approach glow/hum not yet tried by hand. |
| Browser support | "Open in the Meta Quest Browser" message on non-AR browsers; dismissible note on AR browsers that aren't the Quest Browser. | Unit test for detection; production preview |
| Welcome screen | Browser entry point: SpatialQL, today's puzzle, streak, practice progress, Start (enters XR) and Free play; hidden in XR, back (updated) after exit. | Emulator: screenshots in and after XR, Free play and back |
| Production build | No dev-only code. | Grep of `dist/` and of the deployed bundle |
| Deployment | Vercel from GitHub `main`. | Site, bundle and assets return 200 over HTTPS |

## Key decisions

| Decision | Why |
| --- | --- |
| **LEFT is the slab that stayed put**; the one you brought over is RIGHT. | Decided by who moved, never by screen side, so `customers LEFT JOIN orders` follows from bringing orders to customers. |
| **Commit on release**, not on contact. | Jitter while holding never joins; the preview shows what will happen first. |
| **Result slab is not grabbable.** | It's derived output; making it grabbable created a grab hazard next to the control. It follows the pair. |
| **Pinch-to-grab on** (`useHandPinchForGrab`). | Hands have no grip button; pinch is the natural grab gesture on Quest. |
| **Reach limit 0.60 m** (`TOUCH_REACH_MAX_METERS`) for everything you touch. | Seated use, within about 2 ft; reach wins over the view limits. |
| **Natural gaze 18°** below horizontal (`NATURAL_GAZE_PITCH_DEG`), with an 80° group window. | Seated desk work looks slightly down; a fixed gaze keeps placement independent of where the user looked at session start. |
| **Text sized by angle**, not centimeters. | Slabs at arm's length were physically oversized; angular sizing keeps text readable at any distance and the group in view. |
| **Bottoms-aligned slabs** at their natural heights. | Both rest on a real desk (nothing hovers or sinks); rows don't need to line up, since matches are shown by color and lines. |

## Open items for headset testing

- Hand-tracking feel of the grab, the preview "magnet", and release drift.
- Reach and view constants (0.60 m, 18° gaze, 80° window) at a real desk.
- Text size at the 1.15° / 1.3° targets.
- Sound, by ear: overall level and balance (measured: snap -6.9 dBFS, ticks
  -18.3 to -21.4, resolve -16.1, drop tap -11.0).
- The join's motion: row flights, background fade on landing, the drop within
  the slot, total ~1.2 s.
- A hitch at join start: a 112 ms long task seen once on desktop (while the
  profiler ran) didn't reproduce; the dev long-task readout will show one on
  a Quest.
- Poking the control (pinch and ray are verified; poke needs a real pointing
  hand).
- The approach glow and hum, by moving a slab by hand.

## In progress: challenge mode

Daily and practice puzzles over four small datasets; design and phases in
[`plans/challenge-mode.md`](plans/challenge-mode.md). Phase 1 (pure data
layer and tests: datasets, 20 puzzles, query and NULL filter, result
comparison and diff, daily selection, streak, progress, copy) is committed.
Phase 2 (shop puzzles 1-3 playable: card, silhouette, diff, NULL poke, bar,
win, progress) is committed. Phase 3 (all 20 puzzles on four datasets, with
the desk switching tables, dataset theming, and guards so nothing is judged
mid-switch or on the wrong tables) is implemented and emulator-tested, at
its checkpoint.
Phase 4 (the daily puzzle after practice 1-3, its streak, and the SpatialQL
welcome screen with Start and Free play) is implemented and emulator-checked
(start on the daily, win, streak, Next back to practice, welcome screen,
Free play and back); the streak across days with `?day=` isn't checked yet.
Challenge mode is now the default everywhere; Free play (`?mode=free`) gives
the sandbox, labeled as such on the welcome screen ("Start free play").

Since phase 4:

- **Table names on the slabs:** each source slab has a name tab on its top
  edge with the table's SQL name and alias (`customers c`), in the dataset
  accent, so the slabs, the caption and the result headers read as one. It's
  part of the slab (grabbing it grabs the slab). A test checks that every
  "the X table" in the puzzle text is a slab on that puzzle's desk.
- **The card fits the view:** the result slab (and the outline before the
  join) is pushed back until the card on it fits the +40° limit too, never
  past where its rows would drop below 1.05°. Seated, with the tabs: shop
  top 40.0°, extent 74.5° (result 0.58 m, rows 1.10°); library 38.5° / 72.0°;
  school 37.1° / 70.9°; cafe 38.4° / 73.5°.
- **Copy:** the win takeaways describe what happened to the rows in plain
  words, naming columns only through placeholders; the hint button says what
  it shows next (Hint, Another hint, Show answer).
- **Dataset switch:** the card, bar and outline fade out with the leaving
  tables and back in once placed for the new ones (no jump after arriving).
- **Dev, for the headset:** the in-headset debug panel (`?debug=1`) mirrors
  the debug lines, warnings and errors, wrapping long ones, with frame times;
  testing on a Quest over Wi-Fi is in [`DEPLOY.md`](DEPLOY.md).

## Future

- **Three-table datasets** (e.g. borrowers, books and loans): more puzzle
  variety and a longer daily cycle than 20 days; needs a three-slab layout.

## Known limitations

- **`iwsdk-reference` doesn't connect** in Claude Code sessions, so its docs
  haven't been used. Try `npx @iwsdk/cli reference warmup`, then `/mcp`.
- **The seated head must be set by hand** in the emulator: the `seated` flag
  can't move the emulated headset, and logs `the seated pose did NOT take`.
  Set headset Pos Y = 1.2, Rot X = -18, then re-enter XR.
- **The managed Chromium window has no audio:** it's launched by Playwright,
  which normally mutes Chromium's output. To hear the sounds, use a normal
  browser tab on the dev server, or the headset. The debug log still proves
  each sound played, with its measured level.

## How it's built

IWSDK app (Vite + TypeScript):

| File | Role |
| --- | --- |
| `src/desk-placement.ts` | Places the source slabs within reach and view. |
| `src/join-system.ts` | The join: proximity and preview, dock, result slab and control placement, animation timeline and sounds, pinch-on-control. |
| `src/data/` | Pure data layer: tables, joins with `RowRef` lineage, SQL text, the join state machine, key tints. Unit-tested. |
| `src/table-slab-view.ts` | Slab and control UIs (UIKit), sized from font size; per-row animation signals. |
| `src/view-comfort.ts` | Gaze, view window, reach and text-size constants. |
| `src/sound.ts` | Synthesized, spatial join sounds. |
| `src/panel.ts` | Welcome panel and its XR hide. |
| `src/xr-support.ts` | Browser-support notices. |
| `src/dev-flags.ts`, `src/*-debug.ts`, `src/dev-seated.ts` | Dev-only tooling; excluded from production. |

## How to test

- `npm run typecheck`, `npm test`.
- Emulator: `npm run dev`; dev flags `debug`, `seated`, `forceSurface`, `mute`
  via the URL or Option+Shift+D / S / F / M. With `debug`: J / Shift+J join,
  T toggles, U separates, R replays. Steps and expected logs:
  [`grab-debug.md`](grab-debug.md).
- Headset: the deployed link, or the dev server over Wi-Fi (network URL from
  `npx @iwsdk/cli dev status`; steps, the certificate warning and the flags in
  [`DEPLOY.md`](DEPLOY.md#testing-on-a-quest-over-wi-fi)). With `?debug=1`, an
  in-headset panel beside the tables mirrors the debug lines, warnings and
  errors, and shows frame times.
