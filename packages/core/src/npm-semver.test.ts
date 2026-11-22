import { describe, expect, it } from 'vitest';

import { compareSemver, maxSatisfying, parseSemver, satisfiesSemver } from './npm-semver.js';

const VERSIONS = ['1.0.0', '1.2.0', '1.2.3', '1.2.10', '1.3.0-beta.1', '2.0.0', '2.1.0'];

describe('parseSemver', () => {
  it('parses plain and prerelease versions', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
    expect(parseSemver('1.2.3-beta.2')?.prerelease).toEqual(['beta', '2']);
    expect(parseSemver('v2.0.0')?.major).toBe(2);
    expect(parseSemver('not-a-version')).toBeNull();
    expect(parseSemver('1.2')).toEqual({ major: 1, minor: 2, patch: 0, prerelease: [] });
  });
});

describe('compareSemver', () => {
  it('orders numerically and puts prereleases before their release', () => {
    const cmp = (a: string, b: string): number => {
      const pa = parseSemver(a);
      const pb = parseSemver(b);
      if (pa === null || pb === null) throw new Error('bad fixture');
      return compareSemver(pa, pb);
    };
    expect(cmp('1.2.10', '1.2.3')).toBeGreaterThan(0);
    expect(cmp('1.3.0-beta.1', '1.3.0')).toBeLessThan(0);
    expect(cmp('2.0.0', '1.99.99')).toBeGreaterThan(0);
  });
});

describe('satisfiesSemver', () => {
  it('handles exact, caret, tilde and wildcard ranges', () => {
    expect(satisfiesSemver('1.2.3', '1.2.3')).toBe(true);
    expect(satisfiesSemver('1.2.4', '^1.2.3')).toBe(true);
    expect(satisfiesSemver('2.0.0', '^1.2.3')).toBe(false);
    expect(satisfiesSemver('1.2.9', '~1.2.3')).toBe(true);
    expect(satisfiesSemver('1.3.0', '~1.2.3')).toBe(false);
    expect(satisfiesSemver('9.9.9', '*')).toBe(true);
    expect(satisfiesSemver('1.5.0', '1.x')).toBe(true);
    expect(satisfiesSemver('2.0.0', '1.x')).toBe(false);
  });

  it('handles comparator sets, unions and hyphen ranges', () => {
    expect(satisfiesSemver('1.2.3', '>=1.2.0 <2.0.0')).toBe(true);
    expect(satisfiesSemver('2.0.0', '>=1.2.0 <2.0.0')).toBe(false);
    expect(satisfiesSemver('2.0.0', '^1.2.0 || >=2.0.0')).toBe(true);
    expect(satisfiesSemver('1.5.0', '1.2.3 - 2.0.0')).toBe(true);
    expect(satisfiesSemver('1.2.3', '1.2.3 - 2.0.0')).toBe(true);
  });

  it('excludes prereleases unless the range names one on the same triple', () => {
    expect(satisfiesSemver('1.3.0-beta.1', '^1.2.0')).toBe(false);
    expect(satisfiesSemver('1.3.0-beta.1', '^1.3.0-alpha.1')).toBe(true);
    expect(satisfiesSemver('1.3.0-beta.1', '1.3.0-beta.1')).toBe(true);
  });
});

describe('maxSatisfying', () => {
  it('picks the highest matching release', () => {
    expect(maxSatisfying(VERSIONS, '^1.0.0')).toBe('1.2.10');
    expect(maxSatisfying(VERSIONS, '~1.2.0')).toBe('1.2.10');
    expect(maxSatisfying(VERSIONS, '*')).toBe('2.1.0');
    expect(maxSatisfying(VERSIONS, '^3.0.0')).toBeNull();
    expect(maxSatisfying(VERSIONS, '1.3.0-beta.1')).toBe('1.3.0-beta.1');
  });
});
