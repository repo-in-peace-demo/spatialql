import { describe, expect, it } from 'vitest';
import { DATA_METRICS, HEADER_METRICS } from '../slab-metrics.js';
import { BAR, CARD, CONCEPT_INTROS, DATASET_TITLES, DIFF, NULL_EXPLAINER, WELCOME } from './copy.js';
import { DATASET_IDS } from './datasets.js';
import { PUZZLES } from './puzzles.js';
import { puzzleText } from './puzzle-text.js';

/**
 * Every string a player can see, as rendered: puzzle text with its
 * placeholders resolved, and the copy helpers called with sample arguments.
 */
function playerStrings(): string[] {
  const strings: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === 'string') {
      strings.push(value);
    } else if (typeof value === 'function') {
      for (const args of [[1], [3], [12, 20], ['shop'], ['cafe']]) {
        try {
          collect((value as (...a: unknown[]) => unknown)(...args));
        } catch {
          // Not callable with these arguments.
        }
      }
    } else if (Array.isArray(value)) {
      value.forEach(collect);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(collect);
    }
  };
  for (const puzzle of PUZZLES) {
    const text = puzzleText(puzzle);
    collect([text.goal, text.takeaway, ...text.hints]);
  }
  collect([CONCEPT_INTROS, NULL_EXPLAINER, CARD, BAR, DIFF, WELCOME, DATASET_TITLES]);
  for (const id of DATASET_IDS) {
    collect([CARD.practiceTitle(1, id), CARD.dailyTitle(20), WELCOME.dailyOpen(id)]);
  }
  return strings;
}

describe('player-facing copy', () => {
  it('uses only glyphs the bundled fonts have, in both weights', () => {
    const missing = new Map<string, string>();
    for (const text of playerStrings()) {
      for (const char of text) {
        if (char === ' ') {
          continue;
        }
        if (!DATA_METRICS.has(char) || !HEADER_METRICS.has(char)) {
          missing.set(char, text);
        }
      }
    }
    expect([...missing].map(([char, text]) => `"${char}" (U+${char.codePointAt(0)?.toString(16)}) in: ${text}`)).toEqual([]);
  });

  it('is plain ASCII (the copy rule)', () => {
    for (const text of playerStrings()) {
      expect(text, text).toMatch(/^[\x20-\x7e\n]*$/);
    }
  });
});
