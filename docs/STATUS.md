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
row by row, from its source rows. A control column on the left holds the
INNER | LEFT switch and the puzzle buttons; pulling a slab away undoes the
join.

Live: https://spatialql.vercel.app/ (production deploys from `main`).

## Built and verified

"Emulator" means verified in the IWSDK emulator (IWER) with real input
events and logged state. "Headset" means a Quest 3S session over Wi-Fi with
`?debug=1`, read from its log in `logs/` (sessions since 2026-10-06).

| Area | What's built | Verified |
| --- | --- | --- |
| Placement | Slabs rest on a detected desk (or a synthetic one with `forceSurface`), or float at desk height; natural heights, bottom edges aligned. | Emulator: placement and reach logs, screenshots, nothing cut off |
| Reach and view | Left to right: the control column (0.50 m), the result (0.85 m, pushed back to at most 0.89 m when the group is too wide), the card (0.85 m at the result's depth, behind the tables, 16 em wide, 1.30° text); the source slabs below at 0.70 m. The group is centered on straight ahead within ±42° (`VIEW_HALF_WIDTH_DEG`), and vertically within the 80° window around the 4° natural gaze. | Emulator, all 20 puzzles: cafe ±35.6°, school ±41.2°, shop and library -42.0° to +42.1° (shop's result at 0.89 m, rows 1.10°); column 2.3–2.8° left of the result and at least 3° above the slabs |
| Text size | Sized by angle (rows 1.15°, headers 1.3°) from planned distances; ≥ 0.9 cm. | Emulator: source rows 1.10–1.12°, result 1.08–1.11° |
| Grab | Hand pinch grabs a source slab when the palm is within 7 cm. | Emulator: grab and "no grab" reasons logged |
| Join | Preview within 6 cm, commit on release, dock with bottoms aligned. | Emulator: grab-and-release joins, J / Shift+J |
| Result slab | View only; above the pair, its bottom 1.5° above the pair's top in view; anchored by its bottom edge, so it grows upward on INNER ↔ LEFT. | Emulator: J and Shift+J, INNER and LEFT, screenshots |
| Control column | Left of the result: Hint, Prev \| Next, INNER \| LEFT (once joined), Recenter \| Exit; Filter, its chips (one per row) or the WHERE label and Clear grow upward above Hint. On an arc around the eyes, each button facing them with no roll. Free play shows INNER \| LEFT over Recenter \| Exit. | Emulator: every button 0.50 m from the eyes, roll 0.0°; label widths tested |
| Presses (frozen 2026-10-09) | A hand pinch presses through the hand pointer only if the pointer was shown 0.2 s, the fingers opened past 2.2 cm (NULL cells 1.5 cm) within 0.4 s, the pinch started at most 2.5 cm apart, and it closed to 1.8 cm for 40 ms, or as a tap released closed, within 0.5 s. It presses what the pointer showed at its start (or within 0.25 s before). Source slabs don't block the press ray; NULL cells count within 1 cm. A pinch right at a button does nothing (only a fingertip poke presses there). Hint presses at least 0.8 s apart. Constants in the FROZEN block of `src/hand-pointer-math.ts`, pinned by a test. | Unit tests replay five headset logs' phantom and real pinches; emulator: pointer pinch, 25 ms tap, bottom-row NULL through a slab |
| Holds | Exit (1.0 s), Show answer (0.8 s, before the answer) and Recenter (0.6 s) act only when held, with a filling ring; one continuous pinch, trigger or fingertip that started on the button; any let-go resets it. | Emulator: tap vs hold for each |
| Recenter | After its hold: "Look straight ahead" for 1.5 s, then it recenters on the median head yaw of the last 0.3 s. Pressing again, or looking back toward the button after 0.5 s, cancels it. The automatic recenters are unchanged. | Unit tests: nine presses don't drift, cancel cases; emulator: pressed at -30°, recentered at 0° |
| Reach banner | "Move closer, or hold Recenter." when the nearest column button is over 0.65 m from the nearer shoulder, or the nearer slab over 0.90 m from the eyes, for 2 s; hides 5 cm back inside, or on a Recenter. It sits in the row-free band between the slabs' rows and the result's, in front of both, sized to fit; below the gaze (semi-transparent) when the band is under 1.5°. The desk no longer produces a message. | Unit tests (`src/data/reach-hint.test.ts`); emulator: shown at 0.3 m back (banner 3.0°, text 1.67°), 0.6 m (2.5°), 1.0 m (1.8°), below the gaze at 1.5 m; hidden on return and on Recenter |
| Slab release | A slab released outside preview range glides home (0.45 s). | Emulator: logged return, home extents restored |
| Pull apart | Dragging a docked slab > 10 cm separates. | Emulator |
| Feel | Approach glow and hum, dock snap with overshoot, line ticks and pulses, rows flying in from their source rows (row backgrounds fade in only as the cells land), unmatched rows dropping 12% of a row within their slot, resolve; ~1.15–1.2 s. Synthesized spatial sound (`src/sound.ts`), balanced: ticks 11–14 dB and the resolve ~9 dB below the snap. | Emulator: sound order and output peaks from the log; drop offsets for J / Shift+J, INNER / LEFT and five toggles (no drift); mid-flight screenshots; frame times; no long tasks at join start. Approach glow/hum not yet tried by hand. |
| Browser support | "Open in the Meta Quest Browser" message on non-AR browsers; dismissible note on AR browsers that aren't the Quest Browser. | Unit test for detection; production preview |
| Welcome screen | Browser entry point (HTML over the canvas): SpatialQL, today's puzzle, streak, practice progress, Start (enters XR), Choose puzzle, Reset progress; hidden in XR, back (updated) after exit. | Emulator: Start enters XR, hidden in XR, back after exit; screenshots at 1280 x 670 and 1920 x 1080 |
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
| **Natural gaze 4°** below horizontal (`NATURAL_GAZE_PITCH_DEG`), with an 80° group window. | A fixed gaze keeps placement independent of where the user looked at session start. It was 18° (seated desk work); on the Quest 3S, seated users held their heads 2–6° down, so 8°; at the start of a later session about level to a few degrees up, with the group felt as too low, so 4°. The debug log records head pitch every 10 s for further tuning. |
| **A pinch is a motion.** A hand pinch presses only if the fingers opened first. | On the headset, a resting pointing hand's thumb near the index made the platform's pinch flicker on and off, pressing Hint three times and holding Exit. The opening before the pinch separates real pinches (2.6–6.2 cm) from resting ones (mostly 1.3–2.0 cm); the distance at the pinch start doesn't. |
| **Only fingertips press up close.** | Reaching in to pinch a button, the fingertip poked it first; a pinch right at a button now does nothing, and the pointer is the pinch path. |
| **Show answer, Exit and Recenter are holds.** | Irreversible, session-ending, or moving everything: never from a tap or a flicker (a stray pinch once recentered the group). |
| **Pinch constants are frozen** (2026-10-09). | Five headset sessions traded false presses against missed ones; some false presses (a full 7.7 to 0.7 cm motion) match real pinches. Change them only for a clear regression in a session log. |
| **Source slabs don't block presses.** | The docked slabs' top edges sat in the ray's path from a relaxed hand to the result's bottom rows; slabs aren't pressable. Near grab is unaffected (distance grab is dropped). |
| **Reach, not the desk.** | "Move closer to your table" showed whenever a desk was detected out of reach, even when everything was within reach. The banner measures the player's reach from the head and shoulders, seated or standing. |
| **Recenter waits for "Look straight ahead".** | The button sits left; pressing it turned the head toward it, and each recenter moved the group further left (0° to -93° in nine presses on the headset). |
| **Text sized by angle**, not centimeters. | Slabs at arm's length were physically oversized; angular sizing keeps text readable at any distance and the group in view. |
| **Bottoms-aligned slabs** at their natural heights. | Both rest on a real desk (nothing hovers or sinks); rows don't need to line up, since matches are shown by color and lines. |

## Open items for headset testing

- Hand-tracking feel of the grab, the preview "magnet", and release drift.
- View constants (slabs 0.70 m, column 0.50 m, result 0.85 m, 4° gaze, 80°
  window, ±42° width) at a real desk;
  the head-pitch lines in the debug log show how people actually hold their heads.
- Text size at the 1.15° / 1.3° targets.
- Sound, by ear: overall level and balance (measured: snap -6.9 dBFS, ticks
  -18.3 to -21.4, resolve -16.1, drop tap -11.0).
- The join's motion: row flights, background fade on landing, the drop within
  the slot, total ~1.2 s.
- A hitch at join start: a 112 ms long task seen once on desktop (while the
  profiler ran) didn't reproduce; the dev long-task readout will show one on
  a Quest.
- **Watch:** two long tasks (66 ms, 74 ms) at XR session start on the Quest
  3S (headset log of 2026-10-06), none during play. Check whether they
  recur and what runs then (session start: placement, reference space,
  documents).
- Pinch rules are frozen: after a session, `python3 scripts/headset_log.py
  summary` shows each rule's rejections; revisit only for a clear regression.
  The `poke press on` lines (approach and thumb-index gap) tell deliberate
  pokes from reaching-to-pinch ones.
- The holds (Show answer 0.8 s, Recenter 0.6 s) and the Recenter countdown,
  by hand.
- The result's bottom rows from a relaxed hand, now that the press ray passes
  through the slabs (emulator: row 10 pressed through the orders slab). If
  still hard, the planned fallback is a 3° gap under the result (from 1.5°).
- The reach banner: its trigger distances and its fit in the gap.
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
Challenge mode is now the only mode in production. Free play is removed for
now (2026-10-11, item 10 below): no button, and production ignores
`?mode=free`; its code stays, dormant, reachable in dev with `?mode=free`.

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
- **Headset rounds (2026-10-08/09):** the controls moved from a band under
  the result to the column on its left (the band sat in the pointer's path to
  the result); the group fits ±42°; slabs glide home when released away from
  the dock; the hand pointer presses only on a pinch motion; Exit and Show
  answer are holds; Recenter waits for "Look straight ahead". Then pinch
  rules from logged pinches (frozen), Recenter as a hold, the press ray
  through the slabs, and the reach banner in place of the desk message.
- **Dev, for the headset:** the in-headset debug panel (`?debug=1`) mirrors
  the debug lines, warnings and errors, wrapping long ones, with frame times;
  testing on a Quest over Wi-Fi is in [`DEPLOY.md`](DEPLOY.md).

## Plan status (2026-10-11)

**Done** (all committed):

- **1.** The reach banner, "Move closer, or hold Recenter.", in the gap between
  the tables and the result.
- **2.** Pinch rules: start gap 2.5 cm, 0.5 s window, the tap-on-release test, then
  frozen.
- **3.** The pointer passes through tables for presses. The 3° gap under the result
  stays an unused fallback, pending a headset check of the bottom rows.
- **4.** Holds: Recenter (0.6 s) and Show answer (0.8 s); the 0.25 s target lock and
  the 1 cm NULL touch area.
- **5.** The Recenter drift fix: "Look straight ahead" with a countdown. Facing
  the button's way before the press (within 15°) no longer cancels it (the
  2026-10-11 04:33 log: four presses cancelled while facing -33° with the button
  at -36°); one hold per touch, so a fingertip left on a hold button doesn't
  re-trigger it.
- **Reach paths:** nothing sits between a hand and a table.
  The card moved behind the tables, to the result's depth (0.85 m, the same size
  in view); the reach banner sits behind the tables; the debug panel sits outside
  the whole group at eye level. A dev readout (`reach-path.ts`, tested) logs each
  element's clearance from the shoulder-to-grab-point paths (at least 5 cm). In
  the emulator, all four datasets, before and after the join: card 8.1–12.6 cm,
  column 12.9–15.5 cm, result or outline 17.5–23.2 cm, INNER | LEFT 16.5–18.7 cm,
  banner 12.3 cm, debug panel 17.6–20.8 cm.
- **8.** The card's daily title is "Today's puzzle - Puzzle 10"
  (a hyphen: the fonts have no middle dot). The first daily shows "A new puzzle
  every day. Solve it to build a streak." once, marked only when seen in XR;
  Reset shows it again.
- **7.** Hover: only pressable targets highlight; the hand pointer's cursor dot
  rests on a table, the card (never in front of a table) and the result between
  its NULL cells, with no glow. Controllers keep the SDK's ray: out of scope.
- **10.** The flat page shows only the welcome panel, before the
  first session and after leaving one (a camera layer; XR is unchanged).
- **13.** Prev and Next move through the puzzle numbers in order. Prev goes to N−1 (off on puzzle 1). Next goes to N+1 once N is solved (or as Skip after "Show answer"). The exceptions are by design: from puzzle 20, or from a daily that's ahead of practice, Next goes to the lowest open puzzle, and Finish once all 20 are done. Confirmed in the code (`prevPuzzle` / `nextPuzzle`, tested) and in the headset logs: 20 → 19 → … → 13 by Prev (2026-10-09 03:57), and 5 → 6 → … → 11 and 12 → … → 20 by Next (2026-10-07). The "Choose puzzle" grid and "Reset progress" (with a confirmation) are on the welcome screen.

- **Background builds only when quiet:** queued builds start on their first
  step (queuing at a load costs nothing; before, the load frame started every
  neighbor's documents: 55-70 ms frames on the Quest), each step is one cell,
  and the queue runs only after 0.5 s with nothing moving, at most 2 ms a frame,
  and not at all once empty. The debug panel's frame line adds each frame's work
  (update + render CPU time), since the frame gap can't drop below the refresh
  interval (13.9 ms at 72 Hz). Sessions ask for 80 Hz (frame-rate.ts; the
  Quest 3 offers 72, 80, 90, 120): joined work measured p95 12.4 ms, inside 80
  Hz's 12.5 ms. Dev: `?hz=<rate>` asks for another.
- **No builds at loads, switches or joins:** documents are built a few ms per
  frame in the background (build-queue.ts; table-slab-view.ts builds rows one
  at a time onto the live document) and cached: the current puzzle's and its
  neighbors' target outlines (one row built, columns fitted to all), and their
  datasets' tables and result slabs (dataset-cache.ts; parked out of sight).
  Before: every load rebuilt the target outline (50-75 ms on the Quest) and
  every switch built two tables and two result slabs whole (100-240 ms each).
  A picker jump to a dataset that isn't kept builds during the switch, a few ms
  per frame. The display rate in use is in the frame line;
  `scripts/headset_log.py frames` compares sessions.
- **Pokes:** every poke target (column buttons, chips, picker tiles, INNER | LEFT,
  NULL cells, free play's Recenter) takes approaches up to 60° off straight at
  the face (was 45°: the 2026-10-10 tile and chip pokes came in at 47-58° and
  were rejected, so the finger went through; slides along the face, 61-77° in
  the logs, are still rejected). Presses still fire 1.0 cm in front of the
  face. A fingertip within 3 cm in front of a target highlights it (the pointer's
  outline), and a press dips the target with the click. Misses are logged with
  their angle and how deep the fingertip went.
- **In-XR puzzle picker:** a Puzzles button in the column (right above INNER |
  LEFT, in both modes) opens a 4 x 5 grid of puzzles 1-20 in the column's place
  (the welcome grid's status marks: solved, with answer, locked, Today; the
  puzzle on the desk filled). A tile switches through the same path as Prev and
  Next (never-yank) and closes the grid; a locked tile says so on the card; Back
  or Puzzles closes it. Tiles 3.0 x 2.5 cm; the grid is 12.9 cm wide (14.8° at
  0.5 m), extending the column about 2° further left while open (planned to
  about -45°); the group's plan and INNER | LEFT don't move.
- **Prev and Next take the NULL cells' 1.5 cm re-arm opening** (other targets
  keep 2.2 cm; the frozen constants are unchanged). In the 2026-10-10 02:53 log,
  2 of the 5 rapid Prev re-pinches rejected for a short opening (1.8, 1.7 cm)
  would have passed; 3 never opened past 1.0 cm. A rejected pinch's log line now
  says when the tips last closed and opened since the last press.
- **Debug panel placement** (dev): it never goes below or in front of the
  tables. It's placed only from a layout readout, for the head pose that layout
  used (leaning in toward the tables once re-placed it in front of them,
  2026-10-10 02:52:43), re-placed only when the layout changes and the tables are
  still (never during a switch, a recenter or a glide), steps farther out if a
  hand's path to a slab passes within 5 cm, and hides if there's no room.
- **Grab feedback** for the tables (`grab-feedback.ts`). Can grab: the nearest
  table within the 7 cm grab sphere of a free hand's grip gets a soft, thin
  outline in its dataset accent. Grabbed: a brighter, thicker outline, 2% larger,
  carried level (rotation off), a soft shadow on the desk when it rests on one,
  and quiet pick-up and put-down sounds (none when it docks). Ready to join: the
  pulsing amber edge glow and hum, unchanged. Only pressable targets (buttons,
  chips, NULL cells) get a pointer hover highlight; a table, the card and the
  result between NULL cells show only the cursor dot.

**Built, not committed:**

- **9.** The streak calendar (now a month view: see 10): each day's daily recorded by local day (solved, or
  revealed after Show answer or a skip; the last 60 days; old saves get their
  current streak backfilled; Reset clears it). The welcome screen shows the last
  four weeks, Monday first (solved: indigo with a check; with the answer: light
  indigo with an eye; missed: an outline; today: an orange ring; the rest of this
  week faint), with a flame before the streak line (grey at 0; "Solve today's
  puzzle to start your streak.", or "Then a daily puzzle builds your streak."
  before the daily unlocks). The panel grew from 422 to 549 px, so its
  screen-space height went from 40% to 52% and nothing on it shrank; only the
  buttons below moved down. The daily win card's status line gets the flame and,
  on the day a milestone is reached, "3-day streak!", "7 days: a full week!",
  "14 days: two weeks strong!" or "30-day streak!" with a brighter win sound.
  Dev: Option+Shift+Right / Up / 0 (or `spatialql.day`) moves the day.
- **10.** The welcome screen redesign: rebuilt as an HTML/CSS page over the
  canvas (`src/welcome-page.ts`, `src/welcome.css`) in place of the UIKit
  screen-space panel (`welcome.uikitml` and its scene node removed), so the
  browser draws its text crisply in the Quest Browser. Centered on a deep navy
  page with glows in the four dataset accents; a cream card with a two-slab mark,
  the tagline, the dataset icons, the setup line, a big indigo Start, then
  today's puzzle, the streak with its flame, the four-week calendar and practice;
  Choose puzzle (the picker replaces the progress lines) and Reset progress (with
  its confirmation). Two columns on short, wide windows (the Quest Browser
  default, 1280 x 670), one column on taller ones; sizes are floors at the Quest
  default (title 58 px, body 22, Start 30 px text and 76 px tall) and scale up
  to 1.3x. Inter is self-hosted (`src/fonts/`, OFL); icons are the app's Lucide
  set as inline SVG; no new image files. The non-XR message and the "Best on
  Meta Quest Browser" note share the look. Copy in `copy.ts`, width-tested at
  the Quest default. `vite.config.ts` now lists Inter in the plugin's bundled
  fonts: with no UIKitML file left, production otherwise failed at startup.
  **The calendar shows the current month** (2026-10-11 addendum): the month and
  year (English names), Monday-first weeks (4 to 6 rows; cells outside the month
  empty), and the date on days without a mark (missed: outlined; before the
  first daily, or today with nothing yet: a plain fill; later this month: the
  date alone). The back arrow goes to an earlier month while the history covers
  it (at most two, with its 60 days); with no history there yet it's still
  shown, greyed out and disabled. A forward arrow returns, never past this month.
  A 6-row month (November 2026) fits the Quest default: the right column is
  459 px tall (the calendar 313) and the card 523 of 670 px, with 36 px days.
  In one column the scale also respects the window's height (1920 x 1080: 1.18x,
  card 1015 px).
  **Free play removed for now:** no button anywhere, production always runs
  the puzzles (`?mode=free` ignored), and its code and copy (`FREE_PLAY_DORMANT`)
  stay dormant; dev only: `?mode=free`.

- **11.** Back to 72 Hz, and a UIKit leak fixed (2026-10-12). The 80 Hz
  headset session held 12.5 ms for about a minute, then frames averaged 14-16 ms:
  per-frame work rose from 7 to 10-11 ms while stepping through all four
  datasets and never came back. Production asks for 72 Hz again (`?hz=` still
  overrides in dev). Cause: dropped slabs, result slabs and target outlines were
  disposed as entities only; UIKit's reactive effects live until each
  component's own `dispose()`, so every dropped document stayed subscribed
  (about 6,000 effect listeners per puzzle step; 157,000 live JS listeners after
  15 puzzles). `disposeUIKitDocument` (src/uikit-dispose.ts) now disposes every
  component, then the document, wherever one is dropped. Emulator, same run of
  about 15 puzzles across all four datasets: live effect listeners 84,239 after
  8 puzzles before, 31,706 after 16 with the fix (fewer than at load); idle work
  after the run 2.9-3.3 ms before (from 2.1 at the start), 1.8-1.9 ms with the
  fix (from 2.0). Dev logging added: a scene census (objects, meshes, UIKit
  roots, draws, geometries, textures, heap) whenever the kept datasets change
  and once their builds settle, and a major-GC sentinel on the long-task lines
  ("major GC N ms ago"), to tell whether stalls like the 226 ms idle one are
  garbage collection (likely, with the leak's growing heap; not proven).
- **12.** All 20 done: the completion card says "Come back tomorrow to keep your
  streak going." and the welcome screen "Today's puzzle: solved. Come back
  tomorrow." (the daily repeats the 20 now); before then, unchanged.

- **13.** One layout rule: the session layout anchor (src/layout-anchor.ts; eye
  position and yaw), set only at session start, Recenter, the headset coming back
  on, and a reference-space reset. Every placement (the slabs and their homes,
  the result, the card, the column, the reach banner; every puzzle, dataset and
  joined state) is computed from it, never from the live head or a stored head
  pose, so head movement never moves anything. Cause found 2026-10-12: opening
  Filter on puzzle 17 (4 chips, the column 18.9 -> 31.3 cm) re-planned the
  result, column and card around a head pose left from the end of a Recenter
  glide 28 s earlier: the control jumped 37 cm toward the player and 5 cm up
  (the source slabs didn't move). Dataset switches also placed the slabs from
  the live head. The live head is now read only for sensing (facing, the
  Recenter countdown and its prompt, reach, hand pointers); a source test fails
  on any other head read, and the anchor may be set only where a session starts
  or recenters. Emulator: puzzles 15 -> 11 (school -> shop) and back with the
  head at the anchor, then again with it 0.35 m right, 0.45 m back, 0.35 m down
  and turned 35°: every slab, result, card, column and control position matched
  to the millimetre, idle and joined. Dev: L logs the layout; the log notes each
  anchor set.

- **14.** The move guard and the chip budget (2026-10-12). Dev: a warning
  whenever a source slab, the result (its bottom edge) or the card moves more
  than 1 mm in a frame with no allowed reason active (placement, Recenter, a
  dataset or puzzle switch, the join, dock, pull-apart, the glide home, grabs;
  src/move-guard.ts). Emulator: no warning across start, switches, a join,
  INNER | LEFT, a filter, pull-apart and Recenter; a slab moved by hand through
  the ECS warned ("the customers slab by 8.0 cm in a frame"). Not yet run
  with a real grab. The countdown prompt still follows the gaze (by choice).
  Filter chips: six one per row would top the column at about 44° above the
  natural gaze (limit 40°; five, 40.8°); today's puzzles offer at most four
  (37.3° at worst). Half-width chips don't fit every header ("PRODUCT"), so
  five or six now go on pages of three with "More (1/2)": as tall as four.
  The unattributed Filter press in the 2026-10-12 log was a real poke: the
  column it opened jumped (the stale-pose re-plan), so the touch log's
  attempt matcher no longer found the finger near a button.

- **15.** The anchor on the headset (2026-10-12). The 04:20 headset session
  ran a stale tab (code from before the anchor: 80 Hz, no anchor lines), so it
  didn't test the anchor. Now: (1) a code stamp (a hash of src/) in every log
  header and the page's console, and "STALE PAGE ... reload the tab" in the log
  and on the debug panel when the server has newer code. (2) The placement mode
  (floating, on the desk, at its edge; and the desk) is decided once when the
  anchor is set (src/pair-placement.ts, pure); dataset switches only resize in
  that mode. (3) A reference-space reset in the first 3 s of a session is part
  of its start (nothing moves); one with a correction keeps everything in place
  in the room (anchor, slabs, homes corrected); one without is the system
  recenter (logged as such). Headset back on still needs 5 s hidden. (4) The
  home is 0.6 m from the eyes (was 0.7), text sized for it (rows 1.20 cm, same
  angle). Emulator, seated, floating, all four datasets joined: slabs 0.57-0.60
  m, text on target, group 49-57° of 80° tall, ±42.2° wide at most (limit ±42,
  0.5° tolerance), reach paths at least 10.4 cm (5 required), farthest column
  button 0.60 m from the nearer shoulder. On a desk: slab bottoms reach 45°
  below the gaze (5° under the window; the approved desk exception). (5) A
  replay of the 04:20 session's events through the placement: positions change
  only at the anchor events (the old way moved them at every switch).

- **16.** The session clock (2026-10-12): a small pill (clock icon and time,
  muted, 0.85x the card's small text) just above the puzzle card at its left
  edge, part of the card (anchored, never a target). From 0:00 when Start enters
  XR; paused while the headset is off (hidden), not for a system menu; m:ss,
  then h:mm:ss; written once a second. On a win it reads "Solved in 1:42" (the
  puzzle's active time, from its load, without headset-off time) until the next
  puzzle. Counted in the view and reach checks: emulator, floating, seated, all
  four datasets joined: the card's top 18.8-19.5° above the gaze (limit 40°),
  the group 51-57° of 80°, the card's reach-path clearance 18.9 cm or more.
- **17.** Desk placement at the floating distance (2026-10-12): on a desk the
  slabs' bottom line goes as far ahead as when floating (0.49-0.52 m) and rests
  on the desk there; a desk that doesn't reach that far (too short, or too far
  away) isn't used: floating. Decided once per anchor (pair-placement.ts; the
  old desk-edge band and surface-placement.ts are gone). Emulator, seated, all
  four datasets joined, both modes:
  - floating: slabs 0.57-0.60 m, text 1.15-1.21°, width up to ±42.2° (the
    column and card), height 51.3-57.0° of 80°, reach paths 10.4 cm or more.
  - desk (forced, 0.45 m below the eyes): slabs 0.67-0.70 m (lower, same
    distance ahead), text 0.98-1.03° (sized for 0.6 m; target 1.15°), width up
    to ±42.4° (column and card; the slabs reach ±34.7° at most, from ±48°),
    height 46.3-54.1°, slab bottoms 36-37° below the gaze, reach paths 12.0 cm
    or more.
  Trade-off on a desk: the text is a little small (about 1.0°). Text is built
  once for 0.6 m; resizing it for a desk would mean rebuilding the slabs.

- **18.** The anchor waits for tracking; desks only when high enough (2026-10-13).
  The 02:30 headset session (current code, stamp 0550b304) took its anchor the
  moment XR began; 0.2 s later the Quest reset its space with a correction,
  which the session-start rule ignored, so the anchor stayed in the old
  coordinates: the group floated 1.6 m away (reach hint), facing the 53.8° the
  head had briefly turned; the first Recenter found the player 0.9 m from it.
  Placement never used the desk's orientation. Now: (1) the session anchor
  waits until tracking settles (the space attached, no reset and the head
  within 2 cm for 0.5 s; at most 3 s; anchor-settle.ts); a reset before it
  restarts the wait; (2) after it, a reset with a correction is always applied;
  (3) placement reports log the live head beside the anchor; (4) a test: a desk
  at any angle leaves the pair's facing to the anchor. Desks: the slabs rest on
  one only when it's within 0.30 m below the eyes
  (DESK_REST_MAX_BELOW_EYES_METERS) and reaches the floating line; otherwise
  they float at exactly the tuned pose and cast a soft shadow on the desk below
  them (desk-shadow.ts). Emulator, forced desk 0.45 m below the eyes: floating,
  slabs 0.59-0.60 m, text 1.15-1.17°, shadows under both slabs.

- **19.** The player's cue at the start (2026-10-13): from Start until the
  session's anchor is taken (tracking settled: typically 0.5 s, at most 3 s),
  the layout is hidden and "Look straight ahead" shows at the gaze, its ring
  filling as the head holds still; then the layout appears in place, the slabs
  fading in over 0.3 s. No layout at the pre-session pose that then jumps.
  Emulator: the prompt alone right after Start; the tables 0.5 s later.
- **20.** No pause when a puzzle load drops a dataset (2026-10-14). The
  headset's 281-392 ms long tasks (2026-10-14 04:00 log) came on Next, three of
  four within one dataset: not building (that was already sliced and done
  ahead) but disposing the dataset dropped from the kept set -- its parked
  tables and result slabs, in one go. Dropped documents now leave the scene at
  once (hidden, detached) and are disposed in the build queue, 2 ms a frame
  (`disposeUIKitDocumentLater`, src/uikit-dispose.ts), for dropped datasets,
  the outgoing tables of a switch and dropped outlines. Today's daily's dataset
  is kept built too (with the previous and next puzzles'), so Today and the
  picker's daily switch without building. Emulator, Next while joined (drops
  shop): the load 44.5 ms before (trimResultViews 31.5, trimParked 8.9), 1.9 ms
  after; then each result slab released in 9 frames (16 ms in all), each table
  in 3-4 (4-5 ms); loads after a switch 0.5 ms; the census back to 17 UIKit
  roots once settled. Dev: each load logs "perf: loaded in N ms"; the GC
  counter counts one collection per burst of sentinel finalizations (the 128
  "major GCs" of that log were about 4); the move guard allows the card's
  re-layout when a puzzle activates (after a switch that's 0.8 s after Next)
  and anything while the layout is hidden before the anchor.
  Then (headset, 04:27 log: loads 2.1-14.3 ms, no long tasks after the start)
  two card moves (5.8 and 2.0 cm) 1-3 s after loads: the group was planned
  from the pair's result slabs' sizes once built (the outline's until then),
  so a result slab finishing in the background re-planned it. Now the sizes
  are computed from the data without building (`tableSlabSizeMeters`,
  `resultSlabSize`), and dropped documents are released only after every
  build (the queue's `last` jobs), so they never delay one. Dev warns if a
  built result's size differs from its plan. Emulator with the build budget
  cut to 0.15 ms (Quest-like: result slabs done 1.1-2.3 s after loads), the
  same run of Next presses through four datasets: the old planning moved the
  card twice (4.7 and 2.7 cm, each just after a result slab finished); the new
  none, and no size mismatch in any dataset.

**Not started** (submission):

- **19.** Video footage: first join, NULL filter, fan-out win, dataset switch, "All 20 puzzles done."
- **20.** The edited video (under 3 minutes), the description (500 words), the tagline (140 characters), the hand-interaction section, and screenshots.
- **21.** A final check of the Vercel link on a Quest, then submitting.
- **22.** After submitting: a release tag in Git, and Vercel's automatic deploys off.

**To verify:**

- **14.** Dropped with free play (removed for now; see 10).
- **Welcome page on a Quest:** crisp text and the two-column layout at the
  browser's default window; Start enters XR; the page returns after exit.
- **15.** The Hint labels (Hint → Another hint → Show answer): in the copy and tested. Confirm on a Quest.
- **16.** Start as the only entry: the welcome panel's only XR button is Start. The "Enter XR" pill seen at the top of the dev page is most likely the emulator's (dev config). Confirm on the production link on a Quest.
- **17.** Answered (2026-10-11): with the panel off, frame times matched the
  earlier panel-on sessions; the panel's cost is small. Being joined (1-2.5 ms a
  frame) and puzzle loads (now under 50 ms) were the real costs.
- **72 Hz with the leak fixed:** verified on the headset (2026-10-14 04:00 log,
  4 min 46 s, all four datasets, dev with `?debug=1`): 72 Hz set; no growth --
  UIKit roots 12-13 with one dataset kept, 17 with two, 21 with three, the same
  each time; geometries level at 93-107, textures 10; about 4 major GCs, none
  causing a stall. The long tasks were the dataset disposals (fixed in 20).
- **Puzzle loads under 50 ms on a Quest (after 20):** verified (2026-10-14 04:27
  log): 2.1-14.3 ms, no long task after any load.
- **No card moves after puzzle loads (after 20's second part):** verified on the
  headset (2026-10-14 04:41 log): Next and Prev through all four datasets, 5
  switches, 22 loads in 2.0-13.4 ms; no "moved without an allowed reason", no
  "the group re-plans now"; one major GC in the minute (54 ms).
- **80 Hz again:** if 72 Hz holds with room, retry 80 Hz.
- **80 Hz holds (superseded by the line above):** a 3+ minute session with joins; the joined windows' frame gap
  p95 should stay near 12.5 ms (`scripts/headset_log.py frames`). If not, consider
  an automatic one-way fallback to 72 Hz after sustained misses.
- **Reload the headset tab first** (the log's first lines name the page's code; a STALE PAGE warning means reload).
- **The session clock:** verified on the headset, production (2026-10-14): the time above the card, and "Solved in 1:07" on a win.
- **The 0.6 m home on a Quest:** comfortable reading and reach across Prev, Next and dataset switches, joined and not. Measured on the headset (2026-10-14 04:00 log, all four datasets): slabs 0.57-0.60 m from the eyes, rows 1.15-1.21°, column buttons 0.50 m (0.49-0.54 m from the left shoulder), reach paths at least 10.3 cm, the group within ±42.2°, the lowest edge -35°, the card 0.85 m. Comfort: the user's call.
- **Entering XR at the desk:** verified on the headset, production (2026-10-14): the tables appear close and facing you. Still to see: the soft shadows on the desk (none visible in the 2026-10-14 photos; check with `?debug=1` whether a desk was detected).
- **Prev, Next and a dataset switch move nothing:** verified on the headset, production (2026-10-14).
- **Head movement moves nothing:** verified on the headset (2026-10-14 04:00
  log): the head ended 7-8 cm and up to 5.5° from the anchor and nothing
  followed it; the move guard's two card warnings were its own gaps (before the
  anchor, and a card re-layout 0.4 s after a switch), fixed in 20.
- **Recenter facing the button:** recenter while facing about where the Recenter
  button is (the case that cancelled on 2026-10-11); it should complete there.
- **Picker by hand:** tiles, Back and Puzzles by pinch and poke; a locked tile;
  a tile that switches datasets.

**Deferred:** 11 (the left-handed setting) and 12 (persistent anchors).

**Dropped:** 6 (distance grab) and 18 (a playtest with other people).

## Future

- **Free play, back as a guided mode:** unlocked after practice puzzles 1-3,
  with a "things to try" card and a dataset switcher (it was removed on
  2026-10-11 because, with no goal or guidance, a newcomer didn't know what to
  do in it). Its code and copy are dormant, ready to restore.

- **Three-table datasets** (e.g. borrowers, books and loans): more puzzle
  variety and a longer daily cycle than 20 days; needs a three-slab layout.

## Known limitations

- **`iwsdk-reference` doesn't connect** in Claude Code sessions, so its docs
  haven't been used. Try `npx @iwsdk/cli reference warmup`, then `/mcp`.
- **The seated head must be set by hand** in the emulator: the `seated` flag
  can't move the emulated headset, and logs `the seated pose did NOT take`.
  Set headset Pos Y = 1.2, Rot X = -8, then re-enter XR.
- **The managed Chromium window has no audio:** it's launched by Playwright,
  which normally mutes Chromium's output. To hear the sounds, use a normal
  browser tab on the dev server, or the headset. The debug log still proves
  each sound played, with its measured level.

## How it's built

IWSDK app (Vite + TypeScript):

| File | Role |
| --- | --- |
| `src/desk-placement.ts` | Places the source slabs within reach and view. |
| `src/join-system.ts` | The join: proximity and preview, dock, the group layout (column, result, card), animation timeline and sounds, the hand pointer, presses and holds. |
| `src/challenge-system.ts`, `src/challenge-view.ts` | Challenge mode: puzzles, card, the control column's buttons. |
| `src/band-arc.ts` | The column's arc around the eyes (placement and hit tests). |
| `src/hand-pointer-math.ts` | Hand pointer rules: freeze, pinch motion, hold select. Unit-tested. |
| `src/contact-poke.ts` | Fingertip poke detection. Unit-tested. |
| `src/hint-gate.ts` | Hint press spacing; Show answer's hold time. Unit-tested. |
| `src/recenter-countdown.ts`, `src/recenter-prompt.ts` | The Recenter button's countdown and its "Look straight ahead" prompt. |
| `src/reach-hint.ts`, `src/reach-banner.ts` | The reach banner's trigger (unit-tested) and the banner. |
| `scripts/headset_log.py` | Parses `logs/*.log`: pinches, summary, presses, layout, reach, recenter, context. |
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
- Headset logs: `python3 scripts/headset_log.py summary` (or `pinches
  --puzzle N`, `presses`, `reach`, `context --at HH:MM:SS`) on the newest
  `logs/headset-*.log`, or `--latest N` / file globs.
- Headset: the deployed link, or the dev server over Wi-Fi (network URL from
  `npx @iwsdk/cli dev status`; steps, the certificate warning and the flags in
  [`DEPLOY.md`](DEPLOY.md#testing-on-a-quest-over-wi-fi)). With `?debug=1`, an
  in-headset panel beside the tables mirrors the debug lines, warnings and
  errors, and shows frame times.
