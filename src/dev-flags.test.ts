import { describe, expect, it } from 'vitest';
import { DEV_FLAG_STORAGE_PREFIX, resolveDevFlag } from './dev-flags.js';

function storageWith(values: Record<string, string>) {
  return { getItem: (key: string) => values[key] ?? null };
}

describe('dev flags', () => {
  it('reads a flag from the URL query', () => {
    expect(resolveDevFlag('debug', '?debug=1', null)).toBe(true);
    expect(resolveDevFlag('debug', '?debug', null)).toBe(true);
    expect(resolveDevFlag('debug', '?seated=1', null)).toBe(false);
  });

  it('treats 0, false and off in the query as off', () => {
    for (const value of ['0', 'false', 'off', 'OFF']) {
      expect(resolveDevFlag('debug', `?debug=${value}`, null), value).toBe(false);
    }
  });

  it('falls back to localStorage, which must hold exactly "1"', () => {
    expect(resolveDevFlag('seated', '', storageWith({ [`${DEV_FLAG_STORAGE_PREFIX}seated`]: '1' }))).toBe(true);
    expect(resolveDevFlag('seated', '', storageWith({ [`${DEV_FLAG_STORAGE_PREFIX}seated`]: 'true' }))).toBe(false);
    expect(resolveDevFlag('seated', '', storageWith({}))).toBe(false);
  });

  it('lets the URL take precedence over localStorage', () => {
    const stored = storageWith({ [`${DEV_FLAG_STORAGE_PREFIX}forceSurface`]: '1' });
    expect(resolveDevFlag('forceSurface', '?forceSurface=0', stored)).toBe(false);
  });

  it('survives a storage that throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(resolveDevFlag('debug', '', throwing)).toBe(false);
  });
});
