import { describe, expect, it } from 'vitest';

import { loadReportFixture } from './test-helpers.js';
import type { Report } from './types.js';
import { buildFindingsModel, buildOverviewModel, historyEntryFromReport } from './view-adapters.js';

describe('buildOverviewModel', () => {
  const report = loadReportFixture('with-vulnerabilities') as Report;
  const model = buildOverviewModel(report);

  it('mirrors the posture header from report.meta, nothing invented', () => {
    expect(model.posture.projectName).toBe(report.meta.projectName);
    expect(model.posture.ecosystem).toBe(report.meta.ecosystem);
    expect(model.posture.manifestPath).toBe(report.meta.manifestPath);
    expect(model.posture.generatedAt).toBe(report.meta.generatedAt);
    expect(model.posture.schemaVersion).toBe(6);
    expect(model.posture.unresolvedCount).toBe(report.meta.unresolved.length);
  });

  it('emits exactly the four binding stat cards', () => {
    expect(model.statCards.map((card) => card.label)).toEqual([
      'Dependency Inventory',
      'Critical',
      'High',
      'Unresolved Requirements',
    ]);
    const byLabel = new Map(model.statCards.map((card) => [card.label, card.value]));
    expect(byLabel.get('Dependency Inventory')).toBe(report.stats.totalPackages);
    expect(byLabel.get('Critical')).toBe(report.stats.bySeverity.critical);
    expect(byLabel.get('High')).toBe(report.stats.bySeverity.high);
    expect(byLabel.get('Unresolved Requirements')).toBe(report.stats.unresolvedCount);
  });

  it('marks the distribution bars share-of-total with real counts', () => {
    for (const row of model.distribution) {
      expect(row.isShareOfTotal).toBe(true);
      expect(row.count).toBe(report.stats.bySeverity[row.severity]);
    }
    const total = report.stats.totalVulnerabilities;
    const critical = model.distribution.find((row) => row.severity === 'critical');
    expect(critical?.sharePercent).toBe(
      Math.round((report.stats.bySeverity.critical / total) * 100),
    );
  });

  it('ranks priority rows by the real priority score, severity tiebreak', () => {
    expect(model.priorityRows).toHaveLength(report.vulnerabilities.length);
    for (let i = 1; i < model.priorityRows.length; i++) {
      expect(model.priorityRows[i - 1]!.priorityScore).toBeGreaterThanOrEqual(
        model.priorityRows[i]!.priorityScore,
      );
    }
    const scores = report.risk.map((risk) => risk.priorityScore);
    expect(model.priorityRows.map((row) => row.priorityScore).sort((a, b) => b - a)).toEqual(
      [...scores].sort((a, b) => b - a),
    );
  });

  it('exposes the mean priority score under its real name', () => {
    const expected =
      report.risk.reduce((sum, risk) => sum + risk.priorityScore, 0) / report.risk.length;
    expect(model.meanPriorityScore).toBeCloseTo(expected, 1);
  });

  it('counts top packages from real findings only', () => {
    const total = model.topPackages.reduce((sum, row) => sum + row.findingCount, 0);
    expect(total).toBe(report.vulnerabilities.length);
  });

  it('keeps isReachable null when the engine could not determine it', () => {
    for (const row of model.priorityRows) {
      expect(row.isReachable).toBeNull();
    }
  });
});

describe('buildFindingsModel', () => {
  const report = loadReportFixture('with-vulnerabilities') as Report;
  const model = buildFindingsModel(report);

  it('lists every finding, most severe first', () => {
    expect(model.rows).toHaveLength(report.vulnerabilities.length);
    const order = ['critical', 'high', 'medium', 'low'];
    for (let i = 1; i < model.rows.length; i++) {
      expect(order.indexOf(model.rows[i - 1]!.severity)).toBeLessThanOrEqual(
        order.indexOf(model.rows[i]!.severity),
      );
    }
  });

  it('surfaces the CVE alias under its real name', () => {
    for (const row of model.rows) {
      if (row.cve !== null) {
        const vulnerability = report.vulnerabilities.find((v) => v.findingKey === row.findingKey);
        expect(vulnerability?.aliases).toContain(row.cve);
      }
    }
  });

  it('never fabricates a CVSS score', () => {
    for (const row of model.rows) {
      const vulnerability = report.vulnerabilities.find((v) => v.findingKey === row.findingKey);
      expect(row.cvssScore).toBe(vulnerability?.cvss?.score ?? null);
    }
  });

  it('carries the real severity counts through', () => {
    expect(model.counts).toEqual(report.stats.bySeverity);
    expect(model.ignoredCount).toBe(report.stats.ignoredCount);
  });
});

describe('historyEntryFromReport', () => {
  it('adapts a workspace report file with its real tallies', () => {
    const report = loadReportFixture('with-vulnerabilities') as Report;
    const entry = historyEntryFromReport(report, '/repo/reports/scan.json');
    expect(entry.source).toBe('file');
    expect(entry.path).toBe('/repo/reports/scan.json');
    expect(entry.projectName).toBe(report.meta.projectName);
    expect(entry.totalVulnerabilities).toBe(report.stats.totalVulnerabilities);
    expect(entry.bySeverity).toEqual(report.stats.bySeverity);
  });
});
