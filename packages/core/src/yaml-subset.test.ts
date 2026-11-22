import { describe, expect, it } from 'vitest';

import { parseYamlSubset } from './yaml-subset.js';

describe('parseYamlSubset', () => {
  it('parses nested block maps with quoted and plain scalars', () => {
    const doc = parseYamlSubset(
      ['root:', "  'quoted key': plain value", '  nested:', '    deep: 1.2.3', '  empty:'].join(
        '\n',
      ),
    ) as Record<string, unknown>;
    const root = doc['root'] as Record<string, unknown>;
    expect(root['quoted key']).toBe('plain value');
    expect((root['nested'] as Record<string, unknown>)['deep']).toBe('1.2.3');
    expect(root['empty']).toBeNull();
  });

  it('parses single-line flow maps and flow sequences', () => {
    const doc = parseYamlSubset(
      ['pkg:', '  resolution: {integrity: sha512-AAA==}', '  cpu: [arm, x64]', '  os: []'].join(
        '\n',
      ),
    ) as Record<string, unknown>;
    const pkg = doc['pkg'] as Record<string, unknown>;
    expect(pkg['resolution']).toEqual({ integrity: 'sha512-AAA==' });
    expect(pkg['cpu']).toEqual(['arm', 'x64']);
    expect(pkg['os']).toEqual([]);
  });

  it('parses scalar sequences', () => {
    const doc = parseYamlSubset(['peers:', '  - supports-color', '  - debug'].join('\n')) as Record<
      string,
      unknown
    >;
    expect(doc['peers']).toEqual(['supports-color', 'debug']);
  });

  it('unescapes single quotes and handles values containing colons', () => {
    const doc = parseYamlSubset(
      ["a: 'it''s'", 'b: {tarball: https://example.com/x.tgz}'].join('\n'),
    ) as Record<string, unknown>;
    expect(doc['a']).toBe("it's");
    expect(doc['b']).toEqual({ tarball: 'https://example.com/x.tgz' });
  });

  it('skips blank lines and full-line comments', () => {
    const doc = parseYamlSubset(['# comment', '', 'a: 1', '', '# another'].join('\n'));
    expect(doc).toEqual({ a: '1' });
  });

  it('rejects anchors, aliases, tags and block scalars honestly', () => {
    expect(() => parseYamlSubset('a: &x 1')).toThrowError(/outside the subset/);
    expect(() => parseYamlSubset('a: *x')).toThrowError(/outside the subset/);
    expect(() => parseYamlSubset('a: !tag 1')).toThrowError(/outside the subset/);
    expect(() => parseYamlSubset('a: |')).toThrowError(/outside the subset/);
  });

  it('rejects inconsistent indentation and tabs', () => {
    expect(() => parseYamlSubset('a:\n   b: 1\n  c: 2')).toThrowError(/indentation|document end/);
    expect(() => parseYamlSubset('\ta: 1')).toThrowError(/tab/);
  });
});
