import { resolve } from 'node:path';

import {
  AnalyzeError,
  analyzeProject,
  createFileCache,
  writeReportAtomic,
  type AnalyzeDeps,
  type Report,
  type Severity,
} from '@vulnforge/core';
import {
  ForgeError,
  attachSuggestions,
  createForgeClient,
  explainFindings,
  loadForgeConfig,
  suggestForReport,
  type ForgeClient,
} from '@vulnforge/forge';

import { EXIT_CODES } from './exit-codes.js';
import { DashboardError, startDashboardServer } from './dashboard-server.js';
import { parseArgs, type AnalyzeFlags, type DashboardFlags } from './args.js';
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
  /** Test seam: a prebuilt Forge client. Real runs build one from the env. */
  readonly forgeClient?: ForgeClient;
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
  if (flags.explain && flags.format === 'json') {
    io.stderr('error: --explain prints human text, so it needs --format table\n');
    return EXIT_CODES.usage;
  }

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

  const forgeConfig = loadForgeConfig({
    VULNFORGE_AI_BASE_URL: io.env.VULNFORGE_AI_BASE_URL,
    VULNFORGE_AI_MODEL: io.env.VULNFORGE_AI_MODEL,
    VULNFORGE_AI_API_KEY: io.env.VULNFORGE_AI_API_KEY,
    VULNFORGE_AI_TIMEOUT_MS: io.env.VULNFORGE_AI_TIMEOUT_MS,
  });
  const forgeAvailable = deps.forgeClient !== undefined || forgeConfig !== null;
  // the write is delayed past the Forge step only when Forge will actually run
  const wantsSuggest = flags.suggest && forgeAvailable;
  const result = await analyzeProject(
    {
      projectDir,
      // with --suggest the enriched report is written after the Forge step
      ...(wantsSuggest ? {} : { outPath }),
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

  let report: Report = result.report;

  // Opt-in Forge steps. The AI layer never fails a scan and never changes findings.
  if ((flags.suggest || flags.explain) && !forgeAvailable) {
    io.stderr(
      'forge: not configured (set VULNFORGE_AI_BASE_URL for a local server or VULNFORGE_AI_API_KEY for a hosted one); skipping the AI step\n',
    );
  } else if (flags.suggest || flags.explain) {
    const client =
      deps.forgeClient ?? createForgeClient(forgeConfig as NonNullable<typeof forgeConfig>);
    if (flags.suggest) {
      try {
        const { suggestions, warnings } = await suggestForReport(report, { client });
        for (const warning of warnings) io.stderr(`forge: ${warning}\n`);
        report = attachSuggestions(report, suggestions);
        if (!flags.quiet)
          io.stderr(`forge: added ${suggestions.length} suggestion(s) to the report\n`);
      } catch (error) {
        if (error instanceof ForgeError) {
          io.stderr(`forge: suggestion step skipped: ${error.message}\n`);
        } else {
          throw error;
        }
      }
      // the enriched (or, on Forge failure, the original) report lands now
      try {
        writeReportAtomic(outPath, report, deps.pid ?? process.pid);
      } catch {
        io.stderr(`error: could not write report to ${outPath}\n`);
        return EXIT_CODES.internal;
      }
    }
    if (flags.explain) {
      try {
        const { explanations, warnings } = await explainFindings(report, { client });
        for (const warning of warnings) io.stderr(`forge: ${warning}\n`);
        if (explanations.length > 0) {
          const blocks = explanations.map(
            (entry) =>
              `\n--- ${entry.findingKey} ---\n${entry.explanation}\nfix: ${entry.remediation}`,
          );
          io.stdout(`\nForge explanations (${explanations.length}):\n${blocks.join('\n')}\n`);
        }
      } catch (error) {
        if (error instanceof ForgeError) {
          io.stderr(`forge: explanation step skipped: ${error.message}\n`);
        } else {
          throw error;
        }
      }
    }
  }

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

  const writtenPath = wantsSuggest ? outPath : result.reportPath;
  if (!flags.quiet && writtenPath !== null) {
    io.stderr(`wrote report: ${writtenPath}\n`);
  }

  return decideExitCode(report, flags);
}

/**
 * Runs the dashboard server until SIGINT/SIGTERM. The URL and lifecycle messages go to
 * stderr (never stdout - stdout is reserved for report output). Exit 6 on any dashboard
 * startup failure; 130 when the user interrupts.
 */
async function runDashboard(flags: DashboardFlags, io: CliIo): Promise<number> {
  const assetsRoot = resolve(import.meta.dirname, '..', 'assets', 'dashboard');
  const server = await startDashboardServer({
    port: flags.port ?? undefined,
    reportPath: flags.reportPath ?? undefined,
    assetsRoot,
    toolVersion: io.version,
    aiAvailable:
      loadForgeConfig({
        VULNFORGE_AI_BASE_URL: io.env.VULNFORGE_AI_BASE_URL,
        VULNFORGE_AI_MODEL: io.env.VULNFORGE_AI_MODEL,
        VULNFORGE_AI_API_KEY: io.env.VULNFORGE_AI_API_KEY,
        VULNFORGE_AI_TIMEOUT_MS: io.env.VULNFORGE_AI_TIMEOUT_MS,
      }) !== null,
  });
  if (!flags.quiet) {
    io.stderr(`vulnforge dashboard listening at ${server.url}\n`);
    io.stderr('press ctrl+c to stop\n');
  }

  const interrupted = await new Promise<boolean>((resolvePromise) => {
    const onSigint = (): void => {
      resolvePromise(true);
    };
    const onSigterm = (): void => {
      resolvePromise(false);
    };
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
  });
  await server.close();
  return interrupted ? EXIT_CODES.cancelled : EXIT_CODES.success;
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
    case 'dashboard':
      try {
        return await runDashboard(parsed.flags, io);
      } catch (error) {
        if (error instanceof DashboardError) {
          io.stderr(`error: ${error.message}\n`);
          return EXIT_CODES.dashboard;
        }
        io.stderr(`error: internal: ${error instanceof Error ? error.message : String(error)}\n`);
        return EXIT_CODES.internal;
      }
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
