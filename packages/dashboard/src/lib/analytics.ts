import type { Report, ScanHistoryEntry, Severity, TopPackageRow } from './core.js';
import { buildOverviewModel } from './core.js';

export interface TrendPoint {
  /** Real scan timestamp, ISO. */
  readonly at: string;
  readonly total: number;
  readonly bySeverity: Readonly<Record<Severity, number>>;
}

export interface AnalyticsModel {
  /** Number of real scans in the session history. */
  readonly scanCount: number;
  /** Findings trend, oldest to newest. One point is real but not a trend yet. */
  readonly trend: readonly TrendPoint[];
  /** Aggregate severity mix across every scan in history. */
  readonly mix: readonly { readonly severity: Severity; readonly count: number }[];
  /** Latest report's mean priority score; null when the latest report has no findings. */
  readonly meanPriorityScore: number | null;
  /** Latest report's unresolved requirement count. */
  readonly unresolvedCount: number | null;
  /** Latest report's findings total. */
  readonly latestFindings: number | null;
  /** Most vulnerable packages of the latest report. */
  readonly topPackages: readonly TopPackageRow[];
}

const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low'];

/**
 * The Analytics model. Every number derives from the real session history and
 * the real loaded report; nothing is extrapolated or smoothed. With a single
 * scan the trend has one honest point - the screen says so instead of
 * fabricating a curve.
 */
export function buildAnalyticsModel(
  history: readonly ScanHistoryEntry[],
  report: Report | null,
): AnalyticsModel {
  const trend = [...history]
    .sort((a, b) => a.generatedAt.localeCompare(b.generatedAt))
    .map((entry) => ({
      at: entry.generatedAt,
      total: entry.totalVulnerabilities,
      bySeverity: entry.bySeverity,
    }));
  const mix = SEVERITIES.map((severity) => ({
    severity,
    count: history.reduce((sum, entry) => sum + (entry.bySeverity[severity] ?? 0), 0),
  }));
  const overview = report === null ? null : buildOverviewModel(report);
  return {
    scanCount: history.length,
    trend,
    mix,
    meanPriorityScore: overview?.meanPriorityScore ?? null,
    unresolvedCount: overview === null ? null : overview.unresolved.length,
    latestFindings: report === null ? null : report.stats.totalVulnerabilities,
    topPackages: overview?.topPackages ?? [],
  };
}

/**
 * SVG geometry for the findings-over-time area chart, in a 100x40 viewBox.
 * Y grows downward; a single point yields just its dot, no invented slope.
 */
export function trendGeometry(trend: readonly TrendPoint[]): {
  readonly line: string;
  readonly area: string;
  readonly dots: readonly { readonly x: number; readonly y: number; readonly at: string }[];
} {
  const max = Math.max(1, ...trend.map((point) => point.total));
  const n = trend.length;
  // 4% side padding keeps edge dots unclipped; the top keeps headroom so a
  // flat max-line reads as a line, not a full-bleed block.
  const dots = trend.map((point, index) => ({
    x: n === 1 ? 50 : 4 + (index / (n - 1)) * 92,
    y: 36 - (point.total / max) * 26,
    at: point.at,
  }));
  if (dots.length < 2) {
    return { line: '', area: '', dots };
  }
  const first = dots[0];
  const last = dots[dots.length - 1];
  if (first === undefined || last === undefined) {
    return { line: '', area: '', dots };
  }
  const line = dots.map((dot) => `${dot.x.toFixed(2)},${dot.y.toFixed(2)}`).join(' ');
  const area = `M ${first.x.toFixed(2)},38 L ${dots
    .map((dot) => `${dot.x.toFixed(2)},${dot.y.toFixed(2)}`)
    .join(' L ')} L ${last.x.toFixed(2)},38 Z`;
  return { line, area, dots };
}
