import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { validateReport, type Report } from '@vulnforge/core';

/** Keep the most recent 50 complete reports on this computer, never a fabricated run. */
export function createDashboardHistory(path?: string) {
  let reports: Report[] = [];
  let warning: string | null = null;
  if (path !== undefined && existsSync(path)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (!Array.isArray(parsed)) throw new Error('invalid history');
      reports = parsed.filter((r): r is Report => validateReport(r).ok).slice(0, 50);
    } catch {
      warning =
        'Saved history could not be read. New scans will remain in memory to protect the existing file.';
    }
  }
  const writable = warning === null;
  return {
    snapshot: () => ({ reports, warning, path: path ?? null }),
    add(report: Report): void {
      reports = [
        report,
        ...reports.filter(
          (r) =>
            r.meta.generatedAt !== report.meta.generatedAt ||
            r.meta.projectName !== report.meta.projectName,
        ),
      ].slice(0, 50);
      if (path === undefined || !writable) return;
      try {
        mkdirSync(dirname(path), { recursive: true });
        const temp = `${path}.${String(process.pid)}.tmp`;
        writeFileSync(temp, JSON.stringify(reports), { mode: 0o600 });
        renameSync(temp, path);
        warning = null;
      } catch {
        warning =
          'This scan is available now but could not be saved to disk. Export the report before closing the dashboard.';
      }
    },
  };
}
