import { ECOSYSTEMS, SEVERITIES, type Ecosystem, type Severity } from '@vulnforge/core';

export interface AnalyzeFlags {
  readonly command: 'analyze';
  readonly path: string;
  readonly out: string;
  readonly format: 'table' | 'json';
  readonly offline: boolean;
  readonly cacheDir: string | null;
  readonly ignoreIds: readonly string[];
  readonly ignoreFile: string | null;
  readonly ecosystem: Ecosystem | null;
  readonly failOn: Severity | null;
  readonly failOnUnresolved: boolean;
  readonly allowIncomplete: boolean;
  readonly quiet: boolean;
  readonly noColor: boolean;
  /** Opt-in Forge steps. Never on by default. */
  readonly explain: boolean;
  readonly suggest: boolean;
}

export type ParsedArgs =
  | { readonly kind: 'analyze'; readonly flags: AnalyzeFlags }
  | { readonly kind: 'dashboard'; readonly flags: DashboardFlags }
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'bare' }
  | { readonly kind: 'planned'; readonly command: 'ui' }
  | { readonly kind: 'usage-error'; readonly message: string };

export interface DashboardFlags {
  readonly command: 'dashboard';
  /** Optional report file served at startup; validated once when the server boots. */
  readonly reportPath: string | null;
  readonly port: number | null;
  readonly quiet: boolean;
}

const VALUE_FLAGS = [
  '--out',
  '--format',
  '--cache-dir',
  '--ignore',
  '--ignore-file',
  '--ecosystem',
  '--fail-on',
] as const;

const BOOLEAN_FLAGS = [
  '--offline',
  '--explain',
  '--suggest',
  '--fail-on-unresolved',
  '--allow-incomplete',
  '--quiet',
  '--no-color',
] as const;

function usageError(message: string): ParsedArgs {
  return { kind: 'usage-error', message };
}

/** Parses argv (already stripped of node + script). Never throws. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [first, ...rest] = argv;

  if (first === undefined) {
    return { kind: 'bare' };
  }
  if (first === 'help' || first === '--help' || first === '-h') {
    return { kind: 'help' };
  }
  if (first === '--version' || first === '-v' || first === 'version') {
    return { kind: 'version' };
  }
  if (first === 'ui') {
    return { kind: 'planned', command: first };
  }
  if (first === 'dashboard') {
    let reportPath: string | null = null;
    let port: number | null = null;
    let quiet = false;
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === '--quiet') {
        quiet = true;
      } else if (arg === '--port') {
        const value = rest[++i];
        const parsed = value === undefined ? Number.NaN : Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
          return usageError('--port needs a port number (0-65535; 0 picks a free port)');
        }
        port = parsed;
      } else if (arg !== undefined && arg.startsWith('-')) {
        return usageError(`unknown dashboard flag: ${arg}`);
      } else if (arg !== undefined && reportPath === null) {
        reportPath = arg;
      } else {
        return usageError('dashboard takes at most one report file');
      }
    }
    return {
      kind: 'dashboard',
      flags: { command: 'dashboard', reportPath, port, quiet },
    };
  }
  if (first !== 'analyze' && first !== 'scan') {
    return usageError(`unknown command: ${first}`);
  }

  const ignoreIds: string[] = [];
  let path: string | null = null;
  let out = 'report.json';
  let format: 'table' | 'json' = 'table';
  let offline = false;
  let cacheDir: string | null = null;
  let ignoreFile: string | null = null;
  let ecosystem: Ecosystem | null = null;
  let failOn: Severity | null = null;
  let failOnUnresolved = false;
  let allowIncomplete = false;
  let quiet = false;
  let noColor = false;
  let explain = false;
  let suggest = false;

  // Support both `--flag value` and `--flag=value`.
  const expanded: string[] = [];
  for (const arg of rest) {
    const eq = arg.indexOf('=');
    if (arg.startsWith('--') && eq > 2) {
      expanded.push(arg.slice(0, eq), arg.slice(eq + 1));
    } else {
      expanded.push(arg);
    }
  }

  for (let i = 0; i < expanded.length; i += 1) {
    const arg = expanded[i] as string;

    if (arg === '--help' || arg === '-h') {
      return { kind: 'help' };
    }

    if ((VALUE_FLAGS as readonly string[]).includes(arg)) {
      const value = expanded[i + 1];
      if (value === undefined || value.startsWith('--')) {
        return usageError(`flag ${arg} needs a value`);
      }
      i += 1;
      switch (arg) {
        case '--out':
          out = value;
          break;
        case '--format':
          if (value !== 'table' && value !== 'json') {
            return usageError(`--format must be table or json, got: ${value}`);
          }
          format = value;
          break;
        case '--cache-dir':
          cacheDir = value;
          break;
        case '--ignore':
          ignoreIds.push(value);
          break;
        case '--ignore-file':
          ignoreFile = value;
          break;
        case '--ecosystem':
          if (!(ECOSYSTEMS as readonly string[]).includes(value)) {
            return usageError(`--ecosystem must be ${ECOSYSTEMS.join(' or ')}, got: ${value}`);
          }
          ecosystem = value as Ecosystem;
          break;
        case '--fail-on':
          if (!(SEVERITIES as readonly string[]).includes(value)) {
            return usageError(`--fail-on must be one of ${SEVERITIES.join(', ')}, got: ${value}`);
          }
          failOn = value as Severity;
          break;
      }
      continue;
    }

    if ((BOOLEAN_FLAGS as readonly string[]).includes(arg)) {
      switch (arg) {
        case '--offline':
          offline = true;
          break;
        case '--fail-on-unresolved':
          failOnUnresolved = true;
          break;
        case '--allow-incomplete':
          allowIncomplete = true;
          break;
        case '--quiet':
          quiet = true;
          break;
        case '--no-color':
          noColor = true;
          break;
        case '--explain':
          explain = true;
          break;
        case '--suggest':
          suggest = true;
          break;
      }
      continue;
    }

    if (arg.startsWith('-')) {
      return usageError(`unknown flag: ${arg}`);
    }

    if (path !== null) {
      return usageError(`unexpected extra argument: ${arg}`);
    }
    path = arg;
  }

  return {
    kind: 'analyze',
    flags: {
      command: 'analyze',
      path: path ?? '.',
      out,
      format,
      offline,
      cacheDir,
      ignoreIds,
      ignoreFile,
      ecosystem,
      failOn,
      failOnUnresolved,
      allowIncomplete,
      quiet,
      noColor,
      explain,
      suggest,
    },
  };
}
