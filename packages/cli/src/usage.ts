import { EXIT_CODE_LINES } from './exit-codes.js';

export function usage(version: string): string {
  return [
    `vulnforge ${version} - deterministic dependency vulnerability scanner`,
    '',
    'Usage: vulnforge <command> [options]',
    '',
    'Commands:',
    '  analyze [path]   Scan a project directory (alias: scan; default path: .)',
    '  help             Show this message',
    '  version          Print the CLI version',
    '',
    'Planned (later phases): dashboard, ui',
    '',
    'analyze options:',
    '  --out <file>            Report file to write atomically (default: report.json)',
    '  --format table|json     Stdout format (default: table)',
    '  --offline               Use the cache only; unqueried packages land in meta.incomplete',
    '  --cache-dir <dir>       OSV cache directory (default: ~/.vulnforge/cache/osv,',
    '                          or $VULNFORGE_CACHE_DIR)',
    '  --ignore <id>           Suppress a finding by id; repeatable',
    '  --ignore-file <file>    Ignore rules file (default: <path>/.vulnforgeignore when present)',
    '  --ecosystem npm|pypi    Skip auto-detection',
    '  --fail-on <sev>         Exit 1 when any finding is at or above critical|high|medium|low',
    '  --fail-on-unresolved    Exit 1 when any requirement could not be resolved',
    '  --allow-incomplete      Do not exit 5 on coverage gaps',
    '  --quiet                 No progress or status output on stderr',
    '  --no-color              Disable colored output',
    '',
    'Output rules:',
    '  The report (table or JSON) is the only thing on stdout. Progress, status and',
    '  errors go to stderr. Progress renders only on a TTY, never in CI or with --quiet.',
    '  Honors NO_COLOR, FORCE_COLOR, VULNFORGE_COLUMNS, VULNFORGE_DEBUG.',
    '',
    'Exit codes (precedence: error > gate > incomplete > success):',
    ...EXIT_CODE_LINES,
  ].join('\n');
}

export function banner(version: string): string {
  return [
    `vulnforge ${version}`,
    'Deterministic dependency vulnerability scanning. Nothing simulated.',
    '',
    'Run `vulnforge help` for usage, or `vulnforge analyze <path>` to scan a project.',
  ].join('\n');
}
