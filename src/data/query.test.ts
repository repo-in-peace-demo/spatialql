import { describe, expect, it } from 'vitest';
import { DATASETS } from './datasets.js';
import { filterForColumn, runQuery, sameFilter, visibleRowIndices } from './query.js';
import { CUSTOMERS_TABLE, ORDERS_TABLE } from './sample-data.js';

const SHOP = [CUSTOMERS_TABLE, ORDERS_TABLE];
const LIBRARY = DATASETS.library.tables;

describe('runQuery and the NULL filter', () => {
  it('keeps every row without a filter', () => {
    const output = runQuery(SHOP, { left: 'customers', right: 'orders', joinType: 'left', filter: null });
    expect(output.visible).toHaveLength(11);
    expect(output.visible.every(Boolean)).toBe(true);
  });

  it('an anti-join filter keeps only the unmatched (ghost) row', () => {
    const output = runQuery(SHOP, {
      left: 'customers',
      right: 'orders',
      joinType: 'left',
      filter: { tableId: 'orders', column: 'id' },
    });
    expect(visibleRowIndices(output)).toEqual([10]);
    expect(output.result.table.rows[10]['left:name']).toBe('Odalys Ferreira');
  });

  it('IS NULL matches a stored NULL as well as a ghost cell', () => {
    const output = runQuery(LIBRARY, {
      left: 'borrowers',
      right: 'books',
      joinType: 'left',
      filter: { tableId: 'books', column: 'due' },
    });
    const names = visibleRowIndices(output).map((i) => output.result.table.rows[i]['left:name']);
    // Ikaika's book has a stored NULL due date; Basil has no book at all.
    expect(names).toEqual(['Ikaika Dunn', 'Basil Thorne']);
  });

  it('the filter means the same under INNER: an anti-join filter keeps nothing', () => {
    const output = runQuery(SHOP, {
      left: 'customers',
      right: 'orders',
      joinType: 'inner',
      filter: { tableId: 'orders', column: 'id' },
    });
    expect(visibleRowIndices(output)).toEqual([]);
  });

  it('a filter on a column the result does not show keeps nothing', () => {
    // The foreign-key column is dropped from the result.
    const output = runQuery(SHOP, {
      left: 'customers',
      right: 'orders',
      joinType: 'left',
      filter: { tableId: 'orders', column: 'customerId' },
    });
    expect(visibleRowIndices(output)).toEqual([]);
  });

  it('a poked column names its source table and column, whichever side it is on', () => {
    const { left, right, result } = runQuery(SHOP, {
      left: 'orders',
      right: 'customers',
      joinType: 'left',
      filter: null,
    });
    // orders (id, product, amount) then customers (id, name, city).
    expect(filterForColumn(left, right, result, 0)).toEqual({ tableId: 'orders', column: 'id' });
    expect(filterForColumn(left, right, result, 3)).toEqual({ tableId: 'customers', column: 'id' });
  });

  it('compares filters by table and column', () => {
    expect(sameFilter({ tableId: 'orders', column: 'id' }, { tableId: 'orders', column: 'id' })).toBe(true);
    expect(sameFilter({ tableId: 'orders', column: 'id' }, { tableId: 'customers', column: 'id' })).toBe(false);
    expect(sameFilter(null, null)).toBe(true);
    expect(sameFilter(null, { tableId: 'orders', column: 'id' })).toBe(false);
  });
});
