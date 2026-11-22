# P03 — Forge: the opt-in AI explanation and suggestion layer

Date: 2026-11-22 (EET). Build environment: workspace sandbox, Node v22.23.5, pnpm.

## Scope of this phase

Forge, the small-LLM layer (owner's phase order: core -> CLI -> LLM). Per the
spec it explains and suggests only; it can never create findings, and the
deterministic engine runs unchanged without it.

## What exists

- `packages/forge` (`@vulnforge/forge`):
  - `config.ts` — env config: `VULNFORGE_AI_BASE_URL`, `VULNFORGE_AI_MODEL`,
    `VULNFORGE_AI_API_KEY`, `VULNFORGE_AI_TIMEOUT_MS`. Unset everything ->
    Forge is unavailable and says so. Key only -> hosted OpenAI-compatible
    default (`gpt-4o-mini`); base URL only -> local Ollama default
    (`qwen2.5:1.5b`). "Small model" defaults per the owner's brief.
    `forgeCapabilities` exposes booleans only, never the key.
  - `client.ts` — minimal OpenAI-compatible chat-completions client. The key
    appears only in the `Authorization: Bearer` header, never in the body.
    Timeout via AbortController; errors -> `ForgeError`
    (forge-unavailable / forge-timeout / forge-bad-response).
  - `prompts.ts` — pure prompt builders carrying only real finding facts;
    system prompt forbids inventing vulnerabilities, versions or fixes;
    strict-JSON replies; tolerant `extractJson` (fences accepted).
  - `explain.ts` — `explainFindings` -> standalone `AiExplanation[]`
    (never part of `Report`); per-finding failures become warnings.
  - `suggest.ts` — `suggestForReport` -> `Suggestion[]` with provider 'llm';
    unknown findingKeys, duplicates and missing rationales dropped with
    warnings; report-order deterministic. `attachSuggestions` returns a NEW
    revalidated report; the engine's report object is never mutated.
- CLI wiring: `--explain` (table format only, usage error with `--format json`)
  prints a Forge explanations section after the table; `--suggest` merges
  validated suggestions into the atomically-written report. Unconfigured Forge
  warns and the scan proceeds; a Forge outage leaves report and exit code
  untouched (all tested).
- core: `writeReportAtomic` exported so the CLI can write the enriched report.

## Test evidence

18 forge tests + 5 CLI Forge tests covering: config defaults and capability
booleans, request shape (model, stream:false, key only in the header), error
mapping, prompt content (only real facts, every findingKey listed), JSON
extraction, explanations standalone with provider marker, per-finding warning
degradation, suggestion sanitization (unknown/duplicate/no-rationale drops),
revalidated immutable merge, clean report needs no model call, CLI: enriched
report written + stdout parity, unconfigured warning, outage resilience,
explain-after-table, --explain+JSON usage error.

## Gate: `pnpm verify` (exit 0)

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

Scope: 3 of 4 workspace projects
packages/core build$ tsc -b tsconfig.build.json
packages/core build: Done
packages/forge build$ tsc -b tsconfig.build.json
packages/forge build: Done
packages/cli build$ tsc -b tsconfig.build.json
packages/cli build: Done

> vulnforge@0.1.0 lint /downloads/vulnforge
> eslint .


> vulnforge@0.1.0 test /downloads/vulnforge
> pnpm -r run test

Scope: 3 of 4 workspace projects
packages/core test$ vitest run
packages/core test:  RUN  v5.1.1 /downloads/vulnforge/packages/core
packages/core test:  ✓ src/fixture-matching.test.ts (33 tests) 76ms
packages/core test:  ✓ src/analyze.test.ts (12 tests) 43ms
packages/core test:  ✓ src/osv-http.test.ts (13 tests) 26ms
packages/core test:  ✓ src/osv-cache.test.ts (18 tests) 27ms
packages/core test:  ✓ src/report-schema.test.ts (51 tests) 22ms
packages/core test:  ✓ src/match.test.ts (29 tests) 20ms
packages/core test:  ✓ src/validate-report.test.ts (22 tests) 17ms
packages/core test:  ✓ src/npm-parse.test.ts (26 tests) 17ms
packages/core test:  ✓ src/python-parse.test.ts (25 tests) 13ms
packages/core test:  ✓ src/fixture-parsing.test.ts (17 tests) 10ms
packages/core test:  ✓ src/fixture-projects.test.ts (33 tests) 9ms
packages/core test:  ✓ src/json-schema.test.ts (25 tests) 7ms
packages/core test:  ✓ src/report-fixtures.test.ts (6 tests) 6ms
packages/core test:  ✓ src/build-tree.test.ts (11 tests) 6ms
packages/core test:  ✓ src/ignore.test.ts (9 tests) 6ms
packages/core test:  ✓ src/severity-map.test.ts (12 tests) 6ms
packages/core test:  ✓ src/stats.test.ts (9 tests) 5ms
packages/core test:  ✓ src/cvss.test.ts (16 tests) 6ms
packages/core test:  ✓ src/rank.test.ts (8 tests) 4ms
packages/core test:  ✓ src/severity.test.ts (6 tests) 4ms
packages/core test:  Test Files  20 passed (20)
packages/core test:       Tests  381 passed (381)
packages/core test:    Start at  02:02:45
packages/core test:    Duration  2.38s (tests 35%, import 35%, transform 23%, worker 6%)
packages/core test:     Isolate  20 workers spawned · ~66ms startup each (spawn + environment, per file)
packages/core test:              at least ~1.25s faster with isolate: false — reuses workers across files instead of one per file
packages/core test: Done
packages/forge test$ vitest run
packages/forge test:  RUN  v5.1.1 /downloads/vulnforge/packages/forge
packages/forge test:  ✓ src/forge.test.ts (18 tests) 29ms
packages/forge test:  Test Files  1 passed (1)
packages/forge test:       Tests  18 passed (18)
packages/forge test:    Start at  02:02:48
packages/forge test:    Duration  272ms (transform 72%, tests 15%, import 12%, worker 1%)
packages/forge test: Done
packages/cli test$ vitest run
packages/cli test:  RUN  v5.1.1 /downloads/vulnforge/packages/cli
packages/cli test:  ✓ src/run.test.ts (19 tests) 85ms
packages/cli test:  ✓ src/forge-cli.test.ts (5 tests) 30ms
packages/cli test:  ✓ src/table.test.ts (8 tests) 5ms
packages/cli test:  ✓ src/args.test.ts (11 tests) 5ms
packages/cli test:  Test Files  4 passed (4)
packages/cli test:       Tests  43 passed (43)
packages/cli test:    Start at  02:02:48
packages/cli test:    Duration  615ms (tests 43%, import 28%, transform 25%, worker 4%)
packages/cli test: Done
```

## Known limitations at this gate

- No real-model smoke in this environment (no local Ollama here; the client
  is tested against stubbed fetch). First real run is the owner's machine.
- Explanations are request-per-finding and not cached yet.
- The dashboard/TUI will surface Forge state; that lands in phase 4.
