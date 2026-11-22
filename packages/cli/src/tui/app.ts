import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { analyzeProject, createFileCache, validateReport, type Report } from '@vulnforge/core';
import { loadForgeConfig } from '@vulnforge/forge';

import { TUI_COLORS, TUI_FRAME_MS } from '../colors.generated.js';
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
import { padLine } from './theme.js';

/** Reads the OS clipboard for a raw Ctrl+V; null when no clipboard tool answers. */
function readOsClipboard(): Promise<string | null> {
  const command: readonly [string, readonly string[]] =
    process.platform === 'win32'
      ? ['powershell', ['-NoProfile', '-Command', 'Get-Clipboard']]
      : process.platform === 'darwin'
        ? ['pbpaste', []]
        : [
            'sh',
            [
              '-c',
              'xclip -selection clipboard -o 2>/dev/null || xsel -b -o 2>/dev/null || wl-paste -n 2>/dev/null',
            ],
          ];
  return new Promise((resolvePromise) => {
    execFile(
      command[0],
      [...command[1]],
      { timeout: 3000, killSignal: 'SIGKILL' },
      (error, stdout) => {
        resolvePromise(error !== null ? null : stdout);
      },
    );
  });
}

/** SGR that paints the theme background, for terminals that can show it. */
function backgroundSequence(caps: RenderCapabilities): string {
  if (caps.color === 'truecolor') {
    const hex = TUI_COLORS.bgBase.hex;
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    return `\u001b[48;2;${r};${g};${b}m`;
  }
  if (caps.color === '256') {
    return `\u001b[48;5;${TUI_COLORS.bgBase.xterm256}m`;
  }
  return '';
}

const MANIFESTS: readonly { readonly file: string; readonly ecosystem: string }[] = [
  { file: 'package-lock.json', ecosystem: 'npm' },
  { file: 'package.json', ecosystem: 'npm' },
  { file: 'requirements.txt', ecosystem: 'pypi' },
];

function capabilitiesFor(io: CliIo, env: NodeJS.ProcessEnv): RenderCapabilities {
  const noColor =
    (env.NO_COLOR !== undefined && env.NO_COLOR !== '') ||
    (io.env.VULNFORGE_NO_COLOR !== undefined && io.env.VULNFORGE_NO_COLOR !== '');
  // FORCE_COLOR is the explicit override: 0 mono, 1 ansi16, 2 xterm-256, 3 truecolor.
  const force = env.FORCE_COLOR ?? '';
  const forced =
    force === '0' || force === 'false'
      ? ('mono' as const)
      : force === '1'
        ? ('16' as const)
        : force === '2'
          ? ('256' as const)
          : force === '3' || force === 'true'
            ? ('truecolor' as const)
            : null;
  const colorTerm = env.COLORTERM ?? '';
  const term = env.TERM ?? '';
  const termProgram = env.TERM_PROGRAM ?? '';
  // Windows Terminal and the modern editors set no TERM/COLORTERM in PowerShell;
  // their session markers are the only reliable truecolor signal there.
  const modernHost =
    env.WT_SESSION !== undefined ||
    ['vscode', 'WezTerm', 'iTerm.app', 'kitty', 'Alacritty', 'ghostty'].includes(termProgram);
  const color = noColor
    ? 'mono'
    : (forced ??
      (colorTerm === 'truecolor' || colorTerm === '24bit' || modernHost
        ? 'truecolor'
        : term.includes('256color')
          ? '256'
          : '16'));
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
  readonly ecosystems: readonly string[];
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
  const ecosystems: string[] = [];
  if (exists) {
    if (existsSync(join(dir, 'package.json')) || existsSync(join(dir, 'package-lock.json'))) {
      ecosystems.push('npm');
    }
    if (existsSync(join(dir, 'requirements.txt'))) {
      ecosystems.push('pypi');
    }
  }
  return { target: dir, exists, manifest, ecosystem, lockfile, ignoreFile, ecosystems };
}

const BRACKETED_PASTE_START = Buffer.from('\u001b[200~', 'latin1');
const BRACKETED_PASTE_END = Buffer.from('\u001b[201~', 'latin1');

/**
 * Stateful byte-to-key parser. Holds an incomplete trailing sequence (a split
 * UTF-8 character or a bracketed paste still arriving) for the next chunk, so
 * fast paste bursts are never mangled at a chunk boundary.
 */
export function createKeyParser(): (chunk: Buffer) => TuiKey[] {
  let pending: Buffer = Buffer.alloc(0);
  return (chunk: Buffer): TuiKey[] => {
    const buf = pending.length > 0 ? Buffer.concat([pending, chunk]) : chunk;
    pending = Buffer.alloc(0);
    const keys: TuiKey[] = [];
    let i = 0;
    while (i < buf.length) {
      const byte = buf[i] as number;
      if (byte === 0x03) {
        keys.push({ type: 'ctrl-c' });
        i += 1;
      } else if (byte === 0x16) {
        // Ctrl+V arrived as a control byte: the terminal passed it through
        // instead of pasting, so the app asks the OS clipboard itself.
        keys.push({ type: 'paste-request' });
        i += 1;
      } else if (byte === 0x0d || byte === 0x0a) {
        keys.push({ type: 'enter' });
        i += 1;
      } else if (byte === 0x7f || byte === 0x08) {
        keys.push({ type: 'backspace' });
        i += 1;
      } else if (byte === 0x1b) {
        if (i + 1 < buf.length && buf[i + 1] === 0x5b) {
          if (buf.subarray(i, i + BRACKETED_PASTE_START.length).equals(BRACKETED_PASTE_START)) {
            const end = buf.indexOf(BRACKETED_PASTE_END, i + BRACKETED_PASTE_START.length);
            if (end === -1) {
              pending = buf.subarray(i);
              break;
            }
            keys.push({
              type: 'paste',
              text: buf.subarray(i + BRACKETED_PASTE_START.length, end).toString('utf8'),
            });
            i = end + BRACKETED_PASTE_END.length;
            continue;
          }
          // Another CSI sequence (arrows, function keys): consume and ignore it.
          let j = i + 2;
          while (j < buf.length && ((buf[j] as number) < 0x40 || (buf[j] as number) > 0x7e)) {
            j++;
          }
          if (j >= buf.length) {
            pending = buf.subarray(i);
            break;
          }
          i = j + 1;
        } else if (i + 1 >= buf.length) {
          keys.push({ type: 'escape' });
          i += 1;
        } else {
          i += 1;
        }
      } else if (byte >= 0x20) {
        // UTF-8: copy the whole sequence; buffer a split character for the next chunk.
        let end = i + 1;
        if (byte >= 0xf0) end = i + 4;
        else if (byte >= 0xe0) end = i + 3;
        else if (byte >= 0xc0) end = i + 2;
        if (end > buf.length) {
          pending = buf.subarray(i);
          break;
        }
        const text = buf.subarray(i, end).toString('utf8');
        for (const ch of text) {
          keys.push({ type: 'char', value: ch });
        }
        i = end;
      } else {
        i += 1;
      }
    }
    return keys;
  };
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
  const bg = backgroundSequence(caps);
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
    if (bg === '') {
      io.stdout(`\u001b[H${frame.join('\r\n')}`);
      return;
    }
    // Every line padded to full width over an active bg SGR paints the whole
    // screen in the theme base; fg()/bold() only reset fg and weight, so the
    // background survives to the line edge.
    const body = frame.map((line) => padLine(line, width)).join('\r\n');
    io.stdout(`\u001b[H${bg}${body}\u001b[0m`);
  };

  const apply = (effects: readonly TuiEffect[]): void => {
    for (const effect of effects) {
      if (effect.type === 'probe') {
        const facts = probeTarget(io.cwd, effect.path);
        const result = dispatch(model, { type: 'preflight', facts });
        model = result.model;
        apply(result.effects);
      } else if (effect.type === 'run-scan') {
        void runScan(effect.path, effect.ecosystem);
      } else if (effect.type === 'cancel-scan') {
        scanController?.abort();
      } else if (effect.type === 'read-clipboard') {
        void readOsClipboard().then((text) => {
          if (text !== null && text !== '') {
            emit({ type: 'clipboard-text', text });
          }
        });
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

  const runScan = async (target: string, ecosystem?: string): Promise<void> => {
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
        ...(ecosystem === 'npm' || ecosystem === 'pypi' ? { ecosystem } : {}),
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
        const message =
          result.error.code === 'ambiguous-ecosystem'
            ? 'this project mixes npm and Python manifests - press r and pick an ecosystem from the chooser before scanning'
            : result.error.message;
        emit({ type: 'scan-event', event: { type: 'scan-failed', message } });
      }
      return;
    }
    emit({ type: 'scan-event', event: { type: 'scan-completed' } });
    emit({ type: 'scan-report', report: result.report, target });
  };

  // Enter the alternate screen and raw mode.
  // ?2004h: ask the terminal to wrap pastes in bracketed-paste markers.
  io.stdout(
    bg === ''
      ? '\u001b[?1049h\u001b[?25l\u001b[?2004h'
      : `\u001b[?1049h\u001b[?25l\u001b[?2004h${bg}\u001b[2J`,
  );
  if (stdin.setRawMode !== undefined) {
    stdin.setRawMode(true);
  }
  stdin.resume();

  const keyParser = createKeyParser();
  const onData = (chunk: Buffer): void => {
    for (const key of keyParser(chunk)) {
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
  io.stdout('\u001b[?2004l\u001b[?25h\u001b[?1049l');
  if (cancelled) {
    return EXIT_CODES.cancelled;
  }
  return EXIT_CODES.success;
}
