/**
 * PLACEHOLDER DATA — replace with a designed dataset later.
 *
 * Fictional names/products only; no real people, brands, or logos. This is
 * the single module that owns the actual rows; everything else consumes
 * `Table` values, never literal data.
 *
 * Deliberate wrinkles, each on its own row so they don't interact:
 * - `id:5` (Odalys Ferreira) has no matching orders (unmatched-left case).
 * - `id:2` is shared by two distinct customer rows (Priya Shah / Marcus
 *   Webb) — a duplicate key — and `id:2` has real orders, so the fan-out is
 *   actually visible in a join.
 * - order `108` has `customerId: null` (unmatched-FK / unmatched-right case).
 */

import type { Table } from './types.js';

export const CUSTOMERS_TABLE: Table = {
  id: 'customers',
  columns: ['id', 'name', 'city'],
  rows: [
    { id: 1, name: 'Alderly Finch', city: 'Rivermere' },
    { id: 2, name: 'Priya Shah', city: 'Bridgeport' },
    { id: 3, name: 'Tomas Reyes', city: 'Oakhaven' },
    { id: 2, name: 'Marcus Webb', city: 'Fenwick' },
    { id: 5, name: 'Odalys Ferreira', city: 'Millbrook' },
    { id: 6, name: 'Jun Park', city: 'Cedar Falls' },
  ],
};

/**
 * `customerId` by row: [2, 2, 2, null, 1, 3, 6, 1] — three orders for
 * `customerId: 2` (fans out against the two customer rows sharing that id),
 * one `null` (unmatched FK), and at least one order each for customers 1, 3,
 * and 6 so that `id:5` remains the *only* customer with zero orders.
 */
export const ORDERS_TABLE: Table = {
  id: 'orders',
  columns: ['id', 'customerId', 'product', 'amount'],
  rows: [
    { id: 101, customerId: 2, product: 'Notebook Set', amount: 12 },
    { id: 102, customerId: 2, product: 'Water Bottle', amount: 18 },
    { id: 103, customerId: 2, product: 'Backpack', amount: 45 },
    { id: 104, customerId: 1, product: 'Desk Lamp', amount: 24 },
    { id: 105, customerId: 3, product: 'Headphones', amount: 60 },
    { id: 106, customerId: 6, product: 'Notebook Set', amount: 12 },
    { id: 107, customerId: 1, product: 'Water Bottle', amount: 18 },
    { id: 108, customerId: null, product: 'Desk Lamp', amount: 24 },
  ],
};
