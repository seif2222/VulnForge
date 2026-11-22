# UI x backend contract

Status: as implemented at the end of G4. Each row names the screen, the exact
data source, and whether the source exists today. "Adapter" functions live in
`packages/core/src/view-adapters.ts`; the scene model is
`packages/core/src/scene-graph.ts`; the state machine is
`packages/core/src/ui-state-machine.ts`. Everything a screen shows traces to
one of these; anything else is on the hidden list and must not be rendered.

## Screens x data sources

| Screen                                  | Data source                                                                                                        | Status                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 1 Overview - posture header             | `buildOverviewModel(report).posture` (report.meta)                                                                 | exists, tested                                                      |
| 1 Overview - four stat cards            | `OverviewModel.statCards` (report.stats)                                                                           | exists, tested                                                      |
| 1 Overview - severity distribution      | `OverviewModel.distribution` (share-of-total, flagged)                                                             | exists, tested                                                      |
| 1 Overview - priority table             | `OverviewModel.priorityRows` (vulnerabilities x risk)                                                              | exists, tested                                                      |
| 1 Overview - top packages               | `OverviewModel.topPackages`                                                                                        | exists, tested                                                      |
| 1 Overview - mean priority score        | `OverviewModel.meanPriorityScore` (real name)                                                                      | exists, tested                                                      |
| 1 Overview - NOT FULLY SCANNED          | `OverviewModel.unresolved` (meta.unresolved name+reason)                                                           | exists, tested                                                      |
| 1 Overview - Forge agent panel          | `agentStateFor(uiState)` + Forge 3D character                                                                      | state exists, tested; dashboard 3D lands in G5, TUI renderer exists |
| 2 Start New Scan - pre-flight           | fs probes (target exists, manifest, ecosystem detect, ignore file)                                                 | engine detection exists; screen lands in G5/G6                      |
| 2 Start New Scan - launch               | `POST /api/scan {projectPath, aiExplanations?}`                                                                    | exists, tested                                                      |
| Live Monitor - identity                 | state machine `target`, `startedAt` (HH:MM:SS, real)                                                               | exists, tested                                                      |
| Live Monitor - progress                 | SSE `progress` events (done/total + package identity)                                                              | exists, tested                                                      |
| Live Monitor - cancel                   | client disconnect aborts the engine scan                                                                           | exists, tested; explicit cancel button calls the same path in G5    |
| Live Monitor - scan visual              | scene model nodes lit by real progress package identity                                                            | model exists, tested; visual lands in G5/G6                         |
| 3 Findings Explorer                     | `buildFindingsModel(report)` (rows, counts, ignored)                                                               | exists, tested                                                      |
| 3 Finding Details                       | report.vulnerabilities fields (advisory, range, CVSS, reachability flags) + suggestions/explanations kept separate | data exists; screen lands in G5/G6                                  |
| 4 Dependency Tree                       | `buildDependencyGraph(report)` + `buildTree` (P01)                                                                 | exists, tested                                                      |
| 5 AI Agent                              | `agentStateFor(uiState)`, Forge explanations only when an AI step ran                                              | state exists; screen lands in G5/G6                                 |
| 6 Scan History                          | session runs (this process) + workspace report files via `historyEntryFromReport`                                  | adapter exists, tested; discovery lands in G5/G6                    |
| 7 Reports                               | loaded report metadata + JSON download + snapshot export                                                           | data exists; screen lands in G5/G6                                  |
| 8 Settings & Environment                | `GET /api/status` (booleans only) + real probes (node version, platform, cache dir, key presence)                  | status route exists, tested; screen lands in G5/G6                  |
| Intro screen (owner direction, G3 rev3) | static shell + Forge + greeting; no scan data                                                                      | design approved; lands in G5                                        |

## Backend endpoints (dashboard server, packages/cli/src/dashboard-server.ts)

| Endpoint             | Behavior                                                            | Status         |
| -------------------- | ------------------------------------------------------------------- | -------------- |
| GET /api/status      | capability booleans only, never keys                                | exists, tested |
| GET /report.json     | startup report, validated once at boot                              | exists, tested |
| POST /api/scan       | single-flight, 64 KiB cap, abort on disconnect, temp dir removed    | exists, tested |
| GET /api/scan/events | persistent SSE: state + real progress (counters + package identity) | exists, tested |
| GET /, static assets | realpath containment under assets root, strict CSP                  | exists, tested |

## State machine spec

States: idle, scanning, analyzing, detected, completed, error, cancelled.
Legal transitions and the agent-state mapping are implemented and pinned by
`packages/core/src/ui-state-machine.test.ts` (12 tests). Progress carries
`done`/`total` counters and the package identity - never a whole-scan
percentage. Identifiers are honest: `started HH:MM:SS` from the real clock,
`pidN-runM` from the server.

## Hidden list enforcement

Nothing on the spec's hidden list is produced by any adapter, the scene model
or the server: no drift timelines, health grades, SLA timers, confidence
percentages, session IDs, fake KPIs or invented identifiers. Adding any datum
to a screen requires a new adapter field with a test that traces it to real
engine output.

## Backend changes made for the UI (G4)

- `AbortSignal.any/timeout` removed from the OSV request path (Node <20.3
  compat; part of the live-scan hotfix b3475f0).
- OSV querybatch wire format fixed (b3475f0): `{package:{name,ecosystem},version}`;
  a result without a `vulns` key means clean.
