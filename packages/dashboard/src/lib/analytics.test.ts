import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { Report, ScanHistoryEntry } from './core.js';
import { historyEntryFromReport } from './core.js';
import { buildAnalyticsModel, trendGeometry } from './analytics.js';

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../../fixtures/reports/with-vulnerabilities.json', import.meta.url),
    ),
    'utf8',
  ),
) as Report;

function entry(at: string, total: number, medium: number): ScanHistoryEntry {
  return {
    source: 'session',
    projectName: 'demo',
    generatedAt: at,
    totalVulnerabilities: total,
    bySeverity: { critical: 0, high: 0, medium, low: 0 },
    path: null,
  };
}

describe('analytics model', () => {
  it('sorts the trend oldest to newest and aggregates the real severity mix', () => {
    const model = buildAnalyticsModel(
      [entry('2026-11-22T03:00:00Z', 5, 5), entry('2026-11-21T10:00:00Z', 2, 2)],
      null,
    );
    expect(model.scanCount).toBe(2);
    expect(model.trend.map((point) => point.at)).toEqual([
      '2026-11-21T10:00:00Z',
      '2026-11-22T03:00:00Z',
    ]);
    expect(model.trend.map((point) => point.total)).toEqual([2, 5]);
    expect(model.mix.find((row) => row.severity === 'medium')?.count).toBe(7);
    expect(model.mix.find((row) => row.severity === 'critical')?.count).toBe(0);
  });

  it('is honest with no history: zero scans, empty trend, null latest stats', () => {
    const model = buildAnalyticsModel([], null);
    expect(model.scanCount).toBe(0);
    expect(model.trend).toHaveLength(0);
    expect(model.latestFindings).toBeNull();
    expect(model.meanPriorityScore).toBeNull();
    expect(model.unresolvedCount).toBeNull();
    expect(model.topPackages).toHaveLength(0);
  });

  it('pulls latest-report stats and package rankings from the real report', () => {
    const model = buildAnalyticsModel([historyEntryFromReport(fixture, '/r.json')], fixture);
    expect(model.latestFindings).toBe(fixture.stats.totalVulnerabilities);
    expect(model.meanPriorityScore).not.toBeNull();
    expect(model.unresolvedCount).toBe(0);
    expect(model.topPackages.length).toBeGreaterThan(0);
    expect(model.topPackages[0]?.findingCount).toBeGreaterThanOrEqual(
      model.topPackages[model.topPackages.length - 1]?.findingCount ?? 0,
    );
  });
});

describe('trend geometry', () => {
  it('draws a single real point without inventing a line', () => {
    const geometry = trendGeometry([
      { at: 'a', total: 3, bySeverity: { critical: 0, high: 0, medium: 3, low: 0 } },
    ]);
    expect(geometry.line).toBe('');
    expect(geometry.dots).toHaveLength(1);
    expect(geometry.dots[0]?.x).toBe(50);
  });

  it('maps the maximum to the top and zero to the baseline', () => {
    const geometry = trendGeometry([
      { at: 'a', total: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 } },
      { at: 'b', total: 10, bySeverity: { critical: 0, high: 0, medium: 10, low: 0 } },
    ]);
    expect(geometry.dots[0]?.y).toBe(36);
    expect(geometry.dots[1]?.y).toBe(10);
    expect(geometry.line).not.toBe('');
    expect(geometry.area.startsWith('M ')).toBe(true);
  });
});
