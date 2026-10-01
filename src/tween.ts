/**
 * A tiny, preallocated tween pool that animates numeric signals (UIKit
 * property signals and join-visual progress values). Scheduling happens on
 * discrete events; `update()` runs per frame and allocates nothing.
 */

import type { Signal } from '@iwsdk/core';

export type Easing = (t: number) => number;

export const easeOutCubic: Easing = (t) => 1 - (1 - t) ** 3;
export const easeInCubic: Easing = (t) => t * t * t;
export const easeInOutCubic: Easing = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Overshoots slightly then settles: a small "drop and land". */
export const easeOutBack: Easing = (t) => {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

/** A gentler overshoot for the dock snap: settles into place, never wobbles. */
export const easeOutBackSoft: Easing = (t) => {
  const c1 = 1.15;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
/** A fall that bounces at the bottom: first impact at t ≈ 0.36, then two small hops. */
export const BOUNCE_FIRST_IMPACT = 1 / 2.75;
export const easeOutBounce: Easing = (t) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) {
    return n1 * t * t;
  }
  if (t < 2 / d1) {
    const u = t - 1.5 / d1;
    return n1 * u * u + 0.75;
  }
  if (t < 2.5 / d1) {
    const u = t - 2.25 / d1;
    return n1 * u * u + 0.9375;
  }
  const u = t - 2.625 / d1;
  return n1 * u * u + 0.984375;
};

type Slot = {
  active: boolean;
  target: Signal<number> | null;
  from: number;
  to: number;
  /** Seconds on the pool clock. */
  start: number;
  duration: number;
  ease: Easing;
  /** `from` is captured when the tween actually starts (after its delay). */
  started: boolean;
  onDone: (() => void) | null;
};

export class TweenPool {
  private readonly slots: Slot[];
  private clock = 0;

  constructor(capacity: number) {
    this.slots = Array.from({ length: capacity }, () => ({
      active: false,
      target: null,
      from: 0,
      to: 0,
      start: 0,
      duration: 0,
      ease: easeOutCubic,
      started: false,
      onDone: null,
    }));
  }

  get now(): number {
    return this.clock;
  }

  /**
   * Animates `target` to `to` over `duration` seconds after `delay`.
   * Replaces any tween already running on the same signal. Starts from the
   * signal's value at the moment the delay elapses.
   */
  to(
    target: Signal<number>,
    to: number,
    duration: number,
    delay = 0,
    ease: Easing = easeOutCubic,
    onDone: (() => void) | null = null,
  ): void {
    let slot: Slot | null = null;
    for (const candidate of this.slots) {
      if (candidate.active && candidate.target === target) {
        slot = candidate;
        break;
      }
    }
    if (!slot) {
      slot = this.slots.find((candidate) => !candidate.active) ?? null;
    }
    if (!slot) {
      // Pool exhausted: jump to the end state rather than drop the change.
      target.value = to;
      onDone?.();
      return;
    }
    slot.active = true;
    slot.target = target;
    slot.to = to;
    slot.start = this.clock + delay;
    slot.duration = Math.max(1e-4, duration);
    slot.ease = ease;
    slot.started = false;
    slot.onDone = onDone;
  }

  /** Sets a value immediately, cancelling any tween on it. */
  set(target: Signal<number>, value: number): void {
    this.cancel(target);
    target.value = value;
  }

  cancel(target: Signal<number>): void {
    for (const slot of this.slots) {
      if (slot.active && slot.target === target) {
        slot.active = false;
        slot.target = null;
        slot.onDone = null;
      }
    }
  }

  get busy(): boolean {
    for (const slot of this.slots) {
      if (slot.active) {
        return true;
      }
    }
    return false;
  }

  /** Jumps every running tween to its end state (and runs completions). */
  finishAll(): void {
    for (const slot of this.slots) {
      if (slot.active) {
        this.complete(slot);
      }
    }
  }

  update(delta: number): void {
    this.clock += delta;
    for (const slot of this.slots) {
      if (!slot.active || this.clock < slot.start) {
        continue;
      }
      const target = slot.target!;
      if (!slot.started) {
        slot.started = true;
        slot.from = target.peek();
      }
      const t = Math.min(1, (this.clock - slot.start) / slot.duration);
      if (t >= 1) {
        this.complete(slot);
        continue;
      }
      target.value = slot.from + (slot.to - slot.from) * slot.ease(t);
    }
  }

  private complete(slot: Slot): void {
    const target = slot.target!;
    const onDone = slot.onDone;
    target.value = slot.to;
    slot.active = false;
    slot.target = null;
    slot.onDone = null;
    onDone?.();
  }
}
