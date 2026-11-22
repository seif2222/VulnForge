# G4 report - shared logic + dashboard server

Phase: G4 (scan events, state machine, scene model, adapters, hardened dashboard
server). Builds on P01 (core), P02 (CLI), P03 (Forge), G3 (approved design).
Gate G3 passed: owner approved the design (intro screen, overview, live monitor,
robot Forge) on 2026-11-22 before this phase started.

## Raw verify evidence

`pnpm verify` run immediately before the commit, green end to end:
check-encoding (UTF-8, no BOM, LF) -> format:check (prettier) -> build (tsc -b,
all 3 packages) -> lint (eslint, 0 errors) -> hex-audit (0 violations) -> test.

- core: 24 test files, 439 tests passed
- forge: 1 test file, 18 tests passed
- cli: 6 test files, 71 tests passed (dashboard-server.test.ts: 23 tests, all green)
- total: 528 tests

Note: 3 of the 439 core tests are the osv-http signal regressions added with the
live-OSV hotfix (b3475f0), which landed ahead of this phase commit because the
owner was blocked on it.

## What was built

### packages/core (shared by dashboard + TUI)

- `scene-graph.ts` - `buildDependencyGraph(report) -> {nodes, edges, maxDepth}`.
  Node = package with per-severity finding tally, worst severity, worst subtree
  severity, direct flag, depth, dependent count, deterministic 3D position
  (one ring per depth, golden-angle spread, FNV-1a hash jitter; same report in,
  same coordinates out). Edge = parent->child with the child's subtree worst
  severity for coloring. Cycles resolve safely.
- `ui-state-machine.ts` - the single scan state machine for both surfaces:
  idle, scanning, analyzing, detected, completed, error, cancelled. Pure
  transition function with a legality table; invalid events are rejected
  unchanged. `agentStateFor` maps UI states onto the six approved Forge states
  (cancelled maps to idle - a cancelled scan is not an error).
- `view-adapters.ts` - `buildOverviewModel`, `buildFindingsModel`,
  `historyEntryFromReport`: the exact view models the approved screens show
  (four binding stat cards, share-of-total distribution rows, priority-ranked
  rows with real scores, top packages, mean priority score under its real
  name, unresolved requirements with name + reason, CVE alias surfaced under
  its real name, isReachable kept null when undetermined).
- Tests: scene-graph.test.ts (9), ui-state-machine.test.ts (12),
  view-adapters.test.ts (11) = 32 new tests, all against the real fixtures.

### packages/cli (dashboard server + command)

- `dashboard-server.ts` - local-only hardened HTTP server. Rules implemented
  and each one tested (23 tests): binds 127.0.0.1; Host header must be exactly
  `127.0.0.1:<port>` or `localhost:<port>`; foreign Origin -> 403; no CORS
  headers ever; strict CSP (`default-src 'none'; script-src 'self'; ...`; no
  unsafe-inline, no unsafe-eval) plus Referrer-Policy, X-Content-Type-Options
  and Cache-Control: no-store on every response including errors; URL length
  cap (414), backslash/NUL/control rejection (400), decode-twice traversal
  checks, realpath containment under the assets root; POST /api/scan body cap
  64 KiB (413, socket drained before close so the client sees the response);
  GET /api/status (capability booleans only, never keys); GET /report.json
  (validated once at startup; invalid report -> DashboardError -> exit 6);
  GET /api/scan/events is a persistent SSE channel streaming the engine's real
  onProgress events (done/total counters + package identity) and state events;
  single-flight scans (second concurrent -> 409, lease released in a finally);
  client disconnect aborts the engine through the AbortSignal (response 'close'
  event, not the request's); per-request temp dir always removed; header,
  request and idle-socket timeouts with the scan/SSE routes opting out.
- `run.ts`/`args.ts`/`usage.ts` - `vulnforge dashboard [report]` with `--port`
  (0 picks a free port) and `--quiet`; startup failures exit 6, SIGINT exits
  130; status lines on stderr only. `--help` updated.
- `assets/dashboard/index.html` - minimal shell proving asset service under
  the CSP; the real React bundle replaces it in G5.

## Real bugs found and fixed during G4

1. `validateReport` returns `{ok, report}`, not `{ok, value}` - caught by the
   startup-validation test.
2. The request 'close' event fires when the body is merely read; the response
   'close' event is the real disconnect signal for abort-on-disconnect.
3. Destroying the socket on a 413 tore down the client's write side before it
   saw the response; now drained, then closed after finish.
4. SSE designed as persistent (subscribe before launching) after the first
   version ended the stream when idle, which raced the Live Monitor flow.
5. osv.dev live-scan hotfix (b3475f0, landed ahead of this commit): wrong
   querybatch wire shape caused 400 for every query; missing-vulns-key
   misread as malformed. Verified live: 9 real findings on vulnerable-npm.

## File-level change list

- new: packages/core/src/scene-graph.ts, ui-state-machine.ts, view-adapters.ts
  (+ 3 test files), packages/cli/src/dashboard-server.ts (+ test),
  packages/cli/assets/dashboard/index.html, reports/G4-report.md
- changed: packages/core/src/index.ts (exports), packages/cli/src/args.ts
  (dashboard command), packages/cli/src/run.ts (runDashboard), packages/cli/src/usage.ts
  (help), packages/cli/src/args.test.ts, packages/cli/src/run.test.ts
  (planned-command expectations), packages/core/src/osv-http.ts (+ test,
  hotfix b3475f0)

## Not in this phase (by design)

- The React dashboard bundle (G5) and the TUI screens (G6); `ui` still exits 2
  as planned. The dashboard command serves the placeholder shell until G5.
- docs/proposal/ui-backend-contract.md (G0 artifact) will be written at the
  start of G5 with the screen x data-source table as implemented.

## Gate

G4 stops here. G5 (dashboard app) starts next under the owner's approved design.
