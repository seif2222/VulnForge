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
  `(state, width, height, capabilities, t) -> string[]` (see Revision 1 below:
  this section's original lens+ring renderer was replaced):
  - `forgeFrame` — the Forge robot (SDF raymarched: rounded-box head and body,
    dark visor with striped cyan eyes, antenna, blue ears, chest screen),
    two-tone toon shading, half-block raster in truecolor, ASCII luminance
    ramp fallback for mono/no-unicode terminals.
  - `scanConstellationFrame` — Live Monitor visual: package nodes light as OSV queries
    complete (cell-grid raster so styled glyphs never corrupt labels).
  - 6 states: IDLE, SCANNING, ANALYZING, DETECTED, COMPLETED, ERROR.
- `packages/cli/src/tui/render3d.test.ts` — 5 tests: determinism at fixed t (inline
  snapshot), mono ASCII fallback content, truecolor ANSI output, all six states render,
  constellation lit/unlit nodes.
- Bugs found and fixed while testing: inverted z-buffer initial value (model body
  never wrote), key light on the wrong hemisphere (visible face fully dark), constellation
  string-splice corrupting ANSI sequences, label clipping at the right edge,
  upside-down projection (world +y mapped to terminal +row), parametric
  superellipsoid sampling gaps (solved by moving to SDF raymarching).

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

## Revision 1 (2026-11-22, same gate)

Owner feedback on the first G3 package: the lens-and-ring Forge concept was
rejected; he supplied his own reference image (a rounded white glossy robot
with blue glow, dark visor with cyan striped eyes, antenna with a blue ball,
blue side ears, small body) and required Forge to (a) move around the
dashboard as a live animated presence, (b) appear in the terminal, and
(c) have a dedicated scanning animation.

Changes made in response:

- `packages/cli/src/tui/render3d.ts` rewritten: the parametric-sampling
  sphere renderer became an SDF raymarcher (rounded-box head/body, ellipsoid
  ears/arms, cylinder antenna; exact pixel coverage, no sampling gaps, still
  pure frame functions). Two-tone toon shading replaces smooth Lambert (flat
  regions survive low terminal resolutions). States keep their motion
  vocabulary: IDLE bob+sway, SCANNING rotation with scrolling eye stripes and
  antenna wiggle, ANALYZING counter-sway with head tilt, DETECTED micro-shake
  with severity-colored eyes, COMPLETED bounce, ERROR shiver.
- Dashboard prototypes: the CSS lens became an animated CSS robot (same
  identity); the Overview copy shows the 12 s wander loop and the Live
  Monitor shows the scanning loop (stripes scroll, head pulse), both disabled
  under prefers-reduced-motion.
- `docs/proposal/design-brief.md` section 1 (identity), the state sheet, the
  terminal renderer paragraph and a revision log updated. Palette, tokens,
  screens, contrast, glyphs unchanged.
- Prototype frames re-rendered from the new renderer; screenshots retaken.

Everything else in this report (tokens, hex-audit, screens, limits) stands.

## Revision 2 (2026-11-22, same gate)

Owner direction: significantly more visual wow in the dashboard, with data
accuracy and clarity non-negotiable. The two dashboard prototypes were
rebuilt richer (hero + floating robot + blueprint grid, labelled animated
distribution bars, severity pills, glowing toplines/glyphs, severity-colored
dependency tree, hover lift, radar sweep in Live Monitor). All values remain
tokens; all numbers remain fixture data; the spec's binding display rules are
unchanged. TUI renderer and frames unchanged in this revision.

## Revision 3 (2026-11-22, same gate)

Owner direction: add an intro screen that opens before the dashboard. New
prototype docs/proposal/prototypes/dashboard-intro.html: pure black sky with
subtle token-colored shooting-star streaks (canvas), Forge floating large in
the center, entrance animation (Forge descends in, greeting types in:
"Hello, I'm Forge. Let's start."), click-to-enter hint. Reduced-motion
fallbacks throughout. Screenshot evidence rendered from the real file.

## Gate

Owner approval needed on: the Forge robot identity (his own reference, as rendered by the new
renderer), palette, glyphs, typography, and the two screen directions shown in the prototypes. On approval, G4
(dashboard) and G5 (TUI wiring) proceed per the spec.
