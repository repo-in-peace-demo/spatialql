/**
 * Pure data-layer types. No three.js or IWSDK imports belong in this
 * directory — the scene layer renders what this layer computes, never the
 * other way around.
 */

export type CellValue = string | number | null;

export type Row = Record<string, CellValue>;

/**
 * Declares that `column` in the owning table references
 * `references.column` in table `references.tableId`. Join keys are always
 * resolved from this metadata, never hard-coded by callers.
 */
export type ForeignKey = {
  column: string;
  references: { tableId: string; column: string };
};

export type Table = {
  id: string;
  columns: string[];
  rows: Row[];
  /**
   * Optional header text per column key, for presentation only. Column keys
   * in `columns`/`rows` are unchanged; a column without an entry displays its
   * key.
   */
  columnLabels?: Partial<Record<string, string>>;
  /** Short SQL alias (e.g. `c`); also prefixes ambiguous result labels. */
  alias?: string;
  foreignKeys?: ForeignKey[];
};

export type JoinType = 'inner' | 'left';

/**
 * `WHERE <table>.<column> IS NULL` on a join result. Names the source table
 * and column (not a LEFT/RIGHT position), so it means the same thing in
 * either join direction.
 */
export type NullFilter = {
  tableId: string;
  column: string;
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
