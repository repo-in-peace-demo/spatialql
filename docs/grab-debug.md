# Grab debug guide

This guide covers the dev-only hand-grab readout (`src/grab-debug.ts`), the join
debug keys and logs (`src/join-debug.ts`, `src/join-system.ts`), the placement
readout (`src/desk-placement.ts`, `src/placement-debug.ts`), and the dev flags
that turn them on (`src/dev-flags.ts`). Everything here is taken from the code.
Where the code can't tell you something (for example, the emulator's own UI),
this guide says so.

Terms used below:

- **XR session**: the immersive mode (here, AR passthrough) that the app enters
  from the Enter XR button. The readouts do nothing outside an XR session.
- **IWER**: IWSDK's browser-based XR emulator. It stands in for a headset and
  hands while you run the dev server on a desktop.
- **Grip pose vs. target-ray pose**: WebXR gives each hand or controller two
  poses. The grip pose is where you'd hold something (for a hand, roughly the
  palm). The target-ray pose is where you'd point from. IWSDK's proximity grab
  uses the **grip pose**, which is why this guide keeps saying "palm."

See [Testing Your Experience](https://iwsdk.dev/guides/02-testing-experience.html)
for the general emulator and headset workflow.

## How grabbing and pressing work here

- Only the two source slabs (`customers`, `orders`) are grabbable
  (`OneHandGrabbable`). The join result slab is **view only**: it follows the
  docked pair and can't be grabbed. You undo a join by pulling a source slab
  apart.
- A grab happens when the hand's **grab sphere** touches a source slab and a
  squeeze starts. The sphere has a **7.0 cm radius** and is centered on the
  hand's grip pose (the palm, not the fingertips).
- Controllers squeeze with the grip button. Hands have no squeeze button, so
  `GrabSystem` forwards a hand's pinch as a squeeze. It only does this when
  `useHandPinchForGrab` is on (it is, in `iwsdk.config.json`), and only while
  that hand is the primary input on its side.
- The page only sees whether a pinch is pressed or released, not how strong it
  is, so the readout logs the thumb-to-index fingertip distance instead. The
  emulator's pose names ("default", "point") aren't visible through WebXR.

### The join-type control

When the slabs dock, an **INNER | LEFT** control fades in at the pair's front
(bottom) edge, the edge closest to you, centered on the seam between the two
slabs. It fades out when they separate.

- **Size:** each option is at least 4.0 cm wide and 2.5 cm tall
  (`CONTROL_OPTION_MIN_WIDTH_CM`, `CONTROL_OPTION_MIN_HEIGHT_CM`). The selected
  option is dark with light text; the other is light.
- **Placement:** it floats `CONTROL_SLAB_CLEARANCE_METERS` (10 cm) off the slabs
  toward your eyes and sits just below the pair's front edge in view, facing
  you. It's its own entity, not a child of any slab.
- **No grab hazard:** every point of the control is at least 10 cm from both
  source slabs, 3 cm more than the 7 cm palm grab sphere. A palm on the control
  can't reach a slab's grab surface, and the result slab isn't grabbable, so
  pressing or pinching the control never starts a grab.
- **Input:** it responds to a fingertip poke and a ray select (both are UIKit
  clicks), and to a pinch whose pinch point (midway between thumb and index
  tips) lands within 1.5 cm of an option in its plane and within 3 cm of its
  surface. Selecting the option that's already selected changes nothing.
- The SQL caption stays on the result slab and updates when you switch.

### Seated reach

Everything you touch is kept within seated reach (constants in
`src/view-comfort.ts`, meant to be tuned on a headset):

| Constant | Value | Meaning |
| --- | --- | --- |
| `TOUCH_REACH_MAX_METERS` | 0.60 m | Max eye-to-center distance for source slabs and the control |
| `FLOATING_MAX_BELOW_FORWARD_DEG` | 50° | Lowest edge of a floating slab, below head forward |
| `DESK_MAX_BELOW_FORWARD_DEG` | 55° | Lowest edge of a slab resting on a desk |
| `CONTROL_MAX_BELOW_FORWARD_DEG` | 60° | The control |
| `RESULT_MAX_ABOVE_FORWARD_DEG` | 30° | Top edge of the result slab (view only) |
| `MIN_ROW_TEXT_DEG` | 1.0° | Minimum row-text size on the result slab |

When the view limit and reach disagree, reach wins and the debug log warns.
The result slab may sit farther away than touchable content (up to 0.85 m),
pushed back until its top edge fits.

## 1. Setup

### Dev flags

There are three flags: `debug`, `seated` and `forceSurface`. They only work
under the dev server (`import.meta.env.DEV`); production builds never read them.

| Flag | What it does |
| --- | --- |
| `forceSurface` | Skips real surface detection. 1 s into the XR session, it places both slabs on a synthetic desk 0.45 m below the head. Slabs you've already grabbed (or that are docked) aren't moved. |
| `seated` | Lowers the emulated headset to a 1.2 m eye height, at page load and again at each XR session start. Does nothing on a real headset. |
| `debug` | Registers `GrabDebugSystem`, turns on the join debug keys, join and pinch logs, and the placement readout. |

Each flag is read from two places, in this order:

1. **The URL query**, if the flag is there: `?debug=1` (or just `?debug`)
   turns it on; `?debug=0`, `false` or `off` turns it off. The URL always wins.
2. **`localStorage`**, key `spatialql.<flag>`, value `1`.

**In the managed Chromium window (no address bar)**, use the hotkeys. Click the
app first so it has keyboard focus. Each press toggles the stored value and
reloads the page:

| Mac | Windows / Linux | Toggles |
| --- | --- | --- |
| Option+Shift+D | Alt+Shift+D | `debug` |
| Option+Shift+S | Alt+Shift+S | `seated` |
| Option+Shift+F | Alt+Shift+F | `forceSurface` |

They match physical keys, so they work even though Option+Shift+letter types a
special character on a Mac. They're ignored while typing in a text field.

**From DevTools** (any browser):

```js
localStorage.setItem('spatialql.debug', '1');   // set
localStorage.removeItem('spatialql.debug');     // clear
```

Then reload. **In a normal browser tab**, the URL works as before:
`?forceSurface=1&seated=1&debug=1`.

### Expected startup lines

Every dev load prints the effective flags:

```
[dev flags] debug=on, seated=on, forceSurface=on. Toggle with Option+Shift+D / S / F (Alt+Shift on Windows/Linux).
```

With all three flags on:

```
[seated] emulated headset lowered to 1.2 m eye height
[Join debug] keyboard shortcuts:
  J        join: bring orders to customers  (customers is LEFT)
  Shift+J  join: bring customers to orders  (orders is LEFT)
  T        toggle INNER / LEFT
  U        un-join: slide the RIGHT slab away and separate
[Grab debug] active. Grab sphere: 7.0 cm radius around each palm (grip pose). Hand pinch-to-grab: ON.
```

- If the `[seated]` line is a warning ("couldn't reach the emulated headset …"),
  lower the headset to about 1.2 m by hand with the emulator's headset controls,
  or with `npx @iwsdk/cli xr --help`.
- If the grab line ends with `OFF (useHandPinchForGrab is false)`, hand pinches
  won't grab anything. Check `iwsdk.config.json`.

### Placement and reach lines

Each time the slabs are placed (cold start, session start, and when the surface
search ends), the placement readout prints a collapsed group plus one line per
slab:

Measured in the emulator at a 1.2 m eye height, floating and then on the
`forceSurface` desk:

```
[DeskPlacement debug] customers: center 0.54 m from the eyes (reach limit 0.6 m, within reach); edges top -14.9°, bottom -39.7° (limit -50°)
[DeskPlacement debug] orders: center 0.56 m from the eyes (reach limit 0.6 m, within reach); edges top -11.5°, bottom -41.0° (limit -50°)
[DeskPlacement debug] customers: center 0.59 m from the eyes (reach limit 0.6 m, within reach); edges top -25.9°, bottom -48.3° (limit -55°)
[DeskPlacement debug] orders: center 0.60 m from the eyes (reach limit 0.6 m, within reach); edges top -19.3°, bottom -46.5° (limit -55°)
```

The limit is -50° for floating slabs and -55° on a desk, including the
`forceSurface` desk. A slab beyond reach logs
`[DeskPlacement] <slab> slab center is x.xx m from the eyes, beyond the 0.6 m seated reach limit.`

### On-screen dots

During an XR session, `debug` also draws a small dot (6 mm) at each palm:

- **Green**: the palm is within 7.0 cm of the nearest source slab, so a pinch
  should grab it.
- **Gray**: out of range.

### Hand mode

The emulator has **one input mode for both hands**, and it starts in
`controller` mode. Switch it to hands before testing. In controller mode there's
no pinch; the controllers grab with their grip (squeeze) button. Once hands are
active, the start logs say `hand pinch` instead of `controller squeeze`. The
steps below use the emulator's Hand panel controls: **Pos**, **Pose** (e.g.
point) and **Pinch** (1 = pinch, 0 = release).

## 2. What to check, step by step

`<hand>` below is `left` or `right`. `x.x` values vary. Line order can vary by a
frame.

### 2.1 Grab: palm on the orders slab, Pinch 1

1. Move the hand (Pos) until its dot turns green over the orders slab. Put the
   **palm** within about 5 cm of the slab, not just the fingertips: the
   emulated fingers reach about 10 cm past the palm. The Hand panel's Pos is
   not the palm either. With Rot at 0, the emulator measured the palm at
   Pos + (-3.8, -0.3, +3.7) cm and the pinch point at Pos + (0, -2.5, -1.2) cm.
2. Set Pinch to 1.

Expected:

```
[Grab debug] <hand> hand pinch start
  palm (grab sphere center) (x.xxx, y.yyy, z.zzz)
  pinch point (x.xxx, y.yyy, z.zzz), thumb-index tips x.x cm apart
  nearest slab: orders, palm x.x cm from its surface (in front)
[Grab debug] <hand> hand grabbed orders
[Grab debug] <hand> pinch: grab started on orders
```

If instead you get `[Grab debug] <hand> pinch: no grab - …`, see section 3.

### 2.2 Join: move to customers until the preview shows, Pinch 0

1. Keep holding orders (Pinch stays 1) and move it toward the customers slab.

   The slabs start 15 cm apart, so a grab and release in place never joins.
   The preview (a pulsing edge glow on both facing edges plus three hint lines)
   starts when all of these hold, measured in the customers slab's frame:
   - the edge gap is 6 cm or less (or the slabs overlap by up to 8 cm);
   - the out-of-plane distance is 8 cm or less;
   - the vertical offset from tops-aligned is 12 cm or less;
   - the rotation difference is 30° or less.

   Expected when the preview shows:

   ```
   [Join debug] enterRange: idle -> previewing (orders -> customers)
   ```

2. Set Pinch to 0. The join commits on release, not on contact.

Expected:

```
[Join debug] release: previewing (orders -> customers) -> joined (customers INNER JOIN orders)
  pairings: N matched, N unmatched-left, N unmatched-right; result rows (INNER): N
[Join debug] customers slab (touch): center x.xx m from the eyes (reach limit 0.6 m, within reach); edges top x.x°, bottom x.x° from head forward
[Join debug] orders slab (touch): center x.xx m from the eyes (reach limit 0.6 m, within reach); edges top x.x°, bottom x.x° from head forward
[Join debug] join-type control (touch): center x.xx m from the eyes (reach limit 0.6 m, within reach), x.x° from head forward (limit -60°); clearance to the nearest source slab x.x cm (palm grab sphere 7.0 cm, target >= 10.0 cm); options x.x cm x x.x cm
[Join debug] result slab (view only): x.xx m from the eyes (cap 0.85 m), center x.x°, top edge x.x°, bottom edge x.x° from head forward; row text x.xx° tall (source slabs x.xx° at x.xx m; minimum 1.00°)
[Grab debug] <hand> hand released orders: docked into a join
```

The slab that stayed put (customers) is LEFT; the one you brought over (orders)
is RIGHT. The join type always starts as INNER. Warnings follow any line whose
element breaks a limit (beyond reach, past its view limit, clearance under
10 cm, or result text under 1.0°).

If the preview dropped before release, you'll see this instead:

```
[Join debug] exitRange: previewing (orders -> customers) -> idle
[Grab debug] <hand> hand released orders: stayed free
```

Once the preview shows, it survives small movements. It only drops after you
go past looser limits for more than 0.15 s: a 9 cm gap, 12 cm of overlap, 12 cm
out of plane, 16 cm vertical, or 35°.

### 2.3 Press the control: poke, pinch, or ray

- **Poke:** set Pose to point and push the fingertip into LEFT.
- **Pinch:** put the pinch point on LEFT and set Pinch to 1, then 0.
- **Ray:** point the hand's ray at LEFT from a distance and pinch.

Expected, for any of the three:

```
[Join debug] setJoinType: joined (customers INNER JOIN orders) -> joined (customers LEFT JOIN orders)
  pairings: N matched, N unmatched-left, N unmatched-right; result rows (LEFT): N
```

Every pinch while the control is showing is also evaluated against it:

```
[Join debug] <hand> pinch evaluated against the control: pinch point 0.0 cm from LEFT in plane, 0.8 cm off its surface -> selected LEFT
[Join debug] <hand> pinch evaluated against the control: pinch point 4.2 cm from LEFT in plane, 1.1 cm off its surface -> not selected (needs <= 1.5 cm in plane and <= 3.0 cm off the surface)
```

(Numbers are examples.) If a press should have worked and didn't, this line
tells you how far off the pinch point was. `(already selected)` means the
option was already active, so nothing changed.

There should be **no** `[Grab debug] … hand grabbed …` line for any of these.

### 2.4 Pinching near the control or the result slab never grabs anything

Pinch at a few spots on and around the control, and on and around the result
slab. Expected: no `[Grab debug] <hand> hand grabbed …` line. Each pinch logs
`[Grab debug] <hand> pinch: no grab - …`, usually reason 4 (the palm is out of
range of every source slab). The result slab can't be grabbed at all.

Measured in the emulator, pinching at the control's center:

```
[Join debug] right pinch evaluated against the control: pinch point 1.8 cm from LEFT in plane, 0.9 cm off its surface -> not selected (needs <= 1.5 cm in plane and <= 3.0 cm off the surface)
[Grab debug] right pinch: no grab - palm is 14.5 cm from the orders slab surface (beside it); move the palm within 7.0 cm.
```

One exception: the result slab's bottom edge sits only about 3 cm above the
pair's top edge. A pinch there puts the palm within the 7 cm sphere of a
source slab's top edge and grabs **that source slab**, as it should:

```
[Grab debug] right hand pinch start
  palm (grab sphere center) (-0.000, 0.950, -0.500)
  ...
  nearest slab: orders, palm 2.5 cm from its surface (beside it)
[Grab debug] right pinch: grab started on orders
```

### 2.5 Poke a source slab with a pointing finger: does it start a grab by mistake?

1. Set Pose to point, and keep Pinch at 0.
2. Poke the customers or orders slab with the fingertip.

Expected: no `[Grab debug]` lines at all. The readout only logs
`hand pinch start` when a pinch actually starts. So a
`[Grab debug] <hand> hand grabbed customers` (or `orders`) line **without** a
`hand pinch start` line just before it means the poke started a grab.

### 2.6 Pull apart to undo the join

1. Pinch either docked slab.
2. Drag it more than 10 cm away from its dock position.

While you're still holding, the result slab and the control follow the pair.
Expected once you pass 10 cm:

```
[Join debug] pullApart: joined (customers INNER JOIN orders) -> separating (customers INNER JOIN orders)
  pairings: …; result rows (INNER): N
```

About 0.3 s later, once the lines retract and the result slab and control fade:

```
[Join debug] separated: separating (customers INNER JOIN orders) -> idle
```

(The join type shown is whichever was selected.) Then on release (Pinch 0):

```
[Grab debug] <hand> hand released orders: stayed free
```

If you release before 10 cm, there's no `pullApart` line. The slab snaps back
into its dock and the release line ends in `docked into a join`.

## 3. Reading the grab log

Every pinch (hands) or squeeze (controllers) logs a start line. The outcome is
logged 2 frames later, which gives `GrabSystem` time to run first.

On success:

```
[Grab debug] <hand> <pinch|squeeze>: grab started on <slab>
```

Otherwise:

```
[Grab debug] <hand> <pinch|squeeze>: no grab - <reason>
```

`<slab>` is `customers` or `orders`; only grabbable slabs are considered, so the
result slab never appears here. The reasons are checked in the order below, and
only the first one that applies is logged. Parts in `<…>` are filled in by the
code.

| # | Reason (word for word) | What it means | What to change |
| --- | --- | --- | --- |
| 1 | `hand pinch isn't routed to grabbing (GrabSystem.useHandPinchForGrab = false).` | Hand pinches never become grabs. | Nothing in the Hand panel will fix this. Set `world.features.grabbing.useHandPinchForGrab` to `true` in `iwsdk.config.json`. |
| 2 | `the <hand> hand isn't the primary input on its side, so its pinch isn't forwarded.` | Something else, such as a controller, is the active input on that side, so `GrabSystem` ignores this hand's pinch. | Not a Pos, Pose, or Pinch issue. Switch the emulator to hand input. |
| 3 | `there is no slab to grab.` | No visible grabbable slab was found when the pinch started. | Not a hand issue. The slabs aren't created or visible yet. Check the placement logs. |
| 4 | `palm is <x.x cm> from the <slab> slab surface (<where>); move the palm within 7.0 cm.` | The palm (not the fingertips) was out of range when the pinch started. Expected for pinches at the control. | **Pos**: move the hand so the palm sits within 7 cm of the slab, until its dot is green. `<where>` says which way you're off (see below). **Pose** doesn't move the palm. |
| 5 | `palm is within range of the <slab> slab (<x.x cm>, <where>) but no grab started - grab pointer hovering: <object>. This points at an app-side issue, not hand placement.` | Hand placement was fine, but `GrabSystem` still didn't grab. `<object>` is what the grab pointer was touching (its name, its type, or `nothing`). | Hand settings won't fix this. Look at the app: whether the slab still has `OneHandGrabbable`, and what `<object>` is. |

`<where>` is measured in the nearest slab's own frame, against its panel
rectangle:

| `<where>` | Palm position |
| --- | --- |
| `in front` | Over the slab's face, on the viewer's side. The distance is how far off the surface. |
| `behind` | Over the slab's face, on the back side. |
| `beside it` | Past the slab's left or right edge. |
| `above it` | Above the top edge. |
| `below it` | Below the bottom edge. |

A few more things to know about the start line:

- The `nearest slab` line (and the range test for reasons 4 and 5) uses the palm
  position when the pinch **started**, not 2 frames later.
- `thumb-index tips x.x cm apart` shows how closed the pinch was when the runtime
  counted it as a pinch. It's left out when joint poses aren't available.
- `no slab in the scene` in the start line pairs with reason 3.

Release lines come one frame after the slab is let go, so they can report whether
the join logic docked it:

```
[Grab debug] <hand> hand released <slab>: docked into a join
[Grab debug] <hand> hand released <slab>: stayed free
```

## 4. Debug keys

These are active with the `debug` flag. They're ignored while a key is held
down and repeating, with Ctrl, Cmd, or Alt/Option held, or while typing in a
text field. The letters were chosen to stay clear of the emulator's movement
keys (WASD/QE). None of them need a grab.

| Key | Action | Works in phase | Log |
| --- | --- | --- | --- |
| `J` | Joins with orders brought to customers: customers is LEFT, orders is RIGHT. Orders slides into its dock on whichever side of customers it's already on. | idle | `[Join debug] commit: idle -> joined (customers INNER JOIN orders)` plus stats and the layout lines from 2.2 |
| `Shift+J` | Same, reversed: customers is brought to orders, so orders is LEFT. | idle | `[Join debug] commit: idle -> joined (orders INNER JOIN customers)` plus stats |
| `T` | Toggles INNER / LEFT, through the same path as the control. | joined | `[Join debug] toggleJoinType: joined (… INNER JOIN …) -> joined (… LEFT JOIN …)` plus stats |
| `U` | Un-joins: slides the RIGHT slab 15 cm away from the LEFT one and separates them. | joined | `[Join debug] pullApart: …`, then `[Join debug] separated: … -> idle` |

When a key doesn't apply to the current phase:

- `J` / `Shift+J` log `[Join debug] join ignored in phase "<phase>"`.
- `U` logs `[Join debug] separate ignored in phase "<phase>"`.
- `T` logs nothing, because it doesn't change the state.

The flag hotkeys (Option+Shift+D / S / F) are separate; see section 1.

## 5. Headset notes

On a real Quest, run the dev server and open a network URL from
`npx @iwsdk/cli dev status` with `?debug=1` added. `seated` does nothing on a
headset. `forceSurface` still works and replaces real table detection with the
synthetic desk 0.45 m below the head.

The readouts help tune:

- **Reach.** Each placement and join logs every touchable element's distance
  from the eyes against the 0.60 m limit. If something feels too far, compare
  the logged distance with where you actually had to reach, and tune
  `TOUCH_REACH_MAX_METERS` and the placement constants in
  `src/desk-placement.ts`.
- **View limits.** The logged edge angles show how far down you're looking. If
  desk slabs or the control feel too low, the constants to tune are
  `DESK_MAX_BELOW_FORWARD_DEG`, `FLOATING_MAX_BELOW_FORWARD_DEG` and
  `CONTROL_MAX_BELOW_FORWARD_DEG`. If the control is uncomfortable that low,
  the fallback is to place it at the pair's side.
- **Grab range from the palm.** On real hands, people aim with their fingertips,
  but the 7 cm grab sphere follows the palm. For pinches that miss, reason 4
  gives the actual palm-to-slab distance and direction. The 7 cm radius is the
  SDK's default grab pointer size; `grab-debug.ts` only mirrors it.
- **Missed presses on the control.** Each pinch logs how far the pinch point was
  from the nearest option, in plane and off the surface, against the 1.5 cm /
  3 cm limits (`CONTROL_PINCH_MARGIN_METERS`, `CONTROL_PINCH_DEPTH_METERS` in
  `src/join-system.ts`).
- **Release drift.** A release that ends in `stayed free` right after an
  `exitRange` line means drift cancelled the join. The preview's looser exit
  limits and 0.15 s grace time are the values to tune.
- **Poke vs. pinch.** A grab with no `hand pinch start` line before it means a
  poke started the grab.
- **Result text size.** The join log compares the result slab's row text angle
  with the source slabs'. It warns under 1.0° (`MIN_ROW_TEXT_DEG`).
