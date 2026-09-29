# Grab debug guide

This guide covers the dev-only hand-grab readout (`src/grab-debug.ts`), the join
debug keys (`src/join-debug.ts`), and how they report on the grab and join flow in
`src/join-system.ts`. Everything here is taken from the code. Where the code
can't tell you something (for example, the emulator's own UI), this guide says so.

Terms used below:

- **XR session**: the immersive mode (here, AR passthrough) that the app enters
  from the Enter XR button. The readout does nothing outside an XR session.
- **IWER**: IWSDK's browser-based XR emulator. It stands in for a headset and
  hands while you run the dev server on a desktop.
- **Grip pose vs. target-ray pose**: WebXR gives each hand or controller two
  poses. The grip pose is where you'd hold something (for a hand, roughly the
  palm). The target-ray pose is where you'd point from. IWSDK's proximity grab
  uses the **grip pose**, which is why this guide keeps saying "palm."

See [Testing Your Experience](https://iwsdk.dev/guides/02-testing-experience.html)
for the general emulator and headset workflow.

## How grabbing works here

These are the rules the readout reports against (from the header of
`src/grab-debug.ts`):

- The source slabs (`customers`, `orders`) and the join result slab are
  `OneHandGrabbable`. A grab happens when the hand's **grab sphere** touches the
  slab and a squeeze starts.
- The grab sphere has a **7.0 cm radius** and is centered on the hand's grip pose
  (the palm, not the fingertips).
- Controllers squeeze with the grip button. Hands have no squeeze button, so
  `GrabSystem` forwards a hand's pinch as a squeeze. It only does this when
  `useHandPinchForGrab` is on, and only while that hand is the primary input on
  its side.
- `iwsdk.config.json` turns it on:

  ```json
  "grabbing": {
    "useHandPinchForGrab": true
  }
  ```

- The page only sees whether a pinch is pressed or released, not how strong it
  is. So instead of a pinch strength, the readout logs the distance between the
  thumb tip and the index fingertip. The emulator's pose names ("default",
  "point") aren't visible through WebXR, so the readout can't report them.

The join result slab gets `OneHandGrabbable` only while a join is shown. The
INNER | LEFT pill is a separate entity with `PokeInteractable` and
`RayInteractable`, and it is **not** grabbable. It sits 1.2 cm above the result
slab's top edge, right-aligned, and follows the slab. It isn't a child of the
slab, so a poke on the pill can't bubble up to the slab's grab handle.

## 1. Setup

### URL flags

All three flags only work under the dev server (`import.meta.env.DEV`) and are
removed from production builds. The code checks whether each flag is present,
so `?debug` and `?debug=1` behave the same. Combine them like this:

```
?forceSurface=1&seated=1&debug=1
```

| Flag | Read in | What it does |
| --- | --- | --- |
| `?forceSurface=1` | `src/desk-placement.ts` | Skips real surface detection. 1 s into the XR session, it places both slabs on a synthetic surface 0.45 m below the head. Slabs you've already grabbed (or that are docked) aren't moved. |
| `?seated=1` | `src/index.ts` → `src/dev-seated.ts` | Lowers the emulated headset to a 1.2 m eye height, at page load and again at each XR session start. It does nothing on a real headset. |
| `?debug=1` | `src/index.ts`, `src/join-system.ts`, `src/desk-placement.ts` | Registers `GrabDebugSystem`, turns on the join debug keys and join transition logs, and turns on the placement debug readout. |

Expected console lines at startup with all three flags:

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
- After the XR session starts with `?forceSurface=1`, the placement readout logs
  an event named `forced surface (SYNTHETIC, ?forceSurface)`.

### On-screen dots

During an XR session, `?debug=1` also draws a small dot (6 mm) at each palm, on
top of everything:

- **Green**: the palm is within 7.0 cm of the nearest visible slab, so a pinch
  should grab it.
- **Gray**: the palm is out of range.

A hand with no active input shows no dot.

### Hand mode

Switch the emulator's input from controllers to hands before testing. The code
can't show where that switch is in the emulator UI; see the testing guide linked
above. Once hands are active, the start logs say `hand pinch` instead of
`controller squeeze`. The steps below use the emulator's Hand panel controls:
**Pos** (hand position), **Pose** (hand shape, e.g. point), and **Pinch** (1 =
pinch, 0 = release).

## 2. What to check, step by step

`<hand>` below is `left` or `right`, whichever hand you're using. `x.x` values
vary. Log line order can vary by a frame.

### 2.1 Grab: palm on the orders slab, Pinch 1

1. Move the hand (Pos) until its dot turns green over the orders slab.
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

1. Keep holding orders (Pinch stays 1).
2. Move it toward the customers slab.

The slabs start 15 cm apart, so a grab and release in place never joins. The
preview starts when all of these hold, measured in the customers slab's frame:

- the edge gap is 6 cm or less (or the slabs overlap by up to 8 cm)
- the out-of-plane distance is 8 cm or less
- the vertical offset from tops-aligned is 12 cm or less
- the rotation difference is 30° or less

The preview is a pulsing edge glow on both facing edges plus three hint lines.

Expected when the preview shows:

```
[Join debug] enterRange: idle -> previewing (orders -> customers)
```

3. Set Pinch to 0. The join commits on release, not on contact.

Expected:

```
[Join debug] release: previewing (orders -> customers) -> joined (customers INNER JOIN orders)
  pairings: N matched, N unmatched-left, N unmatched-right; result rows (INNER): N
[Join debug] result slab: x.xx m from the eyes (cap 0.85 m), center x.x°, top edge x.x° (pill incl.), bottom edge x.x° from head forward; row text x.xx° tall (source slabs x.xx° at x.xx m)
[Grab debug] <hand> hand released orders: docked into a join
```

The slab that stayed put (customers) is LEFT, and the one you brought over
(orders) is RIGHT. The join type always starts as INNER. `[Join debug]`
warnings about slab edges being outside the comfortable view may also appear;
those are about placement, not grabbing.

If the preview dropped before release, you'll see this instead:

```
[Join debug] exitRange: previewing (orders -> customers) -> idle
[Grab debug] <hand> hand released orders: stayed free
```

Once the preview is showing, it survives small movements. It only drops after
you go past looser limits for more than 0.15 s: a 9 cm gap, 12 cm of overlap,
12 cm out of plane, 16 cm vertical, or 35°.

### 2.3 Pill poke: point pose, poke LEFT; no grab of the result slab

1. Set Pose to point.
2. Move the fingertip into the LEFT option of the pill above the result slab.

Expected:

```
[Join debug] setJoinType: joined (customers INNER JOIN orders) -> joined (customers LEFT JOIN orders)
  pairings: N matched, N unmatched-left, N unmatched-right; result rows (LEFT): N
```

There should be **no** `[Grab debug] <hand> hand grabbed result` line. If LEFT
is already selected, poking it changes nothing and logs nothing.

### 2.4 Pinch at the pill: does it grab the result slab by mistake?

1. Move the pinch point onto the pill.
2. Set Pinch to 1.

The start log reports the palm, the pinch point, and the nearest slab. Keep in
mind that the grab sphere follows the palm, not the pinch point. The pill is only
1.2 cm above the result slab, so with the fingertips on the pill, the palm can
easily be within 7.0 cm of the result slab.

| Log line | Meaning |
| --- | --- |
| `[Grab debug] <hand> hand grabbed result` and `… pinch: grab started on result` | The mistake: the pinch grabbed the result slab. |
| `[Grab debug] <hand> pinch: no grab - …` | No grab happened. The reason says why (section 3). |

Also note whether a `[Join debug] setJoinType …` line appears during this pinch.

### 2.5 Poke a source slab with a pointing finger: does it start a grab by mistake?

1. Set Pose to point, and keep Pinch at 0.
2. Poke the customers or orders slab with the fingertip.

Expected: no `[Grab debug]` lines at all.

The readout only logs `hand pinch start` when a pinch actually starts. So if you
see `[Grab debug] <hand> hand grabbed customers` (or `orders`) **without** a
`hand pinch start` line just before it, the poke started a grab.

### 2.6 Pull apart to undo the join

1. Pinch either docked slab.
2. Drag it more than 10 cm away from its dock position.

Expected while still holding:

```
[Join debug] pullApart: joined (customers INNER JOIN orders) -> separating (customers INNER JOIN orders)
  pairings: …; result rows (INNER): N
```

About 0.3 s later, once the lines retract and the result slab fades:

```
[Join debug] separated: separating (customers INNER JOIN orders) -> idle
```

(The join type in these lines is whatever was selected, INNER or LEFT.)

Then on release (Pinch 0):

```
[Grab debug] <hand> hand released orders: stayed free
```

If you release before moving 10 cm, there's no `pullApart` line. The slab snaps
back into its dock, and the release line ends in `docked into a join`.

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

`<slab>` is `customers`, `orders`, or `result`. The reasons are checked in the
order below, and only the first one that applies is logged. Parts in `<…>` are
filled in by the code.

| # | Reason (word for word) | What it means | What to change |
| --- | --- | --- | --- |
| 1 | `hand pinch isn't routed to grabbing (GrabSystem.useHandPinchForGrab = false).` | Hand pinches never become grabs. | Nothing in the Hand panel will fix this. Set `world.features.grabbing.useHandPinchForGrab` to `true` in `iwsdk.config.json`. |
| 2 | `the <hand> hand isn't the primary input on its side, so its pinch isn't forwarded.` | Something else, such as a controller, is the active input on that side, so `GrabSystem` ignores this hand's pinch. | Not a Pos, Pose, or Pinch issue. Switch that side of the emulator to hand input. |
| 3 | `there is no slab to grab.` | No visible slab was found when the pinch started. | Not a hand issue. The slabs aren't created or visible yet. Check the placement logs. |
| 4 | `palm is <x.x cm> from the <slab> slab surface (<where>); move the palm within 7.0 cm.` | The palm (not the fingertips) was out of range when the pinch started. | **Pos**: move the hand so the palm sits within 7 cm of the slab, until its dot is green. `<where>` says which way you're off (see below). **Pose** doesn't move the palm. |
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

These are active with `?debug=1`. They're ignored while a key is held down and
repeating, with Ctrl, Cmd, or Alt held, or while typing in a text field. The
letters were chosen to stay clear of the emulator's movement keys (WASD/QE).
None of them need a grab.

| Key | Action | Works in phase | Log |
| --- | --- | --- | --- |
| `J` | Joins with orders brought to customers: customers is LEFT, orders is RIGHT. Orders slides into its dock on whichever side of customers it's already on. | idle | `[Join debug] commit: idle -> joined (customers INNER JOIN orders)` plus stats |
| `Shift+J` | Same, reversed: customers is brought to orders, so orders is LEFT. | idle | `[Join debug] commit: idle -> joined (orders INNER JOIN customers)` plus stats |
| `T` | Toggles INNER / LEFT. It goes through the same path as the pill. | joined | `[Join debug] toggleJoinType: joined (… INNER JOIN …) -> joined (… LEFT JOIN …)` plus stats |
| `U` | Un-joins: slides the RIGHT slab 15 cm away from the LEFT one and separates them. | joined | `[Join debug] pullApart: …`, then `[Join debug] separated: … -> idle` |

When a key doesn't apply to the current phase:

- `J` / `Shift+J` log `[Join debug] join ignored in phase "<phase>"`.
- `U` logs `[Join debug] separate ignored in phase "<phase>"`.
- `T` logs nothing, because it doesn't change the state.

## 5. Headset notes

On a real Quest, run the dev server and open a network URL from
`npx @iwsdk/cli dev status` with `?debug=1` added. `?seated=1` does nothing on a
headset. `?forceSurface=1` still works and replaces real table detection with the
synthetic surface 0.45 m below the head.

The readout helps tune three things:

- **Grab range from the palm.** On real hands, people aim with their fingertips,
  but the 7 cm grab sphere follows the palm. For pinches that miss, reason 4
  gives the actual palm-to-slab distance and direction (`in front`, `beside it`,
  …), and the start line gives both palm and pinch-point positions. Collect a
  few misses to judge whether 7 cm is too tight for how people reach. Note that
  the 7 cm radius is the SDK's default grab pointer size; `grab-debug.ts` only
  mirrors it and doesn't change it. The green/gray palm dot shows range live.
- **Release drift.** Tracked fingers move while opening a pinch, which can drag
  the slab out of the preview just before release. Check the release line: a
  release that ends in `stayed free` right after an `exitRange` line means drift
  cancelled the join. The preview's looser exit limits and 0.15 s grace time (in
  `src/join-system.ts`) are the values to tune.
- **Poke vs. pinch.** A grab that starts with no `hand pinch start` line before it
  means a poke started the grab. A pinch start with `thumb-index tips x.x cm
  apart` shows how closed the fingers were when the headset counted the pinch.
  Compare pinches at the pill with pinches on a slab: if a pinch at the pill
  grabs `result`, the palm is in range of the result slab even though the
  fingertips are on the pill.
