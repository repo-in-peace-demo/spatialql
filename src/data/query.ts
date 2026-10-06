/**
 * A challenge-mode query: which table stayed put (LEFT), which was brought
 * over (RIGHT), the join type, and an optional `IS NULL` filter. Runs on the
 * same join engine as the scene, so a puzzle's target and the player's
 * result are computed identically.
 *
 * The filter doesn't remove rows from the result table; it produces a
 * visibility mask over it. The scene builds one result slab per direction
 * and hides filtered rows, so filtering never rebuilds a document.
 */

import { buildJoinResultTable, joinTables, type JoinResultTable } from './join-result.js';
import type { JoinType, NullFilter, Table } from './types.js';

export type QuerySpec = {
  /** Id of the table that stayed put. */
  left: string;
  /** Id of the table brought over. */
  right: string;
  joinType: JoinType;
  filter: NullFilter | null;
};

export type QueryOutput = {
  left: Table;
  right: Table;
  spec: QuerySpec;
  /** Every row of the join, before the filter. */
  result: JoinResultTable;
  /** Per result row: kept by the filter (all true without one). */
  visible: boolean[];
};

export function findTable(tables: readonly Table[], id: string): Table {
  const table = tables.find((t) => t.id === id);
  if (!table) {
    throw new Error(`No table "${id}"`);
  }
  return table;
}

export function runQuery(tables: readonly Table[], spec: QuerySpec): QueryOutput {
  const left = findTable(tables, spec.left);
  const right = findTable(tables, spec.right);
  const result = buildJoinResultTable(left, right, joinTables(left, right, spec.joinType), spec.joinType);
  return { left, right, spec, result, visible: nullFilterMask(left, right, result, spec.filter) };
}

/** The source table id of a result column. */
export function columnTableId(left: Table, right: Table, result: JoinResultTable, columnIndex: number): string {
  return result.columns[columnIndex].source === 'left' ? left.id : right.id;
}

/** Index of the filter's column in the result, or -1 if the result doesn't show it. */
export function filterColumnIndex(left: Table, right: Table, result: JoinResultTable, filter: NullFilter): number {
  return result.columns.findIndex(
    (column, index) =>
      column.sourceColumn === filter.column && columnTableId(left, right, result, index) === filter.tableId,
  );
}

/**
 * Which rows `WHERE table.column IS NULL` keeps. A ghost cell (no source
 * row, from a LEFT join) and a NULL stored in a source row both count, as in
 * SQL. A filter on a column the result doesn't show keeps nothing (the UI
 * can only create filters from a visible cell).
 */
export function nullFilterMask(
  left: Table,
  right: Table,
  result: JoinResultTable,
  filter: NullFilter | null,
): boolean[] {
  if (!filter) {
    return result.table.rows.map(() => true);
  }
  const index = filterColumnIndex(left, right, result, filter);
  if (index < 0) {
    return result.table.rows.map(() => false);
  }
  const key = result.columns[index].key;
  return result.table.rows.map((row) => row[key] === null);
}

/** The filter a poke on a cell in `columnIndex` creates. */
export function filterForColumn(left: Table, right: Table, result: JoinResultTable, columnIndex: number): NullFilter {
  return {
    tableId: columnTableId(left, right, result, columnIndex),
    column: result.columns[columnIndex].sourceColumn,
  };
}

/**
 * The result columns the Filter button offers (one chip each), in column
 * order: those with a NULL in a row the player sees now -- shown by the join
 * type (INNER hides LEFT JOIN's ghost rows) and kept by `filter`. The same
 * filters a poke on one of those NULL cells creates.
 */
export function nullFilterColumns(
  left: Table,
  right: Table,
  result: JoinResultTable,
  joinType: JoinType,
  filter: NullFilter | null,
): number[] {
  const kept = nullFilterMask(left, right, result, filter);
  const columns: number[] = [];
  result.columns.forEach((column, index) => {
    const hasNull = result.table.rows.some(
      (row, rowIndex) =>
        kept[rowIndex] && (joinType === 'left' || !result.lineage[rowIndex].ghost) && row[column.key] === null,
    );
    if (hasNull) {
      columns.push(index);
    }
  });
  return columns;
}

export function sameFilter(a: NullFilter | null, b: NullFilter | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.tableId === b.tableId && a.column === b.column;
}

/** Indices of the rows the filter keeps. */
export function visibleRowIndices(output: QueryOutput): number[] {
  const indices: number[] = [];
  output.visible.forEach((kept, index) => {
    if (kept) {
      indices.push(index);
    }
  });
  return indices;
}
