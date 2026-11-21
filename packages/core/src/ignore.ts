import type { IgnoredFinding, IgnoreSource, Vulnerability } from './types.js';

/**
 * `.depscanignore` format — one rule per line:
 *
 *   CVE-2021-23337
 *   GHSA-93q8-gq69-wqmw until=2027-01-01
 *   CVE-2020-28500 until=2026-12-31 # accepted risk, upgrade scheduled
 *
 * Blank lines and lines starting with `#` are skipped. A trailing `# ...` comment is
 * the rule's reason. `until=` takes a YYYY-MM-DD date; an expired rule ignores nothing.
 */
export interface IgnoreRule {
  readonly id: string;
  readonly source: IgnoreSource;
  readonly reason: string | null;
  readonly until: string | null;
}

const UNTIL_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export class IgnoreFileError extends Error {
  readonly line: number;

  constructor(line: number, message: string) {
    super(message);
    this.name = 'IgnoreFileError';
    this.line = line;
  }
}

/** Parses the contents of an ignore file. Throws IgnoreFileError on a malformed line. */
export function parseIgnoreFile(
  text: string,
  source: IgnoreSource = 'file',
): readonly IgnoreRule[] {
  const rules: IgnoreRule[] = [];

  for (const [index, rawLine] of text.split('\n').entries()) {
    const line = index + 1;
    const trimmed = rawLine.trim();

    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }

    const [beforeComment, ...commentParts] = trimmed.split('#');
    const reason = commentParts.length > 0 ? commentParts.join('#').trim() || null : null;
    const tokens = (beforeComment ?? '').trim().split(/\s+/u).filter(Boolean);
    const id = tokens[0];

    if (id === undefined) {
      throw new IgnoreFileError(line, 'expected an advisory id');
    }

    let until: string | null = null;
    for (const token of tokens.slice(1)) {
      if (!token.startsWith('until=')) {
        throw new IgnoreFileError(line, `unknown token "${token}"`);
      }
      const value = token.slice('until='.length);
      if (!UNTIL_PATTERN.test(value)) {
        throw new IgnoreFileError(line, `until= expects YYYY-MM-DD, got "${value}"`);
      }
      until = value;
    }

    rules.push({ id, source, reason, until });
  }

  return rules;
}

/** Rules for `--ignore <id>` flags; flags accept the same `id` only, no until. */
export function rulesFromFlags(ids: readonly string[]): readonly IgnoreRule[] {
  return ids.map((id) => ({ id, source: 'flag' as const, reason: null, until: null }));
}

function isExpired(rule: IgnoreRule, today: string): boolean {
  return rule.until !== null && rule.until < today;
}

function ruleMatches(rule: IgnoreRule, vulnerability: Vulnerability): boolean {
  return vulnerability.id === rule.id || vulnerability.aliases.includes(rule.id);
}

export interface IgnoreResult {
  readonly vulnerabilities: readonly Vulnerability[];
  readonly ignored: readonly IgnoredFinding[];
}

/**
 * Applies ignore rules to the findings. Ignored findings leave the vulnerabilities
 * array and are listed, with the finding keys they matched, in `ignored`. A rule that
 * matches nothing is still listed with an empty `matchedFindingKeys`, so a typo is
 * visible instead of silent. Expired rules are dropped entirely.
 */
export function applyIgnores(
  vulnerabilities: readonly Vulnerability[],
  rules: readonly IgnoreRule[],
  /** Today's date as YYYY-MM-DD, injected so the engine stays deterministic. */
  today: string,
): IgnoreResult {
  const active = rules.filter((rule) => !isExpired(rule, today));
  const removed = new Set<string>();
  const ignored: IgnoredFinding[] = [];

  for (const rule of active) {
    const matched = vulnerabilities
      .filter((vulnerability) => ruleMatches(rule, vulnerability))
      .map((vulnerability) => vulnerability.findingKey);

    for (const key of matched) {
      removed.add(key);
    }

    ignored.push({
      id: rule.id,
      source: rule.source,
      reason: rule.reason,
      until: rule.until,
      matchedFindingKeys: [...new Set(matched)].sort(),
    });
  }

  return {
    vulnerabilities: vulnerabilities.filter(
      (vulnerability) => !removed.has(vulnerability.findingKey),
    ),
    ignored,
  };
}
