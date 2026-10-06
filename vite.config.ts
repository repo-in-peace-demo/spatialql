/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig, type Plugin } from 'vite';

/** Largest log batch accepted (bytes); bigger bodies are refused. */
const LOG_BODY_LIMIT_BYTES = 256 * 1024;

type LogBatch = {
  id: string;
  device: string;
  header: Record<string, string> | null;
  lines: { t: number; kind: string; text: string }[];
};

/** `YYYYMMDD-HHMMSS` in local time. */
function fileStamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/** `HH:MM:SS.mmm` in local time. */
function lineStamp(ms: number): string {
  const date = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}.${p(date.getMilliseconds(), 3)}`;
}

/**
 * Dev server only (`apply: 'serve'`; never part of a build): receives the
 * page's debug output (`src/debug-log-sink.ts`, with `?debug=1`) at
 * POST /__spatialql/log and appends it to `logs/headset-<stamp>.log` (Quest
 * Browser) or `logs/desktop-<stamp>.log`, one file per page load, so a
 * headset session over Wi-Fi can be read on the Mac afterwards.
 */
function spatialqlDebugLogs(): Plugin {
  return {
    name: 'spatialql-debug-logs',
    apply: 'serve',
    configureServer(server) {
      const dir = path.join(server.config.root, 'logs');
      let commit = 'unknown';
      try {
        commit = execSync('git rev-parse --short HEAD', { cwd: server.config.root, stdio: ['ignore', 'pipe', 'ignore'] })
          .toString()
          .trim();
      } catch {
        // Not a git checkout: the header says "unknown".
      }
      const files = new Map<string, string>();

      const fileFor = (batch: LogBatch): string => {
        const known = files.get(batch.id);
        if (known) {
          return known;
        }
        // The page decides: a real Quest Browser on the network address is "headset".
        const device = batch.device === 'headset' ? 'headset' : 'desktop';
        mkdirSync(dir, { recursive: true });
        const stamp = fileStamp(new Date());
        let file = path.join(dir, `${device}-${stamp}.log`);
        for (let n = 2; existsSync(file); n++) {
          file = path.join(dir, `${device}-${stamp}-${n}.log`);
        }
        const header = [
          `# SpatialQL ${device} debug log`,
          `# started ${new Date().toISOString()}`,
          `# commit ${commit}`,
          ...Object.entries(batch.header ?? {}).map(([key, value]) => `# ${key}: ${value}`),
          '',
        ];
        appendFileSync(file, `${header.join('\n')}\n`);
        files.set(batch.id, file);
        return file;
      };

      server.middlewares.use('/__spatialql/log', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        let size = 0;
        req.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size <= LOG_BODY_LIMIT_BYTES) {
            body += chunk.toString('utf8');
          }
        });
        req.on('end', () => {
          if (size > LOG_BODY_LIMIT_BYTES) {
            res.statusCode = 413;
            res.end();
            return;
          }
          try {
            const batch = JSON.parse(body) as LogBatch;
            if (typeof batch.id !== 'string' || !/^[a-z0-9]{6,32}$/.test(batch.id) || !Array.isArray(batch.lines)) {
              throw new Error('bad batch');
            }
            const file = fileFor(batch);
            const text = batch.lines
              .map((line) => {
                const kind = (line.kind === 'warn' ? 'WARN ' : line.kind === 'error' ? 'ERROR' : 'INFO ').padEnd(5);
                const [first, ...rest] = String(line.text).split('\n');
                return [`${lineStamp(Number(line.t) || Date.now())} ${kind} ${first}`, ...rest.map((r) => `    ${r}`)].join('\n');
              })
              .join('\n');
            if (text) {
              appendFileSync(file, `${text}\n`);
            }
            // The file's name (relative to the project), so the page can say where its log goes.
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ file: path.relative(server.config.root, file) }));
            return;
          } catch {
            res.statusCode = 400;
          }
          res.end();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [iwsdkDev(), spatialqlDebugLogs()],
  // `logs/` holds the debug logs written above: never watched or reloaded.
  server: { host: '0.0.0.0', port: 8081, open: false, watch: { ignored: ['**/logs/**'] } },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (three@0.185 vs app super-three@0.181). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      // @iwsdk/core is served unbundled in dev, so its `signal`/`computed`
      // come straight from node_modules, while @pmndrs/uikit's pre-bundle
      // would otherwise inline a private copy of this package. UIKit
      // unwraps signal-valued properties with `instanceof Signal`, which
      // fails across two copies ("Invalid number: 1"). As its own optimized
      // entry, both sides share one instance.
      '@preact/signals-core',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
