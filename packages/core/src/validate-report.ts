import { isDeepEqual, validateJsonSchema, type ValidationIssue } from './json-schema.js';
import { packageId } from './package-key.js';
import { REPORT_SCHEMA } from './report-schema.js';
import { computeStats } from './stats.js';
import type { Report } from './types.js';

export type ReportValidationResult =
  | { readonly ok: true; readonly report: Report }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

function uniqueDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated: string[] = [];

  for (const value of values) {
    if (seen.has(value) && !repeated.includes(value)) {
      repeated.push(value);
    }
    seen.add(value);
  }

  return repeated;
}

/**
 * Invariants that JSON Schema cannot express: cross-references between sections and
 * internal consistency of the derived stats. Findings are referenced by `findingKey`,
 * so one package with two CVEs is two referenceable rows.
 */
function validateSemantics(report: Report): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const packageIds = report.packages.map((entry) => packageId(entry.name, entry.version));
  const knownPackageIds = new Set(packageIds);

  for (const duplicate of uniqueDuplicates(packageIds)) {
    issues.push({ path: '/packages', message: `contains duplicate package "${duplicate}"` });
  }

  report.packages.forEach((entry, index) => {
    if (entry.isDirect !== (entry.depth === 0)) {
      issues.push({
        path: `/packages/${index}`,
        message: 'isDirect must be true exactly when depth is 0',
      });
    }
    for (const [position, parentId] of entry.parents.entries()) {
      if (!knownPackageIds.has(parentId)) {
        issues.push({
          path: `/packages/${index}/parents/${position}`,
          message: `references unknown package "${parentId}"`,
        });
      }
    }
  });

  const findingKeys = report.vulnerabilities.map((entry) => entry.findingKey);
  const knownFindingKeys = new Set(findingKeys);

  for (const duplicate of uniqueDuplicates(findingKeys)) {
    issues.push({
      path: '/vulnerabilities',
      message: `contains duplicate finding key "${duplicate}"`,
    });
  }

  report.vulnerabilities.forEach((entry, index) => {
    const expectedKey = `${entry.id}|${packageId(entry.package, entry.installedVersion)}`;
    if (entry.findingKey !== expectedKey) {
      issues.push({
        path: `/vulnerabilities/${index}/findingKey`,
        message: `must be "${expectedKey}"`,
      });
    }
    const installed = packageId(entry.package, entry.installedVersion);
    if (!knownPackageIds.has(installed)) {
      issues.push({
        path: `/vulnerabilities/${index}`,
        message: `references package "${installed}" which is not in the package list`,
      });
    }
  });

  const riskKeys = report.risk.map((entry) => entry.findingKey);

  for (const duplicate of uniqueDuplicates(riskKeys)) {
    issues.push({ path: '/risk', message: `contains duplicate entry for "${duplicate}"` });
  }
  for (const key of riskKeys) {
    if (!knownFindingKeys.has(key)) {
      issues.push({ path: '/risk', message: `references unknown finding "${key}"` });
    }
  }
  // Coverage is only required once a report claims to be scored. `risk: []` means
  // priority scoring is not implemented; a partial risk section would silently drop
  // findings, so that is rejected.
  if (riskKeys.length > 0) {
    for (const key of knownFindingKeys) {
      if (!riskKeys.includes(key)) {
        issues.push({ path: '/risk', message: `is missing an entry for "${key}"` });
      }
    }
  }

  const suggestedKeys = report.suggestions.map((entry) => entry.findingKey);

  for (const duplicate of uniqueDuplicates(suggestedKeys)) {
    issues.push({
      path: '/suggestions',
      message: `contains duplicate entry for "${duplicate}"`,
    });
  }
  for (const key of suggestedKeys) {
    if (!knownFindingKeys.has(key)) {
      issues.push({ path: '/suggestions', message: `references unknown finding "${key}"` });
    }
  }

  const matchedIgnoredKeys = report.meta.ignored.flatMap((entry) => entry.matchedFindingKeys);
  for (const key of matchedIgnoredKeys) {
    if (knownFindingKeys.has(key)) {
      issues.push({
        path: '/meta/ignored',
        message: `claims to ignore "${key}" but that finding is still in the report`,
      });
    }
  }

  const ignoredCount = matchedIgnoredKeys.length;
  const expectedStats = computeStats(
    report.packages,
    report.vulnerabilities,
    report.meta.unresolved.length,
    ignoredCount,
  );
  if (!isDeepEqual(expectedStats, report.stats)) {
    issues.push({
      path: '/stats',
      message: `must match the report contents, expected ${JSON.stringify(expectedStats)}`,
    });
  }

  if (report.meta.unresolved.length > 0 && report.vulnerabilities.length === 0) {
    issues.push({
      path: '/meta/unresolved',
      message:
        'must not sit next to an empty vulnerabilities array: a scan with unresolved ' +
        'requirements has not checked everything and cannot be reported as clean',
    });
  }

  return issues;
}

/** Validates an unknown value against the report schema and the report invariants. */
export function validateReport(input: unknown): ReportValidationResult {
  const schemaIssues = validateJsonSchema(input, REPORT_SCHEMA);
  if (schemaIssues.length > 0) {
    return { ok: false, issues: schemaIssues };
  }

  const semanticIssues = validateSemantics(input as Report);
  if (semanticIssues.length > 0) {
    return { ok: false, issues: semanticIssues };
  }

  return { ok: true, report: input as Report };
}

export function isReport(input: unknown): input is Report {
  return validateReport(input).ok;
}
