import { describe, expect, it } from 'vitest';
import { PUZZLE_COPY } from './copy.js';
import { DATASETS } from './datasets.js';
import { buildJoinSql } from './join-sql.js';
import { tableLabel } from './join-result.js';
import { PUZZLES } from './puzzles.js';

/** Every "the X table" in a text. */
function namedTables(text: string): string[] {
  return [...text.matchAll(/\bthe (\w+) table\b/gi)].map((match) => match[1]);
}

describe('table names', () => {
  it('every "the X table" in a puzzle\'s text is a slab label in its dataset', () => {
    for (const puzzle of PUZZLES) {
      const labels = DATASETS[puzzle.datasetId].tables.map((table) => tableLabel(table).name);
      const copy = PUZZLE_COPY[puzzle.id];
      for (const text of [copy.goal, copy.takeaway, ...copy.hints]) {
        for (const name of namedTables(text)) {
          expect(labels, `${puzzle.id}: "${text}"`).toContain(name);
        }
      }
    }
  });

  it('the hints do name tables (the check above has something to check)', () => {
    const named = PUZZLES.flatMap((puzzle) => PUZZLE_COPY[puzzle.id].hints.flatMap(namedTables));
    expect(named.length).toBeGreaterThan(20);
  });

  it('a slab label is the name and alias the SQL caption uses', () => {
    for (const dataset of Object.values(DATASETS)) {
      const [parent, child] = dataset.tables;
      const [from, join] = buildJoinSql(parent, child, 'left');
      const p = tableLabel(parent);
      const c = tableLabel(child);
      expect(from).toMatch(new RegExp(`FROM ${p.name} ${p.alias}$`));
      expect(join).toMatch(new RegExp(`^LEFT JOIN ${c.name} ${c.alias} ON`));
    }
  });
});
