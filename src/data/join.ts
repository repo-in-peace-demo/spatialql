/**
 * Join computation over in-memory `Table`s. Tables are tiny (placeholder
 * data), so a nested-loop matcher is deliberate — no index is worth building.
 *
 * This module is the seam for a future real SQL engine (e.g. sql.js) to
 * verify results against, once the query panel needs it. Not implemented
 * now.
 */

import type { CellValue, JoinPairing, JoinResult, Row, Table } from './types.js';

/**
 * The only place join-key equality is decided. NULL never matches anything,
 * including another NULL — this must not be bypassable by a caller-supplied
 * predicate.
 */
export function keyEquals(a: CellValue, b: CellValue): boolean {
  return a !== null && b !== null && a === b;
}

/**
 * Matches every row of `left` against every row of `right` using `keyEquals`
 * on the extracted keys, producing the complete pairing set described in
 * `JoinResult`: matched pairs, unmatched-left rows, and unmatched-right rows.
 */
export function computeJoin(
  left: Table,
  right: Table,
  leftKey: (row: Row) => CellValue,
  rightKey: (row: Row) => CellValue,
): JoinResult {
  const pairings: JoinPairing[] = [];
  const rightMatched = new Array<boolean>(right.rows.length).fill(false);

  left.rows.forEach((leftRow, leftIndex) => {
    const lk = leftKey(leftRow);
    let matchedAny = false;

    right.rows.forEach((rightRow, rightIndex) => {
      if (!keyEquals(lk, rightKey(rightRow))) {
        return;
      }
      matchedAny = true;
      rightMatched[rightIndex] = true;
      pairings.push({
        left: { tableId: left.id, rowIndex: leftIndex },
        right: { tableId: right.id, rowIndex: rightIndex },
      });
    });

    if (!matchedAny) {
      pairings.push({
        left: { tableId: left.id, rowIndex: leftIndex },
        right: null,
      });
    }
  });

  right.rows.forEach((_rightRow, rightIndex) => {
    if (rightMatched[rightIndex]) {
      return;
    }
    pairings.push({
      left: null,
      right: { tableId: right.id, rowIndex: rightIndex },
    });
  });

  return { pairings };
}

/** Keeps only matched pairs. */
export function innerJoin(
  left: Table,
  right: Table,
  leftKey: (row: Row) => CellValue,
  rightKey: (row: Row) => CellValue,
): JoinResult {
  const { pairings } = computeJoin(left, right, leftKey, rightKey);
  return { pairings: pairings.filter((p) => p.left !== null && p.right !== null) };
}

/** Keeps matched pairs plus unmatched-left rows; drops unmatched-right rows. */
export function leftJoin(
  left: Table,
  right: Table,
  leftKey: (row: Row) => CellValue,
  rightKey: (row: Row) => CellValue,
): JoinResult {
  const { pairings } = computeJoin(left, right, leftKey, rightKey);
  return { pairings: pairings.filter((p) => p.left !== null) };
}
