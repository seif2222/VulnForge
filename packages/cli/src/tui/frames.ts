import {
  agentStateFor,
  buildFindingsModel,
  buildOverviewModel,
  buildTree,
  type Report,
} from '@vulnforge/core';
import { TUI_COLORS } from '../colors.generated.js';
import {
  forgeFrame,
  scanConstellationFrame,
  type OrbState,
  type RenderCapabilities,
} from './render3d.js';
import { bold, cell, dim, fg, fitLine, padLine, severityGlyph, visibleLength } from './theme.js';
import { TAB_IDS, type TuiModel } from './model.js';

/**
 * Pure frame composers (spec 8.2): `(model, width, height, capabilities, t) -> string[]`.
 * Every value on screen traces to a report field, a real scan event, or the real
 * environment. The same model drives the web dashboard, so numbers cannot diverge.
 */

const ORB_FOR_AGENT: Record<string, OrbState> = {
  idle: 'IDLE',
  scanning: 'SCANNING',
  analyzing: 'ANALYZING',
  detected: 'DETECTED',
  completed: 'COMPLETED',
  error: 'ERROR',
};

const ROBOT_WIDTH = 26;

export function composeFrame(
  model: TuiModel,
  width: number,
  height: number,
  caps: RenderCapabilities,
  t: number,
): string[] {
  if (width < 40 || height < 12) {
    return tooSmallFrame(width, height);
  }

  const header = headerLine(model, width, caps);
  const footer = footerLine(model, width, caps);
  const divider = dividerLine(width, caps);
  const contentHeight = height - 4;
  let content = model.liveOpen
    ? liveMonitorLines(model, width, contentHeight, caps, t)
    : tabLines(model, width, contentHeight, caps, t);
  while (content.length < contentHeight) {
    content = [...content, ''];
  }
  content = content.slice(0, contentHeight);

  const lines = [header, divider, ...content, divider, footer];
  return lines.map((line) => padLine(fitLine(line, width), width));
}

function tooSmallFrame(width: number, height: number): string[] {
  const message = fitLine(
    `terminal too small (need at least 40x12, have ${width}x${height})`,
    width,
  );
  const lines = [padLine(message, width)];
  while (lines.length < height) {
    lines.push(' '.repeat(width));
  }
  return lines;
}

function headerLine(model: TuiModel, width: number, caps: RenderCapabilities): string {
  const compact = width < 96;
  const brand = bold(caps, fg(caps, TUI_COLORS.accent, compact ? ' VF ' : ' VulnForge '));
  const tabs = TAB_IDS.map((id) => {
    const label = compact ? compactLabel(id) : shortLabel(id);
    const text = ` ${id} ${label} `;
    return model.tab === id && !model.liveOpen
      ? bold(caps, fg(caps, TUI_COLORS.accent, text))
      : dim(caps, text);
  }).join('');
  const live = model.liveOpen
    ? bold(caps, fg(caps, TUI_COLORS.severityHigh, ' LIVE MONITOR '))
    : '';
  return fitLine(brand + tabs + live, width);
}

function compactLabel(id: number): string {
  return (
    {
      1: 'Ov',
      2: 'Sc',
      3: 'Fi',
      4: 'Tr',
      5: 'AI',
      6: 'Hi',
      7: 'Re',
      8: 'Se',
    } as Record<number, string>
  )[id] as string;
}

function shortLabel(id: number): string {
  return (
    {
      1: 'Overview',
      2: 'Scan',
      3: 'Findings',
      4: 'Tree',
      5: 'AI',
      6: 'History',
      7: 'Reports',
      8: 'Settings',
    } as Record<number, string>
  )[id] as string;
}

function dividerLine(width: number, caps: RenderCapabilities): string {
  const glyph = caps.unicode ? '─' : '-';
  return dim(caps, glyph.repeat(width));
}

function footerLine(model: TuiModel, width: number, caps: RenderCapabilities): string {
  const hints = model.inputFocused
    ? 'enter scan · esc back'
    : '1-8 tabs · s scan · l live · c cancel · r rescan · q quit';
  const status = scanStatusText(model);
  const left = dim(caps, ` ${hints}`);
  const right = status === '' ? '' : dim(caps, `${status} `);
  const gap = width - visibleLength(left) - visibleLength(right);
  if (gap >= 1) {
    return left + ' '.repeat(gap) + right;
  }
  const rightWidth = Math.max(0, width - visibleLength(left) - 1);
  return left + ' ' + fitLine(right.trimStart(), rightWidth);
}

function scanStatusText(model: TuiModel): string {
  const scan = model.scan;
  switch (scan.state) {
    case 'idle':
      return '';
    case 'scanning':
    case 'analyzing':
    case 'detected': {
      const started = scan.startedAt === null ? '' : ` · ${scan.startedAt}`;
      const queries =
        scan.queriesTotal > 0 ? ` · ${scan.queriesDone}/${scan.queriesTotal} queries` : '';
      return `${scan.state}${queries}${started}`;
    }
    case 'completed':
      return 'scan completed';
    case 'cancelled':
      return 'scan cancelled';
    case 'error':
      return 'scan error';
  }
}

function tabLines(
  model: TuiModel,
  width: number,
  height: number,
  caps: RenderCapabilities,
  t: number,
): string[] {
  let body: string[];
  switch (model.tab) {
    case 1:
      body = overviewLines(model, width, height, caps, t);
      break;
    case 2:
      body = startScanLines(model, width, height, caps);
      break;
    case 3:
      body = findingsLines(model, width, height, caps);
      break;
    case 4:
      body = treeLines(model, width, height, caps);
      break;
    case 5:
      body = aiLines(model, width, height, caps, t);
      break;
    case 6:
      body = historyLines(model, width, height, caps);
      break;
    case 7:
      body = reportsLines(model, width, height, caps);
      break;
    case 8:
      body = settingsLines(model, width, height, caps);
      break;
  }
  while (body.length < height) {
    body.push('');
  }
  return body.slice(0, height);
}

function emptyState(model: TuiModel, caps: RenderCapabilities, what: string): string[] {
  const lines = [
    '',
    dim(caps, `  No report yet.`),
    dim(caps, `  ${what} needs a scan: press s, type a project path, hit enter.`),
    dim(caps, `  Or open an existing one: vulnforge ui <path-to-report.json>.`),
  ];
  if (model.scan.state === 'error' && model.scan.errorMessage !== null) {
    lines.push(
      '',
      fg(caps, TUI_COLORS.severityCritical, `  last scan error: ${model.scan.errorMessage}`),
    );
  }
  return lines;
}

// ---------------------------------------------------------------- tab 1: overview

function overviewLines(
  model: TuiModel,
  width: number,
  height: number,
  caps: RenderCapabilities,
  t: number,
): string[] {
  if (model.report === null) {
    return emptyState(model, caps, 'Overview');
  }
  const overview = buildOverviewModel(model.report);
  const robotColumn = width >= 100;
  const contentWidth = robotColumn ? width - ROBOT_WIDTH - 1 : width;

  const left: string[] = [];
  const posture = overview.posture;
  left.push(
    ` ${bold(caps, posture.projectName)} ${dim(caps, `${posture.ecosystem} · ${posture.manifestPath}`)}`,
  );
  left.push(dim(caps, ` generated ${posture.generatedAt} · schema v${posture.schemaVersion}`));
  left.push('');

  // The four binding stat cards.
  const cardWidth = Math.max(14, Math.floor((contentWidth - 4) / 4));
  const top: string[] = [];
  const valueRow: string[] = [];
  const labelRow: string[] = [];
  const bottom: string[] = [];
  const boxH = caps.unicode ? ('─' as string) : '-';
  const boxV = caps.unicode ? ('│' as string) : '|';
  const boxTL = caps.unicode ? '┌' : '+';
  const boxTR = caps.unicode ? '┐' : '+';
  const boxBL = caps.unicode ? '└' : '+';
  const boxBR = caps.unicode ? '┘' : '+';
  for (const card of overview.statCards) {
    top.push(`${boxTL}${boxH.repeat(cardWidth - 2)}${boxTR} `);
    const valueColor =
      card.label === 'Critical'
        ? TUI_COLORS.severityCritical
        : card.label === 'High'
          ? TUI_COLORS.severityHigh
          : TUI_COLORS.accent;
    valueRow.push(
      `${boxV}${cell(bold(caps, fg(caps, valueColor, ` ${card.value}`)), cardWidth - 2)}${boxV} `,
    );
    labelRow.push(`${boxV}${cell(dim(caps, ` ${card.label}`), cardWidth - 2)}${boxV} `);
    bottom.push(`${boxBL}${boxH.repeat(cardWidth - 2)}${boxBR} `);
  }
  left.push(top.join(''));
  left.push(valueRow.join(''));
  left.push(labelRow.join(''));
  left.push(bottom.join(''));
  left.push('');

  // Severity distribution, share of total under its real name.
  const total = overview.distribution.reduce((sum, row) => sum + row.count, 0);
  left.push(bold(caps, ' Distribution (share of total findings)'));
  if (total === 0) {
    left.push(dim(caps, '  no findings'));
  }
  const barMax = Math.max(8, contentWidth - 34);
  for (const row of overview.distribution) {
    const filled = total === 0 ? 0 : Math.round((row.count / total) * barMax);
    const bar = '█'.repeat(filled) + dim(caps, '░'.repeat(barMax - filled));
    left.push(`  ${cell(row.severity, 9)} ${bar} ${String(row.count)} (${row.sharePercent}%)`);
  }
  left.push('');

  if (overview.priorityRows.length > 0) {
    left.push(bold(caps, ' Top priority'));
    for (const row of overview.priorityRows.slice(0, 5)) {
      const fix = row.fixedVersion === null ? 'no fix published' : `fix ${row.fixedVersion}`;
      left.push(
        `  ${severityGlyph(caps, row.severity === 'critical' || row.severity === 'high' || row.severity === 'medium' || row.severity === 'low' ? row.severity : 'low')} ${cell(row.id, 20)} ${cell(`${row.packageName}@${row.installedVersion}`, contentWidth - 50)} score ${row.priorityScore} · ${fix}`,
      );
    }
  } else {
    left.push(bold(caps, ' Top priority'));
    left.push(dim(caps, '  no findings to rank'));
  }
  left.push('');

  if (overview.unresolved.length > 0) {
    left.push(
      fg(
        caps,
        TUI_COLORS.severityHigh,
        ` NOT FULLY SCANNED — ${overview.unresolved.length} requirement(s) could not be checked`,
      ),
    );
    for (const item of overview.unresolved.slice(0, 4)) {
      left.push(dim(caps, `  ${item.requirement}: ${item.reason}`));
    }
  }

  if (!robotColumn) {
    return left;
  }
  const robot = forgeFrame(orbFor(model), ROBOT_WIDTH, Math.min(height, 16), caps, t);
  const merged: string[] = [];
  const rows = Math.max(left.length, robot.length);
  for (let i = 0; i < rows; i++) {
    const l = cell(left[i] ?? '', contentWidth);
    const r = (robot[i] ?? '').padEnd(ROBOT_WIDTH);
    merged.push(l + ' ' + r);
  }
  return merged;
}

function orbFor(model: TuiModel): OrbState {
  const agent = agentStateFor(model.scan.state);
  return ORB_FOR_AGENT[agent] ?? 'IDLE';
}

// ---------------------------------------------------------------- tab 2: start scan

function startScanLines(
  model: TuiModel,
  width: number,
  _height: number,
  caps: RenderCapabilities,
): string[] {
  const inner = Math.min(width - 6, 70);
  const boxH = caps.unicode ? '─' : '-';
  const boxV = caps.unicode ? '│' : '|';
  const lines: string[] = [];
  lines.push('');
  lines.push(` ${bold(caps, 'Start New Scan')}`);
  lines.push('');
  const cursor = model.inputFocused ? (caps.unicode ? '▌' : '_') : ' ';
  const inputText = cell(` ${model.input}${cursor}`, inner);
  lines.push(
    `  ┌${boxH.repeat(inner)}┐`
      .replace('┌', caps.unicode ? '┌' : '+')
      .replace('┐', caps.unicode ? '┐' : '+'),
  );
  lines.push(`  ${boxV}${inputText}${boxV}`);
  lines.push(
    `  └${boxH.repeat(inner)}┘`
      .replace('└', caps.unicode ? '└' : '+')
      .replace('┘', caps.unicode ? '┘' : '+'),
  );
  lines.push('');
  lines.push(dim(caps, '  type a project path, then enter to scan (absolute or relative to cwd)'));
  lines.push('');

  if (model.preflight !== null) {
    lines.push(bold(caps, '  Preflight'));
    const pf = model.preflight;
    lines.push(factLine(caps, 'target exists', pf.exists, pf.target));
    lines.push(
      factLine(
        caps,
        'manifest',
        pf.manifest !== null,
        pf.manifest ?? 'no supported manifest found',
      ),
    );
    lines.push(factLine(caps, 'ecosystem', pf.ecosystem !== null, pf.ecosystem ?? 'unknown'));
    lines.push(
      pf.ignoreFile === null
        ? dim(caps, '  ○ ignore file: none (optional)')
        : factLine(caps, 'ignore file', true, pf.ignoreFile),
    );
    if (!pf.exists || pf.manifest === null) {
      lines.push('');
      lines.push(
        fg(
          caps,
          TUI_COLORS.severityHigh,
          '  scan blocked: fix the failing fact above, then enter again',
        ),
      );
    }
  } else if (model.input.trim() !== '' && !model.inputFocused) {
    lines.push(dim(caps, '  press enter to probe and launch'));
  }

  if (model.scan.state === 'error' && model.scan.errorMessage !== null) {
    lines.push('');
    lines.push(fg(caps, TUI_COLORS.severityCritical, `  last error: ${model.scan.errorMessage}`));
  }
  return lines;
}

function factLine(caps: RenderCapabilities, label: string, ok: boolean, detail: string): string {
  const mark = ok ? fg(caps, TUI_COLORS.success, '✓') : fg(caps, TUI_COLORS.severityCritical, '✗');
  return `  ${mark} ${cell(label, 14)} ${dim(caps, detail)}`;
}

// ---------------------------------------------------------------- tab 3: findings

function findingsLines(
  model: TuiModel,
  width: number,
  height: number,
  caps: RenderCapabilities,
): string[] {
  if (model.report === null) {
    return emptyState(model, caps, 'Findings');
  }
  const findings = buildFindingsModel(model.report);
  const lines: string[] = [];
  const counts = (Object.keys(findings.counts) as (keyof typeof findings.counts)[])
    .filter((severity) => findings.counts[severity] > 0)
    .map((severity) => `${findings.counts[severity]} ${severity}`)
    .join(' · ');
  const ignored = findings.ignoredCount > 0 ? ` · ${findings.ignoredCount} ignored by rules` : '';
  lines.push('');
  lines.push(` ${bold(caps, `${findings.rows.length} findings`)} ${dim(caps, counts + ignored)}`);
  lines.push('');

  const idWidth = 22;
  const pkgWidth = Math.max(18, width - idWidth - 34);
  const header = `   ${cell('ID', idWidth)} ${cell('PACKAGE@VERSION', pkgWidth)} ${cell('CVSS', 5)} ${cell('SCORE', 6)} FIX`;
  lines.push(dim(caps, header));
  const shown = findings.rows.slice(0, Math.max(1, height - 6));
  for (const row of shown) {
    const glyph =
      row.severity === 'critical' ||
      row.severity === 'high' ||
      row.severity === 'medium' ||
      row.severity === 'low'
        ? severityGlyph(caps, row.severity)
        : dim(caps, '?');
    const cvss = row.cvssScore === null ? '  -  ' : row.cvssScore.toFixed(1).padStart(5);
    const fix = row.fixedVersion === null ? dim(caps, 'no fix published') : row.fixedVersion;
    const ignoredMark = row.ignored ? dim(caps, ' (ignored)') : '';
    lines.push(
      ` ${glyph} ${cell(row.id, idWidth)} ${cell(`${row.packageName}@${row.installedVersion}`, pkgWidth)} ${cell(cvss, 5)} ${cell(String(row.priorityScore), 6)} ${fix}${ignoredMark}`,
    );
  }
  if (findings.rows.length > shown.length) {
    lines.push(
      dim(caps, `  … ${findings.rows.length - shown.length} more not shown (terminal height)`),
    );
  }
  return lines;
}

// ---------------------------------------------------------------- tab 4: tree

function treeLines(
  model: TuiModel,
  _width: number,
  height: number,
  caps: RenderCapabilities,
): string[] {
  if (model.report === null) {
    return emptyState(model, caps, 'Dependency tree');
  }
  const tree = buildTree(model.report.packages);
  const vulnerable = new Map<string, 'critical' | 'high' | 'medium' | 'low'>();
  const order = ['critical', 'high', 'medium', 'low'] as const;
  for (const vulnerability of model.report.vulnerabilities) {
    if (
      vulnerability.severity !== 'critical' &&
      vulnerability.severity !== 'high' &&
      vulnerability.severity !== 'medium' &&
      vulnerability.severity !== 'low'
    ) {
      continue;
    }
    const key = `${vulnerability.package}@${vulnerability.installedVersion}`;
    const current = vulnerable.get(key);
    if (current === undefined || order.indexOf(vulnerability.severity) < order.indexOf(current)) {
      vulnerable.set(key, vulnerability.severity);
    }
  }

  const lines: string[] = [''];
  lines.push(
    ` ${bold(caps, `${tree.nodes.size} packages`)} ${dim(caps, `${model.report.stats.directPackages} direct · ${model.report.stats.transitivePackages} transitive`)}`,
  );
  lines.push('');

  const budget = Math.max(1, height - 4);
  const walk = (nodeId: string, prefix: string, isLast: boolean, depth: number): void => {
    if (lines.length >= budget + 3 || depth > 24) {
      return;
    }
    const node = tree.nodes.get(nodeId);
    if (node === undefined) {
      return;
    }
    const branch = caps.unicode ? (isLast ? '└─ ' : '├─ ') : isLast ? '`- ' : '+- ';
    const sev = vulnerable.get(node.id);
    const mark = sev === undefined ? '  ' : `${severityGlyph(caps, sev)} `;
    lines.push(` ${dim(caps, prefix + branch)}${mark}${node.name}@${node.version}`);
    const childPrefix =
      prefix + (isLast ? (caps.unicode ? '   ' : '   ') : caps.unicode ? '│  ' : '|  ');
    node.childIds.forEach((childId, index) => {
      walk(childId, childPrefix, index === node.childIds.length - 1, depth + 1);
    });
  };
  tree.roots.forEach((root, index) => {
    walk(root.id, '', index === tree.roots.length - 1, 0);
  });
  if (lines.length >= budget + 3) {
    lines.push(dim(caps, '  … truncated to terminal height'));
  }
  return lines;
}

// ---------------------------------------------------------------- tab 5: AI agent

function aiLines(
  model: TuiModel,
  width: number,
  height: number,
  caps: RenderCapabilities,
  t: number,
): string[] {
  const agent = agentStateFor(model.scan.state);
  const lines: string[] = [''];
  lines.push(
    ` ${bold(caps, 'Forge')} ${dim(caps, 'explains and suggests only — never creates findings, never fails a scan')}`,
  );
  lines.push(` state: ${agent}`);
  lines.push('');
  const robot = forgeFrame(
    orbFor(model),
    Math.min(width - 4, 44),
    Math.min(height - 8, 14),
    caps,
    t,
  );
  lines.push(...robot.map((row) => ` ${row}`));
  lines.push('');

  if (model.report === null) {
    lines.push(
      dim(caps, '  no report yet — AI suggestions appear here after a scan with --suggest.'),
    );
    return lines;
  }
  if (model.report.suggestions.length === 0) {
    lines.push(dim(caps, '  this report has no AI suggestions (the AI step did not run for it).'));
    lines.push(dim(caps, '  run with --suggest after configuring Forge to generate them.'));
    return lines;
  }
  lines.push(bold(caps, ` ${model.report.suggestions.length} AI suggestions`));
  for (const suggestion of model.report.suggestions.slice(0, Math.max(1, height - 12))) {
    const safer = suggestion.saferVersion === null ? '' : ` → ${suggestion.saferVersion}`;
    const alt =
      suggestion.alternativePackage === null ? '' : ` (alt: ${suggestion.alternativePackage})`;
    lines.push(`  ${suggestion.findingKey}${safer}${alt}`);
    lines.push(dim(caps, `    ${suggestion.rationale}`));
  }
  return lines;
}

// ---------------------------------------------------------------- tab 6: history

function historyLines(
  model: TuiModel,
  _width: number,
  _height: number,
  caps: RenderCapabilities,
): string[] {
  const lines: string[] = [''];
  lines.push(` ${bold(caps, 'Scan History')} ${dim(caps, 'this session')}`);
  lines.push('');
  if (model.sessionRuns.length === 0) {
    lines.push(dim(caps, '  no scans this session yet — press s to run one.'));
    return lines;
  }
  for (const run of model.sessionRuns) {
    const findings = run.findings === null ? '' : ` · ${run.findings} findings`;
    const color =
      run.outcome === 'completed'
        ? TUI_COLORS.success
        : run.outcome === 'cancelled'
          ? TUI_COLORS.severityMedium
          : TUI_COLORS.severityCritical;
    lines.push(
      `  ${fg(caps, color, run.outcome.padEnd(9))} ${run.startedAt}  ${run.target}${findings}`,
    );
  }
  return lines;
}

// ---------------------------------------------------------------- tab 7: reports

function reportsLines(
  model: TuiModel,
  _width: number,
  _height: number,
  caps: RenderCapabilities,
): string[] {
  if (model.report === null) {
    return emptyState(model, caps, 'Reports');
  }
  const report: Report = model.report;
  const lines: string[] = [''];
  lines.push(` ${bold(caps, 'Current report')}`);
  lines.push('');
  lines.push(`  ${cell('source', 16)} ${model.reportSource ?? 'unknown'}`);
  lines.push(`  ${cell('project', 16)} ${report.meta.projectName}`);
  lines.push(`  ${cell('ecosystem', 16)} ${report.meta.ecosystem}`);
  lines.push(`  ${cell('manifest', 16)} ${report.meta.manifestPath}`);
  lines.push(`  ${cell('generated', 16)} ${report.meta.generatedAt}`);
  lines.push(`  ${cell('schema', 16)} v${report.schemaVersion}`);
  lines.push(`  ${cell('tool', 16)} ${report.meta.tool.name} ${report.meta.tool.version}`);
  lines.push('');
  lines.push(
    `  ${report.stats.totalPackages} packages · ${report.stats.totalVulnerabilities} findings · ${report.stats.ignoredCount} ignored · ${report.stats.unresolvedCount} unresolved`,
  );
  if (report.meta.incomplete.length > 0) {
    lines.push('');
    lines.push(
      fg(
        caps,
        TUI_COLORS.severityHigh,
        `  ${report.meta.incomplete.length} query gap(s) recorded in meta.incomplete`,
      ),
    );
  }
  return lines;
}

// ---------------------------------------------------------------- tab 8: settings

function settingsLines(
  model: TuiModel,
  width: number,
  _height: number,
  caps: RenderCapabilities,
): string[] {
  const env = model.env;
  const lines: string[] = [''];
  lines.push(
    ` ${bold(caps, 'Settings')} ${dim(caps, 'presence only — no secret values are ever shown')}`,
  );
  lines.push('');
  lines.push(`  ${cell('tool version', 18)} ${env.toolVersion}`);
  lines.push(`  ${cell('node', 18)} ${env.nodeVersion}`);
  lines.push(`  ${cell('platform', 18)} ${env.platform}`);
  lines.push(`  ${cell('cwd', 18)} ${env.cwd}`);
  lines.push(`  ${cell('cache dir', 18)} ${env.cacheDir}`);
  lines.push(
    `  ${cell('Forge (AI)', 18)} ${env.aiConfigured ? 'configured (VULNFORGE_AI_* present)' : 'not configured'}`,
  );
  lines.push(`  ${cell('color mode', 18)} ${caps.color}`);
  lines.push(`  ${cell('unicode', 18)} ${caps.unicode ? 'yes' : 'no'}`);
  lines.push(`  ${cell('columns', 18)} ${String(width)}`);
  return lines;
}

// ---------------------------------------------------------------- live monitor

function liveMonitorLines(
  model: TuiModel,
  width: number,
  height: number,
  caps: RenderCapabilities,
  t: number,
): string[] {
  const scan = model.scan;
  const lines: string[] = [''];
  const started = scan.startedAt === null ? '' : ` · started ${scan.startedAt}`;
  lines.push(
    ` ${bold(caps, 'Live Monitor')} ${dim(caps, `${scan.state}${scan.target === null ? '' : ` · ${scan.target}`}${started}`)}`,
  );
  const queryText =
    scan.queriesTotal > 0
      ? `Querying OSV — ${scan.queriesDone} / ${scan.queriesTotal} queries${scan.lastPackage === null ? '' : ` · ${scan.lastPackage}`}`
      : 'preparing scan…';
  lines.push(` ${fg(caps, TUI_COLORS.accent, queryText)}`);
  if (scan.state === 'error' && scan.errorMessage !== null) {
    lines.push(` ${fg(caps, TUI_COLORS.severityCritical, scan.errorMessage)}`);
  }
  lines.push('');

  const running =
    scan.state === 'scanning' || scan.state === 'analyzing' || scan.state === 'detected';
  const visualHeight = Math.max(4, height - 12);
  if (running || model.queriedPackages.length > 0) {
    const names = model.queriedPackages.slice(-14);
    const nodes = names.map((name) => ({ name: name.split('@')[0] ?? name, lit: true }));
    if (running && scan.lastPackage !== null && names.length === 0) {
      nodes.push({ name: scan.lastPackage.split('@')[0] ?? scan.lastPackage, lit: false });
    }
    if (nodes.length > 0) {
      lines.push(
        ...scanConstellationFrame(nodes, width - 2, Math.min(visualHeight, 12), caps, t).map(
          (row) => ` ${row}`,
        ),
      );
    }
  } else {
    const robot = forgeFrame(
      orbFor(model),
      Math.min(width - 4, 40),
      Math.min(visualHeight, 12),
      caps,
      t,
    );
    lines.push(...robot.map((row) => ` ${row}`));
  }

  lines.push('');
  lines.push(dim(caps, ' events'));
  const room = height - lines.length - 1;
  const events = model.eventLog.slice(-Math.max(1, room));
  for (const event of events) {
    lines.push(dim(caps, `  ${event}`));
  }
  return lines;
}
