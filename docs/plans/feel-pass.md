# Plan: the feel pass (and its addendum)

Goal: make the join satisfying. It opens the demo video and drives the "Best
First Five Minutes" award. Hands give no physical feedback, so sound and
motion carry it.

Status: implemented; emulator-tested (see "Results" below). Not yet tried on a
headset.

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

### Deviation

The row background was meant to fade in as cells land (`backgroundOpacity`),
but UIKit has no such property. Instead each row's opacity fades in over the
first 60% of its flight.

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

## Results (emulator)

- Sound order, J INNER: `snap` +0.00 s (-7.0 dBFS), 10 × `lineTick` +0.22 →
  +0.49 s (-27 to -33), `dropTap` +0.71 s (-11.0), `resolve` +1.15 s (-20.6).
  Shift+J the same. Toggle: `click` then `slideIn`. Pull apart: `release`.
- Join sequence: 1.15 s (INNER), 1.20 s (LEFT, 11 rows).
- Frame time during a replay (desktop, uncalibrated): p50 8.3 ms, p95 9.0 ms,
  max 9.4 ms, no dropped frames; one 112 ms long task (cause not traced).
- Addendum: pending re-test.

## Open (headset)

- Balance the snap (-7 dBFS) against the ticks (~-30 dBFS).
- Row backgrounds appear before their cells arrive; consider delaying them.
- Check the approach glow and hum by moving a slab by hand.
- Watch for the 112 ms long task at join start.
