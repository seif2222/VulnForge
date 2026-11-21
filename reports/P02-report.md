# P02 — CLI (`vulnforge analyze`)

Date: 2026-11-22 (EET). Build environment: workspace sandbox, Node v22.23.5, pnpm.

## Scope of this phase

The `vulnforge` command line over the phase-1 core (spec G2: commands, flags,
exit codes, table/JSON output, progress rendering, error mapping, `--help`,
table/JSON parity). The dashboard server and TUI are later phases; the
`dashboard` and `ui` commands exist only as recognized "planned" stubs that
exit 2 with a clear message.

## What exists

- `packages/cli` (`@vulnforge/cli`, bin `vulnforge`):
  - `args.ts` — parser: `analyze`/`scan`, `--out`, `--format table|json`,
    `--offline`, `--cache-dir`, `--ignore` (repeatable), `--ignore-file`,
    `--ecosystem`, `--fail-on`, `--fail-on-unresolved`, `--allow-incomplete`,
    `--quiet`, `--no-color`; both `--flag value` and `--flag=value`
  - `exit-codes.ts` — the one exported exit-code table, shown in `--help`
  - `run.ts` — wiring: engine deps, error mapping, gate decisions
  - `table.ts` — deterministic table renderer (score desc, severity desc,
    findingKey asc), severity colors, narrow-terminal fitting
  - `progress.ts` — TTY/CI/--quiet gating; NO_COLOR / FORCE_COLOR /
    VULNFORGE_COLUMNS / VULNFORGE_DEBUG handling
  - `usage.ts`, `bin.ts` (SIGINT -> abort), `version.ts`
- 38 CLI tests: parser table, exit-code mapping, table rendering, progress
  gating, and full runner tests against the fixture projects over the recorded
  osv.dev responses (never the network)

## Exit-code decisions (the spec table leaves these to the build)

| Situation                                                                             | Exit |
| ------------------------------------------------------------------------------------- | ---- |
| success, no gate                                                                      | 0    |
| `--fail-on` threshold met, or `--fail-on-unresolved` hit                              | 1    |
| unknown command/flag, missing value, bad enum, no/ambiguous ecosystem, parse error    | 2    |
| unexpected exception, renderer crash, report write failed                             | 3    |
| every package's OSV query failed (`osv-error` for all)                                | 4    |
| coverage gaps without `--allow-incomplete`; engine refused an unresolved+clean report | 5    |
| cancelled (SIGINT)                                                                    | 130  |

Precedence: error > gate > incomplete > success. A renderer crash exits 3,
never 1. JSON output is byte-stable across runs (tested) and identical to the
written report file (tested).

## Naming applied under the VulnForge instruction

- cache dir: `~/.vulnforge/cache/osv`, env override `VULNFORGE_CACHE_DIR`
  (spec text said `DEPSCAN_CACHE_DIR` / `~/.depscan`)
- ignore file: `.vulnforgeignore` (spec text said `.depscanignore`)
- env knobs: `VULNFORGE_COLUMNS`, `VULNFORGE_DEBUG`; `NO_COLOR` and
  `FORCE_COLOR` stay generic

## Gate: `pnpm verify` (exit 0)

Chain: check-encoding -> prettier --check -> tsc build -> eslint -> vitest.

```text
> vulnforge@0.1.0 verify /downloads/vulnforge
> pnpm run check-encoding && pnpm run format:check && pnpm run build && pnpm run lint && pnpm run test


> vulnforge@0.1.0 check-encoding /downloads/vulnforge
> node scripts/check-encoding.mjs

encoding gate: all files are UTF-8, no BOM, LF

> vulnforge@0.1.0 format:check /downloads/vulnforge
> prettier --check .

Checking formatting...
All matched files use Prettier code style!

> vulnforge@0.1.0 build /downloads/vulnforge
> pnpm -r run build

Scope: 2 of 3 workspace projects
packages/core build$ tsc -b tsconfig.build.json
packages/core build: Done
packages/cli build$ tsc -b tsconfig.build.json
packages/cli build: Done

> vulnforge@0.1.0 lint /downloads/vulnforge
> eslint .


> vulnforge@0.1.0 test /downloads/vulnforge
> pnpm -r run test

Scope: 2 of 3 workspace projects
packages/core test$ vitest run
packages/core test:  RUN  v5.1.1 /downloads/vulnforge/packages/core
packages/core test:  ✓ src/fixture-matching.test.ts (33 tests) 78ms
packages/core test:  ✓ src/analyze.test.ts (12 tests) 43ms
packages/core test:  ✓ src/osv-cache.test.ts (18 tests) 28ms
packages/core test:  ✓ src/osv-http.test.ts (13 tests) 27ms
packages/core test:  ✓ src/report-schema.test.ts (51 tests) 25ms
packages/core test:  ✓ src/match.test.ts (29 tests) 21ms
packages/core test:  ✓ src/validate-report.test.ts (22 tests) 16ms
packages/core test:  ✓ src/npm-parse.test.ts (26 tests) 17ms
packages/core test:  ✓ src/python-parse.test.ts (25 tests) 19ms
packages/core test:  ✓ src/fixture-parsing.test.ts (17 tests) 10ms
packages/core test:  ✓ src/fixture-projects.test.ts (33 tests) 9ms
packages/core test:  ✓ src/json-schema.test.ts (25 tests) 7ms
packages/core test:  ✓ src/report-fixtures.test.ts (6 tests) 6ms
packages/core test:  ✓ src/build-tree.test.ts (11 tests) 6ms
packages/core test:  ✓ src/ignore.test.ts (9 tests) 6ms
packages/core test:  ✓ src/severity-map.test.ts (12 tests) 5ms
packages/core test:  ✓ src/stats.test.ts (9 tests) 5ms
packages/core test:  ✓ src/cvss.test.ts (16 tests) 5ms
packages/core test:  ✓ src/rank.test.ts (8 tests) 4ms
packages/core test:  ✓ src/severity.test.ts (6 tests) 4ms
packages/core test:  Test Files  20 passed (20)
packages/core test:       Tests  381 passed (381)
packages/core test:    Start at  01:56:33
packages/core test:    Duration  2.41s (tests 36%, import 34%, transform 24%, worker 6%)
packages/core test:     Isolate  20 workers spawned · ~66ms startup each (spawn + environment, per file)
packages/core test:              at least ~1.26s faster with isolate: false — reuses workers across files instead of one per file
packages/core test: Done
packages/cli test$ vitest run
packages/cli test:  RUN  v5.1.1 /downloads/vulnforge/packages/cli
packages/cli test:  ✓ src/table.test.ts (8 tests) 5ms
packages/cli test:  ✓ src/run.test.ts (19 tests) 77ms
packages/cli test:  ✓ src/args.test.ts (11 tests) 5ms
packages/cli test:  Test Files  3 passed (3)
packages/cli test:       Tests  38 passed (38)
packages/cli test:    Start at  01:56:35
packages/cli test:    Duration  497ms (transform 42%, tests 33%, import 22%, worker 3%)
packages/cli test: Done
```

## End-to-end smoke (built binary, offline over the recorded cache)

A real file cache was seeded from the 21 committed recordings, then
`node packages/cli/dist/bin.js` ran from a scratch directory:

```text
$ vulnforge analyze fixtures/projects/vulnerable-npm --offline --cache-dir /tmp/vf-cache
vulnforge scan report - vulnerable-npm
ecosystem npm · 3 direct · 0 transitive · scanned 2026-11-21T23:56:39.942Z

SEVERITY  PACKAGE   INSTALLED  FIX      ID                SCORE
critical  minimist  1.2.5      1.2.6    CVE-2021-44906    95
high      qs        5.2.0      6.0.4    CVE-2017-1000048  80
high      lodash    4.17.20    4.17.21  CVE-2021-23337    80
high      qs        5.2.0      6.2.4    CVE-2022-24999    80
high      lodash    4.17.20    4.17.21  CVE-2026-4800     80
medium    lodash    4.17.20    4.17.21  CVE-2020-28500    60
medium    lodash    4.17.20    4.17.23  CVE-2025-13465    60
medium    qs        5.2.0      6.14.1   CVE-2025-15284    60
medium    lodash    4.17.20    4.17.23  CVE-2026-2950     60
medium    qs        5.2.0      6.16.0   CVE-2026-82417    60

10 findings (1 critical, 4 high, 5 medium) · top score 95
wrote report: /tmp/smoke/report.json
EXIT=0

$ vulnforge analyze ... --fail-on high --quiet
(table printed) GATE_EXIT=1

$ vulnforge analyze fixtures/projects/clean-npm --offline --format json
{ "schemaVersion": 6, "meta": { "tool": { "name": "vulnforge", "version": "0.1.0" }, ...
JSON_EXIT=0
```

`--help` prints the full exit-code table (verified in the smoke run and in
tests).

## Known limitations at this gate

- `dashboard` and `ui` commands are stubs (exit 2) until their phases
- no Forge/LLM integration; nothing in the CLI talks to a model
- progress is a single redrawing counter line; no animation layer yet
