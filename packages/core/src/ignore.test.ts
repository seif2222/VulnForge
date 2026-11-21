import { describe, expect, it } from 'vitest';

import {
  IgnoreFileError,
  applyIgnores,
  parseIgnoreFile,
  rulesFromFlags,
  type Vulnerability,
} from './index.js';

const TODAY = '2026-11-22';

function finding(id: string, aliases: readonly string[] = []): Vulnerability {
  return {
    id,
    findingKey: `${id}|lodash@4.17.20`,
    aliases,
    package: 'lodash',
    installedVersion: '4.17.20',
    severity: 'high',
    severityReason: 'github_rating',
    cvss: null,
    summary: `summary for ${id}`,
    affectedRange: '>=0 <4.17.21',
    fixedVersion: '4.17.21',
    advisoryUrl: null,
    source: 'osv.dev',
  };
}

describe('parseIgnoreFile', () => {
  it('parses ids, until dates and reasons', () => {
    const rules = parseIgnoreFile(
      [
        '# accepted risks',
        'CVE-2021-23337',
        'GHSA-93q8-gq69-wqmw until=2027-01-01 # upgrade scheduled',
        '',
      ].join('\n'),
    );

    expect(rules).toEqual([
      { id: 'CVE-2021-23337', source: 'file', reason: null, until: null },
      {
        id: 'GHSA-93q8-gq69-wqmw',
        source: 'file',
        reason: 'upgrade scheduled',
        until: '2027-01-01',
      },
    ]);
  });

  it('rejects a malformed until date with the line number', () => {
    expect(() => parseIgnoreFile('CVE-2021-23337\nCVE-2020-28500 until=next-week')).toThrow(
      IgnoreFileError,
    );
    try {
      parseIgnoreFile('CVE-2021-23337\nCVE-2020-28500 until=next-week');
    } catch (error) {
      expect((error as IgnoreFileError).line).toBe(2);
    }
  });

  it('rejects unknown tokens', () => {
    expect(() => parseIgnoreFile('CVE-2021-23337 later=yes')).toThrow(IgnoreFileError);
  });
});

describe('rulesFromFlags', () => {
  it('marks rules as coming from the flag source', () => {
    expect(rulesFromFlags(['CVE-2021-23337'])).toEqual([
      { id: 'CVE-2021-23337', source: 'flag', reason: null, until: null },
    ]);
  });
});

describe('applyIgnores', () => {
  it('removes matched findings and records the matched keys', () => {
    const result = applyIgnores(
      [finding('CVE-2021-23337'), finding('CVE-2020-28500')],
      [{ id: 'CVE-2021-23337', source: 'file', reason: null, until: null }],
      TODAY,
    );

    expect(result.vulnerabilities.map((entry) => entry.id)).toEqual(['CVE-2020-28500']);
    expect(result.ignored).toEqual([
      {
        id: 'CVE-2021-23337',
        source: 'file',
        reason: null,
        until: null,
        matchedFindingKeys: ['CVE-2021-23337|lodash@4.17.20'],
      },
    ]);
  });

  it('matches a rule against finding aliases too', () => {
    const result = applyIgnores(
      [finding('CVE-2021-3807', ['GHSA-93q8-gq69-wqmw'])],
      [{ id: 'GHSA-93q8-gq69-wqmw', source: 'flag', reason: null, until: null }],
      TODAY,
    );

    expect(result.vulnerabilities).toHaveLength(0);
    expect(result.ignored[0]?.matchedFindingKeys).toEqual(['CVE-2021-3807|lodash@4.17.20']);
  });

  it('drops expired rules entirely', () => {
    const result = applyIgnores(
      [finding('CVE-2021-23337')],
      [{ id: 'CVE-2021-23337', source: 'file', reason: null, until: '2026-01-01' }],
      TODAY,
    );

    expect(result.vulnerabilities).toHaveLength(1);
    expect(result.ignored).toEqual([]);
  });

  it('keeps a rule whose until date is today or in the future', () => {
    const result = applyIgnores(
      [finding('CVE-2021-23337')],
      [{ id: 'CVE-2021-23337', source: 'file', reason: null, until: TODAY }],
      TODAY,
    );

    expect(result.vulnerabilities).toHaveLength(0);
  });

  it('lists a rule that matched nothing with an empty key list, so a typo is visible', () => {
    const result = applyIgnores(
      [finding('CVE-2021-23337')],
      [{ id: 'CVE-1999-00001', source: 'file', reason: null, until: null }],
      TODAY,
    );

    expect(result.vulnerabilities).toHaveLength(1);
    expect(result.ignored).toEqual([
      {
        id: 'CVE-1999-00001',
        source: 'file',
        reason: null,
        until: null,
        matchedFindingKeys: [],
      },
    ]);
  });
});
