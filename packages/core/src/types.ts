export const CORE_PACKAGE_NAME = '@vulnforge/core';

export const TOOL_NAME = 'vulnforge';

/** Schema version of the report contract. Bump on every additive change. */
export const REPORT_SCHEMA_VERSION = 6;

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

export type Severity = (typeof SEVERITIES)[number];

export const ECOSYSTEMS = ['npm', 'pypi'] as const;

export type Ecosystem = (typeof ECOSYSTEMS)[number];

export const UNRESOLVED_REASONS = [
  'not-pinned',
  'wildcard-pin',
  'multiple-pins',
  'url-reference',
  'editable',
  'include-directive',
  'option-line',
] as const;

export type UnresolvedReason = (typeof UNRESOLVED_REASONS)[number];

/** Why an advisory could not be turned into a finding. */
export const INCOMPLETE_REASONS = [
  'no-canonical-id',
  'osv-not-queried-offline',
  'osv-error',
] as const;

export type IncompleteReason = (typeof INCOMPLETE_REASONS)[number];

/**
 * A requirement that could not be resolved to an exact installed version, so it could
 * not be checked. A report with any of these has not fully scanned the project and must
 * never be presented as clean.
 */
export interface UnresolvedRequirement {
  readonly raw: string;
  /** Empty when the line declares no package, e.g. `--index-url https://example.com`. */
  readonly name: string;
  readonly specifier: string;
  /** 1-based line number in the manifest. */
  readonly line: number;
  readonly reason: UnresolvedReason;
}

/**
 * An advisory osv.dev returned that the engine could not identify or use, or a package
 * whose query never completed (offline gap, osv.dev failure). Never silently dropped.
 */
export interface IncompleteAdvisory {
  /** The record id when osv.dev gave one, null when nothing identifiable arrived. */
  readonly advisoryId: string | null;
  /** `name@version` of the installed package the record or gap belongs to. */
  readonly package: string;
  readonly reason: IncompleteReason;
}

/** Where an ignore rule came from. */
export const IGNORE_SOURCES = ['file', 'flag'] as const;

export type IgnoreSource = (typeof IGNORE_SOURCES)[number];

/**
 * A finding suppressed by `.depscanignore` or `--ignore`. Counted and listed, never
 * silently dropped. `matchedFindingKeys` is empty when the rule matched nothing.
 */
export interface IgnoredFinding {
  /** The id the rule names: a CVE, GHSA or alias of the finding. */
  readonly id: string;
  readonly source: IgnoreSource;
  readonly reason: string | null;
  /** Expiry date (YYYY-MM-DD). An expired rule ignores nothing. */
  readonly until: string | null;
  readonly matchedFindingKeys: readonly string[];
}

export interface ToolInfo {
  readonly name: typeof TOOL_NAME;
  readonly version: string;
}

export interface ReportMeta {
  readonly tool: ToolInfo;
  readonly generatedAt: string;
  readonly projectName: string;
  readonly ecosystem: Ecosystem;
  readonly manifestPath: string;
  /** Requirements that were never checked. Non-empty means the scan is not complete. */
  readonly unresolved: readonly UnresolvedRequirement[];
  /** Advisories or query gaps the engine could not use. */
  readonly incomplete: readonly IncompleteAdvisory[];
  /** Findings suppressed by ignore rules. */
  readonly ignored: readonly IgnoredFinding[];
  /** Recoverable problems reported by the parsers. */
  readonly warnings: readonly string[];
}

export interface PackageEntry {
  readonly name: string;
  readonly version: string;
  readonly isDirect: boolean;
  readonly depth: number;
  /** Each entry is `name@version` of an installed package that requires this one. */
  readonly parents: readonly string[];
  /** null when the ecosystem has no dev/prod distinction, such as PyPI. */
  readonly isDev: boolean | null;
}

export interface CvssScore {
  readonly score: number;
  readonly vector: string;
}

export interface Vulnerability {
  readonly id: string;
  /**
   * Stable identity of the finding: `<id>|<package>@<installedVersion>`. Risk entries,
   * suggestions, explanations and ignore rules reference this key.
   */
  readonly findingKey: string;
  readonly aliases: readonly string[];
  readonly package: string;
  readonly installedVersion: string;
  readonly severity: Severity;
  /** Why this severity was chosen; never an invented score. */
  readonly severityReason: SeverityReason;
  readonly cvss: CvssScore | null;
  readonly summary: string;
  readonly affectedRange: string;
  readonly fixedVersion: string | null;
  readonly advisoryUrl: string | null;
  readonly source: string;
}

/** Why a severity was chosen. Mirrors decideSeverity in severity-map.ts. */
export type SeverityReason = 'github_rating' | 'cvss_base_score' | 'severity_unknown';

export interface RiskAssessment {
  readonly findingKey: string;
  /** 0-100, from the documented formula in rank.ts. */
  readonly priorityScore: number;
  readonly flags: RiskFlags;
  /** Machine-readable reason codes, e.g. `direct-dependency`, `fix-available`. */
  readonly reasons: readonly string[];
}

export interface RiskFlags {
  /** null when reachability cannot be determined; the engine never guesses. */
  readonly isReachable: boolean | null;
  readonly isDirect: boolean;
  readonly hasFix: boolean;
}

export interface Suggestion {
  readonly findingKey: string;
  readonly saferVersion: string | null;
  readonly alternativePackage: string | null;
  readonly rationale: string;
  /** Provenance marker. The AI layer may only write suggestions with this value. */
  readonly provider: 'llm';
}

/**
 * A natural-language explanation of one finding, produced by the optional AI step
 * (Forge). Standalone on purpose: never part of `Report`, so explanations can be
 * regenerated without touching findings.
 */
export interface AiExplanation {
  readonly findingKey: string;
  readonly explanation: string;
  readonly remediation: string;
  readonly provider: 'llm';
  readonly generatedAt: string;
}

export interface ReportStats {
  readonly totalPackages: number;
  readonly directPackages: number;
  readonly transitivePackages: number;
  readonly totalVulnerabilities: number;
  readonly bySeverity: Readonly<Record<Severity, number>>;
  /** How many requirements could not be checked. Mirrors `meta.unresolved.length`. */
  readonly unresolvedCount: number;
  /** How many findings were suppressed by ignore rules. Mirrors matched rules. */
  readonly ignoredCount: number;
}

export interface Report {
  readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
  readonly meta: ReportMeta;
  readonly packages: readonly PackageEntry[];
  readonly vulnerabilities: readonly Vulnerability[];
  readonly risk: readonly RiskAssessment[];
  readonly suggestions: readonly Suggestion[];
  readonly stats: ReportStats;
}
