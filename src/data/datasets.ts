/**
 * Challenge-mode datasets: small fictional tables with the wrinkles the
 * puzzles need. No real people, brands or places. Each dataset is two
 * tables related by one foreign key (three-table datasets are a future
 * item). Player-facing titles live in `copy.ts`.
 *
 * Wrinkles per dataset (see docs/plans/challenge-mode.md §8):
 * - shop: the existing sample data (a duplicate customer id, a customer with
 *   no orders, an order with a NULL customer).
 * - library: a borrower with nothing out; books on the shelf (NULL
 *   borrower); a borrowed book with a stored NULL due date.
 * - school: two clubs sharing id 3 (a data-entry mistake); an empty club; a
 *   student with no club (NULL) and one with an unknown club id (9).
 * - cafe: a drink never ordered; a ticket with no drink (NULL); tickets with
 *   a stored NULL milk.
 */

import { CUSTOMERS_TABLE, ORDERS_TABLE } from './sample-data.js';
import type { Table } from './types.js';

export type DatasetId = 'shop' | 'library' | 'school' | 'cafe';

/** A dataset's card icon (drawn as a vector icon by the scene layer). */
export type DatasetIcon = 'shopping-bag' | 'book-open' | 'school' | 'coffee';

export type Dataset = {
  id: DatasetId;
  /** Parent (referenced) table first: it's the left slab on the desk. */
  tables: readonly Table[];
  /**
   * Per table id, the column that names a row for people (a name or an id).
   * Used for readable row labels in tests and debug readouts.
   */
  labelColumns: Readonly<Record<string, string>>;
  /**
   * The dataset's light identity (challenge mode): a deep accent on the card
   * border and the slab header stripe -- never on rows, which carry the
   * pastel key tints -- and an icon on the card title.
   */
  theme: { accent: string; icon: DatasetIcon };
};

export const BORROWERS_TABLE: Table = {
  id: 'borrowers',
  alias: 'br',
  columns: ['id', 'name', 'branch'],
  rows: [
    { id: 1, name: 'Wren Halloway', branch: 'North' },
    { id: 2, name: 'Ikaika Dunn', branch: 'South' },
    { id: 3, name: 'Mirela Okafor', branch: 'North' },
    { id: 4, name: 'Basil Thorne', branch: 'East' },
    { id: 5, name: 'Sunniva Lake', branch: 'South' },
  ],
};

export const BOOKS_TABLE: Table = {
  id: 'books',
  alias: 'bk',
  columns: ['id', 'title', 'borrowerId', 'due'],
  columnLabels: { borrowerId: 'Borrower' },
  foreignKeys: [{ column: 'borrowerId', references: { tableId: 'borrowers', column: 'id' } }],
  rows: [
    // Titles are short enough to fit a column without an ellipsis (tested).
    { id: 201, title: 'Glass Orchard', borrowerId: 1, due: 'Fri' },
    { id: 202, title: 'Salt Lantern', borrowerId: 3, due: 'Mon' },
    { id: 203, title: 'Paper Moons', borrowerId: null, due: null },
    { id: 204, title: 'A Map of Rain', borrowerId: 1, due: 'Tue' },
    { id: 205, title: 'Quiet Engine', borrowerId: 5, due: 'Fri' },
    { id: 206, title: 'Small Hours', borrowerId: null, due: null },
    { id: 207, title: 'Far North', borrowerId: 2, due: null },
    { id: 208, title: 'Tidewater', borrowerId: 3, due: 'Wed' },
  ],
};

export const CLUBS_TABLE: Table = {
  id: 'clubs',
  alias: 'cl',
  columns: ['id', 'club', 'room'],
  rows: [
    { id: 1, club: 'Chess', room: 'B12' },
    { id: 2, club: 'Robotics', room: 'Lab 1' },
    { id: 3, club: 'Choir', room: 'Hall' },
    { id: 3, club: 'Drama', room: 'Hall' },
    { id: 4, club: 'Gardening', room: 'Yard' },
  ],
};

export const STUDENTS_TABLE: Table = {
  id: 'students',
  alias: 'st',
  columns: ['id', 'name', 'clubId', 'grade'],
  columnLabels: { clubId: 'Club ID' },
  foreignKeys: [{ column: 'clubId', references: { tableId: 'clubs', column: 'id' } }],
  rows: [
    { id: 301, name: 'Ines Vale', clubId: 3, grade: 7 },
    { id: 302, name: 'Tobiah Marsh', clubId: 1, grade: 8 },
    { id: 303, name: 'Kemi Ardent', clubId: 2, grade: 7 },
    { id: 304, name: 'Lio Sandoval', clubId: null, grade: 8 },
    { id: 305, name: 'Hana Brook', clubId: 1, grade: 7 },
    { id: 306, name: 'Pell Quinn', clubId: 2, grade: 8 },
    { id: 307, name: 'Odette Rue', clubId: 9, grade: 7 },
  ],
};

export const DRINKS_TABLE: Table = {
  id: 'drinks',
  alias: 'd',
  columns: ['id', 'drink', 'price'],
  rows: [
    { id: 1, drink: 'Flat White', price: 4 },
    { id: 2, drink: 'Chai', price: 3 },
    { id: 3, drink: 'Cold Brew', price: 5 },
    { id: 4, drink: 'Matcha', price: 5 },
    { id: 5, drink: 'Cocoa', price: 3 },
  ],
};

export const TICKETS_TABLE: Table = {
  id: 'tickets',
  alias: 't',
  columns: ['id', 'drinkId', 'milk'],
  columnLabels: { drinkId: 'Drink ID' },
  foreignKeys: [{ column: 'drinkId', references: { tableId: 'drinks', column: 'id' } }],
  rows: [
    { id: 401, drinkId: 1, milk: 'Oat' },
    { id: 402, drinkId: 3, milk: null },
    { id: 403, drinkId: 2, milk: 'Whole' },
    { id: 404, drinkId: 1, milk: 'Whole' },
    { id: 405, drinkId: 5, milk: 'Oat' },
    { id: 406, drinkId: 3, milk: null },
    { id: 407, drinkId: null, milk: 'Oat' },
    { id: 408, drinkId: 2, milk: 'Oat' },
  ],
};

export const DATASETS: Readonly<Record<DatasetId, Dataset>> = {
  shop: {
    id: 'shop',
    tables: [CUSTOMERS_TABLE, ORDERS_TABLE],
    labelColumns: { customers: 'name', orders: 'id' },
    theme: { accent: '#3b4f9c', icon: 'shopping-bag' }, // indigo
  },
  library: {
    id: 'library',
    tables: [BORROWERS_TABLE, BOOKS_TABLE],
    labelColumns: { borrowers: 'name', books: 'title' },
    theme: { accent: '#7a3e8f', icon: 'book-open' }, // plum
  },
  school: {
    id: 'school',
    tables: [CLUBS_TABLE, STUDENTS_TABLE],
    labelColumns: { clubs: 'club', students: 'name' },
    theme: { accent: '#1f6f78', icon: 'school' }, // deep teal
  },
  cafe: {
    id: 'cafe',
    tables: [DRINKS_TABLE, TICKETS_TABLE],
    labelColumns: { drinks: 'drink', tickets: 'id' },
    theme: { accent: '#8a5a2b', icon: 'coffee' }, // coffee brown
  },
};

export const DATASET_IDS: readonly DatasetId[] = ['shop', 'library', 'school', 'cafe'];

/** The table with this id, from any dataset, or null. */
export function tableById(id: string): Table | null {
  for (const datasetId of DATASET_IDS) {
    const table = DATASETS[datasetId].tables.find((t) => t.id === id);
    if (table) {
      return table;
    }
  }
  return null;
}

/** The dataset a table belongs to, or null. */
export function datasetOfTable(id: string): DatasetId | null {
  return DATASET_IDS.find((datasetId) => DATASETS[datasetId].tables.some((t) => t.id === id)) ?? null;
}
