import type { PackageEntry, ReportStats, Severity, Vulnerability } from './types.js';

export function emptySeverityCounts(): Record<Severity, number> {
  return { critical: 0, high: 0, medium: 0, low: 0 };
}

export function countBySeverity(
  items: readonly Pick<Vulnerability, 'severity'>[],
): Record<Severity, number> {
  const counts = emptySeverityCounts();
  for (const item of items) {
    counts[item.severity] += 1;
  }
  return counts;
}

/**
 * Derives every stats field from the report contents. `unresolvedCount` and
 * `ignoredCount` come from the caller because they mirror `meta.unresolved` and the
 * matched ignore rules, which are not part of the stats input.
 */
export function computeStats(
  packages: readonly PackageEntry[],
  vulnerabilities: readonly Vulnerability[],
  unresolvedCount = 0,
  ignoredCount = 0,
): ReportStats {
  const directPackages = packages.filter((entry) => entry.isDirect).length;

  return {
    totalPackages: packages.length,
    directPackages,
    transitivePackages: packages.length - directPackages,
    totalVulnerabilities: vulnerabilities.length,
    bySeverity: countBySeverity(vulnerabilities),
    unresolvedCount,
    ignoredCount,
  };
}
