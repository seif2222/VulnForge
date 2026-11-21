# P01 — core engine, report schema v6

Date: 2026-11-22 (EET). Build environment: workspace sandbox, Node v22.23.5, pnpm.

## Scope of this phase

The deterministic scanner core of VulnForge, with no LLM involvement:

- npm and PyPI project parsing (lockfile-first, manifest-only fallback with
  per-requirement `unresolved` reasons)
- OSV.dev querying with cache, offline mode and per-package progress events
  (`{ done, total, package }` counters — never a whole-scan percentage)
- finding assembly with schema **v6** identity: `findingKey` (`ID|package@version`),
  `severityReason`, risk assessment keyed by `findingKey`
- priority ranking (deterministic formula, cap 100)
- `.depscanignore` + `--ignore` handling (`meta.ignored[]`, `stats.ignoredCount`)
- incomplete-advisory reporting (`meta.incomplete[]`) instead of silent gaps
- atomic report writes (`<out>.tmp-<pid>` then rename)
- report validation that forbids impossible states (ignored findings still in
  the report, unresolved inputs with a "clean" result, stats that don't
  recompute)

## What exists

- `packages/core` (`@vulnforge/core`): `analyze.ts` (pipeline),
  `npm-parse.ts`, `python-parse.ts`, `match.ts`, `osv-http.ts`, `osv-cache.ts`,
  `rank.ts`, `ignore.ts`, `stats.ts`, `cvss.ts`, `severity.ts`,
  `severity-map.ts`, `report-schema.ts`, `validate-report.ts`, `types.ts`
- `fixtures/osv/`: 21 recorded osv.dev responses (recordedAt 2026-10-08) —
  all fixture expectations derive from these recordings, never from invented data
- `fixtures/projects/`: `clean-npm`, `vulnerable-npm` (10 findings),
  `transitive-npm` (1 transitive finding), `unresolved-npm` (engine must
  refuse a clean report), `python-basic` (19 findings), each with EXPECTED.md
- `fixtures/reports/`: `clean.json`, `with-vulnerabilities.json` (v6, 4 findings)
- root tooling: pnpm workspace, TypeScript project references, eslint,
  prettier, `scripts/check-encoding.mjs` (UTF-8 / no BOM / LF gate)

## Gate: `pnpm verify` (exit 0)

Chain: check-encoding → prettier --check → tsc build → eslint → vitest.

Raw output:

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


> @vulnforge/core@0.1.0 build /downloads/vulnforge/packages/core
> tsc -b tsconfig.build.json


> vulnforge@0.1.0 lint /downloads/vulnforge
> eslint .


> vulnforge@0.1.0 test /downloads/vulnforge
> pnpm -r run test


> @vulnforge/core@0.1.0 test /downloads/vulnforge/packages/core
> vitest run


 RUN  v5.1.1 /downloads/vulnforge/packages/core

 ✓ src/fixture-matching.test.ts (33 tests) 76ms
 ✓ src/analyze.test.ts (12 tests) 43ms
 ✓ src/osv-cache.test.ts (18 tests) 27ms
 ✓ src/osv-http.test.ts (13 tests) 26ms
 ✓ src/report-schema.test.ts (51 tests) 26ms
 ✓ src/match.test.ts (29 tests) 20ms
 ✓ src/npm-parse.test.ts (26 tests) 16ms
 ✓ src/validate-report.test.ts (22 tests) 16ms
 ✓ src/python-parse.test.ts (25 tests) 13ms
 ✓ src/fixture-parsing.test.ts (17 tests) 9ms
 ✓ src/fixture-projects.test.ts (33 tests) 9ms
 ✓ src/json-schema.test.ts (25 tests) 8ms
 ✓ src/report-fixtures.test.ts (6 tests) 6ms
 ✓ src/ignore.test.ts (9 tests) 6ms
 ✓ src/build-tree.test.ts (11 tests) 6ms
 ✓ src/severity-map.test.ts (12 tests) 5ms
 ✓ src/stats.test.ts (9 tests) 5ms
 ✓ src/cvss.test.ts (16 tests) 5ms
 ✓ src/rank.test.ts (8 tests) 4ms
 ✓ src/severity.test.ts (6 tests) 4ms

 Test Files  20 passed (20)
      Tests  381 passed (381)
   Start at  01:51:17
   Duration  2.19s (tests 44%, import 43%, worker 7%, transform 5%)

    Isolate  20 workers spawned · ~66ms startup each (spawn + environment, per file)
             at least ~1.26s faster with isolate: false — reuses workers across files instead of one per file
```

## CVSS cross-check

The 4 fixture scores in `fixtures/reports/with-vulnerabilities.json` recomputed
with the built `dist/cvss.js` (`cvssBaseScore`), all MATCH:

```text
CVE-2020-14343 CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H -> recomputed 9.8, fixture 9.8 MATCH
CVE-2018-18074 CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N -> recomputed 7.5, fixture 7.5 MATCH
CVE-2023-32681 CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:C/C:H/I:N/A:N -> recomputed 6.1, fixture 6.1 MATCH
CVE-2024-22195 CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:N -> recomputed 5.4, fixture 5.4 MATCH
risk CVE-2020-14343|PyYAML@5.3.1: 95
risk CVE-2018-18074|requests@2.19.1: 80
risk CVE-2023-32681|requests@2.19.1: 60
risk CVE-2024-22195|Jinja2@3.1.2: 60
```

(Jinja2 CVE-2024-22195 vector verified live against api.osv.dev during fixture
authoring; the other three come from the recorded osv.dev responses.)

## Known limitations at this gate

- `isReachable` is always `null` (reachability analysis is not built yet);
  rank formula awards the "unknown" 5 points, never the "reachable" 10
- no CLI yet (next phase); the pipeline is only reachable through the library
- no LLM/Forge integration; suggestions in fixtures are hand-labelled
  `provider: 'llm'` placeholders only
- CVSS v4 vectors are parsed but not scored (fall back to the
  `severity_unknown` path); v3.0/v3.1 are exact
- progress counters are per-package over the direct parse order; concurrent
  querying interleaves cache writes safely but progress stays monotonic

## Baseline reference

The DepScan repository this build was derived from fails its own `pnpm verify`
at HEAD (113 of 327 tests failing, all ENOENT for 5 fixture files missing from
the repo). VulnForge starts from those sources but repairs the fixture set and
passes clean.
