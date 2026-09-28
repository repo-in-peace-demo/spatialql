import { describe, expect, it } from 'vitest';
import { computeJoin, innerJoin, keyEquals, leftJoin } from './join.js';
import { CUSTOMERS_TABLE, ORDERS_TABLE } from './sample-data.js';
import type { Row, Table } from './types.js';

const byId = (row: Row) => row.id;
const byCustomerId = (row: Row) => row.customerId;

describe('keyEquals', () => {
  it('never matches NULL, including NULL against NULL', () => {
    expect(keyEquals(null, null)).toBe(false);
    expect(keyEquals(null, 1)).toBe(false);
    expect(keyEquals(1, null)).toBe(false);
  });

  it('matches equal non-null values', () => {
    expect(keyEquals(1, 1)).toBe(true);
    expect(keyEquals('a', 'a')).toBe(true);
    expect(keyEquals(1, 2)).toBe(false);
  });
});

describe('computeJoin (semantic fixtures)', () => {
  const left: Table = {
    id: 'left',
    columns: ['id'],
    rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
  };
  const right: Table = {
    id: 'right',
    columns: ['leftId'],
    rows: [{ leftId: 1 }, { leftId: 1 }, { leftId: 99 }],
  };

  it('produces one matched pairing per matching row combination', () => {
    const result = computeJoin(left, right, byId, (r) => r.leftId);
    const matched = result.pairings.filter((p) => p.left && p.right);
    // left id:1 matches right rows 0 and 1 -> 2 matched pairings
    expect(matched).toHaveLength(2);
    expect(matched.every((p) => p.left?.rowIndex === 0)).toBe(true);
  });

  it('produces an unmatched-left entry for a left row with no match', () => {
    const result = computeJoin(left, right, byId, (r) => r.leftId);
    const unmatchedLeft = result.pairings.filter((p) => p.left && !p.right);
    // left ids 2 and 3 have no matching right row
    expect(unmatchedLeft).toHaveLength(2);
    expect(unmatchedLeft.map((p) => p.left?.rowIndex).sort()).toEqual([1, 2]);
  });

  it('produces an unmatched-right entry for a right row with no match', () => {
    const result = computeJoin(left, right, byId, (r) => r.leftId);
    const unmatchedRight = result.pairings.filter((p) => !p.left && p.right);
    // right row 2 (leftId: 99) has no matching left row
    expect(unmatchedRight).toHaveLength(1);
    expect(unmatchedRight[0].right?.rowIndex).toBe(2);
  });

  it('a duplicated key on the left fans out against every match on the right', () => {
    const dupLeft: Table = {
      id: 'dupLeft',
      columns: ['id'],
      rows: [{ id: 7 }, { id: 7 }],
    };
    const dupRight: Table = {
      id: 'dupRight',
      columns: ['leftId'],
      rows: [{ leftId: 7 }, { leftId: 7 }, { leftId: 7 }],
    };
    const result = computeJoin(dupLeft, dupRight, byId, (r) => r.leftId);
    const matched = result.pairings.filter((p) => p.left && p.right);
    // 2 left rows x 3 right rows sharing the same key -> 6 matched pairings
    expect(matched).toHaveLength(6);
  });

  it('NULL on both sides never pairs', () => {
    const nullLeft: Table = {
      id: 'nullLeft',
      columns: ['id'],
      rows: [{ id: null }],
    };
    const nullRight: Table = {
      id: 'nullRight',
      columns: ['leftId'],
      rows: [{ leftId: null }],
    };
    const result = computeJoin(nullLeft, nullRight, byId, (r) => r.leftId);
    const matched = result.pairings.filter((p) => p.left && p.right);
    expect(matched).toHaveLength(0);
    // both rows end up unmatched instead
    expect(result.pairings).toHaveLength(2);
  });
});

describe('innerJoin / leftJoin (semantic fixtures)', () => {
  const left: Table = {
    id: 'left',
    columns: ['id'],
    rows: [{ id: 1 }, { id: 2 }],
  };
  const right: Table = {
    id: 'right',
    columns: ['leftId'],
    rows: [{ leftId: 1 }],
  };

  it('innerJoin drops unmatched-left and unmatched-right rows', () => {
    const result = innerJoin(left, right, byId, (r) => r.leftId);
    expect(result.pairings).toEqual([
      { left: { tableId: 'left', rowIndex: 0 }, right: { tableId: 'right', rowIndex: 0 } },
    ]);
  });

  it('leftJoin keeps unmatched-left rows as ghosts and drops unmatched-right', () => {
    const result = leftJoin(left, right, byId, (r) => r.leftId);
    expect(result.pairings).toEqual([
      { left: { tableId: 'left', rowIndex: 0 }, right: { tableId: 'right', rowIndex: 0 } },
      { left: { tableId: 'left', rowIndex: 1 }, right: null },
    ]);
  });
});

describe('sample data scenarios (customers.id = orders.customerId)', () => {
  it('the no-orders customer (id:5) appears as an unmatched-left ghost under leftJoin', () => {
    const result = leftJoin(CUSTOMERS_TABLE, ORDERS_TABLE, byId, byCustomerId);
    const noOrdersRowIndex = CUSTOMERS_TABLE.rows.findIndex((r) => r.name === 'Odalys Ferreira');
    const ghost = result.pairings.find(
      (p) => p.left?.rowIndex === noOrdersRowIndex && p.right === null,
    );
    expect(ghost).toBeDefined();
  });

  it('the duplicate id:2 customers fan out into exactly 6 matched pairings', () => {
    const result = innerJoin(CUSTOMERS_TABLE, ORDERS_TABLE, byId, byCustomerId);
    const id2CustomerIndexes = CUSTOMERS_TABLE.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.id === 2)
      .map(({ index }) => index);
    expect(id2CustomerIndexes).toHaveLength(2);
    const id2Matches = result.pairings.filter(
      (p) => p.left !== null && id2CustomerIndexes.includes(p.left.rowIndex),
    );
    expect(id2Matches).toHaveLength(6);
  });

  it('the null-FK order is excluded by innerJoin and appears as unmatched-right in computeJoin', () => {
    const nullOrderIndex = ORDERS_TABLE.rows.findIndex((r) => r.customerId === null);
    const inner = innerJoin(CUSTOMERS_TABLE, ORDERS_TABLE, byId, byCustomerId);
    expect(inner.pairings.some((p) => p.right?.rowIndex === nullOrderIndex)).toBe(false);

    const full = computeJoin(CUSTOMERS_TABLE, ORDERS_TABLE, byId, byCustomerId);
    const unmatchedRightEntry = full.pairings.find(
      (p) => p.left === null && p.right?.rowIndex === nullOrderIndex,
    );
    expect(unmatchedRightEntry).toBeDefined();
  });

  it('produces the exact expected pairing counts', () => {
    // Derivation (customers.id = orders.customerId):
    //   id 2 -> 2 customer rows x 3 orders (101, 102, 103) = 6 matched
    //   id 1 -> 1 customer row  x 2 orders (104, 107)      = 2 matched
    //   id 3 -> 1 customer row  x 1 order  (105)           = 1 matched
    //   id 6 -> 1 customer row  x 1 order  (106)           = 1 matched
    //   matched total = 6 + 2 + 1 + 1 = 10
    //   id 5 has no orders                                 = 1 unmatched-left
    //   order 108 has customerId: null                     = 1 unmatched-right
    //   total pairings = 10 + 1 + 1 = 12
    const result = computeJoin(CUSTOMERS_TABLE, ORDERS_TABLE, byId, byCustomerId);
    const matched = result.pairings.filter((p) => p.left && p.right);
    const unmatchedLeft = result.pairings.filter((p) => p.left && !p.right);
    const unmatchedRight = result.pairings.filter((p) => !p.left && p.right);

    expect(matched).toHaveLength(10);
    expect(unmatchedLeft).toHaveLength(1);
    expect(unmatchedRight).toHaveLength(1);
    expect(result.pairings).toHaveLength(12);
  });
});
