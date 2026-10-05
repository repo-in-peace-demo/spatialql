import { describe, expect, it } from 'vitest';
import { DATA_METRICS, displayValue, fitsColumn, HEADER_METRICS, slabMetrics } from '../slab-metrics.js';
import {
  PLANNED_RESULT_DISTANCE_METERS,
  PLANNED_SOURCE_DISTANCE_METERS,
  slabTextSizeAt,
} from '../text-angles.js';
import { DATASET_IDS, DATASETS, datasetOfTable, tableById } from './datasets.js';
import { columnHeaderText } from './join-result.js';
import { KEY_TINT_PALETTE } from './key-tints.js';
import { runQuery } from './query.js';
import type { Table } from './types.js';

/** Every header and cell of `table` that doesn't fit its column at the slab's real text sizes. */
function overflowing(table: Table, distance: number): string[] {
  const text = slabTextSizeAt(distance);
  const m = slabMetrics(text);
  const failures: string[] = [];
  for (const column of table.columns) {
    const header = columnHeaderText(table, column);
    if (!fitsColumn(header, HEADER_METRICS, m.headerFont, m)) {
      failures.push(`header ${header}`);
    }
    for (const row of table.rows) {
      const value = displayValue(row[column] ?? null);
      if (!fitsColumn(value, DATA_METRICS, m.rowFont, m)) {
        failures.push(`${column}: ${value}`);
      }
    }
  }
  return failures;
}

/** sRGB relative luminance of a `#rrggbb` color. */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

describe.each(DATASET_IDS.map((id): [string] => [id]))('dataset %s', (id) => {
  const dataset = DATASETS[id as keyof typeof DATASETS];

  it('every source cell and header fits its column without an ellipsis', () => {
    for (const table of dataset.tables) {
      expect(overflowing(table, PLANNED_SOURCE_DISTANCE_METERS), table.id).toEqual([]);
    }
  });

  it('every result cell and header fits too, in both join directions', () => {
    const [a, b] = dataset.tables;
    for (const [left, right] of [
      [a, b],
      [b, a],
    ]) {
      const { result } = runQuery(dataset.tables, { left: left.id, right: right.id, joinType: 'left', filter: null });
      expect(overflowing(result.table, PLANNED_RESULT_DISTANCE_METERS), result.table.id).toEqual([]);
    }
  });

  it('has a theme: an icon, and a deep accent far darker than every key tint', () => {
    const { accent, icon } = dataset.theme;
    expect(icon.length).toBeGreaterThan(0);
    expect(accent).toMatch(/^#[0-9a-f]{6}$/);
    for (const tint of KEY_TINT_PALETTE) {
      // Distinct by lightness (and position: accents never go on rows), not hue alone.
      expect(luminance(tint) / luminance(accent), `${accent} vs ${tint}`).toBeGreaterThanOrEqual(2.5);
    }
  });

  it('its tables are found by id, and belong to it', () => {
    for (const table of dataset.tables) {
      expect(tableById(table.id)).toBe(table);
      expect(datasetOfTable(table.id)).toBe(id);
    }
  });
});

describe('datasets', () => {
  it('table ids are unique across datasets', () => {
    const ids = DATASET_IDS.flatMap((id) => DATASETS[id].tables.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(tableById('nope')).toBeNull();
  });

  it('accents differ between datasets', () => {
    const accents = DATASET_IDS.map((id) => DATASETS[id].theme.accent);
    expect(new Set(accents).size).toBe(accents.length);
  });
});
