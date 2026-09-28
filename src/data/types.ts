/**
 * Pure data-layer types. No three.js or IWSDK imports belong in this
 * directory — the scene layer renders what this layer computes, never the
 * other way around.
 */

export type CellValue = string | number | null;

export type Row = Record<string, CellValue>;

export type Table = {
  id: string;
  columns: string[];
  rows: Row[];
};

/**
 * Identifies a row by its position within a table rather than by a business
 * key, since a table's key column is not guaranteed unique (the sample data
 * deliberately has a duplicate customer id to exercise fan-out).
 */
export type RowRef = {
  tableId: string;
  rowIndex: number;
};

export type JoinPairing = {
  left: RowRef | null;
  right: RowRef | null;
};

/**
 * The complete outcome of matching every left row against every right row on
 * a join key:
 *
 * - one entry per matched pair (`left` and `right` both set) — a `RowRef` can
 *   appear in more than one matched entry when its key is duplicated on the
 *   other side (fan-out);
 * - one entry per unmatched left row (`right: null`);
 * - one entry per unmatched right row (`left: null`).
 *
 * `innerJoin` keeps only matched entries. `leftJoin` keeps matched entries
 * plus unmatched-left entries. Fan-out is always represented as multiple
 * entries sharing a `RowRef`, never by inflating a single entry.
 */
export type JoinResult = {
  pairings: JoinPairing[];
};
