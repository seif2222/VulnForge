import { resolve } from 'node:path';

import {
  AnalyzeError,
  analyzeProject,
  createFileCache,
  type AnalyzeDeps,
  type Report,
  type Severity,
} from '@vulnforge/core';

import { EXIT_CODES } from './exit-codes.js';
import { parseArgs, type AnalyzeFlags } from './args.js';
import {
  ProgressRenderer,
  colorEnabled,
  progressEnabled,
  resolveColumns,
  type ProgressEnv,
} from './progress.js';
import { renderTable } from './table.js';
import { banner, usage } from './usage.js';

export interface CliIo {
  readonly stdout: (chunk: string) => void;
  readonly stderr: (chunk: string) => void;
  readonly env: ProgressEnv & Readonly<Record<string, string | undefined>>;
  readonly isStdoutTTY: boolean;
  readonly isStderrTTY: boolean;
  readonly cwd: string;
  /** TTY width when stdout is a terminal; undefined otherwise. */
  readonly columns?: number | undefined;
  readonly version: string;
}

export interface CliDeps extends AnalyzeDeps {
  readonly signal?: AbortSignal;
}

const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

/**
 * Exit decision from a finished report. Precedence: error (handled by the
 * caller before this runs) > gate > incomplete > success.
 */
export function decideExitCode(report: Report, flags: AnalyzeFlags): number {
  const threshold = flags.failOn === null ? null : SEVERITY_RANK[flags.failOn];
  const gateHit =
    threshold !== null &&
    report.vulnerabilities.some((finding) => SEVERITY_RANK[finding.severity] >= threshold);
  const unresolvedHit = flags.failOnUnresolved && report.stats.unresolvedCount > 0;
  if (gateHit || unresolvedHit) {
    return EXIT_CODES.gate;
  }

  // Every package unqueried because osv.dev failed = unavailable, not "clean".
  const osvErrors = report.meta.incomplete.filter((entry) => entry.reason === 'osv-error');
  if (report.packages.length > 0 && osvErrors.length >= report.packages.length) {
    return EXIT_CODES.unavailable;
  }

  if (!flags.allowIncomplete) {
    if (report.meta.incomplete.length > 0 || report.stats.unresolvedCount > 0) {
      return EXIT_CODES.incomplete;
    }
  }
  return EXIT_CODES.success;
}

/** Maps an engine error to the exit table. */
export function errorExitCode(error: AnalyzeError): number {
  switch (error.code) {
    case 'ambiguous-ecosystem':
    case 'no-ecosystem':
    case 'parse-error':
    case 'ignore-file-error':
      return EXIT_CODES.usage;
    case 'invalid-report':
      // The engine refused to certify "clean" over unresolved inputs.
      return EXIT_CODES.incomplete;
    case 'write-failed':
      return EXIT_CODES.internal;
  }
}

async function runAnalyze(flags: AnalyzeFlags, io: CliIo, deps: CliDeps): Promise<number> {
  const showProgress = progressEnabled({
    isStderrTTY: io.isStderrTTY,
    quiet: flags.quiet,
    env: io.env,
  });
  const progress = new ProgressRenderer(io.stderr);
  const cache =
    deps.cache ?? createFileCache({ ...(flags.cacheDir === null ? {} : { dir: flags.cacheDir }) });

  const projectDir = resolve(io.cwd, flags.path);
  const outPath = resolve(io.cwd, flags.out);

  const result = await analyzeProject(
    {
      projectDir,
      outPath,
      toolVersion: io.version,
      ...(flags.ecosystem === null ? {} : { ecosystem: flags.ecosystem }),
      offline: flags.offline,
      ignoreIds: flags.ignoreIds,
      ...(flags.ignoreFile === null ? {} : { ignoreFile: resolve(io.cwd, flags.ignoreFile) }),
      onProgress: showProgress ? (event) => progress.update(event) : undefined,
      signal: deps.signal,
    },
    {
      cache,
      ...(deps.http === undefined ? {} : { http: deps.http }),
      ...(deps.clock === undefined ? {} : { clock: deps.clock }),
      ...(deps.pid === undefined ? {} : { pid: deps.pid }),
    },
  );

  progress.finish();

  if (!result.ok) {
    if (result.cancelled === true) {
      io.stderr('cancelled: no report written\n');
      return EXIT_CODES.cancelled;
    }
    io.stderr(`error: ${result.error.message}\n`);
    return errorExitCode(result.error);
  }

  const { report } = result;

  // Report output on stdout only. A renderer crash exits 3, never 1.
  try {
    if (flags.format === 'json') {
      io.stdout(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      io.stdout(
        renderTable(report, {
          color: colorEnabled({
            noColor: flags.noColor,
            isStdoutTTY: io.isStdoutTTY,
            env: io.env,
          }),
          columns: resolveColumns(io.env, io.columns),
        }),
      );
    }
  } catch (error) {
    io.stderr(
      `error: report renderer crashed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return EXIT_CODES.internal;
  }

  if (!flags.quiet && result.reportPath !== null) {
    io.stderr(`wrote report: ${result.reportPath}\n`);
  }

  return decideExitCode(report, flags);
}

/** Runs the CLI and resolves with the process exit code. */
export async function runCli(
  argv: readonly string[],
  io: CliIo,
  deps: CliDeps = {},
): Promise<number> {
  const parsed = parseArgs(argv);

  switch (parsed.kind) {
    case 'help':
      io.stdout(`${usage(io.version)}\n`);
      return EXIT_CODES.success;
    case 'version':
      io.stdout(`${io.version}\n`);
      return EXIT_CODES.success;
    case 'bare':
      io.stdout(`${banner(io.version)}\n`);
      return EXIT_CODES.success;
    case 'planned':
      io.stderr(
        `${parsed.command} is not available in this build - it lands in the dashboard/TUI phase.\n`,
      );
      return EXIT_CODES.usage;
    case 'usage-error':
      io.stderr(`error: ${parsed.message}\n\n${usage(io.version)}\n`);
      return EXIT_CODES.usage;
    case 'analyze':
      try {
        return await runAnalyze(parsed.flags, io, deps);
      } catch (error) {
        if (error instanceof AnalyzeError) {
          io.stderr(`error: ${error.message}\n`);
          return errorExitCode(error);
        }
        io.stderr(`error: internal: ${error instanceof Error ? error.message : String(error)}\n`);
        if (io.env.VULNFORGE_DEBUG !== undefined && io.env.VULNFORGE_DEBUG !== '') {
          io.stderr(`${error instanceof Error ? (error.stack ?? '') : ''}\n`);
        }
        return EXIT_CODES.internal;
      }
  }
}
