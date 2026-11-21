import type { AnalyzeProgress } from '@vulnforge/core';

export interface ProgressEnv {
  readonly CI?: string | undefined;
  readonly NO_COLOR?: string | undefined;
  readonly FORCE_COLOR?: string | undefined;
  readonly VULNFORGE_COLUMNS?: string | undefined;
  readonly VULNFORGE_DEBUG?: string | undefined;
  readonly VULNFORGE_NO_ANIM?: string | undefined;
}

export interface ProgressOptions {
  readonly isStderrTTY: boolean;
  readonly quiet: boolean;
  readonly env: ProgressEnv;
}

/**
 * Whether the live progress line renders at all. Rules from the spec: progress
 * only on a TTY, never in CI, never with --quiet. There is no whole-scan
 * percentage anywhere; the line carries real counters plus the package identity.
 */
export function progressEnabled(options: ProgressOptions): boolean {
  if (options.quiet) return false;
  if (!options.isStderrTTY) return false;
  if (options.env.CI !== undefined && options.env.CI !== '' && options.env.CI !== 'false') {
    return false;
  }
  return true;
}

/** Renders progress events to a single stderr line that redraws in place. */
export class ProgressRenderer {
  private active = false;

  constructor(private readonly write: (chunk: string) => void) {}

  update(progress: AnalyzeProgress): void {
    this.active = true;
    this.write(`\rquerying osv.dev: ${progress.done}/${progress.total} ${progress.package}    `);
  }

  finish(): void {
    if (this.active) {
      this.write('\n');
      this.active = false;
    }
  }
}

/** Color decision: --no-color and NO_COLOR win, FORCE_COLOR forces, else TTY. */
export function colorEnabled(options: {
  readonly noColor: boolean;
  readonly isStdoutTTY: boolean;
  readonly env: ProgressEnv;
}): boolean {
  if (options.noColor) return false;
  if (options.env.NO_COLOR !== undefined && options.env.NO_COLOR !== '') return false;
  if (options.env.FORCE_COLOR !== undefined && options.env.FORCE_COLOR !== '') return true;
  return options.isStdoutTTY;
}

/** Column budget: VULNFORGE_COLUMNS > detected TTY width > 80. */
export function resolveColumns(env: ProgressEnv, ttyColumns: number | undefined): number {
  const fromEnv = Number.parseInt(env.VULNFORGE_COLUMNS ?? '', 10);
  if (Number.isFinite(fromEnv) && fromEnv >= 40) return fromEnv;
  if (ttyColumns !== undefined && ttyColumns >= 40) return ttyColumns;
  return 80;
}
