import { describe, expect, it } from 'vitest';
import {
  buildJoinResultTable,
  findJoinKeys,
  fullJoinPairings,
  isGhostCell,
  joinTables,
} from './join-result.js';
import { CUSTOMERS_TABLE, ORDERS_TABLE } from './sample-data.js';
import type { Table } from './types.js';

const labels = (result: ReturnType<typeof buildJoinResultTable>) =>
  result.columns.map((c) => c.label.toUpperCase());

describe('findJoinKeys (relationship metadata)', () => {
  it('finds orders.customerId -> customers.id with customers as LEFT', () => {
    expect(findJoinKeys(CUSTOMERS_TABLE, ORDERS_TABLE)).toEqual({
      leftColumn: 'id',
      rightColumn: 'customerId',
      foreignKeySide: 'right',
    });
  });

  it('finds the same relationship with orders as LEFT', () => {
    expect(findJoinKeys(ORDERS_TABLE, CUSTOMERS_TABLE)).toEqual({
      leftColumn: 'customerId',
      rightColumn: 'id',
      foreignKeySide: 'left',
    });
  });

  it('returns null for unrelated tables, and joins on them throw', () => {
    const a: Table = { id: 'a', columns: ['id'], rows: [] };
    const b: Table = { id: 'b', columns: ['id'], rows: [] };
    expect(findJoinKeys(a, b)).toBeNull();
    expect(() => joinTables(a, b, 'inner')).toThrow();
  });
});

describe('joinTables uses the same semantics as the existing join functions', () => {
  it('matches the known pairing counts', () => {
    expect(joinTables(CUSTOMERS_TABLE, ORDERS_TABLE, 'inner').pairings).toHaveLength(10);
    expect(joinTables(CUSTOMERS_TABLE, ORDERS_TABLE, 'left').pairings).toHaveLength(11);
    const full = fullJoinPairings(CUSTOMERS_TABLE, ORDERS_TABLE).pairings;
    expect(full.filter((p) => p.left && !p.right)).toHaveLength(1);
    expect(full.filter((p) => !p.left && p.right)).toHaveLength(1);
  });
});

describe('buildJoinResultTable (customers LEFT/INNER JOIN orders)', () => {
  const build = (joinType: 'inner' | 'left') =>
    buildJoinResultTable(
      CUSTOMERS_TABLE,
      ORDERS_TABLE,
      joinTables(CUSTOMERS_TABLE, ORDERS_TABLE, joinType),
      joinType,
    );

  it('INNER has 10 rows, none of them ghosts', () => {
    const result = build('inner');
    expect(result.table.rows).toHaveLength(10);
    expect(result.lineage.every((l) => !l.ghost && l.left && l.right)).toBe(true);
  });

  it('LEFT has 11 rows: the 10 matches then the no-orders customer as a ghost', () => {
    const result = build('left');
    expect(result.table.rows).toHaveLength(11);
    const last = result.lineage[10];
    expect(last.ghost).toBe(true);
    expect(last.right).toBeNull();
    expect(CUSTOMERS_TABLE.rows[last.left!.rowIndex].name).toBe('Odalys Ferreira');
    expect(result.lineage.slice(0, 10).every((l) => !l.ghost)).toBe(true);
  });

  it('INNER rows are exactly the first rows of LEFT (ghosts only ever append)', () => {
    expect(build('left').table.rows.slice(0, 10)).toEqual(build('inner').table.rows);
  });

  it('orders columns left then right, drops the foreign key, and disambiguates labels', () => {
    const result = build('inner');
    expect(labels(result)).toEqual(['C.ID', 'NAME', 'CITY', 'O.ID', 'PRODUCT', 'AMOUNT']);
    expect(result.columns.some((c) => c.sourceColumn === 'customerId')).toBe(false);
    expect(result.table.columns).toEqual(result.columns.map((c) => c.key));
  });

  it('marks ghost cells distinctly: only right-side cells of ghost rows', () => {
    const result = build('left');
    const ghostRow = 10;
    result.columns.forEach((column, columnIndex) => {
      expect(isGhostCell(result, ghostRow, columnIndex)).toBe(column.source === 'right');
      expect(isGhostCell(result, 0, columnIndex)).toBe(false);
    });
    // The ghost's left-side values are real.
    expect(result.table.rows[ghostRow][result.columns[1].key]).toBe('Odalys Ferreira');
  });

  it('never includes the NULL-foreign-key order', () => {
    const nullOrderIndex = ORDERS_TABLE.rows.findIndex((r) => r.customerId === null);
    for (const joinType of ['inner', 'left'] as const) {
      expect(build(joinType).lineage.some((l) => l.right?.rowIndex === nullOrderIndex)).toBe(false);
    }
  });

  it('keeps fan-out: each duplicate id:2 customer row appears with all three orders', () => {
    const result = build('inner');
    const id2Rows = result.lineage.filter(
      (l) => l.left && CUSTOMERS_TABLE.rows[l.left.rowIndex].id === 2,
    );
    expect(id2Rows).toHaveLength(6);
  });
});

describe('buildJoinResultTable (orders as LEFT)', () => {
  it('puts orders columns first, drops customerId, and ghosts the NULL-FK order under LEFT', () => {
    const left = buildJoinResultTable(
      ORDERS_TABLE,
      CUSTOMERS_TABLE,
      joinTables(ORDERS_TABLE, CUSTOMERS_TABLE, 'left'),
      'left',
    );
    expect(labels(left)).toEqual(['O.ID', 'PRODUCT', 'AMOUNT', 'C.ID', 'NAME', 'CITY']);
    expect(left.table.rows).toHaveLength(11);
    const ghost = left.lineage[10];
    expect(ghost.ghost).toBe(true);
    expect(ORDERS_TABLE.rows[ghost.left!.rowIndex].customerId).toBeNull();
  });
});

describe('buildJoinResultTable: a real NULL value is not a ghost', () => {
  const people: Table = { id: 'people', alias: 'p', columns: ['id'], rows: [{ id: 1 }, { id: 2 }] };
  const notes: Table = {
    id: 'notes',
    alias: 'n',
    columns: ['id', 'personId', 'text'],
    rows: [{ id: 10, personId: 1, text: null }],
    foreignKeys: [{ column: 'personId', references: { tableId: 'people', column: 'id' } }],
  };

  it('stores NULL for the real null and flags only the unmatched row as ghost', () => {
    const result = buildJoinResultTable(people, notes, joinTables(people, notes, 'left'), 'left');
    expect(labels(result)).toEqual(['P.ID', 'N.ID', 'TEXT']);
    const textColumn = result.columns.findIndex((c) => c.sourceColumn === 'text');
    expect(result.table.rows[0][result.columns[textColumn].key]).toBeNull();
    expect(isGhostCell(result, 0, textColumn)).toBe(false);
    expect(isGhostCell(result, 1, textColumn)).toBe(true);
  });
});
