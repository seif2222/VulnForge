/**
 * The one exit-code table. Shown in `--help`, used by the runner, tested for
 * precedence. Precedence when several apply: error (2/3/4) > gate (1) >
 * incomplete (5) > success (0). A crash in any renderer exits 3, never 1.
 */
export const EXIT_CODES = {
  /** Scan completed, gate (if any) passed. */
  success: 0,
  /** Findings gate failed: --fail-on severity threshold met, or --fail-on-unresolved. */
  gate: 1,
  /** Bad command line, missing value, unparseable project, unknown flag. */
  usage: 2,
  /** Internal error: unexpected exception or a renderer crash. */
  internal: 3,
  /** Unavailable: every OSV query failed (network/osv.dev down). */
  unavailable: 4,
  /** Result incomplete: unqueried packages, unresolved inputs, refused clean report. */
  incomplete: 5,
  /** Dashboard command failure. Reserved for the dashboard phase. */
  dashboard: 6,
  /** Cancelled by the user (SIGINT). Conventional 128+SIGINT. */
  cancelled: 130,
} as const;

export type ExitCodeName = keyof typeof EXIT_CODES;

export const EXIT_CODE_LINES: readonly string[] = [
  `  ${EXIT_CODES.success}  success - scan completed, no gate failed`,
  `  ${EXIT_CODES.gate}  findings gate - --fail-on threshold met or --fail-on-unresolved hit`,
  `  ${EXIT_CODES.usage}  usage - bad flags, unknown command, unparseable project`,
  `  ${EXIT_CODES.internal}  internal - unexpected error or renderer crash`,
  `  ${EXIT_CODES.unavailable}  unavailable - every osv.dev query failed`,
  `  ${EXIT_CODES.incomplete}  incomplete - gaps in coverage (--allow-incomplete to pass)`,
  `  ${EXIT_CODES.dashboard}  dashboard - reserved for the dashboard phase`,
  `  ${EXIT_CODES.cancelled}  cancelled - interrupted by the user`,
];
