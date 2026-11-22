import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ProjectParseError } from './errors.js';
import { hasPnpmLockfile, parsePnpm, stripPeerSuffix } from './pnpm-parse.js';

let dir = '';

function tempProject(files: Readonly<Record<string, string>>): string {
  dir = mkdtempSync(join(tmpdir(), 'vulnforge-pnpm-test-'));
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

afterEach(() => {
  if (dir !== '') {
    rmSync(dir, { recursive: true, force: true });
    dir = '';
  }
});

const MANIFEST = JSON.stringify({
  name: 'pnpm-app',
  version: '1.0.0',
  dependencies: { leftpad: '^1.0.0' },
  devDependencies: { tape: '^5.0.0' },
});

const LOCKFILE = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

importers:

  .:
    dependencies:
      leftpad:
        specifier: ^1.0.0
        version: 1.0.0
    devDependencies:
      tape:
        specifier: ^5.0.0
        version: 5.9.0(leftpad@1.0.0)

  tools:
    dependencies:
      helper:
        specifier: ^2.0.0
        version: 2.0.0

packages:

  'leftpad@1.0.0':
    resolution: {integrity: sha512-AAA==}
    cpu: [x64, arm64]

  'rightpad@2.1.0':
    resolution: {integrity: sha512-BBB==}

  'tape@5.9.0':
    resolution: {integrity: sha512-CCC==}

  'helper@2.0.0':
    resolution: {integrity: sha512-DDD==}

  'stray@9.9.9':
    resolution: {integrity: sha512-EEE==}

snapshots:

  'leftpad@1.0.0':
    dependencies:
      rightpad: 2.1.0

  'rightpad@2.1.0': {}

  'tape@5.9.0(leftpad@1.0.0)':
    dependencies:
      leftpad: 1.0.0

  'helper@2.0.0': {}

  'stray@9.9.9': {}
`;

describe('parsePnpm', () => {
  it('reads the full dependency tree from a v9 lockfile', () => {
    const project = parsePnpm(
      tempProject({
        'package.json': MANIFEST,
        'pnpm-lock.yaml': LOCKFILE,
        'tools/package.json': JSON.stringify({ name: 'tools', version: '1.0.0' }),
      }),
    );

    const ids = project.packages.map((entry) => `${entry.name}@${entry.version}`).sort();
    expect(ids).toEqual(['helper@2.0.0', 'leftpad@1.0.0', 'rightpad@2.1.0', 'tape@5.9.0']);
    expect(project.unresolved).toEqual([]);

    const leftpad = project.packages.find((entry) => entry.name === 'leftpad');
    expect(leftpad).toMatchObject({ isDirect: true, depth: 0, isDev: false });
    expect(leftpad?.parents).toContain('tape@5.9.0');

    const rightpad = project.packages.find((entry) => entry.name === 'rightpad');
    expect(rightpad).toMatchObject({
      isDirect: false,
      depth: 1,
      isDev: false,
      parents: ['leftpad@1.0.0'],
    });

    const tape = project.packages.find((entry) => entry.name === 'tape');
    expect(tape).toMatchObject({ isDirect: true, depth: 0, isDev: true });
  });

  it('names locked packages nothing uses as orphans', () => {
    const project = parsePnpm(
      tempProject({
        'package.json': MANIFEST,
        'pnpm-lock.yaml': LOCKFILE,
        'tools/package.json': JSON.stringify({ name: 'tools', version: '1.0.0' }),
      }),
    );
    expect(project.orphans).toEqual(['stray@9.9.9']);
  });

  it('scans every workspace importer and keeps per-package provenance', () => {
    const project = parsePnpm(
      tempProject({
        'package.json': MANIFEST,
        'pnpm-lock.yaml': LOCKFILE,
        'tools/package.json': JSON.stringify({ name: 'tools', version: '1.0.0' }),
      }),
    );
    expect(project.workspace?.scannedManifests).toEqual(['.', 'tools']);
    expect(project.workspace?.directOrigins['helper@2.0.0']).toEqual(['tools']);
    expect(project.workspace?.directOrigins['leftpad@1.0.0']).toEqual(['.']);
    const helper = project.packages.find((entry) => entry.name === 'helper');
    expect(helper).toMatchObject({ isDirect: true, depth: 0 });
    expect(project.warnings).toContain('workspace scan: 2 manifests scanned (., tools)');
  });

  it('leaves workspace unset for a single-manifest project', () => {
    const single = LOCKFILE.replace(
      `
  tools:
    dependencies:
      helper:
        specifier: ^2.0.0
        version: 2.0.0
`,
      '',
    );
    const project = parsePnpm(tempProject({ 'package.json': MANIFEST, 'pnpm-lock.yaml': single }));
    expect(project.workspace).toBeUndefined();
    expect(project.orphans).toContain('helper@2.0.0');
  });

  it('skips workspace links with a named warning', () => {
    const withLink = LOCKFILE.replace(
      '      leftpad:\n        specifier: ^1.0.0\n        version: 1.0.0',
      '      leftpad:\n        specifier: ^1.0.0\n        version: 1.0.0\n      local-lib:\n        specifier: workspace:*\n        version: link:../local-lib',
    );
    const project = parsePnpm(
      tempProject({ 'package.json': MANIFEST, 'pnpm-lock.yaml': withLink }),
    );
    expect(project.packages.find((entry) => entry.name === 'local-lib')).toBeUndefined();
    expect(
      project.warnings.some(
        (line) => line.includes('local-lib') && line.includes('scanned via its own manifest'),
      ),
    ).toBe(true);
  });

  it('warns when the manifest declares a dependency the lockfile does not have', () => {
    const manifest = JSON.stringify({
      name: 'pnpm-app',
      version: '1.0.0',
      dependencies: { leftpad: '^1.0.0', ghost: '^1.0.0' },
      devDependencies: { tape: '^5.0.0' },
    });
    const project = parsePnpm(
      tempProject({ 'package.json': manifest, 'pnpm-lock.yaml': LOCKFILE }),
    );
    expect(project.warnings).toContain(
      'manifest dependency "ghost" of "." is not in the pnpm lockfile',
    );
  });

  it('rejects unsupported lockfile versions honestly', () => {
    const older = LOCKFILE.replace("lockfileVersion: '9.0'", "lockfileVersion: '5.4'");
    expect(() =>
      parsePnpm(tempProject({ 'package.json': MANIFEST, 'pnpm-lock.yaml': older })),
    ).toThrowError(ProjectParseError);
  });

  it('rejects YAML outside the subset instead of misparsing it', () => {
    const anchored = `${LOCKFILE}\nanchored: &x 1\nalias: *x\n`;
    expect(() =>
      parsePnpm(tempProject({ 'package.json': MANIFEST, 'pnpm-lock.yaml': anchored })),
    ).toThrowError(/outside the subset/);
  });
});

describe('stripPeerSuffix', () => {
  it('strips single and chained peer suffixes', () => {
    expect(stripPeerSuffix('10.0.1(eslint@10.12.0)')).toBe('10.0.1');
    expect(stripPeerSuffix('5.0.3(a@1.0.0)(b@2.0.0(a@1.0.0))')).toBe('5.0.3');
    expect(stripPeerSuffix('1.2.3')).toBe('1.2.3');
  });
});

describe('hasPnpmLockfile', () => {
  it('detects the lockfile', () => {
    expect(hasPnpmLockfile(tempProject({ 'package.json': MANIFEST }))).toBe(false);
    expect(hasPnpmLockfile(tempProject({ 'pnpm-lock.yaml': LOCKFILE }))).toBe(true);
  });
});
