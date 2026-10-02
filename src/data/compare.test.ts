import { describe, expect, it } from 'vitest';
import { compareToTarget, fanOutGroups } from './compare.js';
import { DATASETS } from './datasets.js';
import { runQuery, type QuerySpec } from './query.js';
import { CUSTOMERS_TABLE, ORDERS_TABLE } from './sample-data.js';
import type { Table } from './types.js';

const SHOP = [CUSTOMERS_TABLE, ORDERS_TABLE];
const spec = (left: string, right: string, joinType: 'inner' | 'left', filter: QuerySpec['filter'] = null) => ({
  left,
  right,
  joinType,
  filter,
});

describe('compareToTarget', () => {
  it('accepts an INNER join in either direction', () => {
    const target = runQuery(SHOP, spec('customers', 'orders', 'inner'));
    const actual = runQuery(SHOP, spec('orders', 'customers', 'inner'));
    const comparison = compareToTarget(actual, target);
    expect(comparison.columnsMatch).toBe(true);
    expect(comparison.solved).toBe(true);
    expect(comparison.missing).toEqual([]);
  });

  it('marks rows the target does not have as extra', () => {
    const target = runQuery(SHOP, spec('customers', 'orders', 'left', { tableId: 'orders', column: 'id' }));
    const actual = runQuery(SHOP, spec('customers', 'orders', 'left'));
    const comparison = compareToTarget(actual, target);
    expect(comparison.solved).toBe(false);
    expect(comparison.rowStatus.filter((s) => s === 'extra')).toHaveLength(10);
    expect(comparison.rowStatus[10]).toBe('match');
    expect(comparison.missing).toEqual([]);
  });

  it('lists target rows the result is still missing', () => {
    const target = runQuery(SHOP, spec('customers', 'orders', 'left'));
    const actual = runQuery(SHOP, spec('customers', 'orders', 'inner'));
    const comparison = compareToTarget(actual, target);
    expect(comparison.solved).toBe(false);
    expect(comparison.rowStatus.every((s) => s === 'match')).toBe(true);
    // Odalys's ghost row, last in the target.
    expect(comparison.missing).toEqual([10]);
  });

  it('marks filtered-out rows as hidden, not extra', () => {
    const target = runQuery(SHOP, spec('customers', 'orders', 'left', { tableId: 'orders', column: 'id' }));
    const actual = runQuery(SHOP, spec('customers', 'orders', 'left', { tableId: 'orders', column: 'product' }));
    const comparison = compareToTarget(actual, target);
    expect(comparison.solved).toBe(true);
    expect(comparison.rowStatus.filter((s) => s === 'hidden')).toHaveLength(10);
    expect(comparison.visibleCount).toBe(1);
  });

  it('compares rows as a multiset: a repeated row must repeat', () => {
    const parents: Table = {
      id: 'p',
      columns: ['id', 'name'],
      rows: [
        { id: 1, name: 'A' },
        { id: 1, name: 'A' },
      ],
    };
    const children: Table = {
      id: 'c',
      columns: ['id', 'pid'],
      foreignKeys: [{ column: 'pid', references: { tableId: 'p', column: 'id' } }],
      rows: [{ id: 9, pid: 1 }],
    };
    const onceParents: Table = { ...parents, rows: [{ id: 1, name: 'A' }] };
    const target = runQuery([parents, children], spec('p', 'c', 'inner'));
    const actual = runQuery([onceParents, children], spec('p', 'c', 'inner'));
    expect(target.result.table.rows).toHaveLength(2);
    const comparison = compareToTarget(actual, target);
    expect(comparison.rowStatus).toEqual(['match']);
    expect(comparison.missing).toHaveLength(1);
    expect(comparison.solved).toBe(false);
  });

  it('treats a ghost NULL and a stored NULL as the same value', () => {
    const parents: Table = { id: 'p', columns: ['id', 'name'], rows: [{ id: 1, name: 'A' }] };
    const noChildren: Table = {
      id: 'c',
      columns: ['id', 'pid', 'note'],
      foreignKeys: [{ column: 'pid', references: { tableId: 'p', column: 'id' } }],
      rows: [],
    };
    const nullChild: Table = { ...noChildren, rows: [{ id: null, pid: 1, note: null }] };
    const ghost = runQuery([parents, noChildren], spec('p', 'c', 'left'));
    const stored = runQuery([parents, nullChild], spec('p', 'c', 'inner'));
    expect(ghost.result.lineage[0].ghost).toBe(true);
    expect(compareToTarget(stored, ghost).solved).toBe(true);
  });

  it('never solves when the columns differ', () => {
    const target = runQuery(SHOP, spec('customers', 'orders', 'inner'));
    const actual = runQuery(DATASETS.library.tables, spec('borrowers', 'books', 'inner'));
    const comparison = compareToTarget(actual, target);
    expect(comparison.columnsMatch).toBe(false);
    expect(comparison.solved).toBe(false);
    expect(comparison.rowStatus.every((s) => s === 'extra')).toBe(true);
    expect(comparison.missing).toHaveLength(10);
  });
});

describe('fanOutGroups', () => {
  it('finds one-to-many repeats and duplicate-key repeats in the shop join', () => {
    const groups = fanOutGroups(runQuery(SHOP, spec('customers', 'orders', 'inner')));
    const oneToMany = groups.filter((g) => g.cause === 'oneToMany');
    const duplicateKey = groups.filter((g) => g.cause === 'duplicateKey');
    // Alderly (2 orders), Priya and Marcus (3 each).
    expect(oneToMany.map((g) => [g.side, g.source.rowIndex, g.resultRows.length, g.key])).toEqual([
      ['left', 0, 2, 1],
      ['left', 1, 3, 2],
      ['left', 3, 3, 2],
    ]);
    // Orders 101-103 each match both customers with id 2.
    expect(duplicateKey.map((g) => [g.side, g.source.rowIndex, g.resultRows.length, g.key])).toEqual([
      ['right', 0, 2, 2],
      ['right', 1, 2, 2],
      ['right', 2, 2, 2],
    ]);
  });

  it('pins Ines repeating to the duplicated club id 3', () => {
    const groups = fanOutGroups(runQuery(DATASETS.school.tables, spec('clubs', 'students', 'inner')));
    const duplicateKey = groups.filter((g) => g.cause === 'duplicateKey');
    expect(duplicateKey).toHaveLength(1);
    expect(duplicateKey[0]).toMatchObject({ side: 'right', source: { tableId: 'students', rowIndex: 0 }, key: 3 });
    expect(duplicateKey[0].resultRows).toHaveLength(2);
  });

  it('ignores rows the filter hides', () => {
    const output = runQuery(SHOP, spec('customers', 'orders', 'left', { tableId: 'orders', column: 'id' }));
    expect(fanOutGroups(output)).toEqual([]);
  });
});
