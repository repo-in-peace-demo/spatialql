import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { anchorEyes, layoutAnchor, resetLayoutAnchorForTests, setLayoutAnchor } from './layout-anchor.js';

afterEach(() => resetLayoutAnchorForTests());

describe('the session layout anchor', () => {
  it('holds the eyes and yaw it was set with, and what set it', () => {
    expect(layoutAnchor()).toMatchObject({ x: 0, y: 1.6, z: 0, yaw: 0, reason: null, epoch: 0 });
    setLayoutAnchor({ x: 0.1, y: 1.1, z: -0.05 }, 0.3, 'session-start');
    expect(layoutAnchor()).toMatchObject({ x: 0.1, y: 1.1, z: -0.05, yaw: 0.3, reason: 'session-start', epoch: 1 });
    setLayoutAnchor({ x: 0, y: 1.2, z: 0 }, -0.2, 'recenter');
    expect(layoutAnchor()).toMatchObject({ reason: 'recenter', epoch: 2, yaw: -0.2 });
  });

  it('hands out a copy of the eyes, not a live reference', () => {
    setLayoutAnchor({ x: 1, y: 2, z: 3 }, 0, 'headset-on');
    const out = { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; } };
    anchorEyes(out).x = 99;
    expect(layoutAnchor().x).toBe(1);
  });
});

/**
 * Head movement never moves anything: every placement reads the layout
 * anchor. So the live head may be read only for sensing (which way the
 * player faces, the Recenter countdown, reach, where a hand points), in the
 * functions listed here; a head read anywhere else fails this test.
 */
describe('the live head is read only for sensing', () => {
  // File -> the functions (or '*' for a whole dev/audio file) allowed to read `player.head`.
  const ALLOWED: Record<string, readonly string[]> = {
    // The Recenter countdown and its prompt (at the gaze, by design), the facing history, the session-start wait.
    'desk-placement.ts': ['requestRecenter', 'updateCountdown', 'update', 'readHeadPose'],
    // Reach sensing (is the player out of reach?) and the hand pointers' aim.
    'join-system.ts': ['reachControlMeters', 'reachSlabMeters', 'updateHandPointers'],
    // The audio listener follows the ears.
    'sound.ts': ['*'],
    // Dev only.
    'debug-hud.ts': ['*'],
    'grab-debug.ts': ['*'],
    'touch-debug.ts': ['*'],
    'placement-debug.ts': ['*'],
    'dev-seated.ts': ['*'],
  };
  // In desk-placement, the live head pose may be read for sensing and to set the anchor -- not to place.
  // ...and reportPlacement: the dev placement report logs the live head beside the anchor (logged, never placed from).
  const READ_HEAD_POSE_ALLOWED = ['requestRecenter', 'updateCountdown', 'update', 'runRecenter', 'beginSessionPlacement', 'reportPlacement'];

  const src = join(__dirname);
  const files = readdirSync(src).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));

  /** Each line's enclosing method or function name (a class member or a top-level function). */
  function enclosing(lines: string[], index: number): string {
    for (let i = index; i >= 0; i--) {
      const member = /^ {2}(?:private |public |protected |static |readonly |async |get |set )*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\(/.exec(lines[i]);
      if (member && !/^ {2}(if|for|while|switch|return)\b/.test(lines[i])) {
        return member[1];
      }
      const top = /^(?:export )?function ([A-Za-z_$][\w$]*)/.exec(lines[i]);
      if (top) {
        return top[1];
      }
    }
    return '?';
  }

  function sites(pattern: RegExp): { file: string; fn: string; line: number }[] {
    const found: { file: string; fn: string; line: number }[] = [];
    for (const file of files) {
      const lines = readFileSync(join(src, file), 'utf8').split('\n');
      lines.forEach((text, i) => {
        const code = text.replace(/\/\/.*$/, '');
        if (pattern.test(code) && !/^\s*\*/.test(text)) {
          found.push({ file, fn: enclosing(lines, i), line: i + 1 });
        }
      });
    }
    return found;
  }

  it('player.head appears only in sensing, input, audio and dev code', () => {
    const offenders = sites(/\bplayer\.head\b|playerHeadEntity/).filter(({ file, fn }) => {
      const allowed = ALLOWED[file];
      return !allowed || !(allowed.includes('*') || allowed.includes(fn));
    });
    expect(offenders, offenders.map((o) => `${o.file}:${o.line} in ${o.fn}`).join('\n')).toEqual([]);
  });

  it('desk placement reads the live head pose only to sense or to set the anchor', () => {
    const offenders = sites(/this\.readHeadPose\(\)/).filter(({ file, fn }) => file === 'desk-placement.ts' && !READ_HEAD_POSE_ALLOWED.includes(fn));
    expect(offenders, offenders.map((o) => `${o.file}:${o.line} in ${o.fn}`).join('\n')).toEqual([]);
  });

  it('the anchor is set only where a session starts, recenters, or tracking corrects itself', () => {
    const setters = sites(/\bsetLayoutAnchor\(/).filter(({ file }) => file !== 'layout-anchor.ts');
    expect(setters.map(({ file, fn }) => `${file} ${fn}`).sort()).toEqual([
      'desk-placement.ts applyTrackingCorrection',
      'desk-placement.ts beginSessionPlacement',
      'desk-placement.ts runRecenter',
    ]);
  });
});
