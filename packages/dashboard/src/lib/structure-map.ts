import type { StructureEntryPayload } from './api.js';
import type { Report, Severity } from './core.js';

const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low'];

/**
 * Strips the version from a progress-event package identity:
 * "lodash@4.17.20" -> "lodash", "@scope/name@1.0.0" -> "@scope/name".
 */
export function packageName(pkg: string): string {
  const at = pkg.lastIndexOf('@');
  return at > 0 ? pkg.slice(0, at) : pkg;
}

/**
 * The structure row a package maps to: its real installed directory when the
 * listing contains node_modules/<name>, else the root manifest/lockfile row
 * (where the requirement is declared), else -1 for "no honest row".
 */
export function rowForPackage(entries: readonly StructureEntryPayload[], pkg: string): number {
  const name = packageName(pkg);
  const installed = entries.findIndex((entry) => entry.path === `node_modules/${name}`);
  if (installed !== -1) {
    return installed;
  }
  const manifest = entries.findIndex(
    (entry) =>
      entry.depth === 0 &&
      (entry.name === 'package.json' ||
        entry.name === 'pnpm-lock.yaml' ||
        entry.name === 'package-lock.json' ||
        entry.name === 'yarn.lock' ||
        entry.name === 'requirements.txt' ||
        entry.name === 'pyproject.toml'),
  );
  return manifest;
}

/**
 * Rows carrying findings after a scan, mapped to the worst severity at that
 * row. Same matching rule as the live progress marker, so a finding lights
 * exactly the row Forge visited.
 */
export function findingRows(
  entries: readonly StructureEntryPayload[],
  report: Report,
): ReadonlyMap<number, Severity> {
  const rows = new Map<number, Severity>();
  for (const vulnerability of report.vulnerabilities) {
    const index = rowForPackage(
      entries,
      `${vulnerability.package}@${vulnerability.installedVersion}`,
    );
    if (index === -1) {
      continue;
    }
    const current = rows.get(index);
    if (
      current === undefined ||
      SEVERITIES.indexOf(vulnerability.severity) < SEVERITIES.indexOf(current)
    ) {
      rows.set(index, vulnerability.severity);
    }
  }
  return rows;
}
