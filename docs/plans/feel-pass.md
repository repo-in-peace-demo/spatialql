# Plan: the feel pass (and its addendum)

Goal: make the join satisfying. It opens the demo video and drives the "Best
First Five Minutes" award. Hands give no physical feedback, so sound and
motion carry it.

Status: planned and approved, then implemented and emulator-tested (see
"Results" below), including the addendum (section 3) and the follow-ups
(section 4). Not yet tried on a headset.

## Constraints

- 60 fps on Quest: no per-frame allocation (tween pool), no per-frame layout
  rebuilds; anything extra is built at startup.
- No change to join semantics, input handling, grab behavior, placement,
  reach, or view limits.
- Works with sound muted or unavailable; sound is never the only feedback.

## 1. Sound: `src/sound.ts`

The SDK's `AudioSource` plays audio files only, so sounds are synthesized with
Web Audio (no files: no licensing, nothing to download). They use the audio
context behind IWSDK's three.js `AudioListener` on the player's head, so
spatial audio follows the head; without it, the module makes its own context
and moves the listener each frame.

| Event | Recipe | API |
| --- | --- | --- |
| Approach / preview | soft detuned sines (~180–260 Hz), low-passed; level and pitch rise as the gap closes, fade if you pull away | `setPreviewProximity(amount, at)` |
| Dock (commit) | pitch drop ~150 → 60 Hz + short filtered-noise click | `playSnap` |
| Each match line | ~10 ms sine blip, 1.6 → 2.4 kHz across the sequence | `playLineTick(i, n)` |
| Result assembled | two soft triangle notes a fifth apart | `playResolve` |
| Unmatched rows drop | low muted thump at the first bounce | `playDropTap` |
| Control press | ~6 ms high-passed noise tick (debounced) | `playClick` |
| LEFT row in / out | band-passed noise sweep, up / down | `playSlide` |
| Pull apart | the snap reversed, softer | `playRelease` |

- **Spatial:** each one-shot gets an HRTF panner at the seam, row, or control.
  Nodes are created per event, never per frame; the hum only updates existing
  params.
- **Unlock:** `unlock()` on the Enter XR tap, at session start, and on the
  first pinch; never throws. Until the context runs (or when muted), play
  calls are no-ops.
- **Volume:** `MASTER_VOLUME` (0.3) and a soft limiter on the master bus.
- **Dev:** a `mute` flag (Option+Shift+M). With `debug`, each sound logs its
  timing and measured output peak; the meter reads inside the app, so it works
  in a muted browser.

## 2. Motion: `src/join-system.ts`

- **Dock:** 0.22 s with a slight overshoot and settle (`easeOutBackSoft`);
  redock too.
- **Magnet:** from 15 cm (`APPROACH_GAP_METERS`) to the 6 cm preview gap, the
  facing edges glow and the hum rises; in preview the pulse speeds up as the
  gap closes. The held slab is never moved.
- **Rows fly in (hero shot):** each result row's LEFT cells and RIGHT cells
  start at their own source rows (lineage `RowRef`s) and fly to the row's slot,
  in pairing order (0.05 s stagger, 0.35 s flights, ease-in-out). The offsets
  are per-row, per-side signals bound to the cells' transforms, created with
  the result slab at startup.
- **Match lines:** a short bright pulse rides each line's tip as it draws (a
  second prebuilt segment batch).
- **Unmatched rows:** drop with a bounce, then settle dimmed (see addendum).
- **Timeline:** 0 snap; 0–0.22 dock; lines from 0.22 (+0.03 each); rows from
  0.35; drops from 0.55; resolve when the last row lands. Target < 1.5–2 s.
- **Dev:** `R` (with `debug`) replays the join animation and sounds on the
  docked pair without separating; the log prints a `join sequence: …`
  breakdown.

### Deviation (resolved in section 4)

The row background was meant to fade in as cells land (`backgroundOpacity`),
but UIKit has no such property. At first each row's opacity faded in over the
first 60% of its flight (backgrounds showed before the cells); section 4
replaced that with a separate background layer.

## 3. Addendum: unmatched rows stay in their own slot

**Bug:** an unmatched source row (Odalys Ferreira in customers) dropped a
fixed 1.0 cm. Since text is sized by angle, a source row is only ~2.15 cm
tall, so it dropped nearly half a row and overlapped Jun Park below, leaving
its own slot empty.

**Fix:**

- `DIM_DROP_ROW_FRACTION` = 0.12 replaces the fixed `DIM_DROP_CM`: the drop is
  12% of the row's own height (~0.26 cm), within the 15% limit.
- `easeOutBounce` never passes its target, so the bounce stays inside the
  slot.
- Restoring eases back to exactly 0; every toggle tweens to absolute targets,
  so toggling can't accumulate an offset.
- Chosen over a depth push: the slabs face the eyes almost head-on, so a few
  millimetres of depth barely reads; a small drop still says "falling out",
  matches the bounce and the tap, and the dimming carries most of the
  exclusion.
- Dev readout: after each drop/restore settles, the log reports every
  unmatched row's offset (cm and % of its row height, against the limit) and
  opacity.

**Verify:**

- J (customers is LEFT): switching to LEFT un-dims Odalys and returns her row
  exactly to 0 (a customers LEFT JOIN keeps her).
- Shift+J (orders is LEFT): Odalys stays excluded in LEFT; order 108 un-dims
  and returns.
- Five INNER ↔ LEFT toggles: the row's final offset matches its original.
- Screenshots of the customers slab for J + LEFT and Shift+J + LEFT.

## 4. Follow-ups (planned, approved, then implemented)

1. **Addendum re-test** (no code).
2. **Sound balance:** per-sound peak gains as named constants (`SNAP_GAIN`,
   `TICK_GAIN` + `TICK_RISE_GAIN`, `RESOLVE_GAIN`); ticks 10–14 dB and the
   resolve 8–10 dB below the snap; `MASTER_VOLUME` and the limiter unchanged.
3. **Row backgrounds wait for their cells:** UIKit has no
   `backgroundOpacity`, and a row's `opacity` also fades its cells, so each
   result row paints its background on its own absolutely positioned layer
   behind the cells, with its own fade. Cells are visible from the start of
   their flight; the background fades in over the last 30% of it
   (`ROW_BACKGROUND_LANDING_FRACTION`). Key tints recolor that layer.
4. **The 112 ms long task:** measure first (dev-only long-task observer timed
   from join start, and a breakdown of the join-start work), then pre-warm
   only what the measurement implicates.

## Results (emulator)

- Sound order, J INNER: `snap` +0.00 s, 10 × `lineTick` +0.22 → +0.49 s,
  `dropTap` +0.71 s, `resolve` +1.15 s. Shift+J the same. Toggle: `click` then
  `slideIn`. Pull apart: `release`.
- Sound levels (output peak, dBFS):

  | Sound | Before | After | Below the snap |
  | --- | --- | --- | --- |
  | snap | -7.0 | -6.9 | — |
  | lineTick ×10 | -27.1 to -32.7 | -18.3 to -21.4 | 11.4–14.5 dB (target 10–14) |
  | resolve | -20.6 | -16.1 | 9.2 dB (target 8–10) |
  | dropTap | -11.0 | -11.0 | 4.1 dB (unchanged) |

- Join sequence: 1.15 s (INNER), 1.20 s (LEFT, 11 rows).
- Row backgrounds: mid-flight, landed cells show without their background
  until the fade; no empty tinted strips.
- Frame time during a replay (desktop, uncalibrated): p50 8.3 ms, p95 9.0 ms,
  max 9.4 ms, no dropped frames.
- Long task: **not reproduced.** No long tasks on a cold first join after a
  page load, an `R` replay, or a second join. Join-start work: 0.3–0.4 ms
  setup and placement, 1.9–3.2 ms sequence, 0.4–0.5 ms debug readout. The
  earlier 112 ms was recorded while the browser profiler was running, its
  likeliest source. No pre-warming added (nothing implicated); the dev
  readout stays in place to catch it on a headset.
- Addendum (unmatched rows, 2.15 cm rows, limit 12%):

  | Case | Row | INNER | LEFT |
  | --- | --- | --- | --- |
  | J | Odalys (customers row 4) | 0.258 cm, opacity 0.35 | 0.000 cm, opacity 1.00 |
  | J | order 108 (orders row 7) | 0.258 cm, 0.35 | 0.258 cm, 0.35 |
  | Shift+J | order 108 | 0.258 cm, 0.35 | 0.000 cm, 1.00 |
  | Shift+J | Odalys | 0.258 cm, 0.35 | 0.258 cm, 0.35 |

  Five INNER ↔ LEFT toggles (J): INNER 0.258 cm and LEFT 0.000 cm every
  time; Odalys ends at exactly 0.000 cm. Screenshots: J + LEFT, Odalys fully
  restored; Shift+J + LEFT, Odalys dimmed inside her own slot, clear of Jun
  Park.

## Open (headset)

- Judge the sound levels by ear (the emulator window is muted).
- Check the approach glow and hum by moving a slab by hand.
- Watch the dev long-task readout at join start on a Quest.
