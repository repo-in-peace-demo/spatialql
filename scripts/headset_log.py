#!/usr/bin/env python3
"""
Parse SpatialQL debug logs (logs/headset-*.log, logs/desktop-*.log) for analysis.

Usage:
  python3 scripts/headset_log.py pinches  [FILES...] [--latest N] [--hand right] [--target NULL] [--json]
  python3 scripts/headset_log.py presses  [FILES...] [--latest N] [--json]
  python3 scripts/headset_log.py summary  [FILES...] [--latest N] [--json]
  python3 scripts/headset_log.py layout   [FILES...] [--latest N] [--json]
  python3 scripts/headset_log.py recenter [FILES...] [--latest N]
  python3 scripts/headset_log.py context  FILE --at HH:MM:SS[.mmm] [--before 2] [--after 1] [--grep REGEX]

FILES default to the newest headset log (--latest N: the newest N). Standard
library only. Times are the log's clock; durations in ms, distances in cm.

What each pinch row holds (one per platform pinch start, "[Grab debug] <hand>
hand pinch start"):
  start_gap   thumb-index tips at the pinch start (cm)
  widest      widest tip distance in the 0.4 s before it (cm; "pinch motion" /
              "pinch ignored" lines, logs from 2026-10-09 on)
  narrowest   narrowest tip distance during it, closed_ms (<= the closed
              threshold), dur_ms ("pinch ended after", later logs)
  visible_s   how long that hand's pointer had been shown
  target      what the pointer was on at the start ("pointer pinch:" line),
              hover / dwell_ms: the last logged hover and how long before
  outcome     pressed <x> | ignored: <why> | dropped: <why> | no target | ...
  aim         the "pinch aim" line: target lock, slab pass-through, NULL distance
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import statistics
import sys
from dataclasses import asdict, dataclass, field
from typing import Iterable

LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'logs')
HANDS = ('left', 'right')

# --- Reading -------------------------------------------------------------------------


@dataclass
class Entry:
    """One timestamped log entry, with its indented continuation lines."""

    t: float  # seconds since midnight
    clock: str  # HH:MM:SS.mmm
    level: str
    text: str  # the first line's message
    more: list[str] = field(default_factory=list)  # continuation lines

    @property
    def full(self) -> str:
        return '\n'.join([self.text, *self.more])


ENTRY_RE = re.compile(r'^(\d\d):(\d\d):(\d\d\.\d+) (\w+)\s+(.*)$')


def seconds(clock: str) -> float:
    h, m, s = clock.split(':')
    return int(h) * 3600 + int(m) * 60 + float(s)


def read_log(path: str) -> list[Entry]:
    """Entries in order; lines starting with whitespace (or a timestamped line
    whose message is indented) continue the previous entry."""
    entries: list[Entry] = []
    with open(path, encoding='utf-8', errors='replace') as f:
        for raw in f:
            line = raw.rstrip('\n')
            if not line or line.startswith('#'):
                continue
            m = ENTRY_RE.match(line)
            if m:
                h, mi, s, level, msg = m.groups()
                clock = f'{h}:{mi}:{s}'
                # "03:57:38.976 INFO    head position ..." continues the entry above it.
                indented = re.match(r'^\d\d:\d\d:\d\d\.\d+ \w+ {3,}', line) is not None
                if indented and entries and not msg.startswith('['):
                    entries[-1].more.append(msg.strip())
                    continue
                entries.append(Entry(seconds(clock), clock, level, msg))
            elif entries:
                entries[-1].more.append(line.strip())
    return entries


def resolve_files(files: list[str], latest: int | None) -> list[str]:
    if files:
        out: list[str] = []
        for pattern in files:
            matches = sorted(glob.glob(pattern))
            out.extend(matches or [pattern])
        return out
    found = sorted(glob.glob(os.path.join(LOG_DIR, 'headset-*.log')), key=os.path.getmtime)
    # Skip near-empty logs (a page load with no session).
    found = [p for p in found if os.path.getsize(p) > 2000]
    return found[-(latest or 1) :]


def short(path: str) -> str:
    return os.path.basename(path).replace('headset-', '').replace('desktop-', 'desk-').replace('.log', '')


# --- Pinches ---------------------------------------------------------------------------


@dataclass
class Pinch:
    file: str
    clock: str
    t: float
    hand: str
    puzzle: int | None = None  # the challenge puzzle loaded then
    start_gap: float | None = None
    widest: float | None = None
    narrowest: float | None = None
    closed_ms: int | None = None
    dur_ms: int | None = None
    visible_s: float | None = None
    target: str | None = None  # from "pointer pinch:"
    hover: str | None = None
    dwell_ms: int | None = None
    released_before: str | None = None
    outcome: str | None = None
    pressed: str | None = None
    confirm_ms: int | None = None
    aim: str | None = None


def num(s: str | None) -> float | None:
    try:
        return float(s) if s is not None else None
    except ValueError:
        return None


def parse_pinches(path: str) -> list[Pinch]:
    entries = read_log(path)
    name = short(path)
    pinches: list[Pinch] = []
    current: dict[str, Pinch | None] = {h: None for h in HANDS}
    active_since: dict[str, float | None] = {h: None for h in HANDS}
    hover: dict[str, tuple[str, float] | None] = {h: None for h in HANDS}
    puzzle: list[int | None] = [None]

    def pinch_at(hand: str, e: Entry) -> Pinch:
        """The pinch of `hand` starting at `e` (within 60 ms of an existing one), else a new one."""
        p = current[hand]
        if p is not None and abs(p.t - e.t) <= 0.06:
            return p
        p = Pinch(name, e.clock, e.t, hand, puzzle[0])
        if active_since[hand] is not None:
            p.visible_s = round(e.t - active_since[hand], 2)
        if hover[hand] is not None:
            p.hover, since = hover[hand]
            p.dwell_ms = round((e.t - since) * 1000)
        pinches.append(p)
        current[hand] = p
        return p

    for e in entries:
        text = e.text
        m = re.search(r'\[Challenge debug\] puzzle (\d+) \(', text)
        if m:
            puzzle[0] = int(m.group(1))
            continue
        # Pointer state.
        m = re.search(r'\] (left|right) pointer on: ', text)
        if m:
            active_since[m.group(1)] = e.t
            continue
        m = re.search(r'\] (left|right) pointer off', text)
        if m:
            active_since[m.group(1)] = None
            hover[m.group(1)] = None
            continue
        m = re.search(r'\] (left|right) pointer on (.+?)(?: at [\d.]+ m)?(?: \(frozen.*\))?$', text)
        if m:
            hand, target = m.group(1), m.group(2)
            if hover[hand] is None or hover[hand][0] != target:
                hover[hand] = (target, e.t)
            continue
        # The platform's pinch start (always logged for a hand).
        m = re.search(r'\[Grab debug\] (left|right) hand pinch start', text)
        if m:
            p = pinch_at(m.group(1), e)
            g = re.search(r'tips ([\d.]+) cm apart', e.full)
            if g:
                p.start_gap = float(g.group(1))
            continue
        m = re.search(r'\] (left|right) pinch motion: tips opened to ([\d.]+) cm', text)
        if m:
            p = pinch_at(m.group(1), e)
            p.widest = float(m.group(2))
            continue
        m = re.search(r'\] (left|right) pinch ignored: (.*)$', text)
        if m:
            p = pinch_at(m.group(1), e)
            why = m.group(2)
            w = re.search(r'widest ([\d.]+) cm', why)
            if w:
                p.widest = float(w.group(1))
            p.outcome = 'ignored: ' + re.sub(r' \(widest.*', '', why)
            continue
        m = re.search(r'\] (left|right) pointer pinch: (.*?)(?:; aim| \(not a button|; ray pitch|$)', text)
        if m:
            p = pinch_at(m.group(1), e)
            p.target = re.sub(r' at [\d.]+ m$', '', m.group(2))
            r = re.search(r'released (never|\d+ ms) before', text)
            if r:
                p.released_before = r.group(1)
            continue
        m = re.search(r'\] (left|right) pointer pinch with the pointer off', text)
        if m:
            pinch_at(m.group(1), e).target = 'pointer off'
            continue
        m = re.search(r'\] (left|right) pinch aim: (.*)$', text)
        if m:
            pinch_at(m.group(1), e).aim = m.group(2)
            continue
        m = re.search(r'\] (left|right) pinch confirmed after (\d+) ms \(closed to ([\d.]+) cm\): pressing (.*?)(?:; the press ray.*)?$', text)
        if m and current[m.group(1)] is not None:
            p = current[m.group(1)]
            p.outcome = 'pressed'
            p.pressed = m.group(4)
            p.confirm_ms = int(m.group(2))
            continue
        m = re.search(r'\] (left|right) pinch dropped: (.*)$', text)
        if m and current[m.group(1)] is not None:
            current[m.group(1)].outcome = 'dropped: ' + re.sub(r' \(narrowest.*', '', m.group(2))
            continue
        m = re.search(r'\] (left|right) pinch ended after (\d+) ms: narrowest ([\d.]+ cm|untracked), closed \(<= [\d.]+ cm\) (\d+) ms', text)
        if m and current[m.group(1)] is not None:
            p = current[m.group(1)]
            p.dur_ms = int(m.group(2))
            p.narrowest = num(m.group(3).replace(' cm', '')) if m.group(3) != 'untracked' else None
            p.closed_ms = int(m.group(4))
            continue
        # Older logs (press at the pinch start): attach a ray press within 0.6 s.
        m = re.search(r'\[Touch debug\] pressed (.+?) via (ray|pinch)', text)
        if m:
            for hand in HANDS:
                p = current[hand]
                if p is not None and p.pressed is None and 0 <= e.t - p.t <= 0.6 and (p.outcome is None or p.outcome == 'pressed'):
                    p.pressed = m.group(1)
                    p.outcome = p.outcome or 'pressed'
                    break
    for p in pinches:
        if p.outcome is None:
            if p.target and (p.target.startswith('hit nothing') or 'slab' in p.target or p.target == 'pointer off'):
                p.outcome = 'no target'
            elif p.target is None and p.visible_s is None:
                p.outcome = 'pointer off'
            else:
                p.outcome = 'no press'
    return pinches


# --- Presses ---------------------------------------------------------------------------


@dataclass
class Press:
    file: str
    clock: str
    target: str
    path: str
    note: str = ''


def parse_presses(path: str) -> list[Press]:
    out: list[Press] = []
    name = short(path)
    for e in read_log(path):
        m = re.search(r'\[Touch debug\] (?:(left|right) .*?-> )?pressed (.+?) via (\w+)', e.text)
        if m:
            out.append(Press(name, e.clock, m.group(2), m.group(3), m.group(1) or ''))
            continue
        m = re.search(r'\] (\w+) held ([\d.]+) s \((.*?)\)', e.text)
        if m:
            out.append(Press(name, e.clock, m.group(1), 'hold', m.group(3)))
            continue
        m = re.search(r'NULL cell poked: (.*)$', e.text)
        if m:
            out.append(Press(name, e.clock, 'NULL ' + m.group(1), 'filter'))
    return out


# --- Layout ----------------------------------------------------------------------------


def parse_layout(path: str) -> list[dict]:
    out: list[dict] = []
    for e in read_log(path):
        m = re.search(r'layout \((joined|before the join)\): .*?extents \(yaw, pitch from the gaze, distance\): (.*?); group (-?[\d.]+)° \((.*?)\) to (-?[\d.]+)°', e.text)
        if not m:
            continue
        parts = {}
        for part in m.group(2).split('; '):
            pm = re.match(r'(.+?) (-?[\d.]+)° to (-?[\d.]+)°, (-?[\d.]+)° to (-?[\d.]+)°, ([\d.]+) m', part)
            if pm:
                parts[pm.group(1)] = dict(
                    yaw=(float(pm.group(2)), float(pm.group(3))),
                    pitch=(float(pm.group(4)), float(pm.group(5))),
                    dist=float(pm.group(6)),
                )
        out.append(dict(file=short(path), clock=e.clock, state=m.group(1), parts=parts, group=(float(m.group(3)), float(m.group(5)))))
    return out


# --- Output ----------------------------------------------------------------------------


def fmt(v, width: int = 0) -> str:
    s = '-' if v is None else (f'{v:g}' if isinstance(v, float) else str(v))
    return s.ljust(width) if width else s


def print_pinches(rows: list[Pinch]) -> None:
    head = f"{'file':15} {'time':12} {'pz':>2} {'h':1} {'gap':>4} {'wide':>4} {'narr':>4} {'clos':>5} {'dur':>5} {'vis':>6} {'dwell':>6}  target / outcome"
    print(head)
    for p in rows:
        target = p.target or p.hover or '-'
        print(
            f'{p.file:15} {p.clock:12} {fmt(p.puzzle):>2} {p.hand[0]} {fmt(p.start_gap):>4} {fmt(p.widest):>4} {fmt(p.narrowest):>4} '
            f'{fmt(p.closed_ms):>5} {fmt(p.dur_ms):>5} {fmt(p.visible_s):>6} {fmt(p.dwell_ms):>6}  '
            f'{target[:40]} | {p.outcome}{" -> " + p.pressed if p.pressed and p.outcome == "pressed" else ""}'
            + (f'  [{p.aim}]' if p.aim else '')
        )


def dist(values: Iterable[float | None]) -> str:
    v = sorted(x for x in values if x is not None)
    if not v:
        return 'n=0'
    q = lambda f: v[min(len(v) - 1, int(f * len(v)))]  # noqa: E731
    return f'n={len(v)} min {v[0]:g} p25 {q(0.25):g} median {statistics.median(v):g} p75 {q(0.75):g} max {v[-1]:g}'


def rule(outcome: str | None) -> str:
    """An outcome grouped by the rule behind it (numbers dropped), for the summary."""
    o = outcome or ''
    o = re.sub(r'tips [\d.]+ cm apart at its start.*', 'start gap over the limit', o)
    o = re.sub(r'pointer shown only \d+ ms.*', 'pointer shown under 0.2 s', o)
    o = re.sub(r'pointer not shown \((\w+)\)', r'pointer not shown (\1)', o)
    o = re.sub(r'never closed to .*', 'never closed in the window', o)
    return o


def kind(p: Pinch) -> str:
    o = p.outcome or ''
    return o.split(':')[0] if ':' in o else o


def print_summary(rows: list[Pinch]) -> None:
    print(f'{len(rows)} pinch starts')
    by: dict[str, list[Pinch]] = {}
    for p in rows:
        by.setdefault(kind(p), []).append(p)
    for k, ps in sorted(by.items(), key=lambda kv: -len(kv[1])):
        print(f'\n== {k}: {len(ps)}')
        reasons: dict[str, int] = {}
        for p in ps:
            reasons[rule(p.outcome)] = reasons.get(rule(p.outcome), 0) + 1
        if len(reasons) > 1 or k in ('ignored', 'dropped'):
            for r, n in sorted(reasons.items(), key=lambda kv: -kv[1]):
                print(f'   {n:3d}  {r}')
        print(f'   start gap  {dist(p.start_gap for p in ps)}')
        print(f'   widest     {dist(p.widest for p in ps)}')
        print(f'   narrowest  {dist(p.narrowest for p in ps)}')
        print(f'   closed ms  {dist(p.closed_ms for p in ps)}')
        print(f'   dur ms     {dist(p.dur_ms for p in ps)}')
    pressed = [p for p in rows if p.outcome == 'pressed']
    targets: dict[str, int] = {}
    for p in pressed:
        key = re.sub(r' at row .*| \(.*', '', p.pressed or '?')
        targets[key] = targets.get(key, 0) + 1
    print('\npinch presses by target:', ', '.join(f'{k} {n}' for k, n in sorted(targets.items(), key=lambda kv: -kv[1])) or 'none')


def cmd_context(path: str, at: str, before: float, after: float, grep: str | None) -> None:
    t0 = seconds(at if at.count(':') == 2 else at + ':00')
    rx = re.compile(grep) if grep else None
    for e in read_log(path):
        if t0 - before <= e.t <= t0 + after and (rx is None or rx.search(e.full)):
            print(f'{e.clock} {e.level:5} {e.full}')


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('command', choices=['pinches', 'presses', 'summary', 'layout', 'recenter', 'context'])
    ap.add_argument('files', nargs='*')
    ap.add_argument('--latest', type=int, help='the newest N headset logs (default 1 when no files are given)')
    ap.add_argument('--hand', choices=HANDS)
    ap.add_argument('--puzzle', help='only these puzzles, e.g. 10 or 7-11')
    ap.add_argument('--target', help='regex on the pinch target / hover / press (e.g. NULL, recenter)')
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--at', help='context: HH:MM:SS[.mmm]')
    ap.add_argument('--before', type=float, default=2.0)
    ap.add_argument('--after', type=float, default=1.0)
    ap.add_argument('--grep', help='context: only entries matching this regex')
    args = ap.parse_args(argv)

    files = resolve_files(args.files, args.latest)
    if not files:
        print('no log files found', file=sys.stderr)
        return 1
    if not args.json:
        print('# ' + ', '.join(os.path.relpath(f) for f in files), file=sys.stderr)

    if args.command == 'context':
        if not args.at:
            ap.error('context needs --at HH:MM:SS')
        for path in files:
            if len(files) > 1:
                print(f'== {short(path)}')
            cmd_context(path, args.at, args.before, args.after, args.grep)
        return 0

    if args.command in ('pinches', 'summary'):
        rows = [p for path in files for p in parse_pinches(path)]
        if args.hand:
            rows = [p for p in rows if p.hand == args.hand]
        if args.puzzle:
            lo, _, hi = args.puzzle.partition('-')
            lo_n, hi_n = int(lo), int(hi or lo)
            rows = [p for p in rows if p.puzzle is not None and min(lo_n, hi_n) <= p.puzzle <= max(lo_n, hi_n)]
        if args.target:
            rx = re.compile(args.target, re.I)
            rows = [p for p in rows if rx.search(' '.join(filter(None, [p.target, p.hover, p.pressed])))]
        if args.json:
            print(json.dumps([asdict(p) for p in rows], indent=1))
        elif args.command == 'pinches':
            print_pinches(rows)
        else:
            print_summary(rows)
        return 0

    if args.command == 'presses':
        rows = [r for path in files for r in parse_presses(path)]
        if args.json:
            print(json.dumps([asdict(r) for r in rows], indent=1))
        else:
            for r in rows:
                print(f'{r.file:15} {r.clock} {r.path:9} {r.target}{"  (" + r.note + ")" if r.note else ""}')
        return 0

    if args.command == 'layout':
        rows = [r for path in files for r in parse_layout(path)]
        if args.json:
            print(json.dumps(rows, indent=1))
        else:
            for r in rows:
                parts = '; '.join(
                    f"{k} {v['yaw'][0]:g}..{v['yaw'][1]:g}° / {v['pitch'][0]:g}..{v['pitch'][1]:g}° @{v['dist']:g} m" for k, v in r['parts'].items()
                )
                print(f"{r['file']} {r['clock']} {r['state']:15} group {r['group'][0]:g}..{r['group'][1]:g}°  {parts}")
        return 0

    if args.command == 'recenter':
        for path in files:
            for e in read_log(path):
                if re.search(r'recenter (requested|countdown|\()|Recenter \(|recenter hold|recenter held', e.text):
                    print(f'{short(path)} {e.clock} {e.text[:220]}')
        return 0
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
