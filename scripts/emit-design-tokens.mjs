#!/usr/bin/env node
/**
 * Emitter: turns packages/core/src/design-tokens.ts (built to dist) into
 *   - packages/dashboard/src/design-tokens.generated.css
 *   - packages/cli/src/colors.generated.ts
 * Both outputs begin with "GENERATED from <source> — do not edit by hand" and
 * are committed; a freshness test proves they match this emitter's output.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DESIGN_TOKENS } from '../packages/core/dist/design-tokens.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TOKEN_SOURCE = 'packages/core/src/design-tokens.ts';
const HEADER = `GENERATED from ${TOKEN_SOURCE} — do not edit by hand`;

const t = DESIGN_TOKENS;

/** hex #rrggbb -> [r, g, b] 0-255 */
function rgb(hex) {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
}

/** Nearest xterm-256 palette index (6x6x6 cube + grayscale ramp). */
function toXterm256(hex) {
  const [r, g, b] = rgb(hex);
  const grayAvg = (r + g + b) / 3;
  const cube = [
    16 + 36 * Math.round((r / 255) * 5) + 6 * Math.round((g / 255) * 5) + Math.round((b / 255) * 5),
  ];
  const grayIndex = 232 + Math.min(23, Math.max(0, Math.round((grayAvg - 8) / 10)));
  // pick whichever is closer in RGB space
  const cubeRgb = (() => {
    const n = cube[0] - 16;
    const levels = [0, 95, 135, 175, 215, 255];
    return [levels[Math.floor(n / 36)], levels[Math.floor((n % 36) / 6)], levels[n % 6]];
  })();
  const grayLevel = 8 + (grayIndex - 232) * 10;
  const dCube = (cubeRgb[0] - r) ** 2 + (cubeRgb[1] - g) ** 2 + (cubeRgb[2] - b) ** 2;
  const dGray = (grayLevel - r) ** 2 + (grayLevel - g) ** 2 + (grayLevel - b) ** 2;
  return dCube <= dGray ? cube[0] : grayIndex;
}

const ANSI_16 = [
  ['black', [0, 0, 0]],
  ['red', [205, 49, 49]],
  ['green', [13, 188, 121]],
  ['yellow', [229, 229, 16]],
  ['blue', [36, 114, 200]],
  ['magenta', [188, 63, 188]],
  ['cyan', [17, 168, 205]],
  ['white', [229, 229, 229]],
  ['brightBlack', [102, 102, 102]],
  ['brightRed', [241, 76, 76]],
  ['brightGreen', [35, 209, 139]],
  ['brightYellow', [245, 245, 67]],
  ['brightBlue', [59, 142, 234]],
  ['brightMagenta', [214, 112, 214]],
  ['brightCyan', [41, 184, 219]],
  ['brightWhite', [255, 255, 255]],
];

/**
 * Nearest basic 16-color name. Raw RGB distance maps greys to magenta, so
 * near-neutral colors only ever map to the neutral ramp (never a hue).
 */
function to16(hex) {
  const [r, g, b] = rgb(hex);
  const max = Math.max(r, g, b);
  const saturation = max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
  const candidates =
    saturation < 0.25
      ? ANSI_16.filter(([name]) => ['black', 'brightBlack', 'white', 'brightWhite'].includes(name))
      : ANSI_16;
  let best = 'white';
  let bestDist = Infinity;
  for (const [name, [cr, cg, cb]] of candidates) {
    const d = (cr - r) ** 2 + (cg - g) ** 2 + (cb - b) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return best;
}

function flatTokens() {
  return {
    'bg-base': t.color.bg.base,
    'bg-raised': t.color.bg.raised,
    'bg-overlay': t.color.bg.overlay,
    'border-subtle': t.color.border.subtle,
    'border-strong': t.color.border.strong,
    'text-primary': t.color.text.primary,
    'text-secondary': t.color.text.secondary,
    'text-disabled': t.color.text.disabled,
    'text-inverse': t.color.text.inverse,
    accent: t.color.accent.default,
    'accent-strong': t.color.accent.strong,
    'accent-on': t.color.accent.onAccent,
    'accent-tint': t.color.accent.tint,
    'severity-critical': t.color.severity.critical,
    'severity-high': t.color.severity.high,
    'severity-medium': t.color.severity.medium,
    'severity-low': t.color.severity.low,
    'severity-critical-tint': t.color.severity.tint.critical,
    'severity-high-tint': t.color.severity.tint.high,
    'severity-medium-tint': t.color.severity.tint.medium,
    'severity-low-tint': t.color.severity.tint.low,
    success: t.color.success,
    danger: t.color.danger,
  };
}

export function emitCss() {
  const flat = flatTokens();
  const lines = [
    `/* ${HEADER} */`,
    ':root {',
    ...Object.entries(flat).map(([name, hex]) => `  --vf-${name}: ${hex};`),
    `  --vf-font-mono: ${t.font.mono};`,
    `  --vf-font-sans: ${t.font.sans};`,
    ...Object.entries(t.space).map(([name, px]) => `  --vf-space-${name}: ${px}px;`),
    ...Object.entries(t.radius).map(([name, px]) => `  --vf-radius-${name}: ${px}px;`),
    `  --vf-motion-fast: ${t.motion.fastMs}ms;`,
    `  --vf-motion-base: ${t.motion.baseMs}ms;`,
    `  --vf-motion-slow: ${t.motion.slowMs}ms;`,
    `  --vf-motion-easing: ${t.motion.easing};`,
    '}',
    '',
  ];
  return lines.join('\n');
}

export function emitTui() {
  const flat = flatTokens();
  const entries = Object.entries(flat).map(([name, hex]) => {
    const camel = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return `  ${camel}: { hex: '${hex}', xterm256: ${toXterm256(hex)}, ansi16: '${to16(hex)}' },`;
  });
  return [
    `// ${HEADER}`,
    '/** One color: truecolor hex, nearest xterm-256 index, nearest 16-color name. */',
    'export interface TuiColor {',
    '  readonly hex: string;',
    '  readonly xterm256: number;',
    "  readonly ansi16: 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' | 'brightBlack' | 'brightRed' | 'brightGreen' | 'brightYellow' | 'brightBlue' | 'brightMagenta' | 'brightCyan' | 'brightWhite';",
    '}',
    '',
    'export const TUI_COLORS = {',
    ...entries,
    '} as const satisfies Record<string, TuiColor>;',
    '',
    `export const TUI_FRAME_MS = ${t.motion.tuiFrameMs};`,
    '',
  ].join('\n');
}

export const OUTPUTS = [
  'packages/dashboard/src/design-tokens.generated.css',
  'packages/cli/src/colors.generated.ts',
];

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outputs = [OUTPUTS[0], emitCss(), OUTPUTS[1], emitTui()];
  for (let i = 0; i < outputs.length; i += 2) {
    const path = join(ROOT, outputs[i]);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, outputs[i + 1], 'utf8');
    console.log(`emitted ${outputs[i]}`);
  }
}
