# Plan: headset findings, distance grab (fix 3) and the group back and up (fix 4)

Status: the finding fixes and fix 4 are implemented, with the decisions taken
(gaze 4°, floating 0.25 m below the eyes, card bottom-aligned with 1.30° text),
waiting for a headset test. The "Move closer" banner and fix 3 (with near grabs
level and our own ray line and glow, the SDK's pointer hidden wherever ours
shows) come next. Updated with the headset session of 2026-10-07 02:29
(`logs/headset-20261007-022926.log`, commit c0dcf3c).

## Findings from the headset log

### 1. The result shrank or expanded on NULL pokes: a poke toggled the filter

Every poke on a NULL in the column already filtered **cleared** the filter
(`activateNullCell`: the same filter → `clearFilter`). Library puzzle 6:

| time | press | filter | rows shown |
|---|---|---|---|
| 02:33:58 | ray on row 6, DUE | set DUE | 8 → 3 |
| 02:34:00 | ray on row 7, DUE | **cleared** | 3 → 8 |
| 02:34:01 | ray on row 6, DUE | set DUE | 8 → 3 |
| 02:34:02 | ray on row 7, DUE | **cleared** | 3 → 8 |
| 02:34:06 | ray on row 6, DUE | set DUE | 8 → 3 |
| 02:34:08 | ray on row 6, DUE | **cleared** | 3 → 8 |
| 02:34:10 | ray on row 4, DUE | set DUE | 8 → 3 |
| 02:34:11 | ray on row 7, BR.ID | switched to BR.ID | 3 → 2, solved |

The same toggling happened in puzzles 7 (02:36:43 set, 02:36:44 cleared) and 9
(02:38:24 set, 02:38:31 cleared by a fingertip poke). No poke switched the
filter in a way that grew the result: every "expand" was a toggle-off.

**The filter is per column**, confirmed: one poke on DUE kept all three rows with
a NULL due date. The player never needs to select several NULLs.

**Fix (as you proposed):**

- A poke (or pinch, or ray) on a NULL only sets or switches the filter; it never
  clears it. Clear is the only way back.
- A poke on a NULL in the column already filtered changes nothing. It gives a soft
  tick and a brief pulse of the `WHERE` line in the caption and of the bar's
  `WHERE` label, so the press is acknowledged and shows which filter is active.
- The `WHERE` line and the bar's `WHERE` label already update on every change,
  including a switch.
- The F dev key follows the same rule.
- No hint text mentions poking again to clear; only the F key's help text
  ("filter on its column, or clear it") changes.
- Test: `activateNullCell`'s decision becomes a pure function (`nullPokeEvent`:
  same column → none, different → set) with unit tests.

### 2. The card overlapped the right-hand table (puzzles 6, 7): before the join

After a join the card never overlaps a slab: its bottom edge was +13° to +17°
from the gaze, and the slabs' tops were -4° to -15°. The overlap is **before**
the join, when the card sits beside the target outline (the silhouette), tops
aligned:

- Puzzles 6 and 7 have tiny targets (2 rows and 1 row), so their silhouettes
  are only about 9–10 cm tall. The card is 18.7 cm tall, so it hangs about
  9 cm below the silhouette's bottom edge.
- That is past the bar and onto the right slab's top rows: the books slab spans
  about 10°–41° right, and the card about 17°–43° right.
- Shop puzzle 5 (11 target rows) has a tall silhouette, so its card stayed high.

**Why nothing caught it:** the layout readout only runs at the join
(`warnIfOutOfView`), and it only compares the card's inner edge horizontally
with the result's edge. It never checks before the join, and never against
the slabs, the control or the bar.

**Fix:**

- **Placement:** after placing the card (before and after the join), raise it,
  if needed, until its bottom edge is at least 1.5° above the higher of the bar's
  top edge and the slabs' highest point (their name tabs), in view. The card stays
  on its arc and toed in.
- **Readout:** before the join (each time the pre-join layout runs) and at the
  join, log the card's clearance in view from every element: left slab, right
  slab, control (joined only), bar, and silhouette or result. This is the angular
  gap between their view rectangles (0 or negative = overlap), with a warning
  below 1°.
- **Measure:** all 20 puzzles in the emulator, before and after the join, floating
  and on a desk; report the table.

### 3. At the start: slabs cut off at the bottom, card hard to read

| what | measured |
|---|---|
| head height | 1.09 m (local-floor) |
| head pitch at the start | 2.8° to 3.7° up; 10 s medians 2.4° up to 1.9° down |
| head pitch while joined | medians up to 17° up (reading the result) |
| slabs at the start (floating) | centers 0.52–0.53 m; top edges -7.0° / -11.8°, bottom edges **-31.8° / -30.8°** from the 8° gaze, i.e. **about 40° below horizontal** |
| table | plane "table" 0.36 m below the eyes, its near edge **0.77 m** ahead (reach allows 0.44–0.45 m): floating, hint shown |
| card (pre-join) | 0.60 m (on its arc), row text 1.15° (sized for 0.60 m), about 17°–43° right; no readout before the join |
| card (joined) | 0.60 m, row text 1.15°, **20°–50° right** of the result's center, +13° to +34° from the gaze; its center is about 35° right and 23° up, far off the lens center |
| group (joined) | extent 58–66° of 80° (fits); slabs were pushed back by hand to 0.60–0.70 m before most joins |

**"Cut off at the bottom":** with the head about 3° up, the slabs' bottom edges
sat about 43° below the view center, at the lower edge of the headset's view.

**"Card hard to read":** its text is exactly at its 1.15° target, but it sits
35–50° off-axis to the right, where the lenses are least sharp. Size alone isn't
the issue; position is.

**Fix 4 already moves the slabs up and back**; this log supports it: you pushed
the slabs to 0.60–0.70 m yourself. The card changes are below (under "The card").

### Also found: opening Filter moved the control under your finger

At 02:36:50 Filter opened (by ray). The bar grew from about 13 to about 35 cm,
and the control and bar group re-centered on the seam, so the control slid
about 11 cm left. At 02:36:56 a poke aimed at LEFT pressed Back instead (the
touch readout shows the fingertip on LEFT; the bar's poke test pressed Back).

**Fix:** the control stays where it is when the bar changes width; the bar
grows to the right only. The bar re-places only its own position, never the
control's. The readout logs the bar's buttons (centers, distances) after each
resize.

## "Move closer to your table": prominent and live

### What happened

The status line showed it 15 times (at each puzzle and after each
separation), but the slabs never moved, because the check ran once at session
start.

### Banner

- **What:** a small non-interactive panel, "Move closer to your table" (the
  shorter form; the status line keeps the full sentence), at row-text size.
- **Where:** centered on the pair, just above the bar (in view, between the bar
  and the silhouette's lower edge), floating 5 cm in front of the silhouette.
  It is out of the band, and only shown before a join.
- **Pointer:** a thin line from the banner's bottom edge to the nearest point of
  the detected table's edge (`SegmentBatch`, 0.15 cm, 50% opacity).
- **Pulse:** the panel's opacity goes 0.55 → 1 → 0.55 over 2.4 s (sine; calm, no
  flashing). It fades in and out over 0.3 s.
- **Rules:** never shown while joined, mid-switch, or over a win. Placed with the
  pre-join layout, so it stays clear of the card and slabs by the clearance rule
  above.

### Live check

- Four times a second while the hint shows: re-assess the chosen surface (the one
  `assessSurface` already kept) against the current head position, and run the
  pure surface rule (`surfacePlacementCase`). This is one entity, with no
  per-frame allocation (scratch vectors).
- **When it becomes on-surface or desk-edge:**
  - fade the hint out;
  - glide the slabs onto the table over 0.45 s (the home-glide easing), re-running
    surface placement from the new head pose;
  - never a slab that's held, or that was moved by hand this puzzle (never-yank),
    and never while joined or mid-switch.
  - If one slab was moved by hand, neither moves: they must stay a pair. The hint
    then hides with "moved closer, slabs kept (moved by hand)".
- **Stops:** if you join while floating, the hint hides and the check stops for
  this puzzle. At the next puzzle load it runs once; if the table is still too
  far, the hint returns.
- **Log:**
  - `move-closer hint shown (table 0.77 m, reach 0.45 m)`
  - `hidden: moved closer | joined | puzzle change | session end`
  - `slabs re-placed onto the table (on-surface|desk-edge)`

With fix 4 the surface rule's distances change (below), so "close enough"
means the desk reaches the slabs' new line.

## The card: readable, and nearer the middle (with fix 4)

- **Bottom-aligned with the result** instead of top-aligned. Its center moves from
  about +23° to about +10° from the gaze, toward the lens center. The clearance
  rule keeps it above the bar and slabs.
- **Text:** row 1.15° → **1.30°**, goal 1.30° → 1.45°, at its actual distance (0.75 m
  with fix 4). Width stays 20 goal-ems, so the wrap tests don't change.
  - Its angular width grows from 26° to about 29°; it spans about 22°–51° right.
  - The readout adds the card's actual text angle at its actual distance (today
    it's only implied).
- **Alternative, if 51° is too far out:** 18 goal-ems wide. The message would
  then wrap about 11% sooner and may need 6 lines; the fit tests would tell.

## Fix 3: distance grab, carrying slabs level

### Why not the SDK's `DistanceGrabbable`

IWSDK's `GrabSystem` gives an entity exactly one grab handle
(`initializeDistanceHandle` returns early if a `Handle` exists).
`OneHandGrabbable` sets `pointerEventsType = { deny: 'ray' }` and
`DistanceGrabbable` sets `{ deny: 'grab' }`, so one slab can't have both near
grab and distance grab. Swapping components at runtime would cancel live grabs
and fight the never-yank rule. So: **keep `OneHandGrabbable` for near grabs and
add our own ray carry** in the join system, which already casts the hand ray
(`castRay`, from the last round).

### Behavior

- **Start:** a select start (pinch, or a controller's trigger) whose ray hits a
  source slab first (`castRay` target `slab`). The pinch must not be at a slab
  (a near grab) and must not land on a control, bar or NULL target. It doesn't
  start mid-switch or while that slab is docking or gliding.
- **Carry on the slab's own plane:** each frame the ray is intersected with the
  plane the slab had when it was picked up. The slab keeps its grab offset
  within that plane. Its orientation never changes: no tilt, no roll, and the
  same reading angle. Both slabs share the placement plane, so a carried slab
  always stays within the join preview's 8 cm depth limit. That makes docking
  by ray as easy as by hand.
- **Smoothing:** exponential, with a time constant of 0.05 s. At 0.7 m, hand-ray
  jitter of 1° moves the slab about 0.6 cm before smoothing.
- **Grazing guard:** if the ray is within 12° of parallel to the plane, the slab
  holds its last position, so it can't shoot off.
- **End:** select end. If the slab is in preview range, the join commits on
  release, exactly as a near grab does. A near grab by either hand takes over
  and ends the carry.
- **Joined:** carrying a docked slab more than 10 cm from its dock pose pulls
  the pair apart, as now.

### "Held" for the rest of the app

`Grabbed` belongs to `GrabSystem`; we never add it. Add a small
`SlabHeld` tag (system-free component) kept in sync by a `HeldSyncSystem`: a
slab is held while it is `Grabbed` or ray-carried. Switch every place that
reads "held" to it:

- join system: the `held` query (proximity and preview, release, home capture),
  `pulledApart`, dock and glide yielding, re-placing the result while held;
- desk placement: `grabbedSlabs` (the never-yank `touched` flag), `anySlabHeld`;
- the debug panel's "slabs at rest" check, and the grab readout.

### Showing what the ray will grab

The SDK draws no ray hit on our slabs (`deny: 'ray'`), so we add our own:

- a thin ray line (0.15 cm, 60% opacity) from the hand to the hit point,
  shown only while the ray hits one of our targets within 1.5 m;
- a hovered slab gets the existing edge glow at 0.25, so it reads as
  "pinch to grab".

It would reuse `SegmentBatch` and `EdgeGlow`, with no new allocations per frame.

### Near grab: carry level too (needs your decision)

Today a near grab rotates the slab with the hand (`OneHandGrabbable` defaults to
`rotate: true`); nothing keeps it level. **Proposed:** `rotate: false` on near
grabs as well, so slabs never tilt, by hand or by ray. A tilted slab is harder
to read and to dock (the preview allows 30° of misalignment).

### Logging (dev)

- `ray carry start: <slab> by <hand>, <d> m along the ray`
- `ray carry end: <slab>, docked | moved <cm>`
- `carry grazing: held`
- `near grab took over a ray carry`

These go into the `DEPLOY.md` dist grep.

## Fix 4: the group back and up

### What the headset said (two sessions)

- 01:34 session: the player leaned back; everything sat at 0.50–0.64 m, and the
  result's text was below 1° (fixed by the result cap).
- 02:29 session: the slabs started at 0.52 m with their bottom edges about 40°
  below horizontal (cut off at the bottom of the view), and you pushed them back
  to 0.60–0.70 m before most joins.
- Head pitch: about 0–4° up at the start, medians up to 17° up while reading the
  result. The layout assumes an 8° downward gaze, so for you the group sat low.

### Distances (text keeps its angular size; physical sizes scale)

| element | now | proposed | why |
|---|---|---|---|
| source slab centers | 0.52–0.55 m (`PLANNED_SOURCE_DISTANCE_METERS` 0.55) | **0.70 m** (new `SLAB_VIEW_DISTANCE_METERS`) | out of the near field; grabbed by ray |
| join-type control and bar | 0.45–0.50 m (planned 0.45) | **0.50 m** (planned 0.50) | stay within near reach (0.60) for poke and pinch |
| result slab | 0.56–0.59 m (planned 0.56) | **about 0.72 m** (planned 0.72) | follows the pair, just behind and above it |
| result cap (1.05° rows) | 0.61 m | **0.79 m** (follows the new planned font) | |
| card (arc beside the result) | 0.60 m, 1.15° text | **0.75 m, 1.30° text**, bottom-aligned | beside the result at about its depth; larger and nearer the middle (see "The card") |

At 0.70 m the row font grows from 1.10 to 1.40 cm, so the slabs are about 1.27×
larger physically and take the same angle. The card-fit and cell-fit tests are
in ems, so they don't change. Touch targets keep their 4 × 2.5 cm minimum.

**The band:** the control and bar are placed in view between the pair's top
edge and the result, as now. Instead of floating a fixed 10 cm off the slab
plane, they sit at 0.50 m from the eyes along that sight line. That is about
22 cm in front of the pair, so it stays reachable, and still at least 10 cm
from the slabs' grab surfaces. In view they are where they are now; in depth
they float clearly in front of the pair.

### Height (floating)

The slabs' center depression from horizontal, at 0.70 m:

| floating below the eyes | slab center below horizontal | group (estimated) below / above horizontal |
|---|---|---|
| 0.29 m (today's angles, only farther) | 24.5° | -35.5° / +26.5° |
| **0.25 m (proposed)** | **20.9°** | **-31.9° / +30°** |
| 0.22 m | 18.3° | -29.3° / +32.7° |

The estimate assumes the group's extent shrinks from about 66° to about 62° at
0.70 m, because the fixed metric gaps (8 cm above the pair, 9 cm dock gap) take
fewer degrees farther away. I'll measure this before choosing.

**Proposed: 0.25 m below the eyes, about 0.65 m ahead** (`FLOATING_FORWARD_METERS`
0.42 → 0.65). That raises the slabs about 8° from today.

**Gaze reference, needs your decision:** `NATURAL_GAZE_PITCH_DEG` 8 → **4** (between
the earlier session's 8° and this one's about 0°). The view window becomes
4° ± 40°. With 0.25 m below and a 4° gaze, the group is about -28° / +34° from
the gaze. With the gaze kept at 8°, the top would sit at about +38°, near the
+40° limit, and the result push-back would start working again. 0.22 m only
fits with a 4° gaze or less.

### On a desk

The same 0.70 m slab centers. With a surface 0.45 m below the eyes, the
propped slabs' bottom edges rest about **0.56 m ahead** (today 0.32 m). Their
bottom edges are then about 35° below a 4° gaze, inside the window; today they
are at -44°, accepted under option (a).

The surface rule (`surface-placement.ts`) changes from reach to view distance:

- on-surface if the desk reaches the 0.56 m line;
- desk-edge if its near edge is at most 12 cm beyond it (slabs at the line, at
  desk height);
- otherwise floating, with "Move closer to your table to use it."

A desk whose near edge is more than about 0.68 m away floats. Its far edge must
reach about 0.65 m (most desks do, seated 20–30 cm from the edge).

### Unchanged

- Reach 0.60 m still applies to the control, bar, chips and NULL pokes.
- Source slabs are now reported as "near reach: no (ray grab)" instead of
  warning "BEYOND REACH".
- Preview and dock thresholds, join lowering (at most 0.30 m), the dock gap
  and the slab gap stay as they are.

### Measuring before the report

Emulator, seated (y 1.2), at the chosen gaze. All 20 puzzles, floating and
forced desk, using the existing per-puzzle loop. For each:

- slab, control, bar, result and card distances and edges;
- the group extent;
- row text angles;
- the card's horizontal span;
- the control and bar distances against reach.

Plus one ray carry and dock per dataset (controller ray in IWER), and the
carry log lines.

## Order

1. Findings fixes: the NULL poke never clears; the control stays put when the
   bar resizes; the card clearance rule and readout (measure all 20 puzzles,
   before and after the join).
2. Fix 4's distances and heights, with the card changes; then measure, and
   adjust the floating height if the measured extent differs from the estimate.
3. The live, prominent "Move closer" banner (it uses fix 4's surface rule).
4. Fix 3's held tag (a refactor with no behavior change), then the ray carry,
   ray line and hover.
3. Tests:
   - pure placement numbers: surface rule cases and the floating forward/below
     solution;
   - the carry's plane intersection and grazing guard as a pure function, with
     unit tests.
4. Docs (`STATUS.md`, `grab-debug.md`, `DEPLOY.md` grep). You run typecheck,
   tests and build after each step; headset checklist at the end.

## Decisions for you

1. Near grab `rotate: false` (slabs never tilt)? **Recommended: yes.**
2. Gaze reference 8° → 4°? **Recommended: yes**, given this session's pitch log.
3. Floating 0.25 m (recommended) or 0.22 m below the eyes.
4. Our own ray line and slab hover glow (recommended), or rely on the SDK's ray
   visual (which doesn't show hits on our slabs).
5. The card: bottom-aligned with the result and text at 1.30° (recommended), or
   also narrower (18 goal-ems)?
6. "Move closer": if you had moved a slab by hand, should the live check still
   move both onto the table? **Recommended: no** (never-yank); the hint just hides.
