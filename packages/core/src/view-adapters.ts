import { compareSeverity } from './severity.js';
import { SEVERITIES } from './types.js';
import type { Report, Severity } from './types.js';

/**
 * View adapters (G4): pure functions that turn a validated Report into exactly the
 * view models the approved screens show. Both surfaces (dashboard and TUI) consume
 * these, so a number can never diverge between them. Every value traces to report
 * fields; nothing is computed that the engine did not produce.
 */

export interface PostureHeader {
  readonly projectName: string;
  readonly ecosystem: string;
  readonly manifestPath: string;
  readonly generatedAt: string;
  readonly schemaVersion: number;
  readonly unresolvedCount: number;
}

export interface StatCard {
  /** The binding screen copy: exactly these four labels. */
  readonly label: 'Dependency Inventory' | 'Critical' | 'High' | 'Unresolved Requirements';
  readonly value: number;
}

export interface DistributionRow {
  readonly severity: Severity;
  readonly count: number;
  /** Whole-number share of total findings; the design marks these bars share-of-total. */
  readonly sharePercent: number;
  readonly isShareOfTotal: true;
}

export interface PriorityRow {
  readonly findingKey: string;
  readonly id: string;
  /** CVE alias when the advisory has one, else the primary id. Shown under its real name. */
  readonly cve: string | null;
  readonly packageName: string;
  readonly installedVersion: string;
  readonly severity: Severity;
  readonly priorityScore: number;
  readonly fixedVersion: string | null;
  readonly isDirect: boolean;
  readonly hasFix: boolean;
  /** null when reachability could not be determined; the engine never guesses. */
  readonly isReachable: boolean | null;
}

export interface TopPackageRow {
  readonly id: string;
  readonly findingCount: number;
  readonly worstSeverity: Severity;
}

export interface OverviewModel {
  readonly posture: PostureHeader;
  readonly statCards: readonly StatCard[];
  readonly distribution: readonly DistributionRow[];
  readonly priorityRows: readonly PriorityRow[];
  /** Mean of the real priority scores, shown under its real name "mean priority score". */
  readonly meanPriorityScore: number | null;
  readonly topPackages: readonly TopPackageRow[];
  readonly unresolved: readonly { readonly requirement: string; readonly reason: string }[];
}

export function buildOverviewModel(report: Report): OverviewModel {
  const posture: PostureHeader = {
    projectName: report.meta.projectName,
    ecosystem: report.meta.ecosystem,
    manifestPath: report.meta.manifestPath,
    generatedAt: report.meta.generatedAt,
    schemaVersion: report.schemaVersion,
    unresolvedCount: report.meta.unresolved.length,
  };

  const statCards: StatCard[] = [
    { label: 'Dependency Inventory', value: report.stats.totalPackages },
    { label: 'Critical', value: report.stats.bySeverity.critical },
    { label: 'High', value: report.stats.bySeverity.high },
    { label: 'Unresolved Requirements', value: report.stats.unresolvedCount },
  ];

  const total = report.stats.totalVulnerabilities;
  const distribution: DistributionRow[] = SEVERITIES.map((severity) => ({
    severity,
    count: report.stats.bySeverity[severity],
    sharePercent: total === 0 ? 0 : Math.round((report.stats.bySeverity[severity] / total) * 100),
    isShareOfTotal: true,
  }));

  const riskByKey = new Map(report.risk.map((risk) => [risk.findingKey, risk]));
  const priorityRows: PriorityRow[] = report.vulnerabilities
    .map((vulnerability) => {
      const risk = riskByKey.get(vulnerability.findingKey);
      return {
        findingKey: vulnerability.findingKey,
        id: vulnerability.id,
        cve: vulnerability.aliases.find((alias) => alias.startsWith('CVE-')) ?? null,
        packageName: vulnerability.package,
        installedVersion: vulnerability.installedVersion,
        severity: vulnerability.severity,
        priorityScore: risk?.priorityScore ?? 0,
        fixedVersion: vulnerability.fixedVersion,
        isDirect: risk?.flags.isDirect ?? false,
        hasFix: risk?.flags.hasFix ?? false,
        isReachable: risk?.flags.isReachable ?? null,
      };
    })
    .sort((left, right) => {
      if (left.priorityScore !== right.priorityScore) {
        return right.priorityScore - left.priorityScore;
      }
      const bySeverity = compareSeverity(left.severity, right.severity);
      return bySeverity !== 0 ? bySeverity : left.findingKey.localeCompare(right.findingKey);
    });

  const meanPriorityScore =
    report.risk.length === 0
      ? null
      : Math.round(
          (report.risk.reduce((sum, risk) => sum + risk.priorityScore, 0) / report.risk.length) *
            10,
        ) / 10;

  const tally = new Map<string, { count: number; worst: Severity }>();
  for (const vulnerability of report.vulnerabilities) {
    const id = `${vulnerability.package}@${vulnerability.installedVersion}`;
    const entry = tally.get(id);
    if (entry === undefined) {
      tally.set(id, { count: 1, worst: vulnerability.severity });
    } else {
      tally.set(id, {
        count: entry.count + 1,
        worst:
          compareSeverity(vulnerability.severity, entry.worst) < 0
            ? vulnerability.severity
            : entry.worst,
      });
    }
  }
  const topPackages: TopPackageRow[] = [...tally.entries()]
    .map(([id, entry]) => ({ id, findingCount: entry.count, worstSeverity: entry.worst }))
    .sort((left, right) => {
      if (left.findingCount !== right.findingCount) {
        return right.findingCount - left.findingCount;
      }
      const bySeverity = compareSeverity(left.worstSeverity, right.worstSeverity);
      return bySeverity !== 0 ? bySeverity : left.id.localeCompare(right.id);
    });

  return {
    posture,
    statCards,
    distribution,
    priorityRows,
    meanPriorityScore,
    topPackages,
    unresolved: report.meta.unresolved.map((item) => ({
      requirement: item.raw,
      reason: item.reason,
    })),
  };
}

export interface FindingRow {
  readonly findingKey: string;
  readonly id: string;
  readonly cve: string | null;
  readonly packageName: string;
  readonly installedVersion: string;
  readonly severity: Severity;
  /** The real CVSS base score when the advisory carries one; null otherwise. */
  readonly cvssScore: number | null;
  readonly priorityScore: number;
  readonly fixedVersion: string | null;
  readonly flags: {
    readonly isDirect: boolean;
    readonly hasFix: boolean;
    readonly isReachable: boolean | null;
  };
  readonly ignored: boolean;
}

export interface FindingsModel {
  readonly rows: readonly FindingRow[];
  readonly counts: Readonly<Record<Severity, number>>;
  readonly ignoredCount: number;
}

export function buildFindingsModel(report: Report): FindingsModel {
  const riskByKey = new Map(report.risk.map((risk) => [risk.findingKey, risk]));
  const ignoredKeys = new Set(report.meta.ignored.flatMap((rule) => rule.matchedFindingKeys));
  const rows: FindingRow[] = report.vulnerabilities
    .map((vulnerability) => {
      const risk = riskByKey.get(vulnerability.findingKey);
      return {
        findingKey: vulnerability.findingKey,
        id: vulnerability.id,
        cve: vulnerability.aliases.find((alias) => alias.startsWith('CVE-')) ?? null,
        packageName: vulnerability.package,
        installedVersion: vulnerability.installedVersion,
        severity: vulnerability.severity,
        cvssScore: vulnerability.cvss?.score ?? null,
        priorityScore: risk?.priorityScore ?? 0,
        fixedVersion: vulnerability.fixedVersion,
        flags: {
          isDirect: risk?.flags.isDirect ?? false,
          hasFix: risk?.flags.hasFix ?? false,
          isReachable: risk?.flags.isReachable ?? null,
        },
        ignored: ignoredKeys.has(vulnerability.findingKey),
      };
    })
    .sort((left, right) => {
      const bySeverity = compareSeverity(left.severity, right.severity);
      if (bySeverity !== 0) {
        return bySeverity;
      }
      if (left.priorityScore !== right.priorityScore) {
        return right.priorityScore - left.priorityScore;
      }
      return left.findingKey.localeCompare(right.findingKey);
    });

  return {
    rows,
    counts: report.stats.bySeverity,
    ignoredCount: report.stats.ignoredCount,
  };
}

export interface ScanHistoryEntry {
  /** Real source: 'session' for a run this process performed, 'file' for a report file on disk. */
  readonly source: 'session' | 'file';
  readonly projectName: string;
  readonly generatedAt: string;
  readonly totalVulnerabilities: number;
  readonly bySeverity: Readonly<Record<Severity, number>>;
  /** Absolute path for file entries; null for session runs. */
  readonly path: string | null;
}

/** Adapts a report file discovered in the workspace into a history row. Real data only. */
export function historyEntryFromReport(report: Report, path: string): ScanHistoryEntry {
  return {
    source: 'file',
    projectName: report.meta.projectName,
    generatedAt: report.meta.generatedAt,
    totalVulnerabilities: report.stats.totalVulnerabilities,
    bySeverity: report.stats.bySeverity,
    path,
  };
}
