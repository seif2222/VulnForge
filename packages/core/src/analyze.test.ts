import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  analyzeProject,
  createMemoryCache,
  RegistryError,
  validateReport,
  type AnalyzeProgress,
} from './index.js';
import { loadOsvRecordings, recordingHttp, seedCache } from './test-helpers.js';

const FIXTURE_PROJECTS = new URL('../../../fixtures/projects/', import.meta.url).pathname;

const CLOCK = () => new Date('2026-10-08T12:00:00Z');

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vulnforge-analyze-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** analyzeProject wired to the recorded osv.dev responses; never touches the network. */
async function analyzeFixture(
  fixture: string,
  overrides: Partial<Parameters<typeof analyzeProject>[0]> = {},
) {
  const recordings = loadOsvRecordings();
  const cache = createMemoryCache();
  seedCache(cache, recordings);

  return analyzeProject(
    {
      projectDir: join(FIXTURE_PROJECTS, fixture),
      toolVersion: '0.0.0-test',
      ...overrides,
    },
    { http: recordingHttp(recordings), cache, clock: CLOCK, pid: 4242 },
  );
}

describe('analyzeProject pipeline', () => {
  it('scans vulnerable-npm end to end and produces a valid report', async () => {
    const result = await analyzeFixture('vulnerable-npm');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.report.meta.tool).toEqual({ name: 'vulnforge', version: '0.0.0-test' });
    expect(result.report.meta.generatedAt).toBe('2026-10-08T12:00:00.000Z');
    expect(result.report.vulnerabilities).toHaveLength(10);
    expect(result.report.risk).toHaveLength(10);
    expect(result.report.stats.bySeverity).toEqual({ critical: 1, high: 4, medium: 5, low: 0 });
    expect(validateReport(result.report).ok).toBe(true);
  });

  it('auto-detects the ecosystem and errors on an empty directory', async () => {
    const empty = tempDir();
    const result = await analyzeProject(
      { projectDir: empty, toolVersion: '0.0.0-test' },
      { clock: CLOCK },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.cancelled).not.toBe(true);
    if ('error' in result) {
      expect(result.error.code).toBe('no-ecosystem');
    }
  });

  it('reports real progress: monotonic counters, ending at the total, with package identity', async () => {
    const events: AnalyzeProgress[] = [];

    await analyzeFixture('vulnerable-npm', { onProgress: (event) => events.push(event) });

    expect(events.length).toBeGreaterThan(0);
    const total = events[0]?.total;
    expect(total).toBe(3);
    expect(events.map((event) => event.total)).toEqual(events.map(() => total));
    expect(events.map((event) => event.done)).toEqual([1, 2, 3]);
    expect(events.every((event) => event.package.includes('@'))).toBe(true);
    expect(events[events.length - 1]?.done).toBe(total);
  });

  it('ranks findings and honours ignore flags', async () => {
    const result = await analyzeFixture('vulnerable-npm', { ignoreIds: ['CVE-2021-44906'] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.report.vulnerabilities.map((entry) => entry.id)).not.toContain('CVE-2021-44906');
    expect(result.report.meta.ignored).toEqual([
      {
        id: 'CVE-2021-44906',
        source: 'flag',
        reason: null,
        until: null,
        matchedFindingKeys: ['CVE-2021-44906|minimist@1.2.5'],
      },
    ]);
    expect(result.report.stats.ignoredCount).toBe(1);
    expect(result.report.stats.totalVulnerabilities).toBe(9);
    // every surviving finding still has a risk entry (full coverage)
    expect(result.report.risk).toHaveLength(9);
    expect(validateReport(result.report).ok).toBe(true);
  });

  it('reads .vulnforgeignore from the project directory', async () => {
    const project = tempDir();
    writeFileSync(
      join(project, 'package.json'),
      JSON.stringify({
        name: 'ignore-file-project',
        version: '1.0.0',
        dependencies: { minimist: '1.2.5' },
      }),
    );
    writeFileSync(join(project, '.vulnforgeignore'), 'CVE-2021-44906 # accepted\n');

    const recordings = loadOsvRecordings();
    const cache = createMemoryCache();
    seedCache(cache, recordings);

    const result = await analyzeProject(
      { projectDir: project, toolVersion: '0.0.0-test' },
      { http: recordingHttp(recordings), cache, clock: CLOCK },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.meta.ignored[0]?.reason).toBe('accepted');
    expect(result.report.stats.ignoredCount).toBe(1);
  });

  it('resolves only exact pins without a lockfile and reports the rest unresolved', async () => {
    const result = await analyzeFixture('unresolved-npm');

    // unresolved requirements + zero findings is never a written "clean" report
    expect(result.ok).toBe(false);
    if (result.ok) return;
    if ('error' in result) {
      expect(result.error.code).toBe('invalid-report');
    }
  });

  it('fails honestly with nothing-resolved when nothing can resolve (depscan-copy regression)', async () => {
    // The owner's depscan-copy: no lockfile, every dependency a range, and the
    // registry cannot help (unreachable). The old path died deep in report
    // validation; the engine names the failing fact instead.
    const dir = tempDir();
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'all-ranges',
        version: '1.0.0',
        dependencies: { lodash: '^4.17.21', chalk: '*' },
      }),
    );

    const result = await analyzeProject(
      { projectDir: dir, toolVersion: '0.0.0-test' },
      { cache: createMemoryCache(), clock: CLOCK, registry: null },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    if ('error' in result) {
      expect(result.error.code).toBe('nothing-resolved');
      expect(result.error.message).toContain('all 2 requirement(s) are unresolved');
      expect(result.error.message).toContain('package-lock.json');
    }
  });

  it('resolves lockfile-less ranges from the registry and scans them (depscan-copy online)', async () => {
    // His depscan-copy on an online machine: no lockfile, but the registry
    // answers, so the scan produces a real report instead of an error.
    const dir = tempDir();
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'depscan-copy',
        version: '1.0.0',
        dependencies: { lodash: '^4.17.20', minimist: '~1.2.5' },
        devDependencies: { chalk: '*' },
      }),
    );

    const versions: Record<string, { versions: string[]; distTags: Record<string, string> }> = {
      lodash: { versions: ['4.17.19', '4.17.20', '4.17.21'], distTags: { latest: '4.17.21' } },
      minimist: { versions: ['1.2.5', '1.2.8', '2.0.1'], distTags: { latest: '2.0.1' } },
      chalk: { versions: ['4.1.2', '5.3.0'], distTags: { latest: '5.3.0' } },
    };

    const result = await analyzeProject(
      { projectDir: dir, toolVersion: '0.0.0-test' },
      {
        cache: createMemoryCache(),
        clock: CLOCK,
        registry: {
          metadata: (name: string) => {
            const found = versions[name];
            if (found === undefined) {
              return Promise.reject(
                new RegistryError('not-found', `no such package: ${name}`, 404),
              );
            }
            return Promise.resolve(found);
          },
        },
        http: { queryBatch: (queries) => Promise.resolve(queries.map(() => [])) },
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resolved = result.report.packages.map((entry) => `${entry.name}@${entry.version}`);
    expect(resolved).toEqual(['chalk@5.3.0', 'lodash@4.17.21', 'minimist@1.2.8']);
    expect(result.report.meta.unresolved).toEqual([]);
    expect(
      result.report.meta.warnings.some((line) => line.includes('resolved from the npm registry')),
    ).toBe(true);
    expect(result.report.packages.find((entry) => entry.name === 'chalk')?.isDev).toBe(true);
  });

  it('produces a valid report for scoped packages (depscan regression: scoped parents)', async () => {
    // The owner's real depscan scan failed validation: parents like
    // "@typescript-eslint/parser@8.0.0" did not match the old unscoped pattern.
    const dir = tempDir();
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'scoped-temp',
        version: '1.0.0',
        dependencies: { '@typescript-eslint/parser': '8.0.0' },
      }),
    );
    writeFileSync(
      join(dir, 'package-lock.json'),
      JSON.stringify({
        name: 'scoped-temp',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': {
            name: 'scoped-temp',
            version: '1.0.0',
            dependencies: { '@typescript-eslint/parser': '8.0.0' },
          },
          'node_modules/@typescript-eslint/parser': {
            version: '8.0.0',
            dependencies: { '@typescript-eslint/types': '8.0.0', debug: '4.3.4' },
          },
          'node_modules/@typescript-eslint/types': { version: '8.0.0' },
          'node_modules/debug': { version: '4.3.4', dependencies: { ms: '2.1.2' } },
          'node_modules/ms': { version: '2.1.2' },
        },
      }),
    );

    const result = await analyzeProject(
      { projectDir: dir, toolVersion: '0.0.0-test', offline: true },
      { cache: createMemoryCache(), clock: CLOCK },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateReport(result.report).ok).toBe(true);
    const types = result.report.packages.find((entry) => entry.name === '@typescript-eslint/types');
    expect(types?.parents).toEqual(['@typescript-eslint/parser@8.0.0']);
  });

  it('marks packages incomplete in offline mode when the cache has no answer', async () => {
    const recordings = loadOsvRecordings();

    const result = await analyzeProject(
      {
        projectDir: join(FIXTURE_PROJECTS, 'vulnerable-npm'),
        toolVersion: '0.0.0-test',
        offline: true,
      },
      { http: recordingHttp(recordings), cache: createMemoryCache(), clock: CLOCK },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.meta.incomplete).toHaveLength(3);
    expect(result.report.meta.incomplete[0]?.reason).toBe('osv-not-queried-offline');
    expect(result.report.vulnerabilities).toHaveLength(0);
  });

  it('writes the report atomically: target plus no leftover temp file', async () => {
    const outDir = tempDir();
    const outPath = join(outDir, 'report.json');

    const result = await analyzeFixture('transitive-npm', { outPath });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.reportPath).toBe(outPath);
    expect(readdirSync(outDir)).toEqual(['report.json']);
    const written = JSON.parse(readFileSync(outPath, 'utf8')) as unknown;
    expect(validateReport(written).ok).toBe(true);
  });
});

describe('analyzeProject cancellation', () => {
  it('a signal aborted before the run returns cancelled with no report and no temp file', async () => {
    const outDir = tempDir();
    const outPath = join(outDir, 'report.json');
    const controller = new AbortController();
    controller.abort();

    const result = await analyzeFixture('transitive-npm', {
      outPath,
      signal: controller.signal,
    });

    expect(result).toEqual({ ok: false, cancelled: true });
    expect(existsSync(outPath)).toBe(false);
    expect(readdirSync(outDir)).toEqual([]);
  });

  it('cancelling between match and write writes nothing and keeps the cache intact', async () => {
    const outDir = tempDir();
    const outPath = join(outDir, 'report.json');
    const controller = new AbortController();

    const recordings = loadOsvRecordings();
    const cache = createMemoryCache();
    seedCache(cache, recordings);
    const cacheKeysBefore = [...cache.keys()].sort();

    const result = await analyzeProject(
      {
        projectDir: join(FIXTURE_PROJECTS, 'transitive-npm'),
        toolVersion: '0.0.0-test',
        outPath,
        signal: controller.signal,
        onProgress: () => controller.abort(),
      },
      { http: recordingHttp(recordings), cache, clock: CLOCK, pid: 4242 },
    );

    expect(result).toEqual({ ok: false, cancelled: true });
    expect(existsSync(outPath)).toBe(false);
    expect(readdirSync(outDir)).toEqual([]);
    expect([...cache.keys()].sort()).toEqual(cacheKeysBefore);
  });

  it('completed batches stay cached when a later stage is cancelled', async () => {
    // the first progress event fires after the first query completed and was cached
    const controller = new AbortController();
    const recordings = loadOsvRecordings();
    const cache = createMemoryCache();

    const result = await analyzeProject(
      {
        projectDir: join(FIXTURE_PROJECTS, 'vulnerable-npm'),
        toolVersion: '0.0.0-test',
        signal: controller.signal,
        onProgress: (event) => {
          if (event.done === event.total) controller.abort();
        },
      },
      { http: recordingHttp(recordings), cache, clock: CLOCK },
    );

    expect(result).toEqual({ ok: false, cancelled: true });
    expect(cache.keys().length).toBe(3);
  });
});

describe('analyzeProject on python-basic', () => {
  it('produces the 19-finding PyPI report with unresolved requirements listed', async () => {
    const result = await analyzeFixture('python-basic');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.report.meta.ecosystem).toBe('pypi');
    expect(result.report.vulnerabilities).toHaveLength(19);
    expect(result.report.stats.bySeverity).toEqual({ critical: 1, high: 8, medium: 10, low: 0 });
    expect(validateReport(result.report).ok).toBe(true);
  });
});
