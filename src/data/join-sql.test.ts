import { describe, expect, it } from 'vitest';
import { buildJoinSql } from './join-sql.js';
import { CUSTOMERS_TABLE, ORDERS_TABLE } from './sample-data.js';

describe('buildJoinSql', () => {
  it('describes customers LEFT JOIN orders from the relationship metadata', () => {
    expect(buildJoinSql(CUSTOMERS_TABLE, ORDERS_TABLE, 'left')).toEqual([
      'SELECT c.*, o.id, o.product, o.amount FROM customers c',
      'LEFT JOIN orders o ON o.customerId = c.id',
    ]);
  });

  it('only the join keyword changes between join types', () => {
    const [innerSelect, innerJoin] = buildJoinSql(CUSTOMERS_TABLE, ORDERS_TABLE, 'inner');
    const [leftSelect, leftJoin] = buildJoinSql(CUSTOMERS_TABLE, ORDERS_TABLE, 'left');
    expect(innerSelect).toBe(leftSelect);
    expect(innerJoin).toBe('INNER JOIN orders o ON o.customerId = c.id');
    expect(innerJoin.replace('INNER JOIN', 'LEFT JOIN')).toBe(leftJoin);
  });

  it('puts the stationary (LEFT) table in FROM whichever table it is', () => {
    expect(buildJoinSql(ORDERS_TABLE, CUSTOMERS_TABLE, 'inner')).toEqual([
      'SELECT o.id, o.product, o.amount, c.* FROM orders o',
      'INNER JOIN customers c ON o.customerId = c.id',
    ]);
  });
});
