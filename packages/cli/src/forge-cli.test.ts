import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { validateReport, type Report } from '@vulnforge/core';
import { ForgeError, type ForgeClient } from '@vulnforge/forge';

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
  const dir = mkdtempSync(join(tmpdir(), 'vulnforge-forge-cli-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fixtureDeps(forgeClient?: ForgeClient): CliDeps {
  const recordings = loadOsvRecordings();
  return {
    http: recordingHttp(recordings),
    cache: seededMemoryCache(recordings),
    clock: () => new Date('2026-10-08T12:00:00Z'),
    pid: 4242,
    ...(forgeClient === undefined ? {} : { forgeClient }),
  };
}

const SUGGEST_REPLY = JSON.stringify([
  {
    findingKey: 'CVE-2021-44906|minimist@1.2.5',
    saferVersion: '1.2.6',
    alternativePackage: null,
    rationale: '1.2.6 patches the prototype pollution.',
  },
]);

const EXPLAIN_REPLY = JSON.stringify({
  explanation: 'Prototype pollution in minimist argument parsing.',
  remediation: 'Upgrade minimist to 1.2.6.',
});

describe('CLI Forge integration', () => {
  it('--suggest merges validated suggestions into the written report', async () => {
    const cwd = tempDir();
    const captured = captureIo({ cwd });
    const code = await runCli(
      ['analyze', join(FIXTURE_PROJECTS, 'vulnerable-npm'), '--suggest', '--format', 'json'],
      captured.io,
      fixtureDeps({ model: 'test', chat: () => Promise.resolve(SUGGEST_REPLY) }),
    );

    expect(code).toBe(EXIT_CODES.success);
    const written = JSON.parse(readFileSync(join(cwd, 'report.json'), 'utf8')) as Report;
    expect(written.suggestions).toEqual([
      {
        findingKey: 'CVE-2021-44906|minimist@1.2.5',
        saferVersion: '1.2.6',
        alternativePackage: null,
        rationale: '1.2.6 patches the prototype pollution.',
        provider: 'llm',
      },
    ]);
    expect(validateReport(written).ok).toBe(true);
    // stdout JSON carries them too
    expect((JSON.parse(captured.stdout()) as Report).suggestions).toHaveLength(1);
  });

  it('--suggest without any Forge config warns and still scans clean', async () => {
    const cwd = tempDir();
    const captured = captureIo({ cwd });
    const code = await runCli(
      ['analyze', join(FIXTURE_PROJECTS, 'vulnerable-npm'), '--suggest'],
      captured.io,
      fixtureDeps(),
    );

    expect(code).toBe(EXIT_CODES.success);
    expect(captured.stderr()).toContain('forge: not configured');
    const written = JSON.parse(readFileSync(join(cwd, 'report.json'), 'utf8')) as Report;
    expect(written.suggestions).toEqual([]);
  });

  it('a Forge outage leaves the report and the exit code untouched', async () => {
    const cwd = tempDir();
    const captured = captureIo({ cwd });
    const code = await runCli(
      ['analyze', join(FIXTURE_PROJECTS, 'vulnerable-npm'), '--suggest'],
      captured.io,
      fixtureDeps({
        model: 'test',
        chat: () =>
          Promise.reject(
            new ForgeError('forge-unavailable', 'cannot reach Forge endpoint: ECONNREFUSED'),
          ),
      }),
    );

    expect(code).toBe(EXIT_CODES.success);
    expect(captured.stderr()).toContain('forge: suggestion step skipped');
    const written = JSON.parse(readFileSync(join(cwd, 'report.json'), 'utf8')) as Report;
    expect(written.suggestions).toEqual([]);
    expect(written.vulnerabilities).toHaveLength(10);
  });

  it('--explain prints explanations after the table', async () => {
    const cwd = tempDir();
    const captured = captureIo({ cwd });
    const code = await runCli(
      ['analyze', join(FIXTURE_PROJECTS, 'vulnerable-npm'), '--explain'],
      captured.io,
      fixtureDeps({ model: 'test', chat: () => Promise.resolve(EXPLAIN_REPLY) }),
    );

    expect(code).toBe(EXIT_CODES.success);
    expect(captured.stdout()).toContain('Forge explanations (10):');
    expect(captured.stdout()).toContain('Prototype pollution in minimist argument parsing.');
    expect(captured.stdout()).toContain('fix: Upgrade minimist to 1.2.6.');
    // explanations never land in the report file
    const written = JSON.parse(readFileSync(join(cwd, 'report.json'), 'utf8')) as Report;
    expect(JSON.stringify(written)).not.toContain('Prototype pollution');
  });

  it('--explain with --format json is a usage error, exit 2', async () => {
    const captured = captureIo({ cwd: tempDir() });
    const code = await runCli(
      ['analyze', join(FIXTURE_PROJECTS, 'vulnerable-npm'), '--explain', '--format', 'json'],
      captured.io,
      fixtureDeps(),
    );
    expect(code).toBe(EXIT_CODES.usage);
    expect(captured.stderr()).toContain('--explain prints human text');
    expect(existsSync(join(tempDir(), 'report.json'))).toBe(false);
  });
});
