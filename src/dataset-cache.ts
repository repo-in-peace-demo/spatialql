/**
 * Which datasets stay built: their two tables (desk placement) and their
 * result slabs (the join system), parked out of sight while another dataset
 * is on the desk. Challenge mode keeps the current puzzle's dataset and its
 * neighbors' (the previous and next puzzle), so a Next, Prev or picker step
 * to them switches without building anything; desk placement and the join
 * system build what's missing in the background (build-queue.ts) and dispose
 * what's no longer kept. Free play keeps nothing extra.
 */

import type { DatasetId } from './data/datasets.js';

let kept: readonly DatasetId[] = [];
const listeners = new Set<(kept: readonly DatasetId[]) => void>();

/** Keeps these datasets built (and lets the others go), effective now. */
export function keepDatasets(datasets: readonly DatasetId[]): void {
  if (datasets.length === kept.length && datasets.every((id) => kept.includes(id))) {
    return;
  }
  kept = [...datasets];
  for (const listener of listeners) {
    listener(kept);
  }
}

export function keptDatasets(): readonly DatasetId[] {
  return kept;
}

/** Called whenever the kept set changes; returns its unsubscribe. */
export function onKeptDatasets(listener: (kept: readonly DatasetId[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
