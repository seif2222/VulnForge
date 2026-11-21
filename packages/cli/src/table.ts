import { SEVERITIES, type Report, type Severity, type Vulnerability } from '@vulnforge/core';

const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  magenta: '\u001b[35m',
} as const;

const SEVERITY_COLOR: Readonly<Record<Severity, string>> = {
  critical: ANSI.magenta,
  high: ANSI.red,
  medium: ANSI.yellow,
  low: ANSI.blue,
};

export interface TableOptions {
  /** Wrap in ANSI colors. The runner decides from TTY/NO_COLOR/FORCE_COLOR/--no-color. */
  readonly color: boolean;
  /** Available columns (VULNFORGE_COLUMNS > tty columns > 80). */
  readonly columns: number;
}

function paint(color: boolean, code: string, text: string): string {
  return color ? `${code}${text}${ANSI.reset}` : text;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function truncate(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

/**
 * Findings in report order are undefined; the table sorts deterministically:
 * priority score desc, severity desc, findingKey asc. JSON output keeps report order;
 * this ordering is presentation-only and tested for parity of content.
 */
export function sortFindings(report: Report): readonly Vulnerability[] {
  const scoreByKey = new Map(report.risk.map((entry) => [entry.findingKey, entry.priorityScore]));
  return [...report.vulnerabilities].sort((a, b) => {
    const scoreDiff = (scoreByKey.get(b.findingKey) ?? 0) - (scoreByKey.get(a.findingKey) ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sevDiff !== 0) return sevDiff;
    return a.findingKey < b.findingKey ? -1 : a.findingKey > b.findingKey ? 1 : 0;
  });
}

/** Renders the human report. Pure: same report + options, same string. */
export function renderTable(report: Report, options: TableOptions): string {
  const { color } = options;
  const lines: string[] = [];
  const { meta, stats } = report;

  lines.push(paint(color, ANSI.bold, `vulnforge scan report - ${meta.projectName}`));
  lines.push(
    `ecosystem ${meta.ecosystem} · ${stats.directPackages} direct · ` +
      `${stats.transitivePackages} transitive · scanned ${meta.generatedAt}`,
  );
  lines.push('');

  if (report.vulnerabilities.length === 0) {
    lines.push('No known vulnerabilities found.');
  } else {
    const findings = sortFindings(report);
    const scoreByKey = new Map(report.risk.map((entry) => [entry.findingKey, entry.priorityScore]));

    const headers = ['SEVERITY', 'PACKAGE', 'INSTALLED', 'FIX', 'ID', 'SCORE'] as const;
    const rows = findings.map((finding) => [
      finding.severity,
      finding.package,
      finding.installedVersion,
      finding.fixedVersion ?? '-',
      finding.id,
      String(scoreByKey.get(finding.findingKey) ?? 0),
    ]);

    // Fit the table to the terminal: ID shrinks first, PACKAGE second.
    const widths = headers.map((header, column) =>
      Math.max(header.length, ...rows.map((row) => (row[column] as string).length)),
    );
    const fixed = widths.reduce((sum, width) => sum + width, 0) + 2 * (headers.length - 1);
    const overflow = fixed - options.columns;
    if (overflow > 0) {
      const idIndex = 4;
      const pkgIndex = 1;
      const idShrink = Math.min(overflow, Math.max(0, (widths[idIndex] as number) - 15));
      widths[idIndex] = (widths[idIndex] as number) - idShrink;
      const remaining = overflow - idShrink;
      if (remaining > 0) {
        widths[pkgIndex] = Math.max(10, (widths[pkgIndex] as number) - remaining);
      }
    }

    const renderRow = (cells: readonly string[], isHeader: boolean): string => {
      const rendered = cells
        .map((cell, column) =>
          pad(truncate(cell, widths[column] as number), widths[column] as number),
        )
        .join('  ');
      return isHeader ? paint(color, ANSI.dim, rendered) : rendered;
    };

    lines.push(renderRow(headers, true));
    for (const [index, finding] of findings.entries()) {
      const row = renderRow(rows[index] as string[], false);
      lines.push(paint(color, SEVERITY_COLOR[finding.severity], row));
    }
    lines.push('');
  }

  const tally = SEVERITIES.filter((severity) => stats.bySeverity[severity] > 0)
    .map((severity) => `${stats.bySeverity[severity]} ${severity}`)
    .join(', ');
  const topScore = report.risk.reduce((max, entry) => Math.max(max, entry.priorityScore), 0);
  const summaryParts = [
    `${stats.totalVulnerabilities} finding${stats.totalVulnerabilities === 1 ? '' : 's'}`,
  ];
  if (tally.length > 0) summaryParts.push(`(${tally})`);
  if (stats.ignoredCount > 0) summaryParts.push(`· ${stats.ignoredCount} ignored`);
  if (report.vulnerabilities.length > 0) summaryParts.push(`· top score ${topScore}`);
  lines.push(summaryParts.join(' '));

  if (meta.unresolved.length > 0) {
    lines.push('');
    lines.push(
      paint(
        color,
        ANSI.yellow,
        `Unresolved requirements (${meta.unresolved.length}) - never checked:`,
      ),
    );
    for (const entry of meta.unresolved) {
      const where = entry.line > 0 ? `:${entry.line}` : '';
      lines.push(`  ${entry.raw}${where} - ${entry.reason}`);
    }
  }

  if (meta.incomplete.length > 0) {
    lines.push('');
    lines.push(paint(color, ANSI.yellow, `Incomplete coverage (${meta.incomplete.length}):`));
    for (const advisory of meta.incomplete) {
      const id = advisory.advisoryId ?? advisory.package;
      lines.push(`  ${id} (${advisory.package}) - ${advisory.reason}`);
    }
  }

  if (meta.ignored.length > 0) {
    lines.push('');
    lines.push(`Ignored (${meta.ignored.length} rule${meta.ignored.length === 1 ? '' : 's'}):`);
    for (const rule of meta.ignored) {
      const matched =
        rule.matchedFindingKeys.length === 0
          ? 'matched nothing'
          : `matched ${rule.matchedFindingKeys.join(', ')}`;
      const reason = rule.reason === null ? '' : ` - ${rule.reason}`;
      lines.push(`  ${rule.id} [${rule.source}] ${matched}${reason}`);
    }
  }

  if (meta.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of meta.warnings) {
      lines.push(`  ${warning}`);
    }
  }

  // Narrow terminals: painted lines are already width-fitted; clamp the rest.
  const fitted = lines.map((line) =>
    line.includes('\u001b') ? line : truncate(line, options.columns),
  );
  return `${fitted.join('\n')}\n`;
}
