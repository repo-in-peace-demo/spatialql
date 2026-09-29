/**
 * Stable soft tints per join-key value, so a key's rows can be picked out by
 * colour across the source slabs and the result. Pure data layer.
 *
 * The palette is lightened from the Okabe-Ito colour-blind-safe set (no
 * red/green-only distinction). Every tint keeps >= 10:1 contrast with the
 * slabs' near-black text, and the slabs' opaque backgrounds mean passthrough
 * never shows through behind them.
 */

import type { CellValue } from './types.js';

/**
 * Only clearly coloured tints (HSL saturation >= 50%): a grey or washed-out
 * tint would read as "dimmed / unmatched", the opposite of what a key tint
 * means.
 */
export const KEY_TINT_PALETTE: readonly string[] = [
  '#cfe3f7', // light blue
  '#fbdcb5', // light orange
  '#f4e7a8', // light yellow
  '#ddcdf5', // lavender
  '#bfeee2', // light teal
  '#f5d5e4', // light pink
];

/** Deterministic string hash (FNV-1a, 32-bit). */
function hashKey(value: Exclude<CellValue, null>): number {
  const text = `${typeof value}:${String(value)}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The tint a key prefers when nothing else in its set has claimed it. */
export function preferredKeyTint(value: CellValue): string | null {
  return value === null ? null : KEY_TINT_PALETTE[hashKey(value) % KEY_TINT_PALETTE.length];
}

/**
 * Assigns a tint to each distinct non-null key. Each key starts at its
 * hash-derived slot; collisions probe forward to the next unused tint, with
 * keys processed in a canonical sorted order so the result doesn't depend on
 * input order. The same key therefore always gets its preferred tint unless
 * another key in the same join already took it, and distinct keys get
 * distinct tints until the palette runs out (then they wrap). NULL never
 * gets a tint.
 */
export function assignKeyTints(keys: Iterable<CellValue>): Map<Exclude<CellValue, null>, string> {
  const distinct = [...new Set([...keys].filter((k): k is Exclude<CellValue, null> => k !== null))];
  distinct.sort((a, b) => {
    const ka = `${typeof a}:${String(a)}`;
    const kb = `${typeof b}:${String(b)}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const used = new Set<number>();
  const tints = new Map<Exclude<CellValue, null>, string>();
  for (const key of distinct) {
    let slot = hashKey(key) % KEY_TINT_PALETTE.length;
    if (used.size < KEY_TINT_PALETTE.length) {
      while (used.has(slot)) {
        slot = (slot + 1) % KEY_TINT_PALETTE.length;
      }
    }
    used.add(slot);
    tints.set(key, KEY_TINT_PALETTE[slot]);
  }
  return tints;
}
