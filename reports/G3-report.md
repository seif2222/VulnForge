# G3 report — design gate (phase 4, design half)

Date: 2026-11-22 · commit: see `git log` (this file committed with the G3 work)
Scope: spec section 5.2 design gate + section 6 binding rules. **STOP point: no G4/G5
(dashboard/TUI implementation) work starts until the owner approves this gate.**

## What exists now

### Design tokens (one source, generated artifacts, enforced)

- `packages/core/src/design-tokens.ts` — the only place product colors, fonts, spacing,
  radii and motion values are defined by hand.
- `scripts/emit-design-tokens.mjs` (`pnpm emit-tokens`) generates:
  - `packages/dashboard/src/design-tokens.generated.css` (CSS custom properties)
  - `packages/cli/src/colors.generated.ts` (TUI color table incl. xterm-256/16 mapping)
- Freshness + golden-pin tests: `packages/core/src/design-tokens.test.ts` re-runs the
  emitter and compares bytes; golden pins lock specific token values (accent #5ec8e3,
  bg-base #0b0f14, severity ramp) and measured contrast pairs.
- `scripts/hex-audit.mjs` (`pnpm hex-audit`) runs inside `pnpm verify` between lint and
  test: **0 violations** — no hex/rgba literals anywhere in `packages/` outside the
  token source and the two generated files.
- Contrast: all 17 text/background pairs measure ≥ 4.5:1 except `text-disabled` at
  3.32:1, which is used only for disabled/placeholder content (documented in the brief).

### Software 3D renderer (TUI prototype, real code)

- `packages/cli/src/tui/render3d.ts` — pure frame functions
  `(state, width, height, capabilities, t) -> string[]`:
  - `forgeFrame` — the Forge character: squashed lens sphere + equatorial ring + two
    pupils, Lambert shading, z-buffer, half-block raster in truecolor, ASCII luminance
    ramp fallback for mono/no-unicode terminals.
  - `scanConstellationFrame` — Live Monitor visual: package nodes light as OSV queries
    complete (cell-grid raster so styled glyphs never corrupt labels).
  - 6 states: IDLE, SCANNING, ANALYZING, DETECTED, COMPLETED, ERROR.
- `packages/cli/src/tui/render3d.test.ts` — 5 tests: determinism at fixed t (inline
  snapshot), mono ASCII fallback content, truecolor ANSI output, all six states render,
  constellation lit/unlit nodes.
- Bugs found and fixed while testing: inverted z-buffer initial value (sphere body
  never wrote), key light on the wrong hemisphere (visible face fully dark), constellation
  string-splice corrupting ANSI sequences, label clipping at the right edge.

### Prototypes (generated, not hand-drawn)

- `scripts/render-prototypes.mjs` renders from the real renderer + real fixture data
  (`fixtures/projects/vulnerable-npm`: lodash 4.17.20, minimist 1.2.5, qs 5.2.0):
  - `docs/proposal/prototypes/tui-overview-agent.frame.txt`
  - `docs/proposal/prototypes/tui-live-monitor-scanning.frame.txt`
  - `docs/proposal/prototypes/tui-forge-states.frame.txt`
  - `docs/proposal/prototypes/tui-mono-fallback.frame.txt`
  - `docs/proposal/prototypes/tui-frames.html` (browser preview, ANSI → styled spans)
- `docs/proposal/prototypes/dashboard-overview.html` — 8 numbered tabs per spec section
  6, stat cards (Dependency Inventory / Critical / High / Unresolved Requirements),
  findings table with real CVEs and fix versions from the OSV recordings, severity
  glyphs ●▲■○.
- `docs/proposal/prototypes/dashboard-live-monitor.html` — Live Monitor as the in-scan
  view (not a tab), "Querying OSV — 2 / 3 queries" copy (no whole-scan percentage),
  node-light visual, Forge SCANNING panel. Mock times marked illustrative.
- Screenshots (rendered in headless Chrome, attached to the parent report):
  `vulnforge-g3-dashboard-overview.png`, `vulnforge-g3-dashboard-live-monitor.png`,
  `vulnforge-g3-tui-frames.png`.

### Design brief

- `docs/proposal/design-brief.md` — Forge identity, palette table, measured contrast
  table, glyph set, typography, spacing, grids, motion tokens (120/200/360ms,
  tuiFrameMs 83 ≈ 12fps), 6-state Forge sheet, component list, 3D performance plan.

## Evidence

- `pnpm verify` chain: check-encoding → format:check → build → lint → hex-audit → test.
  Result: **green**. Tests: **469 passed** (core 403, forge 18, cli 48). hex-audit: 0
  violations.
- All numbers in the prototypes come from `fixtures/projects/vulnerable-npm` (10
  findings: 1 critical / 4 high / 5 medium, top score 95) or are labelled mock.

## Known limits (honest list)

- The dashboard prototypes are static HTML+CSS stand-ins; no JS app exists yet (G4).
- The TUI renderer is not yet wired into the CLI screens (G5); frames are rendered by
  the prototype script only.
- Screenshots were taken against data: URLs with inlined CSS (cloud browser cannot
  read the local filesystem); layout is identical to the committed files plus the
  generated stylesheet.
- The dashboard Forge lens is a CSS approximation for preview; the canonical render
  is `render3d.ts`.

## Gate

Owner approval needed on: Forge identity (lens + ring + pupils), palette, glyphs,
typography, and the two screen directions shown in the prototypes. On approval, G4
(dashboard) and G5 (TUI wiring) proceed per the spec.
