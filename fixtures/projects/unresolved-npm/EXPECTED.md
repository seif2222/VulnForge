# EXPECTED — unresolved-npm

Ground truth for the `unresolved-npm` fixture. The project has **no lockfile**, so only
exactly pinned dependencies can be resolved. Everything else must become an
`UnresolvedRequirement` with the correct reason, and the report must read NOT FULLY
SCANNED. A scan that silently skips the unpinned dependencies is a bug.

## How this was verified

This fixture is deterministic parser ground truth: the expected output follows from the
manifest text alone, with no external data. The one resolvable package, `left-pad@1.3.0`,
was additionally queried against the OSV.dev API (`POST https://api.osv.dev/v1/query`,
`ecosystem: "npm"`) on **2026-10-08** and returned no vulnerabilities, so the fixture
produces zero findings for reasons of evidence, not by assumption.

## Files

- `package.json` — four declared dependencies, exactly one of them pinned. No
  `package-lock.json` exists and none must be added: the fixture guards the
  manifest-only fallback path.

## Manifest and expected parse

| Declaration                                                | Outcome                            |
| ---------------------------------------------------------- | ---------------------------------- |
| `left-pad@1.3.0`                                           | resolves: direct, depth 0          |
| `lodash@^4.17.21`                                          | unresolved, reason `not-pinned`    |
| `chalk@*`                                                  | unresolved, reason `wildcard-pin`  |
| `secret-dep@git+https://github.com/example/secret-dep.git` | unresolved, reason `url-reference` |

The parser also emits the warning `no package-lock.json: only exactly pinned
dependencies could be resolved`.

## Expected report numbers

| Field                        | Expected |
| ---------------------------- | -------- |
| `stats.totalPackages`        | 1        |
| `stats.directPackages`       | 1        |
| `stats.transitivePackages`   | 0        |
| `stats.totalVulnerabilities` | 0        |
| `stats.unresolvedCount`      | 3        |

## Notes for the engine

- `meta.unresolved` carries all three unresolved requirements with their 1-based line
  numbers in `package.json`.
- `validateReport` rejects a report whose `meta.unresolved` is non-empty while
  `vulnerabilities` is empty: a scan that checked nothing vulnerable but skipped three
  requirements must not be written as if it were clean. This fixture therefore expects
  the engine to refuse the write with an `invalid-report` error (CLI: the incomplete
  exit code and a NOT FULLY SCANNED message), not to emit a report file.
