import { describe, expect, it } from 'vitest';

import { rankFindings, scoreFinding, type PackageEntry, type Vulnerability } from './index.js';

function finding(overrides: Partial<Vulnerability> = {}): Vulnerability {
  return {
    id: 'CVE-2021-23337',
    findingKey: 'CVE-2021-23337|lodash@4.17.20',
    aliases: ['GHSA-35jh-r3h4-6jhm'],
    package: 'lodash',
    installedVersion: '4.17.20',
    severity: 'high',
    severityReason: 'github_rating',
    cvss: null,
    summary: 'Command Injection in lodash',
    affectedRange: '>=0 <4.17.21',
    fixedVersion: '4.17.21',
    advisoryUrl: 'https://github.com/advisories/GHSA-35jh-r3h4-6jhm',
    source: 'osv.dev',
    ...overrides,
  };
}

function entry(isDirect: boolean): PackageEntry {
  return {
    name: 'lodash',
    version: '4.17.20',
    isDirect,
    depth: isDirect ? 0 : 1,
    parents: isDirect ? [] : ['app@1.0.0'],
    isDev: false,
  };
}

describe('scoreFinding formula pins', () => {
  it('scores a critical direct finding with a fix at 95 (reachability unknown)', () => {
    const assessment = scoreFinding(finding({ severity: 'critical' }), entry(true));

    expect(assessment.priorityScore).toBe(95);
    expect(assessment.reasons).toEqual([
      'severity-critical',
      'direct-dependency',
      'fix-available',
      'reachability-unknown',
    ]);
  });

  it('scores high 45 + direct 15 + fix 15 + unknown reachability 5 = 80', () => {
    expect(scoreFinding(finding(), entry(true)).priorityScore).toBe(80);
  });

  it('scores a transitive medium without a fix at 30', () => {
    const assessment = scoreFinding(
      finding({ severity: 'medium', fixedVersion: null }),
      entry(false),
    );

    expect(assessment.priorityScore).toBe(30);
    expect(assessment.flags).toEqual({ isReachable: null, isDirect: false, hasFix: false });
    expect(assessment.reasons).toEqual(['severity-medium', 'reachability-unknown']);
  });

  it('scores low severity at 10 base', () => {
    expect(
      scoreFinding(finding({ severity: 'low', fixedVersion: null }), entry(false)).priorityScore,
    ).toBe(15);
  });

  it('never invents reachability: isReachable is null until the engine can determine it', () => {
    expect(scoreFinding(finding(), entry(true)).flags.isReachable).toBeNull();
  });

  it('keeps the score inside 0-100', () => {
    const assessment = scoreFinding(finding({ severity: 'critical' }), entry(true));
    expect(assessment.priorityScore).toBeLessThanOrEqual(100);
    expect(assessment.priorityScore).toBeGreaterThanOrEqual(0);
  });
});

describe('rankFindings', () => {
  it('writes one risk entry per finding, keyed by findingKey', () => {
    const findings = [
      finding(),
      finding({
        id: 'CVE-2020-28500',
        findingKey: 'CVE-2020-28500|lodash@4.17.20',
        severity: 'medium',
      }),
    ];

    const risk = rankFindings(findings, [entry(true)]);

    expect(risk.map((entry2) => entry2.findingKey)).toEqual([
      'CVE-2021-23337|lodash@4.17.20',
      'CVE-2020-28500|lodash@4.17.20',
    ]);
    expect(risk[0]?.priorityScore).toBe(80);
    expect(risk[1]?.priorityScore).toBe(60);
  });

  it('treats a finding whose package is not in the list as transitive', () => {
    const risk = rankFindings([finding()], []);

    expect(risk[0]?.flags.isDirect).toBe(false);
    expect(risk[0]?.priorityScore).toBe(65);
  });
});
