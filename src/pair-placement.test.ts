import { describe, expect, it } from 'vitest';
import { decidePlacementMode, planPair, type Footprint, type P3, type PairPlan, type PlacementMode, type SlabSize } from './pair-placement.js';
import { SLAB_VIEW_DISTANCE_METERS } from './view-comfort.js';

const deg = (d: number) => (d * Math.PI) / 180;
const dist = (a: P3, b: P3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const TAB = 0.03;
const size = (widthCm: number, heightCm: number): SlabSize => ({ width: widthCm / 100, height: heightCm / 100, tab: TAB });

/** The four datasets' slabs (logged at their switches, 2026-10-12: "slabs customers 28.6 x 21.8 cm, ..."). */
const DATASET_SLABS: Record<string, [SlabSize, SlabSize]> = {
  shop: [size(28.6, 21.8), size(36.2, 27.2)],
  library: [size(28.1, 19.0), size(35.9, 27.2)],
  school: [size(23.1, 19.0), size(34.4, 24.5)],
  cafe: [size(22.8, 19.0), size(22.5, 27.2)],
};

/** An axis-aligned desk top: x and z bounds (world), at `topY`. */
function desk(minX: number, maxX: number, minZ: number, maxZ: number, topY: number): Footprint {
  return { toLocal: (p) => ({ ...p }), toWorld: (p) => ({ ...p }), minX, maxX, minZ, maxZ, topY };
}

const samePlan = (a: PairPlan, b: PairPlan) => {
  expect(dist(a.left.center, b.left.center)).toBeLessThan(1e-9);
  expect(dist(a.right.center, b.right.center)).toBeLessThan(1e-9);
  expect(a.left.lean).toBeCloseTo(b.left.lean, 12);
  expect(a.mode).toBe(b.mode);
};

describe('pair placement (pure): from the layout anchor, in the mode decided at it', () => {
  const eyes = { x: 0, y: 1.12, z: 0 };

  it('floating: both slab centers about the 0.6 m view distance from the eyes (the shorter slab a few mm farther)', () => {
    expect(SLAB_VIEW_DISTANCE_METERS).toBe(0.6);
    for (const [name, [left, right]] of Object.entries(DATASET_SLABS)) {
      const plan = planPair(eyes, 0, { kind: 'floating' }, left, right);
      const far = Math.max(dist(plan.left.center, eyes), dist(plan.right.center, eyes));
      expect(far, name).toBeLessThanOrEqual(0.6 + 0.005);
      expect(far, name).toBeGreaterThan(0.55);
      // Ahead (-Z for yaw 0), below the eyes, side by side.
      expect(plan.left.center.z).toBeLessThan(0);
      expect(plan.left.center.x).toBeLessThan(plan.right.center.x);
    }
  });

  it('turns with the anchor yaw, never anything else', () => {
    const [left, right] = DATASET_SLABS.shop;
    const ahead = planPair(eyes, 0, { kind: 'floating' }, left, right);
    const turned = planPair(eyes, deg(90), { kind: 'floating' }, left, right);
    // 90° left: forward is -X.
    expect(turned.left.center.x).toBeCloseTo(ahead.left.center.z, 9);
    expect(turned.left.center.y).toBeCloseTo(ahead.left.center.y, 12);
  });

  it('the mode is decided once: a dataset whose sizes would tip it keeps the anchored mode', () => {
    // A desk whose near edge is half a meter ahead: within reach of the 0.6 m home.
    const surfaceY = 0.73;
    const footprint = desk(-0.6, 0.6, -1.2, -0.5, surfaceY);
    const decided = Object.fromEntries(
      Object.entries(DATASET_SLABS).map(([name, [l, r]]) => [name, decidePlacementMode(eyes, 0, { y: surfaceY, footprint }, l, r).mode.kind]),
    );
    // Whatever each pair alone would decide, a switch keeps the anchor's mode: never floating once on the desk.
    const anchored = decidePlacementMode(eyes, 0, { y: surfaceY, footprint }, ...DATASET_SLABS.shop).mode;
    expect(anchored.kind).not.toBe('floating');
    for (const [name, [l, r]] of Object.entries(DATASET_SLABS)) {
      const plan = planPair(eyes, 0, anchored, l, r);
      expect(plan.mode, `${name} (alone it would be ${decided[name]})`).toBe(anchored.kind);
      expect(plan.deskY, name).not.toBeNull();
    }
    // And a floating anchor stays floating for every pair, even with a desk in the room.
    for (const [name, [l, r]] of Object.entries(DATASET_SLABS)) {
      expect(planPair(eyes, 0, { kind: 'floating' }, l, r).mode, name).toBe('floating');
    }
  });

  it('a desk too far away (the 2026-10-12 session: its near edge 0.77 m ahead) is floating for every pair', () => {
    const footprint = desk(-0.8, 0.8, -1.6, -0.77, 0.73);
    for (const [name, [l, r]] of Object.entries(DATASET_SLABS)) {
      expect(decidePlacementMode(eyes, 0, { y: 0.73, footprint }, l, r).mode.kind, name).toBe('floating');
    }
  });
});

/**
 * The 2026-10-12 04:20 headset session, replayed: its session start (after
 * the start-of-session reset), its two Recenter presses, and every dataset
 * switch with the live head pose at that moment (the old code placed from
 * it). Positions may change only where the anchor is set; between anchors
 * each dataset comes back to exactly the same place, whatever the head did.
 */
describe('replaying the 2026-10-12 04:20 headset session through the placement', () => {
  type Head = { x: number; y: number; z: number; yawDeg: number };
  type Event =
    | { t: string; kind: 'session-start'; head: Head; dataset: string }
    | { t: string; kind: 'recenter'; head: Head; dataset: string }
    | { t: string; kind: 'switch'; head: Head; dataset: string };
  // From the log: "head position (x, y, z), yaw N°" at each placement; Recenter's facing after its countdown.
  const EVENTS: Event[] = [
    { t: '04:20:44.873', kind: 'session-start', head: { x: 0.0, y: 1.12, z: -0.0, yawDeg: -0.4 }, dataset: 'school' },
    { t: '04:21:04.337', kind: 'switch', head: { x: 0.0, y: 1.12, z: 0.0, yawDeg: 11.2 }, dataset: 'shop' },
    { t: '04:21:15.475', kind: 'recenter', head: { x: 0.0, y: 1.12, z: 0.0, yawDeg: 2.1 }, dataset: 'shop' },
    { t: '04:21:23.551', kind: 'switch', head: { x: 0.01, y: 1.12, z: 0.03, yawDeg: 16.1 }, dataset: 'library' },
    { t: '04:21:33.174', kind: 'switch', head: { x: 0.03, y: 1.11, z: 0.03, yawDeg: 4.5 }, dataset: 'school' },
    { t: '04:21:41.639', kind: 'recenter', head: { x: 0.03, y: 1.11, z: 0.03, yawDeg: 4.5 }, dataset: 'school' },
    { t: '04:21:47.504', kind: 'switch', head: { x: 0.04, y: 1.1, z: 0.05, yawDeg: 1.5 }, dataset: 'library' },
    { t: '04:22:31.042', kind: 'switch', head: { x: 0.07, y: 1.11, z: 0.04, yawDeg: -5.0 }, dataset: 'school' },
    { t: '04:22:48.758', kind: 'switch', head: { x: 0.05, y: 1.11, z: 0.03, yawDeg: -2.5 }, dataset: 'library' },
    { t: '04:23:48.293', kind: 'switch', head: { x: 0.08, y: 1.11, z: 0.02, yawDeg: -5.4 }, dataset: 'shop' },
    { t: '04:24:14.830', kind: 'switch', head: { x: 0.07, y: 1.13, z: -0.01, yawDeg: 2.5 }, dataset: 'school' },
    { t: '04:25:46.460', kind: 'switch', head: { x: 0.1, y: 1.13, z: -0.03, yawDeg: -6.3 }, dataset: 'cafe' },
  ];
  // The desk the session found ("plane#34 table"): 0.39 m below the eyes, its near edge 0.77 m ahead.
  const DESK = { y: 0.73, footprint: desk(-0.8, 0.8, -1.6, -0.77, 0.73) };

  /** The replay, as desk placement runs it: the anchor and mode only at anchor events; switches place from them. */
  function replay(placeFromLiveHead: boolean) {
    let anchor: { eyes: P3; yaw: number } | null = null;
    let mode: PlacementMode = { kind: 'floating' };
    const placed: { event: Event; plan: PairPlan; anchorIndex: number }[] = [];
    let anchorIndex = -1;
    for (const event of EVENTS) {
      const head = { eyes: { x: event.head.x, y: event.head.y, z: event.head.z }, yaw: deg(event.head.yawDeg) };
      const [l, r] = DATASET_SLABS[event.dataset];
      if (event.kind !== 'switch') {
        anchor = head;
        anchorIndex++;
        mode = decidePlacementMode(anchor.eyes, anchor.yaw, DESK, l, r).mode;
      }
      const from = placeFromLiveHead ? head : anchor!;
      placed.push({ event, plan: planPair(from.eyes, from.yaw, mode, l, r), anchorIndex });
    }
    return placed;
  }

  it('each dataset comes back to exactly the same place between anchors, whatever the head did', () => {
    const placed = replay(false);
    const first = new Map<string, PairPlan>();
    for (const { event, plan, anchorIndex } of placed) {
      const key = `${anchorIndex}:${event.dataset}`;
      const earlier = first.get(key);
      if (earlier) {
        samePlan(plan, earlier);
      } else {
        first.set(key, plan);
      }
    }
    // The session had repeat visits within one anchor: library 3x and school 2x after the second Recenter.
    expect(placed.filter((p) => p.anchorIndex === 2 && p.event.dataset === 'library')).toHaveLength(2);
  });

  it('the placement mode never changes between anchors (here: floating; the desk is beyond the desk-edge band)', () => {
    for (const { event, plan } of replay(false)) {
      expect(plan.mode, `${event.t} ${event.dataset}`).toBe('floating');
    }
  });

  it('all pairs share one center line: a switch only resizes around the anchored place', () => {
    const placed = replay(false).filter((p) => p.anchorIndex === 2);
    const middle = (plan: PairPlan) => ({
      x: (plan.left.center.x + plan.right.center.x) / 2,
      z: (plan.left.center.z + plan.right.center.z) / 2,
    });
    const reference = middle(placed[0].plan);
    for (const { event, plan } of placed) {
      const m = middle(plan);
      // Within a few cm (each pair's widths differ), and never swung: the anchor's yaw for all.
      expect(Math.hypot(m.x - reference.x, m.z - reference.z), event.t).toBeLessThan(0.05);
    }
  });

  it('the old way (from the live head) would have moved the group at every switch: up to ~10 cm here', () => {
    const anchored = replay(false);
    const live = replay(true);
    const shifts = anchored.map((a, i) => dist(a.plan.left.center, live[i].plan.left.center));
    expect(Math.max(...shifts)).toBeGreaterThan(0.05);
    // ...and the anchored replay moves only at the anchor events.
    expect(shifts.filter((_, i) => anchored[i].event.kind !== 'switch').every((s) => s < 1e-9)).toBe(true);
  });
});
