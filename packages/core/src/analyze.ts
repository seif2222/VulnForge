import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { isProjectParseError, ProjectParseError } from './errors.js';
import { applyIgnores, parseIgnoreFile, rulesFromFlags, type IgnoreRule } from './ignore.js';
import { matchVulnerabilities, type MatchProgress } from './match.js';
import { hasNpmLockfile, parseNpm, parseNpmManifestOnly } from './npm-parse.js';
import { hasPnpmLockfile, parsePnpm } from './pnpm-parse.js';
import { createNpmRegistry, resolveManifestRanges, type NpmRegistry } from './npm-registry.js';
import { sortPackageEntries } from './package-key.js';
import type { OsvCache } from './osv-cache.js';
import type { OsvHttp } from './osv-http.js';
import { parsePython } from './python-parse.js';
import { rankFindings } from './rank.js';
import { computeStats } from './stats.js';
import { TOOL_NAME } from './types.js';
import type {
  Ecosystem,
  IncompleteAdvisory,
  PackageEntry,
  Report,
  UnresolvedRequirement,
} from './types.js';
import { validateReport } from './validate-report.js';

export type AnalyzeProgress = MatchProgress;

export interface AnalyzeOptions {
  readonly projectDir: string;
  /** Auto-detected when omitted; ambiguous or missing ecosystems are a usage error. */
  readonly ecosystem?: Ecosystem;
  /** Use the cache only; unqueried packages land in meta.incomplete. */
  readonly offline?: boolean;
  /** `--ignore <id>` rules, repeatable. */
  readonly ignoreIds?: readonly string[];
  /** Ignore file path; defaults to `<projectDir>/.vulnforgeignore` when it exists. */
  readonly ignoreFile?: string;
  /** Write the validated report here, atomically. No write when omitted. */
  readonly outPath?: string;
  /** The CLI's own version, stamped into report.meta.tool. */
  readonly toolVersion: string;
  /** Real progress: OSV query counters with the package identity. Never a percentage. */
  readonly onProgress?: (progress: AnalyzeProgress) => void;
  /** Cooperative cancellation. A cancelled run writes no report and no temp file. */
  readonly signal?: AbortSignal;
}

export interface AnalyzeDeps {
  readonly http?: OsvHttp;
  readonly cache?: OsvCache;
  /**
   * Registry client for resolving lockfile-less npm ranges. Default: a live
   * registry client, but only when no http was injected (hermetic tests never
   * touch the network by accident). Pass null to disable resolution.
   */
  readonly registry?: NpmRegistry | null;
  /** Injected clock so the engine never reads the wall clock itself. */
  readonly clock?: () => Date;
  /** Injected pid for the atomic-write temp name. */
  readonly pid?: number;
}

export const ANALYZE_ERROR_CODES = [
  'ambiguous-ecosystem',
  'no-ecosystem',
  'parse-error',
  'ignore-file-error',
  'nothing-resolved',
  'invalid-report',
  'write-failed',
] as const;

export type AnalyzeErrorCode = (typeof ANALYZE_ERROR_CODES)[number];

export class AnalyzeError extends Error {
  readonly code: AnalyzeErrorCode;

  constructor(code: AnalyzeErrorCode, message: string) {
    super(message);
    this.name = 'AnalyzeError';
    this.code = code;
  }
}

export type AnalyzeResult =
  | { readonly ok: true; readonly report: Report; readonly reportPath: string | null }
  | { readonly ok: false; readonly cancelled: true }
  | { readonly ok: false; readonly cancelled?: false; readonly error: AnalyzeError };

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function detectEcosystem(projectDir: string): Ecosystem {
  const hasNpm =
    existsSync(join(projectDir, 'package-lock.json')) ||
    existsSync(join(projectDir, 'package.json'));
  const hasPython = existsSync(join(projectDir, 'requirements.txt'));

  if (hasNpm && hasPython) {
    throw new AnalyzeError(
      'ambiguous-ecosystem',
      'both package.json and requirements.txt are present; pass --ecosystem',
    );
  }
  if (hasNpm) return 'npm';
  if (hasPython) return 'pypi';
  throw new AnalyzeError(
    'no-ecosystem',
    'no package.json, package-lock.json or requirements.txt found',
  );
}

interface ParsedProject {
  readonly projectName: string;
  readonly manifestPath: string;
  readonly packages: readonly PackageEntry[];
  readonly unresolved: readonly UnresolvedRequirement[];
  readonly warnings: readonly string[];
}

function parseProject(projectDir: string, ecosystem: Ecosystem): ParsedProject {
  if (ecosystem === 'pypi') {
    const project = parsePython(projectDir);
    return {
      projectName: project.projectName,
      manifestPath: project.manifestPath,
      packages: project.packages,
      unresolved: project.unresolved,
      warnings: project.warnings,
    };
  }

  const project = hasNpmLockfile(projectDir)
    ? parseNpm(projectDir)
    : hasPnpmLockfile(projectDir)
      ? parsePnpm(projectDir)
      : parseNpmManifestOnly(projectDir);
  return {
    projectName: project.projectName,
    manifestPath: project.manifestPath,
    packages: project.packages,
    unresolved: project.unresolved,
    warnings: project.warnings,
  };
}

function loadIgnoreRules(options: AnalyzeOptions, today: string): readonly IgnoreRule[] {
  const rules: IgnoreRule[] = [...rulesFromFlags(options.ignoreIds ?? [])];

  const ignoreFile = options.ignoreFile ?? join(options.projectDir, '.vulnforgeignore');
  if (existsSync(ignoreFile)) {
    try {
      rules.push(...parseIgnoreFile(readFileSync(ignoreFile, 'utf8')));
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unreadable ignore file';
      throw new AnalyzeError('ignore-file-error', `${ignoreFile}: ${detail}`);
    }
  }

  // `today` only matters at apply time; validated here so a bad system date fails early.
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(today)) {
    throw new AnalyzeError('ignore-file-error', `injected clock produced invalid date "${today}"`);
  }

  return rules;
}

/**
 * Atomic write: serialize to `<target>.tmp-<pid>` next to the target, then rename.
 * The temp file is never left behind by this function; a crash between write and
 * rename may leave one, which the next run's caller may remove.
 */
export function writeReportAtomic(outPath: string, report: Report, pid: number): void {
  const temporary = `${outPath}.tmp-${pid}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    renameSync(temporary, outPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown write error';
    throw new AnalyzeError('write-failed', `${outPath}: ${detail}`);
  }
}

/**
 * The engine pipeline: parse -> match -> rank -> ignore -> assemble -> validate ->
 * write. Every step is deterministic; all external inputs (clock, pid, http, cache)
 * are injected through `deps`.
 */
export async function analyzeProject(
  options: AnalyzeOptions,
  deps: AnalyzeDeps = {},
): Promise<AnalyzeResult> {
  try {
    throwIfAborted(options.signal);

    const ecosystem = options.ecosystem ?? detectEcosystem(options.projectDir);
    let parsed = parseProject(options.projectDir, ecosystem);

    // A lockfile-less npm project still scans: ranges resolve to concrete
    // versions from registry metadata, marked honestly in meta.warnings.
    if (ecosystem === 'npm' && parsed.unresolved.length > 0 && options.offline !== true) {
      const registry =
        deps.registry === null
          ? undefined
          : (deps.registry ??
            (deps.http === undefined ? createNpmRegistry({ signal: options.signal }) : undefined));
      if (registry !== undefined) {
        const known = new Set(parsed.packages.map((entry) => entry.name));
        const resolution = await resolveManifestRanges(
          options.projectDir,
          parsed.unresolved,
          registry,
          options.signal,
        );
        parsed = {
          ...parsed,
          packages: sortPackageEntries([
            ...parsed.packages,
            ...resolution.packages.filter((entry) => !known.has(entry.name)),
          ]),
          unresolved: resolution.unresolved,
          warnings: [...parsed.warnings, ...resolution.warnings],
        };
      }
    }

    // Zero-resolved is an honest dead end, not a report: without one resolved
    // package there is nothing to query and a report would only mislead. Name
    // the failing fact and the fix instead of dying in report validation.
    if (parsed.packages.length === 0 && parsed.unresolved.length > 0) {
      const reasons = [...new Set(parsed.unresolved.map((entry) => entry.reason))].join(', ');
      const hint =
        ecosystem === 'npm'
          ? 'without a package-lock.json ranges resolve only from the npm registry (unreachable or no match here); run "npm install" to create a lockfile, then scan again'
          : 'only exact == pins in requirements.txt resolve; pin the requirements or install a lock step, then scan again';
      throw new AnalyzeError(
        'nothing-resolved',
        `no dependencies could be resolved from ${parsed.manifestPath}: all ${parsed.unresolved.length} requirement(s) are unresolved (${reasons}) - ${hint}`,
      );
    }

    throwIfAborted(options.signal);

    const incomplete: IncompleteAdvisory[] = [];
    const vulnerabilities = await matchVulnerabilities(parsed.packages, {
      ecosystem,
      http: deps.http,
      cache: deps.cache,
      offline: options.offline ?? false,
      signal: options.signal,
      onProgress: options.onProgress,
      onUnidentifiedAdvisory: (info) => {
        incomplete.push({
          advisoryId: info.recordId,
          package: `${info.package}@${info.version}`,
          reason: 'no-canonical-id',
        });
      },
      onQueryGap: (gap) => {
        incomplete.push({
          advisoryId: null,
          package: `${gap.package}@${gap.version}`,
          reason: gap.reason,
        });
      },
    });

    throwIfAborted(options.signal);

    const now = (deps.clock ?? (() => new Date()))();
    const today = now.toISOString().slice(0, 10);
    const rules = loadIgnoreRules(options, today);
    const { vulnerabilities: kept, ignored } = applyIgnores(vulnerabilities, rules, today);
    const risk = rankFindings(kept, parsed.packages);

    const report: Report = {
      schemaVersion: 6,
      meta: {
        tool: { name: TOOL_NAME, version: options.toolVersion },
        generatedAt: now.toISOString(),
        projectName: parsed.projectName,
        ecosystem,
        manifestPath: parsed.manifestPath,
        unresolved: parsed.unresolved,
        incomplete,
        ignored,
        warnings: parsed.warnings,
      },
      packages: parsed.packages,
      vulnerabilities: kept,
      risk,
      suggestions: [],
      stats: computeStats(
        parsed.packages,
        kept,
        parsed.unresolved.length,
        ignored.flatMap((entry) => entry.matchedFindingKeys).length,
      ),
    };

    const validation = validateReport(report);
    if (!validation.ok) {
      const detail = validation.issues.map((issue) => `${issue.path} ${issue.message}`).join('; ');
      throw new AnalyzeError('invalid-report', `engine produced an invalid report: ${detail}`);
    }

    throwIfAborted(options.signal);

    let reportPath: string | null = null;
    if (options.outPath !== undefined) {
      writeReportAtomic(options.outPath, report, deps.pid ?? process.pid);
      reportPath = options.outPath;
    }

    return { ok: true, report, reportPath };
  } catch (error) {
    if (isAbort(error, options.signal)) {
      return { ok: false, cancelled: true };
    }
    if (error instanceof AnalyzeError) {
      return { ok: false, error };
    }
    if (isProjectParseError(error)) {
      return { ok: false, error: new AnalyzeError('parse-error', error.message) };
    }
    if (error instanceof ProjectParseError) {
      return { ok: false, error: new AnalyzeError('parse-error', error.message) };
    }
    throw error;
  }
}
