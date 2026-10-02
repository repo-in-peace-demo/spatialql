/**
 * Challenge mode's win check and the diff it shows: does the player's
 * result match the puzzle's target?
 *
 * Columns and rows are compared by *source* (`tableId.column`), not by
 * LEFT/RIGHT position, so the comparison doesn't depend on join direction:
 * `customers INNER JOIN orders` and `orders INNER JOIN customers` give the
 * same answer, as in SQL. Rows compare as a multiset: order doesn't matter,
 * and a row repeated by fan-out must appear as many times as in the target.
 * A ghost cell (no source row) and a stored NULL are both just NULL.
 */

import { requireJoinKeys } from './join-result.js';
import { columnTableId, visibleRowIndices, type QueryOutput } from './query.js';
import type { CellValue, RowRef } from './types.js';

/** Sorted `tableId.column` of every result column. */
export function columnSet(output: QueryOutput): string[] {
  const { left, right, result } = output;
  return result.columns.map((column, index) => `${columnTableId(left, right, result, index)}.${column.sourceColumn}`).sort();
}

/** A direction-independent identity for one result row. */
export function rowKey(output: QueryOutput, rowIndex: number): string {
  const { left, right, result } = output;
  const row = result.table.rows[rowIndex];
  return result.columns
    .map((column, index) => `${columnTableId(left, right, result, index)}.${column.sourceColumn}=${JSON.stringify(row[column.key] ?? null)}`)
    .sort()
    .join('|');
}

/**
 * Per result row of the player's query: `match` (in the target), `extra`
 * (shown but not in the target), or `hidden` (removed by the filter).
 */
export type RowStatus = 'match' | 'extra' | 'hidden';

export type Comparison = {
  solved: boolean;
  columnsMatch: boolean;
  /** One per row of the player's (unfiltered) result. */
  rowStatus: RowStatus[];
  /** Target result row indices that the player's result doesn't have yet. */
  missing: number[];
  /** Rows the player's result shows. */
  visibleCount: number;
};

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function compareToTarget(actual: QueryOutput, target: QueryOutput): Comparison {
  const columnsMatch = arraysEqual(columnSet(actual), columnSet(target));
  const actualRows = visibleRowIndices(actual);
  const targetRows = visibleRowIndices(target);

  // Remaining target occurrences per key, consumed by matching actual rows.
  const targetCounts = new Map<string, number>();
  for (const index of targetRows) {
    const key = rowKey(target, index);
    targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
  }
  const actualCounts = new Map<string, number>();
  const rowStatus: RowStatus[] = actual.visible.map(() => 'hidden');
  for (const index of actualRows) {
    const key = rowKey(actual, index);
    actualCounts.set(key, (actualCounts.get(key) ?? 0) + 1);
    const remaining = columnsMatch ? (targetCounts.get(key) ?? 0) : 0;
    if (remaining > 0) {
      targetCounts.set(key, remaining - 1);
      rowStatus[index] = 'match';
    } else {
      rowStatus[index] = 'extra';
    }
  }

  // Which target rows have no counterpart, consuming actual occurrences.
  const missing: number[] = [];
  for (const index of targetRows) {
    const key = rowKey(target, index);
    const available = columnsMatch ? (actualCounts.get(key) ?? 0) : 0;
    if (available > 0) {
      actualCounts.set(key, available - 1);
    } else {
      missing.push(index);
    }
  }

  const solved = columnsMatch && missing.length === 0 && rowStatus.every((status) => status !== 'extra');
  return { solved, columnsMatch, rowStatus, missing, visibleCount: actualRows.length };
}

/**
 * Why a source row appears in more than one result row:
 * - `oneToMany`: it's on the referenced side (a customer with several
 *   orders), the normal case;
 * - `duplicateKey`: it's on the foreign-key side (a student whose club id is
 *   shared by two clubs), which only happens when the referenced key is
 *   duplicated -- usually a data mistake.
 */
export type FanOutCause = 'oneToMany' | 'duplicateKey';

export type FanOutGroup = {
  side: 'left' | 'right';
  source: RowRef;
  /** The visible result rows this source row appears in. */
  resultRows: number[];
  /** The source row's join key value. */
  key: CellValue;
  cause: FanOutCause;
};

/** Source rows that the visible result repeats, in first-appearance order. */
export function fanOutGroups(output: QueryOutput): FanOutGroup[] {
  const { left, right, result } = output;
  const keys = requireJoinKeys(left, right);
  const groups = new Map<string, FanOutGroup>();
  for (const rowIndex of visibleRowIndices(output)) {
    const lineage = result.lineage[rowIndex];
    for (const side of ['left', 'right'] as const) {
      const source = lineage[side];
      if (!source) {
        continue;
      }
      const id = `${side}:${source.rowIndex}`;
      let group = groups.get(id);
      if (!group) {
        const table = side === 'left' ? left : right;
        const keyColumn = side === 'left' ? keys.leftColumn : keys.rightColumn;
        group = {
          side,
          source,
          resultRows: [],
          key: table.rows[source.rowIndex][keyColumn] ?? null,
          cause: side === keys.foreignKeySide ? 'duplicateKey' : 'oneToMany',
        };
        groups.set(id, group);
      }
      group.resultRows.push(rowIndex);
    }
  }
  return [...groups.values()].filter((group) => group.resultRows.length > 1);
}
