# Phase reports

One report per completed phase gate. Each report records what was built, the
raw evidence for the gate (full `pnpm verify` output, verification commands and
their output), and the known limitations at that point.

| Phase                               | Report                         | Gate                            |
| ----------------------------------- | ------------------------------ | ------------------------------- |
| P01 — core engine, report schema v6 | [P01-report.md](P01-report.md) | `pnpm verify` green (381 tests) |
| P02 — CLI (`vulnforge analyze`)     | [P02-report.md](P02-report.md) | `pnpm verify` green (419 tests) |
