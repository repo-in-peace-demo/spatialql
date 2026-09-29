/**
 * Relationship-driven joins and the display-ready result table. Pure data
 * layer: the join key always comes from `Table.foreignKeys` metadata, never
 * from the caller, and every result row keeps its source `RowRef` lineage so
 * the scene can animate row-to-row.
 */

import { computeJoin, innerJoin, leftJoin } from './join.js';
import type { CellValue, JoinResult, JoinType, Row, RowRef, Table } from './types.js';

export type JoinKeys = {
  leftColumn: string;
  rightColumn: string;
  /** The side whose column is the foreign key (dropped from the result). */
  foreignKeySide: 'left' | 'right';
};

export type ResultColumn = {
  /** Unique key of this column in the result table's rows. */
  key: string;
  source: 'left' | 'right';
  sourceColumn: string;
  label: string;
};

export type ResultRowLineage = {
  left: RowRef | null;
  right: RowRef | null;
  /**
   * True for an unmatched-left row kept by a LEFT JOIN: its right-side cells
   * have no source row at all (a "ghost"), which is different from a real
   * NULL value stored in a source row.
   */
  ghost: boolean;
};

export type JoinResultTable = {
  table: Table;
  columns: ResultColumn[];
  lineage: ResultRowLineage[];
};

export function tableAlias(table: Table): string {
  return table.alias ?? table.id;
}

/** Finds the foreign-key relationship between two tables, in either direction. */
export function findJoinKeys(left: Table, right: Table): JoinKeys | null {
  for (const fk of right.foreignKeys ?? []) {
    if (fk.references.tableId === left.id) {
      return { leftColumn: fk.references.column, rightColumn: fk.column, foreignKeySide: 'right' };
    }
  }
  for (const fk of left.foreignKeys ?? []) {
    if (fk.references.tableId === right.id) {
      return { leftColumn: fk.column, rightColumn: fk.references.column, foreignKeySide: 'left' };
    }
  }
  return null;
}

export function requireJoinKeys(left: Table, right: Table): JoinKeys {
  const keys = findJoinKeys(left, right);
  if (!keys) {
    throw new Error(`No foreign key relates "${left.id}" and "${right.id}"`);
  }
  return keys;
}

function keyReader(column: string): (row: Row) => CellValue {
  return (row) => row[column] ?? null;
}

/** INNER or LEFT join of `left` and `right` on their declared relationship. */
export function joinTables(left: Table, right: Table, joinType: JoinType): JoinResult {
  const keys = requireJoinKeys(left, right);
  const join = joinType === 'inner' ? innerJoin : leftJoin;
  return join(left, right, keyReader(keys.leftColumn), keyReader(keys.rightColumn));
}

/** Every pairing, including unmatched rows on both sides. */
export function fullJoinPairings(left: Table, right: Table): JoinResult {
  const keys = requireJoinKeys(left, right);
  return computeJoin(left, right, keyReader(keys.leftColumn), keyReader(keys.rightColumn));
}

function resultColumns(left: Table, right: Table, keys: JoinKeys): ResultColumn[] {
  const droppedColumn = keys.foreignKeySide === 'left' ? keys.leftColumn : keys.rightColumn;
  const candidates: { table: Table; source: 'left' | 'right'; column: string; base: string }[] = [];
  for (const [table, source] of [
    [left, 'left'],
    [right, 'right'],
  ] as const) {
    for (const column of table.columns) {
      if (source === keys.foreignKeySide && column === droppedColumn) {
        continue;
      }
      candidates.push({ table, source, column, base: table.columnLabels?.[column] ?? column });
    }
  }
  const counts = new Map<string, number>();
  for (const { base } of candidates) {
    const normalized = base.toLowerCase();
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return candidates.map(({ table, source, column, base }) => ({
    key: `${source}:${column}`,
    source,
    sourceColumn: column,
    label: (counts.get(base.toLowerCase()) ?? 0) > 1 ? `${tableAlias(table)}.${base}` : base,
  }));
}

/**
 * Builds the display-ready result of joining `left` and `right`.
 *
 * Columns: left table's then right table's, minus the foreign-key column,
 * with a label prefixed by the table alias wherever two labels would
 * otherwise collide (`C.ID` / `O.ID`).
 *
 * Rows: matched pairings in `joinResult` order, then (LEFT only) unmatched
 * left rows as ghost rows. Keeping ghosts last is a deliberate ordering
 * rule -- SQL guarantees no row order, and it lets INNER <-> LEFT add or
 * remove rows without moving any other row. Unmatched-right pairings never
 * produce a row.
 */
export function buildJoinResultTable(
  left: Table,
  right: Table,
  joinResult: JoinResult,
  joinType: JoinType,
): JoinResultTable {
  const keys = requireJoinKeys(left, right);
  const columns = resultColumns(left, right, keys);

  const matched = joinResult.pairings.filter((p) => p.left !== null && p.right !== null);
  const ghosts =
    joinType === 'left' ? joinResult.pairings.filter((p) => p.left !== null && p.right === null) : [];

  const rows: Row[] = [];
  const lineage: ResultRowLineage[] = [];
  for (const pairing of [...matched, ...ghosts]) {
    const leftRow = pairing.left ? left.rows[pairing.left.rowIndex] : null;
    const rightRow = pairing.right ? right.rows[pairing.right.rowIndex] : null;
    const row: Row = {};
    for (const column of columns) {
      const sourceRow = column.source === 'left' ? leftRow : rightRow;
      row[column.key] = sourceRow ? (sourceRow[column.sourceColumn] ?? null) : null;
    }
    rows.push(row);
    lineage.push({ left: pairing.left, right: pairing.right, ghost: pairing.right === null });
  }

  const table: Table = {
    id: `${left.id}_${joinType}_join_${right.id}`,
    columns: columns.map((c) => c.key),
    columnLabels: Object.fromEntries(columns.map((c) => [c.key, c.label])),
    rows,
  };
  return { table, columns, lineage };
}

/** Whether a result cell is a ghost (no source row) rather than a value/NULL. */
export function isGhostCell(result: JoinResultTable, rowIndex: number, columnIndex: number): boolean {
  return result.lineage[rowIndex].ghost && result.columns[columnIndex].source === 'right';
}
