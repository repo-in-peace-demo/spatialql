import { describe, expect, it } from 'vitest';
import { joinTables } from './join-result.js';
import { assignKeyTints, KEY_TINT_PALETTE, preferredKeyTint } from './key-tints.js';
import { CUSTOMERS_TABLE, ORDERS_TABLE } from './sample-data.js';

describe('key tints', () => {
  it('gives the same key the same tint every time, regardless of input order', () => {
    const a = assignKeyTints([1, 2, 3, 6]);
    const b = assignKeyTints([6, 3, 2, 1, 2]);
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
    expect(preferredKeyTint(2)).toBe(preferredKeyTint(2));
  });

  it('gives distinct keys distinct tints while the palette lasts', () => {
    const keys = Array.from({ length: KEY_TINT_PALETTE.length }, (_, i) => i * 7 + 1);
    const tints = assignKeyTints(keys);
    expect(new Set(tints.values()).size).toBe(KEY_TINT_PALETTE.length);
  });

  it('uses no grey or near-neutral tints (every tint reads as "matched")', () => {
    for (const tint of KEY_TINT_PALETTE) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(tint.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const lightness = (max + min) / 2;
      const saturation = (max - min) / (1 - Math.abs(2 * lightness - 1));
      expect(saturation, tint).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('never tints NULL', () => {
    expect(preferredKeyTint(null)).toBeNull();
    expect(assignKeyTints([null, 1]).size).toBe(1);
  });

  it('distinguishes a number key from the same-looking string key', () => {
    const tints = assignKeyTints([2, '2']);
    expect(tints.get(2)).not.toBe(tints.get('2'));
  });

  it('tints the sample join: one distinct tint each for customer ids 1, 2, 3 and 6', () => {
    const matchedKeys = joinTables(CUSTOMERS_TABLE, ORDERS_TABLE, 'inner').pairings.map(
      (p) => CUSTOMERS_TABLE.rows[p.left!.rowIndex].id,
    );
    const tints = assignKeyTints(matchedKeys);
    expect([...tints.keys()].sort()).toEqual([1, 2, 3, 6]);
    expect(new Set(tints.values()).size).toBe(4);
    for (const tint of tints.values()) {
      expect(KEY_TINT_PALETTE).toContain(tint);
    }
  });
});
