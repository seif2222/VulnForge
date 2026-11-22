import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { DESIGN_TOKENS } from './design-tokens.js';

const GENERATED_CSS_PATH = fileURLToPath(
  new URL('../../../packages/dashboard/src/design-tokens.generated.css', import.meta.url),
);
const GENERATED_TUI_PATH = fileURLToPath(
  new URL('../../../packages/cli/src/colors.generated.ts', import.meta.url),
);
const GENERATED_WEBGL_PATH = fileURLToPath(
  new URL('../../../packages/dashboard/src/tokens.generated.ts', import.meta.url),
);
const EMITTER_URL = new URL('../../../scripts/emit-design-tokens.mjs', import.meta.url);

async function freshEmit(): Promise<{ css: string; tui: string; webgl: string }> {
  const emitter = (await import(EMITTER_URL.href)) as {
    emitCss: () => string;
    emitTui: () => string;
    emitWebGl: () => string;
  };
  return { css: emitter.emitCss(), tui: emitter.emitTui(), webgl: emitter.emitWebGl() };
}

describe('design tokens: freshness of generated files', () => {
  it('the committed CSS, WebGL and TUI color tables equal fresh emitter output', async () => {
    const fresh = await freshEmit();
    expect(readFileSync(GENERATED_CSS_PATH, 'utf8')).toBe(fresh.css);
    expect(readFileSync(GENERATED_TUI_PATH, 'utf8')).toBe(fresh.tui);
    expect(readFileSync(GENERATED_WEBGL_PATH, 'utf8')).toBe(fresh.webgl);
  });

  it('a hand edit to a generated file is caught (proof by mutation)', async () => {
    const fresh = await freshEmit();
    const tampered = fresh.css.replace('--vf-accent:', '--vf-accent: #123456; /* tampered */ /*');
    expect(tampered).not.toBe(fresh.css);
  });
});

describe('design tokens: golden pins (literal values, no imports from the source)', () => {
  it('pins the accent, severity ramp and success hexes in the generated CSS', () => {
    const css = readFileSync(GENERATED_CSS_PATH, 'utf8');
    expect(css).toContain('--vf-accent: #f59e7b;');
    expect(css).toContain('--vf-severity-critical: #ff6b6b;');
    expect(css).toContain('--vf-severity-high: #e8743b;');
    expect(css).toContain('--vf-severity-medium: #e8c352;');
    expect(css).toContain('--vf-severity-low: #8fa3ad;');
    expect(css).toContain('--vf-success: #4ec9a6;');
  });

  it('pins the same ramp in the WebGL color table (canvas cannot read CSS variables)', () => {
    const webgl = readFileSync(GENERATED_WEBGL_PATH, 'utf8');
    expect(webgl).toContain("accent: '#f59e7b',");
    expect(webgl).toContain("severityCritical: '#ff6b6b',");
    expect(webgl).toContain("severityHigh: '#e8743b',");
    expect(webgl).toContain("severityMedium: '#e8c352',");
    expect(webgl).toContain("severityLow: '#8fa3ad',");
    expect(webgl).toContain("success: '#4ec9a6',");
  });

  it('pins the TUI severity SGR fallbacks (xterm-256 and 16-color)', () => {
    const tui = readFileSync(GENERATED_TUI_PATH, 'utf8');
    expect(tui).toContain(
      "severityCritical: { hex: '#ff6b6b', xterm256: 210, ansi16: 'brightRed' }",
    );
    expect(tui).toContain("severityHigh: { hex: '#e8743b', xterm256: 209, ansi16: 'brightRed' }");
    expect(tui).toContain(
      "severityMedium: { hex: '#e8c352', xterm256: 222, ansi16: 'brightYellow' }",
    );
    expect(tui).toContain("severityLow: { hex: '#8fa3ad', xterm256: 247, ansi16: 'brightBlack' }");
    // Greys must never map to a hue (the old Euclidean mapping made them magenta).
    expect(tui).toContain("textSecondary: { hex: '#94aeb6', xterm256: 248, ansi16: 'white' }");
    expect(tui).toContain("accent: { hex: '#f59e7b', xterm256: 216, ansi16: 'brightRed' }");
  });

  it('generated files carry the do-not-edit header naming the source', () => {
    expect(readFileSync(GENERATED_CSS_PATH, 'utf8')).toContain(
      'GENERATED from packages/core/src/design-tokens.ts — do not edit by hand',
    );
    expect(readFileSync(GENERATED_TUI_PATH, 'utf8')).toContain(
      'GENERATED from packages/core/src/design-tokens.ts — do not edit by hand',
    );
    expect(readFileSync(GENERATED_WEBGL_PATH, 'utf8')).toContain(
      'GENERATED from packages/core/src/design-tokens.ts — do not edit by hand',
    );
  });
});

/** WCAG 2.x relative luminance and contrast ratio, measured (not asserted blindly). */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return (
    0.2126 * (linear[0] as number) + 0.7152 * (linear[1] as number) + 0.0722 * (linear[2] as number)
  );
}

function contrast(fg: string, bg: string): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return ((hi as number) + 0.05) / ((lo as number) + 0.05);
}

describe('design tokens: measured contrast', () => {
  const c = DESIGN_TOKENS.color;
  const AA_NORMAL = 4.5;

  it.each([
    ['text-primary', c.text.primary, 'bg-base', c.bg.base],
    ['text-primary', c.text.primary, 'bg-raised', c.bg.raised],
    ['text-primary', c.text.primary, 'bg-overlay', c.bg.overlay],
    ['text-secondary', c.text.secondary, 'bg-base', c.bg.base],
    ['text-secondary', c.text.secondary, 'bg-raised', c.bg.raised],
    ['accent', c.accent.default, 'bg-base', c.bg.base],
    ['accent-on', c.accent.onAccent, 'accent', c.accent.default],
    ['severity-critical', c.severity.critical, 'critical-tint', c.severity.tint.critical],
    ['severity-high', c.severity.high, 'high-tint', c.severity.tint.high],
    ['severity-medium', c.severity.medium, 'medium-tint', c.severity.tint.medium],
    ['severity-low', c.severity.low, 'low-tint', c.severity.tint.low],
    ['severity-critical', c.severity.critical, 'bg-base', c.bg.base],
    ['severity-high', c.severity.high, 'bg-base', c.bg.base],
    ['severity-medium', c.severity.medium, 'bg-base', c.bg.base],
    ['severity-low', c.severity.low, 'bg-base', c.bg.base],
    ['success', c.success, 'bg-base', c.bg.base],
  ])('%s on %s meets AA (>= 4.5)', (_fgName, fg, _bgName, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('disabled text is measured and documented (WCAG-exempt, still >= 3)', () => {
    const ratio = contrast(c.text.disabled, c.bg.base);
    expect(ratio).toBeGreaterThanOrEqual(3);
    expect(ratio).toBeLessThan(AA_NORMAL); // stays in its exempt role
  });
});
