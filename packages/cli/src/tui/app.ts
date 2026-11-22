import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { analyzeProject, createFileCache, validateReport, type Report } from '@vulnforge/core';
import { loadForgeConfig } from '@vulnforge/forge';

import { TUI_FRAME_MS } from '../colors.generated.js';
import { EXIT_CODES } from '../exit-codes.js';
import type { CliDeps, CliIo } from '../run.js';
import { composeFrame } from './frames.js';
import {
  dispatch,
  initialModel,
  type EnvFacts,
  type TuiEffect,
  type TuiKey,
  type TuiModel,
} from './model.js';
import type { RenderCapabilities } from './render3d.js';

const MANIFESTS: readonly { readonly file: string; readonly ecosystem: string }[] = [
  { file: 'package-lock.json', ecosystem: 'npm' },
  { file: 'package.json', ecosystem: 'npm' },
  { file: 'requirements.txt', ecosystem: 'pypi' },
];

function capabilitiesFor(io: CliIo, env: NodeJS.ProcessEnv): RenderCapabilities {
  const noColor =
    (env.NO_COLOR !== undefined && env.NO_COLOR !== '') ||
    (io.env.VULNFORGE_NO_COLOR !== undefined && io.env.VULNFORGE_NO_COLOR !== '');
  const colorTerm = env.COLORTERM ?? '';
  const term = env.TERM ?? '';
  const color = noColor
    ? 'mono'
    : colorTerm === 'truecolor' || colorTerm === '24bit'
      ? 'truecolor'
      : term.includes('256color')
        ? '256'
        : '16';
  const locale = `${env.LC_ALL ?? ''}${env.LC_CTYPE ?? ''}${env.LANG ?? ''}`;
  const unicode = !env.VULNFORGE_ASCII && locale.toLowerCase().includes('utf');
  return { color, unicode };
}

function probeTarget(
  cwd: string,
  target: string,
): {
  readonly target: string;
  readonly exists: boolean;
  readonly manifest: string | null;
  readonly ecosystem: string | null;
  readonly lockfile: string | null;
  readonly ignoreFile: string | null;
} {
  const dir = resolve(cwd, target);
  const exists = existsSync(dir);
  let manifest: string | null = null;
  let ecosystem: string | null = null;
  let lockfile: string | null = null;
  if (exists) {
    for (const candidate of MANIFESTS) {
      if (existsSync(join(dir, candidate.file))) {
        manifest = candidate.file;
        ecosystem = candidate.ecosystem;
        break;
      }
    }
  }
  if (exists && existsSync(join(dir, 'package-lock.json'))) {
    lockfile = 'package-lock.json';
  } else if (exists && existsSync(join(dir, 'pnpm-lock.yaml'))) {
    lockfile = 'pnpm-lock.yaml';
  }
  const ignoreFile =
    exists && existsSync(join(dir, '.vulnforgeignore')) ? join(dir, '.vulnforgeignore') : null;
  return { target: dir, exists, manifest, ecosystem, lockfile, ignoreFile };
}

function parseKeys(chunk: Buffer): TuiKey[] {
  const keys: TuiKey[] = [];
  for (let i = 0; i < chunk.length; i++) {
    const byte = chunk[i] as number;
    if (byte === 0x03) {
      keys.push({ type: 'ctrl-c' });
    } else if (byte === 0x0d || byte === 0x0a) {
      keys.push({ type: 'enter' });
    } else if (byte === 0x7f || byte === 0x08) {
      keys.push({ type: 'backspace' });
    } else if (byte === 0x1b) {
      // A CSI sequence (arrows, function keys) is consumed and ignored this pass;
      // a lone ESC blurs the input or closes the Live Monitor.
      if (i + 2 < chunk.length && chunk[i + 1] === 0x5b) {
        i += 2;
        while (i < chunk.length && ((chunk[i] as number) < 0x40 || (chunk[i] as number) > 0x7e)) {
          i++;
        }
      } else if (i + 1 >= chunk.length) {
        keys.push({ type: 'escape' });
      }
    } else if (byte >= 0x20) {
      // UTF-8: copy the whole sequence.
      let end = i + 1;
      if (byte >= 0xf0) end = i + 4;
      else if (byte >= 0xe0) end = i + 3;
      else if (byte >= 0xc0) end = i + 2;
      const text = chunk.subarray(i, Math.min(end, chunk.length)).toString('utf8');
      i = Math.min(end, chunk.length) - 1;
      for (const ch of text) {
        keys.push({ type: 'char', value: ch });
      }
    }
  }
  return keys;
}

function envFacts(io: CliIo, deps: CliDeps): EnvFacts {
  const forgeConfig = loadForgeConfig({
    VULNFORGE_AI_BASE_URL: io.env.VULNFORGE_AI_BASE_URL,
    VULNFORGE_AI_MODEL: io.env.VULNFORGE_AI_MODEL,
    VULNFORGE_AI_API_KEY: io.env.VULNFORGE_AI_API_KEY,
    VULNFORGE_AI_TIMEOUT_MS: io.env.VULNFORGE_AI_TIMEOUT_MS,
  });
  return {
    nodeVersion: process.version,
    platform: `${process.platform} ${process.arch}`,
    cwd: io.cwd,
    cacheDir: join(homedir(), '.vulnforge', 'cache', 'osv'),
    aiConfigured: deps.forgeClient !== undefined || forgeConfig !== null,
    toolVersion: io.version,
  };
}

function animationsEnabled(io: CliIo): boolean {
  const noAnim = io.env.VULNFORGE_NO_ANIM;
  return noAnim === undefined || noAnim === '' || noAnim === '0';
}

/**
 * The interactive TUI: raw-mode keyboard input, alternate screen, pure frames.
 * Only runs on a real terminal; callers fall back to the banner otherwise.
 * Returns the process exit code after the user quits.
 */
export async function runTui(io: CliIo, deps: CliDeps, reportPath: string | null): Promise<number> {
  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!stdin.isTTY || !stdout.isTTY) {
    return EXIT_CODES.usage;
  }

  const caps = capabilitiesFor(io, process.env);
  const animate = animationsEnabled(io);
  let model: TuiModel = initialModel(envFacts(io, deps));

  if (reportPath !== null) {
    try {
      const raw = JSON.parse(readFileSync(resolve(io.cwd, reportPath), 'utf8')) as unknown;
      const validation = validateReport(raw);
      if (!validation.ok) {
        io.stderr(
          `error: report at ${reportPath} failed validation (${validation.issues.length} issue(s))\n`,
        );
        return EXIT_CODES.usage;
      }
      const loaded: Report = validation.report;
      model = dispatch(model, {
        type: 'report-loaded',
        report: loaded,
        path: resolve(io.cwd, reportPath),
      }).model;
    } catch {
      io.stderr(`error: cannot read report at ${reportPath}\n`);
      return EXIT_CODES.usage;
    }
  }

  let tick = 0;
  let running = true;
  let cancelled = false;
  let scanController: AbortController | null = null;

  const size = (): { width: number; height: number } => ({
    width: Math.max(1, stdout.columns || io.columns || 80),
    height: Math.max(1, stdout.rows || 24),
  });

  const paint = (): void => {
    const { width, height } = size();
    const frame = composeFrame(model, width, height, caps, animate ? tick : 0);
    io.stdout(`\u001b[H${frame.join('\r\n')}`);
  };

  const apply = (effects: readonly TuiEffect[]): void => {
    for (const effect of effects) {
      if (effect.type === 'probe') {
        const facts = probeTarget(io.cwd, effect.path);
        const result = dispatch(model, { type: 'preflight', facts });
        model = result.model;
        apply(result.effects);
      } else if (effect.type === 'run-scan') {
        void runScan(effect.path);
      } else if (effect.type === 'cancel-scan') {
        scanController?.abort();
      }
    }
  };

  const emit = (action: Parameters<typeof dispatch>[1]): void => {
    const result = dispatch(model, action);
    model = result.model;
    if (result.effects.length > 0) {
      apply(result.effects);
    }
    if (model.quit) {
      running = false;
      return;
    }
    paint();
  };

  const runScan = async (target: string): Promise<void> => {
    const controller = new AbortController();
    scanController = controller;
    const cache =
      deps.cache ??
      createFileCache({
        ...(io.env.VULNFORGE_CACHE_DIR ? { dir: io.env.VULNFORGE_CACHE_DIR } : {}),
      });
    const result = await analyzeProject(
      {
        projectDir: target,
        toolVersion: io.version,
        onProgress: (progress) => {
          emit({
            type: 'scan-event',
            event: {
              type: 'query-progress',
              done: progress.done,
              total: progress.total,
              pkg: progress.package,
            },
          });
        },
        signal: controller.signal,
      },
      {
        cache,
        ...(deps.http === undefined ? {} : { http: deps.http }),
        ...(deps.clock === undefined ? {} : { clock: deps.clock }),
        ...(deps.pid === undefined ? {} : { pid: deps.pid }),
      },
    );
    scanController = null;
    if (!result.ok) {
      if (result.cancelled === true) {
        cancelled = true;
        emit({ type: 'scan-event', event: { type: 'scan-cancelled' } });
      } else {
        emit({ type: 'scan-event', event: { type: 'scan-failed', message: result.error.message } });
      }
      return;
    }
    emit({ type: 'scan-event', event: { type: 'scan-completed' } });
    emit({ type: 'scan-report', report: result.report, target });
  };

  // Enter the alternate screen and raw mode.
  io.stdout('\u001b[?1049h\u001b[?25l');
  if (stdin.setRawMode !== undefined) {
    stdin.setRawMode(true);
  }
  stdin.resume();

  const onData = (chunk: Buffer): void => {
    for (const key of parseKeys(chunk)) {
      if (!running) break;
      emit({ type: 'key', key });
    }
  };
  stdin.on('data', onData);

  const robotVisible = (): boolean => model.liveOpen || model.tab === 1 || model.tab === 5;
  const scanActive = (): boolean =>
    model.scan.state === 'scanning' ||
    model.scan.state === 'analyzing' ||
    model.scan.state === 'detected';

  const timer = setInterval(() => {
    if (!running) return;
    tick += 1;
    // Repaint on tick only while something on screen actually moves.
    if (animate && (scanActive() || robotVisible())) {
      paint();
    }
  }, TUI_FRAME_MS);

  paint();

  await new Promise<void>((resolvePromise) => {
    const check = setInterval(() => {
      if (!running) {
        clearInterval(check);
        resolvePromise();
      }
    }, 30);
    // Also stop if stdin ends (terminal closed).
    stdin.once('end', () => {
      running = false;
    });
  });

  clearInterval(timer);
  stdin.off('data', onData);
  if (stdin.setRawMode !== undefined) {
    stdin.setRawMode(false);
  }
  stdin.pause();
  io.stdout('\u001b[?25h\u001b[?1049l');
  if (cancelled) {
    return EXIT_CODES.cancelled;
  }
  return EXIT_CODES.success;
}
