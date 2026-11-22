# Phase reports

One report per completed phase gate. Each report records what was built, the
raw evidence for the gate (full `pnpm verify` output, verification commands and
their output), and the known limitations at that point.

| Phase                                  | Report                               | Gate                                                     |
| -------------------------------------- | ------------------------------------ | -------------------------------------------------------- |
| P01 — core engine, report schema v6    | [P01-report.md](P01-report.md)       | `pnpm verify` green (381 tests)                          |
| P02 — CLI (`vulnforge analyze`)        | [P02-report.md](P02-report.md)       | `pnpm verify` green (419 tests)                          |
| P03 — Forge LLM layer                  | [P03-report.md](P03-report.md)       | `pnpm verify` green (442 tests)                          |
| G3 — design gate (phase 4 design)      | [G3-report.md](G3-report.md)         | `pnpm verify` green (469 tests) + owner approval pending |
| G4 — shared logic + dashboard server   | [G4-report.md](G4-report.md)         | `pnpm verify` green (528 tests)                          |
| G5 — interactive TUI (phase 4, part 1) | [G5-TUI-report.md](G5-TUI-report.md) | `pnpm verify` green (564 tests) + pty smoke test         |
