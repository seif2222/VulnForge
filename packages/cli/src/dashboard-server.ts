import { createDashboardHistory } from './dashboard-history.js';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, posix, resolve, sep } from 'node:path';

import {
  analyzeProject,
  validateReport,
  type AnalyzeDeps,
  type AnalyzeOptions,
  type AnalyzeResult,
  type Report,
} from '@vulnforge/core';

/**
 * The local-only, hardened dashboard server (G4). Every rule from the spec's section 4
 * lives here and has a test: bind 127.0.0.1, exact Host allow-list, foreign Origin 403,
 * no CORS headers, strict CSP with no unsafe-inline/unsafe-eval, URL hardening with
 * realpath containment, 64 KiB scan-body cap, single-flight scans with abort on client
 * disconnect, per-request temp dirs always removed, SSE streaming the engine's real
 * progress events, and security headers on every response including errors.
 */

const CSP =
  "default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self'; " +
  "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const MAX_URL_LENGTH = 2048;
const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_PORT = 4173;
/** Idle sockets die fast; the scan and SSE routes opt out explicitly. */
const IDLE_SOCKET_MS = 30_000;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

export const DASHBOARD_ERROR_CODES = [
  'invalid-report',
  'report-unreadable',
  'assets-missing',
  'listen-failed',
] as const;

export type DashboardErrorCode = (typeof DASHBOARD_ERROR_CODES)[number];

export class DashboardError extends Error {
  readonly code: DashboardErrorCode;

  constructor(code: DashboardErrorCode, message: string) {
    super(message);
    this.name = 'DashboardError';
    this.code = code;
  }
}

export type AnalyzeFn = (options: AnalyzeOptions, deps?: AnalyzeDeps) => Promise<AnalyzeResult>;

/** Forge suggestion pass: takes a scan report, returns it with suggestions attached. */
export type SuggestFn = (report: Report) => Promise<Report>;

/** One row of the project structure listing shown during a live scan. */
export interface StructureEntry {
  /** Slash-separated path relative to the scanned root. */
  readonly path: string;
  readonly name: string;
  readonly kind: 'dir' | 'file';
  /** 0 = direct child of the scanned root. */
  readonly depth: number;
}

const STRUCTURE_MAX_ENTRIES = 400;
const STRUCTURE_MAX_DEPTH = 3;
const STRUCTURE_SKIP = new Set(['.git', '.svn', '.hg']);

/**
 * Lists the real project tree for the live-scan structure view. Directories
 * first, alphabetical; node_modules is collapsed to its package dirs (those
 * are the rows scan progress maps onto) without descending into them. Capped
 * and honest about truncation.
 */
export function listStructure(root: string): {
  readonly entries: StructureEntry[];
  readonly truncated: boolean;
} {
  const entries: StructureEntry[] = [];
  let truncated = false;

  const push = (entry: StructureEntry): boolean => {
    if (entries.length >= STRUCTURE_MAX_ENTRIES) {
      truncated = true;
      return false;
    }
    entries.push(entry);
    return true;
  };

  const walk = (dir: string, rel: string, depth: number): void => {
    if (truncated || depth > STRUCTURE_MAX_DEPTH) {
      return;
    }
    let items;
    try {
      items = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directories are simply absent from the listing
    }
    items.sort(
      (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
    );
    for (const item of items) {
      if (STRUCTURE_SKIP.has(item.name)) {
        continue;
      }
      const childRel = rel === '' ? item.name : `${rel}/${item.name}`;
      const isDir = item.isDirectory();
      if (!push({ path: childRel, name: item.name, kind: isDir ? 'dir' : 'file', depth })) {
        return;
      }
      if (!isDir) {
        continue;
      }
      if (item.name === 'node_modules') {
        // Collapse: list package dirs (and scoped packages one level deeper)
        // so scan progress can point at the real installed package rows.
        let packages;
        try {
          packages = readdirSync(join(dir, item.name), { withFileTypes: true });
        } catch {
          continue;
        }
        packages.sort((a, b) => a.name.localeCompare(b.name));
        for (const pkg of packages) {
          const pkgRel = `${childRel}/${pkg.name}`;
          if (pkg.name.startsWith('@') && pkg.isDirectory()) {
            if (!push({ path: pkgRel, name: pkg.name, kind: 'dir', depth: depth + 1 })) {
              return;
            }
            let scoped;
            try {
              scoped = readdirSync(join(dir, item.name, pkg.name), { withFileTypes: true });
            } catch {
              continue;
            }
            scoped.sort((a, b) => a.name.localeCompare(b.name));
            for (const inner of scoped) {
              if (
                !push({
                  path: `${pkgRel}/${inner.name}`,
                  name: inner.name,
                  kind: inner.isDirectory() ? 'dir' : 'file',
                  depth: depth + 2,
                })
              ) {
                return;
              }
            }
          } else if (
            !push({
              path: pkgRel,
              name: pkg.name,
              kind: pkg.isDirectory() ? 'dir' : 'file',
              depth: depth + 1,
            })
          ) {
            return;
          }
        }
        continue;
      }
      walk(join(dir, item.name), childRel, depth + 1);
    }
  };

  walk(root, '', 0);
  return { entries, truncated };
}

export interface DashboardServerOptions {
  /** 0 picks a free port; used by tests. */
  readonly port?: number;
  /** Report shown at startup; validated once, here. */
  readonly reportPath?: string;
  readonly historyPath?: string;
  /** Static bundle root; realpath containment is enforced against it. */
  readonly assetsRoot: string;
  /** Stamped into reports the scan route produces. */
  readonly toolVersion: string;
  /** Capability booleans only, never keys: true when an AI provider is configured. */
  readonly aiAvailable: boolean;
  /** Engine injection point for tests; defaults to the real analyzeProject. */
  readonly analyze?: AnalyzeFn;
  readonly analyzeDeps?: AnalyzeDeps;
  /**
   * Forge suggestion pass, applied to a fresh scan report when the client asks
   * for AI explanations. Absent when no provider is configured. Forge must
   * never fail a scan: the server swallows its errors and keeps the base report.
   */
  readonly suggest?: SuggestFn;
}

export interface RunningServer {
  readonly port: number;
  readonly url: string;
  readonly close: () => Promise<void>;
}

interface ActiveScan {
  readonly runId: string;
  readonly controller: AbortController;
  readonly tempDir: string;
  lastProgress: { done: number; total: number; pkg: string } | null;
}

export async function startDashboardServer(
  options: DashboardServerOptions,
): Promise<RunningServer> {
  if (!existsSync(options.assetsRoot)) {
    throw new DashboardError(
      'assets-missing',
      `dashboard assets not found at ${options.assetsRoot}`,
    );
  }
  const assetsRoot = realpathSync(resolve(options.assetsRoot));
  if (!existsSync(join(assetsRoot, 'index.html'))) {
    throw new DashboardError(
      'assets-missing',
      `dashboard assets not found at ${assetsRoot} (index.html missing)`,
    );
  }

  const history = createDashboardHistory(options.historyPath);
  let startupReport: Report | null = null;
  if (options.reportPath !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(options.reportPath, 'utf8')) as unknown;
    } catch {
      throw new DashboardError('report-unreadable', `cannot read report at ${options.reportPath}`);
    }
    const validation = validateReport(parsed);
    if (!validation.ok) {
      throw new DashboardError(
        'invalid-report',
        `report at ${options.reportPath} failed schema validation at startup`,
      );
    }
    startupReport = validation.report;
  }

  const analyze = options.analyze ?? analyzeProject;
  let activeScan: ActiveScan | null = null;
  let runSeq = 0;
  // The events channel is persistent: clients connect before launching a scan and see
  // every state change and progress event from then on.
  const eventListeners = new Set<ServerResponse>();

  const server: Server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      sendJson(res, 500, { error: 'internal' });
    });
  });
  server.headersTimeout = 5_000;
  server.requestTimeout = 15_000;
  server.timeout = IDLE_SOCKET_MS;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const port = boundPort();
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      sendJson(res, 403, { error: 'forbidden-host' });
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let originHost: string;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = '';
      }
      if (originHost !== host) {
        sendJson(res, 403, { error: 'forbidden-origin' });
        return;
      }
    }

    const rawUrl = req.url ?? '/';
    if (rawUrl.length > MAX_URL_LENGTH) {
      sendJson(res, 414, { error: 'url-too-long' });
      return;
    }
    // Backslash, NUL and control characters never reach the path logic.
    // eslint-disable-next-line no-control-regex
    if (/[\\\u0000-\u001f]/u.test(rawUrl)) {
      sendJson(res, 400, { error: 'bad-url' });
      return;
    }
    const pathname = safePathname(rawUrl);
    if (pathname === null) {
      sendJson(res, 400, { error: 'bad-url' });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/history') {
      sendJson(res, 200, history.snapshot());
      return;
    }

    if (req.method === 'GET' && pathname === '/api/status') {
      sendJson(res, 200, {
        ok: true,
        capabilities: { ai: options.aiAvailable, scan: true },
        toolVersion: options.toolVersion,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/report.json') {
      if (startupReport === null) {
        sendJson(res, 404, { error: 'no-report' });
        return;
      }
      sendJson(res, 200, startupReport);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/scan/events') {
      serveEvents(req, res);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/scan') {
      await serveScan(req, res);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/structure') {
      serveStructure(rawUrl, res);
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      serveStatic(pathname, res);
      return;
    }

    sendJson(res, 404, { error: 'not-found' });
  }

  function serveEvents(req: IncomingMessage, res: ServerResponse): void {
    req.socket.setTimeout(0);
    res.writeHead(200, {
      ...securityHeaders(),
      'content-type': 'text/event-stream; charset=utf-8',
    });
    const scan = activeScan;
    const snapshot =
      scan === null
        ? { state: 'idle' }
        : { state: 'scanning', runId: scan.runId, progress: scan.lastProgress };
    res.write(`event: state\ndata: ${JSON.stringify(snapshot)}\n\n`);
    eventListeners.add(res);
    req.on('close', () => {
      eventListeners.delete(res);
    });
  }

  function emitEvent(event: string, data: unknown): void {
    const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const listener of eventListeners) {
      listener.write(line);
    }
  }

  /**
   * The real file/folder structure of a scan target, for the live-scan
   * structure view. Same trust model as launching a scan: local-only server,
   * the user names their own project paths. Missing/unreadable targets answer
   * honestly so the dashboard can say so instead of inventing a tree.
   */
  function serveStructure(rawUrl: string, res: ServerResponse): void {
    const projectPath = new URL(rawUrl, 'http://127.0.0.1').searchParams.get('path');
    if (projectPath === null || projectPath.trim() === '') {
      sendJson(res, 400, { error: 'bad-project-path' });
      return;
    }
    const root = resolve(projectPath);
    try {
      const stats = statSync(root);
      if (!stats.isDirectory()) {
        sendJson(res, 400, { error: 'not-a-directory' });
        return;
      }
    } catch {
      sendJson(res, 404, { error: 'path-not-found' });
      return;
    }
    const { entries, truncated } = listStructure(root);
    sendJson(res, 200, { root, entries, truncated });
  }

  async function serveScan(req: IncomingMessage, res: ServerResponse): Promise<void> {
    req.socket.setTimeout(0);
    if (activeScan !== null) {
      sendJson(res, 409, { error: 'scan-already-running', runId: activeScan.runId });
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        // Respond, then close once the response is flushed - destroying the socket first
        // would tear down the client's write side before it sees the 413.
        sendJson(res, 413, { error: 'body-too-large' });
        res.on('finish', () => {
          req.socket.destroy();
        });
        return;
      }
      sendJson(res, 400, { error: 'bad-json' });
      return;
    }
    const projectPath =
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>)['projectPath']
        : undefined;
    if (typeof projectPath !== 'string' || projectPath.trim() === '') {
      sendJson(res, 400, { error: 'bad-project-path' });
      return;
    }
    const aiExplanations =
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>)['aiExplanations'] === true
        : false;

    const tempDir = mkdtempSync(join(tmpdir(), 'vulnforge-scan-'));
    const controller = new AbortController();
    const scan: ActiveScan = {
      runId: `pid${process.pid}-run${++runSeq}`,
      controller,
      tempDir,
      lastProgress: null,
    };
    activeScan = scan;
    // A client that goes away mid-scan cancels the engine for real. The response 'close'
    // event (not the request's, which fires when the body is merely read) is the signal.
    res.on('close', () => {
      if (!res.writableEnded) {
        controller.abort();
      }
    });

    const emit = emitEvent;

    emit('state', { state: 'scanning', runId: scan.runId });
    try {
      mkdirSync(tempDir, { recursive: true });
      const result = await analyze(
        {
          projectDir: projectPath,
          toolVersion: options.toolVersion,
          outPath: join(tempDir, 'report.json'),
          signal: controller.signal,
          onProgress: (progress) => {
            scan.lastProgress = {
              done: progress.done,
              total: progress.total,
              pkg: progress.package,
            };
            emit('progress', scan.lastProgress);
          },
        },
        options.analyzeDeps,
      );
      if (result.ok) {
        const validation = validateReport(result.report);
        if (!validation.ok) {
          emit('state', { state: 'error', message: 'engine produced an invalid report' });
          sendJson(res, 500, { error: 'invalid-report' });
          return;
        }
        let report = result.report;
        if (aiExplanations && options.suggest !== undefined) {
          try {
            emit('state', { state: 'analyzing', runId: scan.runId });
            const enriched = await options.suggest(report);
            // Only swap in the enriched report when it still validates; Forge
            // writes suggestions, never findings, and must never fail a scan.
            const enrichedValidation = validateReport(enriched);
            if (enrichedValidation.ok) {
              report = enriched;
            }
          } catch {
            // Forge failure keeps the base report.
          }
        }
        history.add(report);
        emit('state', { state: 'completed', runId: scan.runId });
        sendJson(res, 200, report);
        return;
      }
      if (result.cancelled === true) {
        emit('state', { state: 'cancelled', runId: scan.runId });
        if (!res.writableEnded) {
          sendJson(res, 499, { error: 'cancelled' });
        }
        return;
      }
      emit('state', { state: 'error', message: result.error.message });
      sendJson(res, 500, { error: result.error.code, message: result.error.message });
    } finally {
      // The single-flight lease and the temp dir are always released, so the next
      // scan never sees a stale 409 and no scan artifacts linger. Event listeners stay
      // subscribed: the channel is persistent across runs.
      activeScan = null;
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  function serveStatic(pathname: string, res: ServerResponse): void {
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const candidate = resolve(assetsRoot, normalize(relative));
    if (!isContained(assetsRoot, candidate)) {
      sendJson(res, 403, { error: 'forbidden-path' });
      return;
    }
    let real: string;
    try {
      real = realpathSync(candidate);
    } catch {
      sendJson(res, 404, { error: 'not-found' });
      return;
    }
    if (!isContained(assetsRoot, real)) {
      sendJson(res, 403, { error: 'forbidden-path' });
      return;
    }
    let content: Buffer;
    try {
      content = readFileSync(real);
    } catch {
      sendJson(res, 404, { error: 'not-found' });
      return;
    }
    res.writeHead(200, {
      ...securityHeaders(),
      'content-type': CONTENT_TYPES[extname(real)] ?? 'application/octet-stream',
    });
    res.end(content);
  }

  function boundPort(): number {
    const address = server.address();
    if (address !== null && typeof address === 'object') {
      return address.port;
    }
    return options.port ?? DEFAULT_PORT;
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', () => {
      rejectPromise(
        new DashboardError('listen-failed', `port ${options.port ?? DEFAULT_PORT} unavailable`),
      );
    });
    server.listen(options.port ?? DEFAULT_PORT, '127.0.0.1', () => {
      resolvePromise();
    });
  });

  const port = boundPort();
  return {
    port,
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolvePromise) => {
        for (const listener of eventListeners) {
          listener.end();
        }
        eventListeners.clear();
        server.closeAllConnections();
        server.close(() => resolvePromise());
      }),
  };
}

function securityHeaders(): Record<string, string> {
  return {
    'content-security-policy': CSP,
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  };
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  if (res.writableEnded) {
    return;
  }
  res.writeHead(status, {
    ...securityHeaders(),
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload));
}

class BodyTooLargeError extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.removeAllListeners('data');
        req.resume(); // drain the rest so the response can be delivered
        rejectPromise(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rejectPromise);
  });
}

/** Decode twice and reject anything that escapes the root or fails to decode. */
function safePathname(rawUrl: string): string | null {
  const withoutQuery = rawUrl.split('?')[0] ?? '/';
  let decoded = withoutQuery;
  for (let round = 0; round < 2; round++) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return null;
    }
  }
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f]/u.test(decoded)) {
    return null;
  }
  // URL paths always use '/', so they must be normalized with POSIX semantics.
  // node:path's normalize turns '/' into '\' on Windows, which broke every route.
  const normalized = posix.normalize(decoded);
  if (normalized.includes('..')) {
    return null;
  }
  return normalized.startsWith('/') ? normalized : '/' + normalized;
}

function isContained(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + sep);
}
