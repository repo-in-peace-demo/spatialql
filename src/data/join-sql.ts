/**
 * The SQL caption for a join, generated from table metadata and join state.
 * Pure data layer; the scene only displays these lines.
 */

import { requireJoinKeys, tableAlias } from './join-result.js';
import type { JoinType, NullFilter, Table } from './types.js';

export function joinKeyword(joinType: JoinType): string {
  return joinType === 'inner' ? 'INNER JOIN' : 'LEFT JOIN';
}

/**
 * Two lines of SQL equivalent to what the result slab shows, e.g.
 *
 *   SELECT c.*, o.id, o.product, o.amount FROM customers c
 *   LEFT JOIN orders o ON o.customerId = c.id
 *
 * `left` is the LEFT table (the slab that stayed put). The select list
 * names columns explicitly on the side whose foreign-key column the result
 * slab drops, so the SQL matches the displayed columns exactly. Only the
 * join keyword differs between join types, so a toggle only changes that.
 */
export function buildJoinSql(left: Table, right: Table, joinType: JoinType): [string, string] {
  const keys = requireJoinKeys(left, right);
  const leftAlias = tableAlias(left);
  const rightAlias = tableAlias(right);

  const selectFor = (table: Table, alias: string, droppedColumn: string | null): string =>
    droppedColumn === null
      ? `${alias}.*`
      : table.columns
          .filter((column) => column !== droppedColumn)
          .map((column) => `${alias}.${column}`)
          .join(', ');

  const select = [
    selectFor(left, leftAlias, keys.foreignKeySide === 'left' ? keys.leftColumn : null),
    selectFor(right, rightAlias, keys.foreignKeySide === 'right' ? keys.rightColumn : null),
  ].join(', ');

  const fk =
    keys.foreignKeySide === 'right'
      ? { alias: rightAlias, column: keys.rightColumn }
      : { alias: leftAlias, column: keys.leftColumn };
  const referenced =
    keys.foreignKeySide === 'right'
      ? { alias: leftAlias, column: keys.leftColumn }
      : { alias: rightAlias, column: keys.rightColumn };

  return [
    `SELECT ${select} FROM ${left.id} ${leftAlias}`,
    `${joinKeyword(joinType)} ${right.id} ${rightAlias} ON ${fk.alias}.${fk.column} = ${referenced.alias}.${referenced.column}`,
  ];
}

/**
 * The optional third caption line for a NULL filter, e.g.
 * `WHERE o.id IS NULL`. It names the source column (not its display label),
 * like the lines above. Throws if the filter names neither table.
 */
export function buildWhereSql(left: Table, right: Table, filter: NullFilter): string {
  const table = filter.tableId === left.id ? left : filter.tableId === right.id ? right : null;
  if (!table) {
    throw new Error(`Filter table "${filter.tableId}" is not "${left.id}" or "${right.id}"`);
  }
  return `WHERE ${tableAlias(table)}.${filter.column} IS NULL`;
}
