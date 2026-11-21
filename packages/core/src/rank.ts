import type { PackageEntry, RiskAssessment, Vulnerability } from './types.js';
import { packageId } from './package-key.js';

/**
 * Priority scoring, fixed by this document and pinned by rank.test.ts.
 *
 * priorityScore = severity base + direct bonus + fix bonus + reachability bonus,
 * clamped to 0-100:
 *
 *   severity base    critical 60, high 45, medium 25, low 10
 *   isDirect         +15
 *   hasFix           +15
 *   isReachable      true +10, null (unknown) +5, false +0
 *
 * The maximum is 100 (critical + direct + fix + reachable). Reachability is only
 * scored when it is actually known; an unknown reachability earns a partial bonus so
 * it never outranks a proven-reachable finding of the same class, and a proven-
 * unreachable finding still keeps its severity base. The engine currently cannot
 * determine reachability, so `isReachable` is null for every finding.
 */
const SEVERITY_BASE: Readonly<Record<Vulnerability['severity'], number>> = {
  critical: 60,
  high: 45,
  medium: 25,
  low: 10,
};

const DIRECT_BONUS = 15;
const FIX_BONUS = 15;
const REACHABLE_BONUS = 10;
const REACHABILITY_UNKNOWN_BONUS = 5;

export function scoreFinding(
  vulnerability: Vulnerability,
  entry: PackageEntry | undefined,
): RiskAssessment {
  const isDirect = entry?.isDirect ?? false;
  const hasFix = vulnerability.fixedVersion !== null;
  // Reachability analysis is not implemented; the engine reports unknown, never a guess.
  const isReachable: boolean | null = null;

  let score = SEVERITY_BASE[vulnerability.severity];
  const reasons: string[] = [`severity-${vulnerability.severity}`];

  if (isDirect) {
    score += DIRECT_BONUS;
    reasons.push('direct-dependency');
  }
  if (hasFix) {
    score += FIX_BONUS;
    reasons.push('fix-available');
  }
  if (isReachable === true) {
    score += REACHABLE_BONUS;
    reasons.push('reachable');
  } else if (isReachable === null) {
    score += REACHABILITY_UNKNOWN_BONUS;
    reasons.push('reachability-unknown');
  }

  return {
    findingKey: vulnerability.findingKey,
    priorityScore: Math.min(100, score),
    flags: { isReachable, isDirect, hasFix },
    reasons,
  };
}

/**
 * One risk entry per finding, in the same deterministic order as the findings.
 * `risk: []` is only valid when priority scoring is not implemented; this function
 * always scores everything it is given.
 */
export function rankFindings(
  vulnerabilities: readonly Vulnerability[],
  packages: readonly PackageEntry[],
): readonly RiskAssessment[] {
  const byId = new Map(packages.map((entry) => [packageId(entry.name, entry.version), entry]));

  return vulnerabilities.map((vulnerability) =>
    scoreFinding(
      vulnerability,
      byId.get(packageId(vulnerability.package, vulnerability.installedVersion)),
    ),
  );
}
