# G5-dashboard report - the WebGL dashboard front-end

Phase: G5 second half (the real dashboard front-end on the G4 server, to the
approved G3 design). Builds on P01-P03, G3 (design), G4 (dashboard server,
state machine, view adapters), G5-TUI (the interactive terminal half).

Owner steering applied (2026-11-22, via main): the owner stepped out of the
test loop; build the whole dashboard front-end per the approved design (intro
screen with shooting stars and "Hello, I'm Forge. Let's start.", 8 tabs, Live
Monitor, WebGL Forge + 3D dependency graph with 2D/reduced-motion fallbacks,
offline bundle, teal/ice-white/peach from design tokens), verify, push, one
closeout.

## Raw verify evidence

`pnpm verify` green end to end immediately before the commit:
check-encoding -> format:check -> build (tsc -b + vite) -> lint (0 errors)
-> hex-audit (0 violations) -> test.

- core: 478 tests passed
- forge: 18 tests passed
- dashboard: 10 tests passed (3 files: format, graph-colors, spiral)
- cli: 123 tests passed (9 files)
- total: 629 tests

## Bundle (offline, `vite build`, all local assets incl. fonts)

- index.html 0.47 kB
- index css 12.6 kB (gzip 2.9)
- index js 39.3 kB (gzip 12.0)
- react chunk 141.6 kB (gzip 45.4)
- three chunk 484.7 kB (gzip 121.6) - lazy: loads only when a WebGL scene
  actually mounts (React.lazy + dynamic import), never on the fallback path
- scene chunks: ForgeScene 3.4 kB, GraphScene 6.9 kB, ScanFieldScene 2.5 kB
- fonts: Inter + JetBrains Mono variable woff2 (latin), bundled with OFL
  notices in public/fonts/FONTS.md - no Google-Fonts network dependency

Initial paint never downloads three.js; the SVG fallbacks render instantly and
the 3D chunk streams in behind them.

## Screenshot evidence (real server, real report, headless Chrome + SwiftShader)

Captured against `vulnforge dashboard /tmp/depscan-workspace.json` serving the
real depscan report (163 packages, 238 edges, 2 real medium CVEs):

- desktop 1440x900: intro (shooting stars, "Hello, I'm Forge. Let's start."),
  overview (posture, stat cards, gold severity bars, 3D Forge), dependency
  tree + 3D graph (instanced nodes, gold vulnerable-path edges), AI Agent,
  live monitor mid-scan, findings
- tablet 834x1112: overview, tree
- mobile 390x844 @2x: overview, findings
- fallback: reduced-motion overview (Forge2D SVG, frozen, success chest) and
  tree (fallback notice); WebGL-disabled overview (Forge2D) and tree
  ("WebGL is not available in this browser - the tree on the left carries the
  same data.")

Live-scan caveat, stated honestly: OSV uses its batch endpoint, so for this
163-package fixture the query phase flushes in well under a second and the
mid-flight screenshot caught the 0/0 pre-query moment (still the real live
view: target, start clock, state pill, cancel, agent sensor in SCANNING). The
progress stream itself is proven separately: curl against /api/scan/events
during a POST /api/scan captured all 163 real progress events
(`{"done":1,"total":163,"pkg":"@cacheable/memory@2.2.0"}` ... ). The 3D scan
field lights from those same events; on larger trees and slower networks it
stays visible proportionally longer.

## What was built

### packages/dashboard (new package: react 18 + vite 6 + three, all bundled)

- `App.tsx` - intro gate, 8 tabs, state pill, Live Monitor takeover during
  scanning/analyzing/detected
- `lib/api.ts` - typed client for the G4 server (status, startup report,
  scan POST with real AbortController cancel, persistent SSE)
- `lib/useScan.ts` - the shared core state machine driven by real SSE events;
  session history; scannedPackages in real arrival order
- `lib/core.ts` - deep imports of the pure core adapters (view-adapters,
  scene-graph, build-tree, ui-state-machine); zero view math duplicated
- screens: Overview, Start New Scan, Findings Explorer (filter/search/sort,
  AI suggestions separated), Dependency Tree (fold/search/vulnerable-paths),
  AI Agent, Scan History, Reports (metadata + JSON download), Settings (real
  probes: server, version, capabilities, SSE, WebGL, reduced-motion)
- `components/Intro.tsx` - SVG starfield, deterministic seeded stars, shooting
  stars, reduced-motion safe
- `components/Forge2D.tsx` - the accessible SVG Forge (6 states)
- `components/ForgeVisual.tsx` - capability switch: WebGL Forge, SVG fallback
  (no WebGL / reduced motion / chunk still loading)

### WebGL scenes (src/three/)

- `useThreeScene.ts` - the spec's non-negotiables in one place: pixelRatio
  capped at 2, render loop pauses on hidden tab and offscreen canvas
  (IntersectionObserver), full disposal on unmount, webglcontextlost ->
  preventDefault -> rebuild on restored, deterministic injectable clock,
  setSize(w,h,false) so no inline styles under CSP
- `ForgeScene.tsx` - Forge from primitives matching the 2D identity (ice-white
  glossy shell, dark visor, four striped eyes, antenna + ball, ear discs,
  chest screen); the 6 agent states drive motion and accent color
- `GraphScene.tsx` - one InstancedMesh for all packages (scales past the
  2000-node bar), LineSegments edges, custom orbit/zoom/pan (CSP-safe, no
  inline styles), hover readout, click -> the node's real findings from the
  report, vulnerable-path dimming, gentle idle rotation on the injected clock
- `ScanFieldScene.tsx` - Live Monitor scan visual: one slot per real announced
  OSV query, lit in arrival order as progress events name each package, accent
  pulse on the newest; counters beside it carry the same numbers as text
- `graph-colors.ts` / `spiral.ts` - pure, node-free, unit-tested mapping and
  layout (no three import)

### Token pipeline

- emit-design-tokens.mjs now also emits `tokens.generated.ts` (hex constants
  for WebGL materials - CSS variables cannot reach a canvas); freshness test
  extended (committed file must equal fresh emitter output, mutation-proof);
  hex-audit allowlist updated; the severity ramp is golden-pinned in both CSS
  and WebGL outputs

## Defects found by the screenshot pass and fixed

- dist bars used `background` on SVG `<rect>` (needs `fill`) - the medium bar
  rendered black; fixed and re-verified visually (now token gold)
- 3D Forge visor sat inside the head sphere's z extent, so the shell bulged
  through the visor center; visor moved forward, eyes with it

## Commits this phase

- 69e8168 scaffold: shell, 8 tabs, real-data screens, Forge 2D, intro, fonts
- d88bb06 3D: WebGL Forge + instanced dependency graph + fallbacks
- 6811e8b live scan field lit by real SSE package events
- (this report + screenshot fixes) see git log

## Spec alignment notes

- CSP: no inline styles or scripts anywhere; scene canvases sized with
  updateStyle=false; tooltip-by-corner-readout instead of positioned overlay
- 8 tabs, Live Monitor is the in-scan view (not a tab), matching the TUI model
- hidden list honored: no invented scan IDs, activity feeds, or findings; the
  Agent screen says plainly when no AI suggestion exists
- zero runtime deps in core/CLI unchanged; React/three exist only in the
  dashboard package, fully bundled offline
