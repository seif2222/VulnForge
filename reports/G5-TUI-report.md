# G5-TUI report - interactive terminal UI

Phase: G5 first half (the interactive TUI, to the owner's Claude-Code-style bar:
styled, keyboard-driven, quick scan-by-path). Builds on P01-P03, G3 (approved
design), G4 (shared state machine, view adapters, robot renderer).

Owner steering applied (2026-11-22, via main): the CLI should have real style and
be as easy to use as the Claude Code terminal, with easy shortcuts to scan any
project by its path. It is his graduation project and he will demo it live.

## Raw verify evidence

`pnpm verify` run immediately before the commit, green end to end:
check-encoding -> format:check -> build (tsc -b, 3 packages) -> lint (0 errors)
-> hex-audit (0 violations) -> test.

- core: 439 tests passed
- forge: 18 tests passed
- cli: 107 tests passed (8 files; new: tui/model.test.ts 18, tui/frames.test.ts 18)
- total: 564 tests

## Real-terminal smoke test (pty, not a claim)

Drove the built `node packages/cli/dist/bin.js ui fixtures/reports/with-vulnerabilities.json`
under a real pty at 100x30 (TERM=xterm-256color):

- alternate screen entered and left cleanly, cursor restored
- exit code 0 on `q`
- rendered: VulnForge brand, all 8 tab labels, posture line
  (`vulnerable-example pypi - requirements.txt`), the four stat cards,
  the share-of-total distribution bars
- a 0x0 pty (no winsize) no longer collapses the layout: width/height fall
  back to 80x24 when the terminal reports 0 (fixed during the smoke test)

## What was built

### packages/cli/src/tui/

- `model.ts` - TuiModel + pure reducer `dispatch(model, action) -> {model, effects}`.
  Every key and scan event is a pure transition, tested without a terminal.
  Effects (`probe`, `run-scan`, `cancel-scan`) are the only IO the reducer asks
  for. Keys: 1-8 tabs, s (focus scan path input), enter (probe, then launch when
  the facts pass), esc (blur input / close Live Monitor), l (Live Monitor for the
  current or last run), c (cancel a run), r (re-arm the last target), q / ctrl-c
  (cancel while running, quit when idle). Digits are path characters while the
  input owns keys; they switch tabs again after blur.
- `frames.ts` - pure frame composer `(model, width, height, caps, t) -> string[]`,
  exact width x height on every tab at 80x24, 100x30 and 142x42 (invariant tests).
  Screens: Overview (posture, the four binding stat cards, share-of-total
  distribution, top priority, NOT FULLY SCANNED block when unresolved exists,
  robot at >=100 cols), Start New Scan (input + honest preflight facts:
  target exists / manifest / ecosystem / ignore file, blocked state names the
  failing fact), Findings (severity glyphs, CVSS, priority score, fix version,
  ignored marks), Dependency Tree (indented, worst-severity glyph per package),
  AI Agent (Forge robot + agent state + real suggestions or the honest empty
  state), Scan History (this session's runs), Reports (current report metadata
  - source), Settings (node/platform/cwd/cache dir, Forge configured yes/no,
    color mode; presence only, never secret values). Live Monitor is the in-scan
    view, not a tab: "Querying OSV - N / M queries - package" (never a whole-scan
    percentage), the scan constellation of really-queried packages, the real
    event log, honest `started HH:MM:SS`.
- `app.ts` - the thin IO shell: raw-mode key parsing (UTF-8 aware, CSI sequences
  consumed), alternate screen, 83ms tick (TUI_FRAME_MS) that only repaints while
  something on screen actually moves (running scan or visible robot, animations
  enabled), full-frame repaint this pass. Runs effects: fs preflight probe,
  `analyzeProject` with real onProgress feeding the reducer, AbortController
  cancel. `VULNFORGE_NO_ANIM`, `NO_COLOR` / `VULNFORGE_NO_COLOR`, non-TTY and
  too-small-terminal fallbacks all honored.
- `theme.ts` - capability-aware ANSI helpers (truecolor/256/16/mono), severity
  glyphs, ANSI-aware truncate/pad.

### Wiring

- `vulnforge ui [report]` opens the TUI (optional report validated once at
  startup; bad file exits 2 with the reason).
- Bare `vulnforge` in a terminal opens the TUI; outside a terminal it prints
  the banner as before (plus a one-line note for `ui`).
- usage.ts documents the keys and the fallback env vars.

## Golden frames

9 ANSI-stripped golden snapshots at the binding sizes (overview at
80x24 / 100x30 / 142x42; findings, scan-with-blocked-preflight, live monitor
mid-scan, tree, AI, settings at 100x30), plus exact-cell invariants for every
tab at all three sizes and the too-small fallback. The live-monitor goldens pin
`started 09:30:00` (the reducer stamps the real wall clock; the test overrides
it deterministically).

## Known limitations (honest defer list)

- Full-frame repaint per tick; differential redraw (spec 8.2) not yet done.
- No Playwright/xterm real-terminal pass yet; the pty smoke test above is the
  current terminal evidence.
- No CPU/fps measurement yet (spec G6 exit criterion still open).
- Findings search and tree fold/expand are not in this pass.
- Arrow keys / mouse are ignored (CSI sequences consumed); keyboard flow is
  digit/letter driven per the approved design.
- The dashboard front-end page itself is still the placeholder from G4; the
  remaining G5 work is the real dashboard page on top of the G4 server.
- TUI scans keep the report in memory (Reports tab shows the scanned target as
  the source); no auto-write of scan reports from the TUI yet.
