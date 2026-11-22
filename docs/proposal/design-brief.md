# VulnForge design brief (G3)

Owner approval gate. This brief, the token source, the generated outputs, the
measured contrast table below, and the attached prototype frames are the G3
deliverable. Nothing in this document is aspirational: every hex lives in
`packages/core/src/design-tokens.ts`, every pair is measured, every frame
attached is produced by the real renderer code.

## 1. Identity

VulnForge is a calm security operations workspace: precise, quiet, confident,
readable. Dark-first, one theme. The signature element is **Forge**, the 3D
agent character: a small rounded robot, taken from the owner's own reference
image (revision 1 of this gate: he rejected the original lens-and-ring concept
and chose this robot). Glossy white shell, dark visor face with two cyan
striped eye bars, a short antenna with a ball tip, side ears, and a small
body with a chest screen. In the product the eyes, ears, antenna ball and
chest mark render in the accent (Soft Peach), the shell in Ice White against
the deep-teal dark theme, giving Forge a silhouette no other element has. Forge is
present on both surfaces: it wanders the dashboard (a live animated presence,
never a static icon) and renders in the terminal through the software 3D
renderer.

## 2. Palette (all values from the token source)

Owner-chosen base palette: **Deep Teal #0F3D47** (structure/brand), **Ice
White #F4F8F9** (primary text), **Soft Peach #F59E7B** (accent/highlights).
Backgrounds and borders are darkened teal steps of the brand hue.

| Role           | Hex                     | Use                                    |
| -------------- | ----------------------- | -------------------------------------- |
| bg-base        | #07181d                 | app background                         |
| bg-raised      | #0c242c                 | cards, panels                          |
| bg-overlay     | #11313b                 | popovers, hover states                 |
| border-subtle  | #1d4a57                 | card edges, dividers                   |
| border-strong  | #2f6675                 | focus rings, active edges              |
| text-primary   | #f4f8f9                 | everything primary                     |
| text-secondary | #94aeb6                 | metadata, labels                       |
| text-disabled  | #54707a                 | disabled only (WCAG-exempt)            |
| accent         | #f59e7b                 | one accent: links, active, progress    |
| accent-strong  | #fbc3a6                 | accent hover/emphasis                  |
| accent-on      | #0f3d47                 | text on accent fills                   |
| accent-tint    | #38271e                 | accent-tinted fills                    |
| critical       | #ff6b6b on tint #3e1a1e | severity badge                         |
| high           | #e8743b on tint #37251b | severity badge                         |
| medium         | #e8c352 on tint #33301d | severity badge                         |
| low            | #8fa3ad on tint #1e282e | severity badge — slate, never green    |
| success        | #4ec9a6                 | clean scan, gate pass — the ONLY green |

## 3. Measured contrast (WCAG 2.x ratios, computed from the tokens)

| Pair                        | Ratio | Verdict                                |
| --------------------------- | ----- | -------------------------------------- |
| text-primary on bg-base     | 16.27 | AAA                                    |
| text-primary on bg-raised   | 15.37 | AAA                                    |
| text-primary on bg-overlay  | 14.20 | AAA                                    |
| text-secondary on bg-base   | 7.83  | AAA                                    |
| text-secondary on bg-raised | 7.40  | AAA                                    |
| text-disabled on bg-base    | 3.32  | exempt (disabled), measured and pinned |
| accent on bg-base           | 9.93  | AAA                                    |
| accent-on on accent         | 8.52  | AAA                                    |
| critical on critical-tint   | 5.54  | AA                                     |
| high on high-tint           | 6.53  | AA                                     |
| medium on medium-tint       | 7.72  | AAA                                    |
| low on low-tint             | 4.94  | AA                                     |
| critical on bg-base         | 6.93  | AA                                     |
| high on bg-base             | 8.71  | AAA                                    |
| medium on bg-base           | 11.31 | AAA                                    |
| low on bg-base              | 6.55  | AA                                     |
| success on bg-base          | 9.36  | AAA                                    |

Enforcement: `design-tokens.test.ts` recomputes every ratio and asserts >= 4.5
(disabled >= 3, pinned below 4.5 so it stays in its exempt role). A palette
change that breaks AA fails `pnpm verify`.

## 4. Severity is never color alone

Badge = glyph + label on a tinted fill: `[● CRIT]` `[▲ HIGH]` `[■ MED]`
`[○ LOW]`. Glyphs are tokens (`glyph.critical …` in the source). Low is slate;
green is reserved for success so "low severity" never reads as "safe".

## 5. Type, spacing, shape

- Monospace-led. Dashboard bundles JetBrains Mono (woff2, offline, no CDN);
  stack: `'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace`.
  Sans (Inter/system) only for long-form help text.
- Spacing scale: 4 / 8 / 16 / 24 / 32. Radius: 4 / 8 / 12.
- Cards: 1 px border-subtle, no shadows except rgba(0,0,0,x) (the only rgba
  literals the hex-audit allows).

## 6. Layout grids

- Wide (>= 1200 px): 12-col, 24 px gutters. Overview: posture header full row,
  4 stat cards in one row, distribution + agent panel side by side, priority
  table full width.
- Standard (768-1199 px): 8-col. Stat cards 2x2, agent panel below distribution.
- Compact (< 768 px): 4-col stacked. Agent panel collapses to a status line;
  every datum stays reachable (3D is always supplementary).
- TUI: 80x24 minimum for animation; below that (or NO_COLOR, CI, non-TTY,
  --quiet, VULNFORGE_NO_ANIM) the same panels render as static frames/text.

## 7. Motion and 3D language

Timings are tokens: fast 120 ms, base 200 ms, slow 360 ms, easing
cubic-bezier(0.2, 0, 0, 1). CSS keyframes animate transform/opacity only. No
blur, no backdrop-filter. prefers-reduced-motion: static pose, no loops.

What moves and why: only state communication. The Forge robot bobs gently
when idle, wanders the dashboard between scans, sweeps its eye stripes and
wiggles its antenna while scanning, tilts its head while analyzing, shakes on
detection, bounces once on completion, shivers then goes still on error.
The dependency graph never animates except layout settle (360 ms) and hover
focus. The Live Monitor scan visual lights nodes strictly as their real OSV
queries complete — no decorative particles, no fake traffic.

### Forge state sheet (all six states)

| State     | Pose                      | Motion                                             | Color          |
| --------- | ------------------------- | -------------------------------------------------- | -------------- |
| IDLE      | upright, slow sway        | 3.6 s breathing bob; dashboard wander loop (12 s)  | accent         |
| SCANNING  | slight tilt               | slow rotation, eye stripes scroll, antenna wiggles | accent         |
| ANALYZING | head tilted               | slow counter-sway                                  | accent-strong  |
| DETECTED  | eyes flash worst severity | 28 Hz micro-shake, eyes hold severity color        | worst severity |
| COMPLETED | upright                   | single bounce, eyes steady success green           | success        |
| ERROR     | dimmed                    | 18 Hz shiver on entry, then still, eyes danger red | danger         |

DETECTED persists until the next real event (spec). State changes blend over
base timing; animation stops immediately when the state leaves one that
requires it. Every state has a pure static frame `(state, t fixed)` used in
tests, snapshots, reduced-motion and fallback rendering.

## 8. Component list

Posture header, stat card, severity badge (glyph+text), distribution bars
(labelled share-of-total), priority table, findings table, finding details
panel (evidence vs AI text separated), dependency tree, scan event log, tab
bar (8 numbered tabs), Live Monitor overlay, progress line ("Querying OSV —
N / M queries", never a percentage), empty state, error state, focus ring
(border-strong, always visible).

## 9. 3D performance plan and fallbacks

Dashboard: bundled tree-shaken three.js, no CDN, no remote textures,
CSP-clean (no eval). Instanced meshes for graph nodes; smooth interaction
target at 2,000+ nodes, clustering beyond. Pixel ratio capped at 2. Render
loop paused when tab hidden or canvas off-screen. Full geometry/material
disposal on unmount. Context-loss recovery re-creates from the scene model.
Fallback: 2D SVG/CSS rendering of the same scene-model data when WebGL is
missing or reduced-motion is set. Bundle-size delta reported in the G4/G5
phase report.

Terminal: pure-TypeScript software renderer (no native deps): SDF model of
the robot (rounded-box head/body, ellipsoid ears and arms, cylinder antenna)
-> raymarched per pixel -> two-tone toon shading -> character grid.
Half-block cells by default (2 vertical pixels per cell), ASCII luminance
ramp without Unicode, 16-color and NO_COLOR monochrome fallbacks. The robot
is built from the same six states on both surfaces. Frame budget 12 fps (token `tuiFrameMs = 83`), pure
frame functions `(state, width, height, capabilities, t) -> string[]`,
differential redraw, runs only while visible and the state requires it.
Every 3D visual has a static frame.

## 10. Prototypes attached to this gate

- `prototypes/tui-overview-agent.frame.txt` — real renderer output: the Forge
  robot in IDLE at fixed t (half-block, truecolor stripped for review).
- `prototypes/tui-live-monitor-scanning.frame.txt` — Live Monitor scan visual
  mid-scan (2 of 3 package nodes lit, fixed t) with Forge SCANNING.
- `prototypes/tui-frames.html` — the same frames with real colors for review
  in a browser.
- Dashboard static prototypes: `prototypes/dashboard-overview.html` and
  `prototypes/dashboard-live-monitor.html` built from the generated CSS
  variables; screenshots attached to the G3 report message.

STOP: owner approval before any G4 (shared logic + server) or G5 (screens)
work begins.

## 11. Revision log

- **Revision 1 (2026-11-22):** the owner rejected the original lens-and-ring
  Forge concept and supplied his own reference: a rounded white glossy robot
  with blue glow, dark visor face, cyan striped eyes, antenna with a blue
  ball, blue side ears, small body. He also required Forge to move around the
  dashboard (animated presence), appear in the terminal, and have a dedicated
  scanning animation. Identity, state sheet, TUI renderer (now an SDF
  raymarcher), dashboard prototypes (animated CSS robot with wander and
  scanning loops), and prototype frames were reworked to match. Palette,
  tokens, screens, and all other rules are unchanged.

- **Revision 2 (2026-11-22):** owner direction: more visual impact in the
  dashboard ("defense-demo grade") while data stays accurate and clearly
  readable. The dashboard prototypes were rebuilt richer: hero card with the
  floating Forge robot and a blueprint grid, labelled severity distribution
  bars (animated draw-on), severity pills and glowing glyphs in the findings
  table, glowing stat-card toplines, a severity-colored dependency tree
  visual, hover lift on cards, and radar-sweep rings around Forge in the Live
  Monitor. All colors remain design tokens; motion stays transform/opacity
  only with prefers-reduced-motion fallbacks; every number still comes from
  the vulnerable-npm fixture. The binding display rules (8 tabs, honest
  identifiers, "Querying OSV - N / M queries", no whole-scan percentage) are
  untouched.

- **Revision 3 (2026-11-22):** owner direction: an intro (landing) screen
  that opens first, before the dashboard tabs. Forge floats large in the
  center of a pure black sky filled with subtle blue shooting-star light
  streaks (canvas-rendered, capped at 5 concurrent, elegant not noisy), with
  an entrance animation - Forge descends and un-blurs into place, then the
  greeting "Hello, I'm Forge. Let's start." types itself in letter by letter
  with a blinking caret. A quiet "click anywhere to enter the dashboard"
  hint fades in last. All colors come from the design tokens at runtime;
  prefers-reduced-motion freezes the sky to a few faint static streaks, shows
  Forge instantly, and prints the greeting without typing. Prototype:
  prototypes/dashboard-intro.html.
