/**
 * Vitest config, kept separate from `vite.config.ts` on purpose: Vitest picks
 * this file over `vite.config.ts`, so the `iwsdkDev()` plugin never loads
 * during tests. That plugin starts (or claims ownership of) the workspace's
 * IWSDK dev runtime, which fails with `runtime_owner_conflict` whenever
 * `npm run dev` is already running.
 *
 * The tests are pure TypeScript (data layer), so they need no IWSDK, Three.js,
 * or DOM setup.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
