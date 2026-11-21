import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { validateReport, type OsvHttp, type Report } from '@vulnforge/core';

import { EXIT_CODES } from './exit-codes.js';
import { runCli, type CliDeps } from './run.js';
import {
  FIXTURE_PROJECTS,
  captureIo,
  loadOsvRecordings,
  recordingHttp,
  seededMemoryCache,
} from './test-helpers.js';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vulnforge-cli-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fixtureDeps(): CliDeps {
  const recordings = loadOsvRecordings();
  return {
    http: recordingHttp(recordings),
    cache: seededMemoryCache(recordings),
    clock: () => new Date('2026-10-08T12:00:00Z'),
    pid: 4242,
  };
}

async function run(argv: readonly string[], cwd: string, deps: CliDeps = fixtureDeps()) {
  const captured = captureIo({ cwd });
  const code = await runCli(argv, captured.io, deps);
  return { code, stdout: captured.stdout(), stderr: captured.stderr() };
}

describe('runCli analyze against fixture projects', () => {
  it('scans vulnerable-npm: table on stdout, report file written, exit 0', async () => {
    const cwd = tempDir();
    const { code, stdout, stderr } = await run(
      ['analyze', join(FIXTURE_PROJECTS, 'vulnerable-npm')],
      cwd,
    );

    expect(code).toBe(EXIT_CODES.success);
    expect(stdout).toContain('vulnforge scan report - vulnerable-npm');
    expect(stdout).toContain('CVE-2021-44906');
    expect(stdout).toContain('10 findings (1 critical, 4 high, 5 medium) · top score 95');
    expect(stderr).toContain('wrote report:');

    const written = JSON.parse(readFileSync(join(cwd, 'report.json'), 'utf8')) as unknown;
    expect(validateReport(written).ok).toBe(true);
  });

  it('json format: stdout is exactly the report, byte-identical to the file', async () => {
    const cwd = tempDir();
    const { code, stdout } = await run(
      ['analyze', join(FIXTURE_PROJECTS, 'vulnerable-npm'), '--format', 'json'],
      cwd,
    );

    expect(code).toBe(EXIT_CODES.success);
    const fromStdout = JSON.parse(stdout) as Report;
    const fromFile = JSON.parse(readFileSync(join(cwd, 'report.json'), 'utf8')) as Report;
    expect(fromStdout).toEqual(fromFile);
    expect(fromStdout.meta.tool.name).toBe('vulnforge');
    expect(fromStdout.meta.tool.version).toBe('0.0.0-test');
  });

  it('table and json carry the same findings (parity)', async () => {
    const cwdTable = tempDir();
    const cwdJson = tempDir();
    const tableRun = await run(['analyze', join(FIXTURE_PROJECTS, 'vulnerable-npm')], cwdTable);
    const jsonRun = await run(
      ['analyze', join(FIXTURE_PROJECTS, 'vulnerable-npm'), '--format=json'],
      cwdJson,
    );

    const report = JSON.parse(jsonRun.stdout) as Report;
    for (const finding of report.vulnerabilities) {
      expect(tableRun.stdout).toContain(finding.id);
      expect(tableRun.stdout).toContain(finding.package);
      expect(tableRun.stdout).toContain(finding.installedVersion);
    }
    expect(tableRun.code).toBe(jsonRun.code);
  });

  it('json output is stable: two runs produce identical bytes', async () => {
    const a = await run(
      ['analyze', join(FIXTURE_PROJECTS, 'vulnerable-npm'), '--format=json'],
      tempDir(),
    );
    const b = await run(
      ['analyze', join(FIXTURE_PROJECTS, 'vulnerable-npm'), '--format=json'],
      tempDir(),
    );
    expect(a.stdout).toBe(b.stdout);
  });

  it('--fail-on exits 1 at or above the threshold, 0 below it', async () => {
    const target = join(FIXTURE_PROJECTS, 'vulnerable-npm');
    expect((await run(['analyze', target, '--fail-on', 'medium'], tempDir())).code).toBe(
      EXIT_CODES.gate,
    );
    expect((await run(['analyze', target, '--fail-on', 'critical'], tempDir())).code).toBe(
      EXIT_CODES.gate,
    );

    const clean = join(FIXTURE_PROJECTS, 'clean-npm');
    expect((await run(['analyze', clean, '--fail-on', 'low'], tempDir())).code).toBe(
      EXIT_CODES.success,
    );
  });

  it('--ignore suppresses a finding; the report lists the rule and the count', async () => {
    const cwd = tempDir();
    const { code, stdout } = await run(
      ['analyze', join(FIXTURE_PROJECTS, 'vulnerable-npm'), '--ignore', 'CVE-2021-44906'],
      cwd,
    );

    expect(code).toBe(EXIT_CODES.success);
    expect(stdout).toContain('9 findings');
    expect(stdout).toContain('1 ignored');
    expect(stdout).toContain('CVE-2021-44906 [flag] matched CVE-2021-44906|minimist@1.2.5');
    expect(stdout).not.toContain(' 95');
  });

  it('offline with an empty cache: exit 5, gaps listed; --allow-incomplete passes', async () => {
    const target = join(FIXTURE_PROJECTS, 'vulnerable-npm');
    const offlineDeps: CliDeps = {
      ...fixtureDeps(),
      cache: seededMemoryCache(new Map()),
    };

    const blocked = await run(['analyze', target, '--offline'], tempDir(), offlineDeps);
    expect(blocked.code).toBe(EXIT_CODES.incomplete);
    expect(blocked.stdout).toContain('Incomplete coverage (3)');
    expect(blocked.stdout).toContain('osv-not-queried-offline');

    const allowed = await run(
      ['analyze', target, '--offline', '--allow-incomplete'],
      tempDir(),
      offlineDeps,
    );
    expect(allowed.code).toBe(EXIT_CODES.success);
  });

  it('unresolved-npm: the engine refuses a clean report, exit 5', async () => {
    const cwd = tempDir();
    const { code, stderr } = await run(['analyze', join(FIXTURE_PROJECTS, 'unresolved-npm')], cwd);
    expect(code).toBe(EXIT_CODES.incomplete);
    expect(stderr).toContain('error:');
    expect(existsSync(join(cwd, 'report.json'))).toBe(false);
  });

  it('a manifest with ranges: unresolved listed; gates behave', async () => {
    const project = tempDir();
    writeFileSync(
      join(project, 'package.json'),
      JSON.stringify({
        name: 'mixed-project',
        version: '1.0.0',
        dependencies: { minimist: '1.2.5', lodash: '^4.17.0' },
      }),
    );

    const base = await run(['analyze', project], tempDir());
    expect(base.code).toBe(EXIT_CODES.incomplete);
    expect(base.stdout).toContain('Unresolved requirements (1)');
    expect(base.stdout).toContain('"lodash": "^4.17.0"');
    expect(base.stdout).toContain('not-pinned');

    const allowed = await run(['analyze', project, '--allow-incomplete'], tempDir());
    expect(allowed.code).toBe(EXIT_CODES.success);

    const strict = await run(['analyze', project, '--fail-on-unresolved'], tempDir());
    expect(strict.code).toBe(EXIT_CODES.gate);
  });

  it('total osv.dev failure is exit 4, never a clean report', async () => {
    const failingHttp: OsvHttp = {
      queryBatch(): Promise<never> {
        return Promise.reject(new Error('ECONNREFUSED'));
      },
    };
    const deps: CliDeps = {
      ...fixtureDeps(),
      http: failingHttp,
      cache: seededMemoryCache(new Map()),
    };
    const { code } = await run(
      ['analyze', join(FIXTURE_PROJECTS, 'vulnerable-npm')],
      tempDir(),
      deps,
    );
    expect(code).toBe(EXIT_CODES.unavailable);
  });

  it('cancelled before the run: exit 130 and nothing written', async () => {
    const cwd = tempDir();
    const controller = new AbortController();
    controller.abort();
    const captured = captureIo({ cwd });
    const code = await runCli(['analyze', join(FIXTURE_PROJECTS, 'vulnerable-npm')], captured.io, {
      ...fixtureDeps(),
      signal: controller.signal,
    });

    expect(code).toBe(EXIT_CODES.cancelled);
    expect(captured.stderr()).toContain('cancelled');
    expect(existsSync(join(cwd, 'report.json'))).toBe(false);
  });
});

describe('runCli output rules', () => {
  it('progress renders counters with package identity on a TTY only', async () => {
    const ttyCaptured = captureIo({ cwd: tempDir(), isStderrTTY: true });
    await runCli(
      ['analyze', join(FIXTURE_PROJECTS, 'vulnerable-npm')],
      ttyCaptured.io,
      fixtureDeps(),
    );
    expect(ttyCaptured.stderr()).toContain('querying osv.dev: 3/3');
    expect(ttyCaptured.stderr()).toContain('lodash@4.17.20');

    const quietCaptured = captureIo({ cwd: tempDir(), isStderrTTY: true });
    await runCli(
      ['analyze', join(FIXTURE_PROJECTS, 'vulnerable-npm'), '--quiet'],
      quietCaptured.io,
      fixtureDeps(),
    );
    expect(quietCaptured.stderr()).not.toContain('querying osv.dev');
    expect(quietCaptured.stderr()).not.toContain('wrote report');

    const ciCaptured = captureIo({ cwd: tempDir(), isStderrTTY: true, env: { CI: 'true' } });
    await runCli(
      ['analyze', join(FIXTURE_PROJECTS, 'vulnerable-npm')],
      ciCaptured.io,
      fixtureDeps(),
    );
    expect(ciCaptured.stderr()).not.toContain('querying osv.dev');

    const pipeCaptured = captureIo({ cwd: tempDir(), isStderrTTY: false });
    await runCli(
      ['analyze', join(FIXTURE_PROJECTS, 'vulnerable-npm')],
      pipeCaptured.io,
      fixtureDeps(),
    );
    expect(pipeCaptured.stderr()).not.toContain('querying osv.dev');
    expect(pipeCaptured.stderr()).toContain('wrote report');
  });

  it('report output never mixes with status text on stdout', async () => {
    const cwd = tempDir();
    const captured = captureIo({ cwd });
    await runCli(
      ['analyze', join(FIXTURE_PROJECTS, 'vulnerable-npm'), '--format', 'json'],
      captured.io,
      fixtureDeps(),
    );
    expect(() => JSON.parse(captured.stdout()) as unknown).not.toThrow();
  });
});

describe('runCli command handling', () => {
  it('help lists the exit-code table and analyze flags', async () => {
    const { code, stdout } = await run(['help'], tempDir());
    expect(code).toBe(EXIT_CODES.success);
    expect(stdout).toContain('--fail-on');
    expect(stdout).toContain('Exit codes');
    expect(stdout).toContain('4  unavailable');
    expect(stdout).toContain('130  cancelled');
  });

  it('bare invocation prints the banner, exit 0', async () => {
    const { code, stdout } = await run([], tempDir());
    expect(code).toBe(EXIT_CODES.success);
    expect(stdout).toContain('vulnforge');
  });

  it('planned commands exit 2 with a clear message', async () => {
    const { code, stderr } = await run(['dashboard'], tempDir());
    expect(code).toBe(EXIT_CODES.usage);
    expect(stderr).toContain('not available in this build');
  });

  it('usage errors exit 2 and print usage to stderr', async () => {
    const { code, stdout, stderr } = await run(['analyze', '--bogus'], tempDir());
    expect(code).toBe(EXIT_CODES.usage);
    expect(stdout).toBe('');
    expect(stderr).toContain('error: unknown flag: --bogus');
    expect(stderr).toContain('Usage: vulnforge');
  });

  it('an empty directory is a usage error (no ecosystem), exit 2', async () => {
    const { code, stderr } = await run(['analyze', tempDir()], tempDir());
    expect(code).toBe(EXIT_CODES.usage);
    expect(stderr).toContain('error:');
  });

  it('version prints the CLI version', async () => {
    const { code, stdout } = await run(['version'], tempDir());
    expect(code).toBe(EXIT_CODES.success);
    expect(stdout).toBe('0.0.0-test\n');
  });
});
