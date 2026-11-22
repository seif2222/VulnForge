import { describe, expect, it } from 'vitest';

import { parseArgs } from './args.js';

describe('parseArgs', () => {
  it('parses a bare analyze with defaults', () => {
    const parsed = parseArgs(['analyze']);
    expect(parsed.kind).toBe('analyze');
    if (parsed.kind !== 'analyze') return;
    expect(parsed.flags).toEqual({
      command: 'analyze',
      path: '.',
      out: 'report.json',
      format: 'table',
      offline: false,
      cacheDir: null,
      ignoreIds: [],
      ignoreFile: null,
      ecosystem: null,
      failOn: null,
      failOnUnresolved: false,
      allowIncomplete: false,
      quiet: false,
      noColor: false,
      explain: false,
      suggest: false,
    });
  });

  it('accepts the scan alias and a path', () => {
    const parsed = parseArgs(['scan', '/tmp/project']);
    expect(parsed.kind).toBe('analyze');
    if (parsed.kind !== 'analyze') return;
    expect(parsed.flags.path).toBe('/tmp/project');
  });

  it('parses every flag, space-separated and = form', () => {
    const parsed = parseArgs([
      'analyze',
      'proj',
      '--out',
      'out.json',
      '--format=json',
      '--offline',
      '--cache-dir',
      '/cache',
      '--ignore',
      'CVE-1',
      '--ignore=CVE-2',
      '--ignore-file',
      'rules.txt',
      '--ecosystem',
      'npm',
      '--fail-on',
      'high',
      '--fail-on-unresolved',
      '--allow-incomplete',
      '--quiet',
      '--no-color',
    ]);
    expect(parsed.kind).toBe('analyze');
    if (parsed.kind !== 'analyze') return;
    expect(parsed.flags.out).toBe('out.json');
    expect(parsed.flags.format).toBe('json');
    expect(parsed.flags.offline).toBe(true);
    expect(parsed.flags.cacheDir).toBe('/cache');
    expect(parsed.flags.ignoreIds).toEqual(['CVE-1', 'CVE-2']);
    expect(parsed.flags.ignoreFile).toBe('rules.txt');
    expect(parsed.flags.ecosystem).toBe('npm');
    expect(parsed.flags.failOn).toBe('high');
    expect(parsed.flags.failOnUnresolved).toBe(true);
    expect(parsed.flags.allowIncomplete).toBe(true);
    expect(parsed.flags.quiet).toBe(true);
    expect(parsed.flags.noColor).toBe(true);
  });

  it.each([
    [['analyze', '--bogus'], 'unknown flag: --bogus'],
    [['analyze', '--out'], 'flag --out needs a value'],
    [['analyze', '--format', 'xml'], '--format must be table or json, got: xml'],
    [['analyze', '--ecosystem', 'go'], '--ecosystem must be npm or pypi, got: go'],
    [
      ['analyze', '--fail-on', 'fatal'],
      '--fail-on must be one of critical, high, medium, low, got: fatal',
    ],
    [['analyze', 'a', 'b'], 'unexpected extra argument: b'],
    [['bogus'], 'unknown command: bogus'],
  ])('rejects %j with "%s"', (argv, message) => {
    expect(parseArgs(argv)).toEqual({ kind: 'usage-error', message });
  });

  it('routes help, version, bare and planned commands', () => {
    expect(parseArgs([])).toEqual({ kind: 'bare' });
    expect(parseArgs(['help'])).toEqual({ kind: 'help' });
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseArgs(['analyze', '--help'])).toEqual({ kind: 'help' });
    expect(parseArgs(['--version'])).toEqual({ kind: 'version' });
    expect(parseArgs(['dashboard'])).toEqual({
      kind: 'dashboard',
      flags: { command: 'dashboard', reportPath: null, port: null, quiet: false },
    });
    expect(parseArgs(['ui'])).toEqual({ kind: 'planned', command: 'ui' });
  });
});
