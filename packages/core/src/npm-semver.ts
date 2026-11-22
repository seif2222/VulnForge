/**
 * The npm semver subset the engine needs to resolve manifest ranges against
 * registry metadata when a project has no lockfile. Not a general semver
 * library: caret, tilde, wildcards, comparator sets, hyphen ranges and `||`
 * unions. Anything outside the subset simply matches nothing, and the caller
 * reports the requirement as unresolved instead of guessing.
 */

export interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
}

const VERSION_PATTERN =
  /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Parses `1.2.3-rc.1`; missing minor/patch become 0 (registry versions are always full). */
export function parseSemver(text: string): Semver | null {
  const match = VERSION_PATTERN.exec(text.trim());
  if (match === null) {
    return null;
  }
  const prerelease =
    match[4] === undefined || match[4] === '' ? [] : match[4].split('.').filter((id) => id !== '');
  return {
    major: Number(match[1]),
    minor: match[2] === undefined ? 0 : Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
    prerelease,
  };
}

/** npm precedence: numeric identifiers rank below alphanumeric; a release outranks its prereleases. */
export function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const shared = Math.min(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < shared; i++) {
    const ai = a.prerelease[i] as string;
    const bi = b.prerelease[i] as string;
    const an = /^\d+$/.test(ai);
    const bn = /^\d+$/.test(bi);
    if (an && bn) {
      const diff = Number(ai) - Number(bi);
      if (diff !== 0) return diff;
    } else if (an !== bn) {
      return an ? -1 : 1;
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  return a.prerelease.length - b.prerelease.length;
}

interface Comparator {
  readonly op: '>=' | '<=' | '>' | '<' | '=';
  readonly version: Semver;
}

const NUMERIC = /^\d+$/;

/** A partial bound like `1.2` or `1` inside an explicit comparator (`>=1.2` pads with 0). */
function parsePartialBound(
  token: string,
): { version: Semver; partial: 'major' | 'minor' | 'full' } | null {
  const match = VERSION_PATTERN.exec(token.trim());
  if (match === null) {
    return null;
  }
  const partial = match[2] === undefined ? 'major' : match[3] === undefined ? 'minor' : 'full';
  return {
    version: {
      major: Number(match[1]),
      minor: match[2] === undefined ? 0 : Number(match[2]),
      patch: match[3] === undefined ? 0 : Number(match[3]),
      prerelease:
        match[4] === undefined || match[4] === ''
          ? []
          : match[4].split('.').filter((id) => id !== ''),
    },
    partial,
  };
}

function isWildcard(token: string): boolean {
  return token === '' || token === '*' || token.toLowerCase() === 'x';
}

/** Wildcard bounds: `1.2.x` -> [>=1.2.0, <1.3.0]; `1.x` / `1` -> [>=1.0.0, <2.0.0]. */
function wildcardComparators(token: string): Comparator[] | null {
  const parts = token.split('.');
  if (parts.length === 0 || !NUMERIC.test(parts[0] as string)) {
    return null;
  }
  let wildAt = -1;
  for (let i = 1; i < parts.length; i++) {
    if (isWildcard(parts[i] as string)) {
      wildAt = i;
      break;
    }
    if (!NUMERIC.test(parts[i] as string)) {
      return null;
    }
  }
  if (wildAt === -1) {
    return null;
  }
  const numbers = parts.slice(0, wildAt).map(Number);
  const lower: Semver = {
    major: numbers[0] as number,
    minor: numbers[1] ?? 0,
    patch: numbers[2] ?? 0,
    prerelease: [],
  };
  const upper: Semver =
    wildAt === 1
      ? { major: lower.major + 1, minor: 0, patch: 0, prerelease: [] }
      : { major: lower.major, minor: lower.minor + 1, patch: 0, prerelease: [] };
  return [
    { op: '>=', version: lower },
    { op: '<', version: upper },
  ];
}

function caretComparators(bound: {
  version: Semver;
  partial: 'major' | 'minor' | 'full';
}): Comparator[] {
  const { version, partial } = bound;
  const upper: Semver =
    partial === 'major'
      ? { major: version.major + 1, minor: 0, patch: 0, prerelease: [] }
      : partial === 'minor'
        ? { major: version.major, minor: version.minor + 1, patch: 0, prerelease: [] }
        : version.major > 0
          ? { major: version.major + 1, minor: 0, patch: 0, prerelease: [] }
          : version.minor > 0
            ? { major: 0, minor: version.minor + 1, patch: 0, prerelease: [] }
            : { major: 0, minor: 0, patch: version.patch + 1, prerelease: [] };
  return [
    { op: '>=', version },
    { op: '<', version: upper },
  ];
}

function tildeComparators(bound: {
  version: Semver;
  partial: 'major' | 'minor' | 'full';
}): Comparator[] {
  const { version, partial } = bound;
  const upper: Semver =
    partial === 'major'
      ? { major: version.major + 1, minor: 0, patch: 0, prerelease: [] }
      : { major: version.major, minor: version.minor + 1, patch: 0, prerelease: [] };
  return [
    { op: '>=', version },
    { op: '<', version: upper },
  ];
}

/** One `-`-separated... no: one AND-set (a single member of a `||` union). Returns null when unsupported. */
function comparatorSet(part: string): Comparator[] | null {
  const trimmed = part.trim();
  if (trimmed === '' || trimmed === '*' || trimmed.toLowerCase() === 'x') {
    return [];
  }
  // Hyphen range: `1.2.3 - 2.3.4` (full versions only in the subset).
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(trimmed);
  if (hyphen !== null) {
    const from = parsePartialBound(hyphen[1] as string);
    const to = parsePartialBound(hyphen[2] as string);
    if (from === null || to === null) {
      return null;
    }
    return [
      { op: '>=', version: from.version },
      { op: '<=', version: to.version },
    ];
  }

  const comparators: Comparator[] = [];
  for (const token of trimmed.split(/\s+/)) {
    if (isWildcard(token)) {
      continue;
    }
    if (token.includes('.')) {
      const wildcard = wildcardComparators(token);
      if (wildcard !== null) {
        comparators.push(...wildcard);
        continue;
      }
    }
    const match = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(token);
    if (match === null) {
      return null;
    }
    const op = match[1] ?? '';
    const bound = parsePartialBound(match[2] as string);
    if (bound === null) {
      return null;
    }
    if (op === '^') {
      comparators.push(...caretComparators(bound));
    } else if (op === '~') {
      comparators.push(...tildeComparators(bound));
    } else if (op === '') {
      // A bare full version is exact; a bare partial is a wildcard (`1.2` == `1.2.x`).
      if (bound.partial === 'full') {
        comparators.push({ op: '=', version: bound.version });
      } else {
        const wild = wildcardComparators(`${match[2]}.x`);
        if (wild === null) {
          return null;
        }
        comparators.push(...wild);
      }
    } else {
      comparators.push({ op: op as Comparator['op'], version: bound.version });
    }
  }
  return comparators;
}

function meets(version: Semver, comparator: Comparator): boolean {
  const diff = compareSemver(version, comparator.version);
  switch (comparator.op) {
    case '>=':
      return diff >= 0;
    case '<=':
      return diff <= 0;
    case '>':
      return diff > 0;
    case '<':
      return diff < 0;
    case '=':
      return diff === 0;
  }
}

/** True when the range uses syntax outside the supported subset. */
export function isSupportedRange(range: string): boolean {
  return range.split('||').every((part) => comparatorSet(part) !== null);
}

export function satisfiesSemver(versionText: string, range: string): boolean {
  const version = parseSemver(versionText);
  if (version === null) {
    return false;
  }
  return range.split('||').some((part) => {
    const set = comparatorSet(part);
    if (set === null) {
      return false;
    }
    // A prerelease only enters a set whose own bound carries a prerelease.
    if (version.prerelease.length > 0 && !set.some((c) => c.version.prerelease.length > 0)) {
      return false;
    }
    return set.every((comparator) => meets(version, comparator));
  });
}

/** The highest version satisfying the range; prereleases only when nothing stable qualifies. */
export function maxSatisfying(versions: readonly string[], range: string): string | null {
  const parsed = versions
    .map((text) => ({ text, version: parseSemver(text) }))
    .filter((entry): entry is { text: string; version: Semver } => entry.version !== null);
  const matching = parsed.filter((entry) => satisfiesSemver(entry.text, range));
  const stable = matching.filter((entry) => entry.version.prerelease.length === 0);
  const pool = stable.length > 0 ? stable : matching;
  if (pool.length === 0) {
    return null;
  }
  return pool.reduce((best, entry) =>
    compareSemver(entry.version, best.version) > 0 ? entry : best,
  ).text;
}
