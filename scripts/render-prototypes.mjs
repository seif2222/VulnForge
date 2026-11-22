#!/usr/bin/env node
/* Renders the G3 TUI prototype frames from the real renderer
 * (packages/cli/dist/tui/render3d.js) and writes:
 *   docs/proposal/prototypes/*.frame.txt  - raw ANSI frames (cat them)
 *   docs/proposal/prototypes/tui-frames.html - browser preview
 * Package names and counts come from fixtures/projects/vulnerable-npm,
 * never invented. Run after `pnpm build`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'docs/proposal/prototypes');
mkdirSync(outDir, { recursive: true });

const { forgeFrame, scanConstellationFrame } = await import(
  join(root, 'packages/cli/dist/tui/render3d.js')
);

const TRUECOLOR = { color: 'truecolor', unicode: true };
const MONO = { color: 'mono', unicode: false };

// Real fixture data: fixtures/projects/vulnerable-npm
const fixture = JSON.parse(
  readFileSync(join(root, 'fixtures/projects/vulnerable-npm/package.json'), 'utf8'),
);
const pkgs = Object.keys(fixture.dependencies);
const expected = readFileSync(join(root, 'fixtures/projects/vulnerable-npm/EXPECTED.md'), 'utf8');

const RULE = '─'.repeat(46);
const RESET = '\u001b[0m';
const DIM = '\u001b[2m';
const BOLD = '\u001b[1m';

function overviewFrame() {
  const forge = forgeFrame('IDLE', 34, 15, TRUECOLOR, 1.2);
  const lines = [`${BOLD}VulnForge${RESET}  ${DIM}v0.0.0 · schema v6${RESET}`, RULE, ''];
  const side = [
    `${BOLD}Scan complete${RESET}  vulnerable-npm`,
    '',
    `10 findings  ${DIM}top score 95${RESET}`,
    `● 1 critical   ▲ 4 high`,
    `■ 5 medium     ○ 0 low`,
    '',
    `${DIM}Forge is idle. Press e to explain a finding.${RESET}`,
  ];
  for (let i = 0; i < forge.length; i += 1) {
    lines.push(`${forge[i]}  ${side[i] ?? ''}`);
  }
  lines.push(
    '',
    RULE,
    `${DIM}prototype frame · renderer: packages/cli/src/tui/render3d.ts${RESET}`,
  );
  return lines.join('\n');
}

function liveMonitorFrame() {
  const nodes = pkgs.map((name, i) => ({ name, lit: i < 2 }));
  const constellation = scanConstellationFrame(nodes, 44, 9, TRUECOLOR, 0.4);
  const forge = forgeFrame('SCANNING', 34, 13, TRUECOLOR, 0.25);
  const lines = [`${BOLD}Live Monitor${RESET}  ${DIM}scanning vulnerable-npm${RESET}`, RULE];
  const right = [
    `${BOLD}OSV queries${RESET}  2/3 done`,
    `${DIM}lodash done · minimist done · qs pending${RESET}`,
    '',
    `${DIM}nodes light as queries complete${RESET}`,
  ];
  for (const row of constellation) lines.push(row);
  lines.push('');
  for (let i = 0; i < forge.length; i += 1) {
    lines.push(`${forge[i]}  ${right[i] ?? ''}`);
  }
  lines.push('', RULE, `${DIM}prototype frame · no whole-scan percentage per spec${RESET}`);
  return lines.join('\n');
}

function statesStrip(caps) {
  const states = ['IDLE', 'SCANNING', 'ANALYZING', 'DETECTED', 'COMPLETED', 'ERROR'];
  const frames = states.map((s) => forgeFrame(s, 20, 10, caps, 1.0));
  const lines = [];
  for (let row = 0; row < 10; row += 1) {
    lines.push(frames.map((f) => f[row]).join('  '));
  }
  lines.push(states.map((s) => s.padEnd(20)).join('  '));
  return lines.join('\n');
}

const monoOverview = [
  `${BOLD}mono fallback (no unicode, no color)${RESET}`,
  RULE,
  ...forgeFrame('IDLE', 34, 14, MONO, 1.2),
].join('\n');

const files = {
  'tui-overview-agent.frame.txt': overviewFrame(),
  'tui-live-monitor-scanning.frame.txt': liveMonitorFrame(),
  'tui-forge-states.frame.txt': statesStrip(TRUECOLOR),
  'tui-mono-fallback.frame.txt': monoOverview,
};
for (const [name, body] of Object.entries(files)) {
  writeFileSync(join(outDir, name), `${body}\n`);
}

// --- HTML preview: convert the SGR sequences we emit into spans ---
function ansiToHtml(text) {
  let html = '';
  let open = false;
  // eslint-disable-next-line no-control-regex -- matching our own SGR output
  const escRe = /\u001b\[([0-9;]*)m/g;
  let last = 0;
  for (const m of text.matchAll(escRe)) {
    html += escapeHtml(text.slice(last, m.index));
    last = m.index + m[0].length;
    const params = m[1];
    if (open) {
      html += '</span>';
      open = false;
    }
    if (params === '0' || params === '') continue;
    const tc = params.match(/^38;2;(\d+);(\d+);(\d+)$/);
    const bg = params.match(/^48;2;(\d+);(\d+);(\d+)$/);
    let style = '';
    if (tc) style = `color:rgb(${tc[1]},${tc[2]},${tc[3]})`;
    else if (bg) style = `background:rgb(${bg[1]},${bg[2]},${bg[3]})`;
    else if (params === '1') style = 'font-weight:700';
    else if (params === '2') style = 'opacity:.65';
    if (style) {
      html += `<span style="${style}">`;
      open = true;
    }
  }
  html += escapeHtml(text.slice(last));
  if (open) html += '</span>';
  return html;
}
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const sections = Object.entries(files)
  .map(
    ([name, body]) => `
  <section>
    <h2>${name}</h2>
    <pre>${ansiToHtml(body)}</pre>
  </section>`,
  )
  .join('\n');

writeFileSync(
  join(outDir, 'tui-frames.html'),
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>VulnForge TUI prototype frames</title>
<link rel="stylesheet" href="../../../packages/dashboard/src/design-tokens.generated.css">
<style>
  body { background: var(--vf-bg-base); color: var(--vf-text-primary);
         font-family: var(--vf-font-sans); margin: 0; padding: var(--vf-space-lg); }
  h1 { font-size: 20px; } h2 { font-size: 13px; color: var(--vf-text-secondary);
       font-weight: 500; margin: var(--vf-space-lg) 0 var(--vf-space-sm); }
  pre { font-family: var(--vf-font-mono); font-size: 13px; line-height: 1.15;
        background: var(--vf-bg-raised); border: 1px solid var(--vf-border-subtle);
        border-radius: 8px; padding: var(--vf-space-md); overflow-x: auto; margin: 0; }
</style></head><body>
<h1>VulnForge TUI prototype frames (G3)</h1>
<p>Rendered by packages/cli/src/tui/render3d.ts via scripts/render-prototypes.mjs.
Fixture: vulnerable-npm (${pkgs.join(', ')}).</p>
${sections}
</body></html>
`,
);
console.log(`wrote ${Object.keys(files).length + 1} prototype files to ${outDir}`);
console.log(`fixture expectation excerpt: ${expected.split('\n')[0] ?? ''}`);
