import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DashboardError,
  listStructure,
  startDashboardServer,
  type AnalyzeFn,
  type RunningServer,
  type SuggestFn,
} from './dashboard-server.js';

/**
 * Every security rule from the spec's section 4 has a test here, plus the cancel path
 * and the single-flight release. Tests run against a real listening server on
 * 127.0.0.1 with an injected engine stub, so no network and no osv.dev.
 */

const fixtureReport = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../fixtures/reports/with-vulnerabilities.json', import.meta.url)),
    'utf8',
  ),
) as unknown;

let workDir: string;
let assetsRoot: string;
let reportPath: string;
let server: RunningServer;
let base: string;

function okAnalyze(report: unknown = fixtureReport): AnalyzeFn {
  return (options) => {
    options.onProgress?.({ done: 1, total: 2, package: 'lodash@4.17.20' });
    options.onProgress?.({ done: 2, total: 2, package: 'minimist@1.2.5' });
    return Promise.resolve({
      ok: true,
      report: report as never,
      reportPath: options.outPath ?? null,
    });
  };
}

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'vulnforge-server-test-'));
  assetsRoot = join(workDir, 'assets');
  rmSync(assetsRoot, { recursive: true, force: true });
  const { mkdirSync } = await import('node:fs');
  mkdirSync(assetsRoot, { recursive: true });
  writeFileSync(join(assetsRoot, 'index.html'), '<!doctype html><title>vf</title>');
  writeFileSync(join(assetsRoot, 'app.js'), 'console.log("vf")');
  reportPath = join(workDir, 'report.json');
  writeFileSync(reportPath, JSON.stringify(fixtureReport));

  server = await startDashboardServer({
    port: 0,
    reportPath,
    assetsRoot,
    toolVersion: '0.1.0-test',
    aiAvailable: false,
    analyze: okAnalyze(),
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server.close();
  rmSync(workDir, { recursive: true, force: true });
});

function rawRequest(
  path: string,
  headers: Record<string, string>,
  method = 'GET',
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = httpRequest(
      { host: '127.0.0.1', port: server.port, path, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolvePromise({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', rejectPromise);
    req.end();
  });
}

/** Reads an SSE stream until `done(body)` is true, then cancels. `trigger` runs after subscribing. */
async function readSseUntil(
  port: number,
  done: (body: string) => boolean,
  trigger?: () => Promise<void>,
): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/api/scan/events`);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = (res.body as ReadableStream<Uint8Array> | null)?.getReader();
  if (reader === undefined) {
    throw new Error('no SSE body');
  }
  let body = '';
  const decoder = new TextDecoder();
  const pump = (async () => {
    for (;;) {
      const { value, done: ended } = await reader.read();
      if (ended) {
        break;
      }
      body += decoder.decode(value, { stream: true });
      if (done(body)) {
        break;
      }
    }
  })();
  await trigger?.();
  await pump;
  await reader.cancel();
  return body;
}

describe('dashboard server: host and origin rules', () => {
  it('rejects a foreign Host header', async () => {
    const res = await rawRequest('/api/status', { host: 'evil.example.com' });
    expect(res.status).toBe(403);
  });

  it('accepts localhost:<port> as Host', async () => {
    const res = await rawRequest('/api/status', { host: `localhost:${server.port}` });
    expect(res.status).toBe(200);
  });

  it('rejects a foreign Origin and never emits CORS headers', async () => {
    const res = await rawRequest('/api/status', {
      host: `127.0.0.1:${server.port}`,
      origin: 'https://evil.example.com',
    });
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('accepts a same-host Origin', async () => {
    const res = await rawRequest('/api/status', {
      host: `127.0.0.1:${server.port}`,
      origin: `http://127.0.0.1:${server.port}`,
    });
    expect(res.status).toBe(200);
  });
});

describe('dashboard server: security headers', () => {
  it('sends the strict CSP and friends on a 200', async () => {
    const res = await fetch(`${base}/api/status`);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('sends the same headers on errors', async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('dashboard server: URL hardening', () => {
  it('rejects overlong URLs', async () => {
    const res = await fetch(`${base}/${'a'.repeat(3000)}`);
    expect(res.status).toBe(414);
  });

  it('rejects double-encoded traversal', async () => {
    const res = await fetch(`${base}/%252e%252e%252f%252e%252e%252fetc%252fpasswd`);
    expect([400, 403, 404]).toContain(res.status);
    expect(res.status).not.toBe(200);
  });

  it('rejects single-encoded traversal', async () => {
    const res = await rawRequest('/%2e%2e/%2e%2e/etc/passwd', {
      host: `127.0.0.1:${server.port}`,
    });
    expect(res.status).not.toBe(200);
    expect(res.body).not.toContain('root:');
  });

  it('rejects backslashes in the URL', async () => {
    const res = await rawRequest('/app%5c..%5csecret', { host: `127.0.0.1:${server.port}` });
    expect(res.status).toBe(400);
  });

  it('contains static files under the assets root via realpath', async () => {
    const res = await fetch(`${base}/app.js`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('vf');
  });

  it('serves index.html at /', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });
});

describe('dashboard server: status and report routes', () => {
  it('/api/status exposes capability booleans only, never keys', async () => {
    const res = await fetch(`${base}/api/status`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['ok']).toBe(true);
    const caps = body['capabilities'] as Record<string, unknown>;
    for (const value of Object.values(caps)) {
      expect(typeof value).toBe('boolean');
    }
    expect(JSON.stringify(body)).not.toMatch(/key|token|secret/i);
  });

  it('/report.json returns the report validated at startup', async () => {
    const res = await fetch(`${base}/report.json`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { schemaVersion: number };
    expect(body.schemaVersion).toBe(6);
  });

  it('refuses to boot with an invalid startup report', async () => {
    const badPath = join(workDir, 'bad.json');
    writeFileSync(badPath, JSON.stringify({ nope: true }));
    await expect(
      startDashboardServer({
        port: 0,
        reportPath: badPath,
        assetsRoot,
        toolVersion: '0.1.0-test',
        aiAvailable: false,
      }),
    ).rejects.toBeInstanceOf(DashboardError);
  });

  it('refuses to boot when assets are missing', async () => {
    await expect(
      startDashboardServer({
        port: 0,
        assetsRoot: join(workDir, 'nowhere'),
        toolVersion: '0.1.0-test',
        aiAvailable: false,
      }),
    ).rejects.toMatchObject({ code: 'assets-missing' });
  });
});

describe('dashboard server: scan route', () => {
  it('caps the scan body at 64 KiB', async () => {
    const res = await fetch(`${base}/api/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectPath: '/x', pad: 'a'.repeat(70 * 1024) }),
    });
    expect(res.status).toBe(413);
  });

  it('rejects a body without a projectPath', async () => {
    const res = await fetch(`${base}/api/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('runs a scan single-flight and returns a validated report', async () => {
    const res = await fetch(`${base}/api/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectPath: '/repo/demo' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { schemaVersion: number };
    expect(body.schemaVersion).toBe(6);
  });

  it('409s a second concurrent scan and releases single-flight in a finally', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    const slow = await startDashboardServer({
      port: 0,
      assetsRoot,
      toolVersion: '0.1.0-test',
      aiAvailable: false,
      analyze: async (options) => {
        await gate;
        return { ok: true, report: fixtureReport as never, reportPath: options.outPath ?? null };
      },
    });
    try {
      const first = fetch(`http://127.0.0.1:${slow.port}/api/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectPath: '/repo/demo' }),
      });
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      const second = await fetch(`http://127.0.0.1:${slow.port}/api/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectPath: '/repo/other' }),
      });
      expect(second.status).toBe(409);
      release();
      const firstRes = await first;
      expect(firstRes.status).toBe(200);
      // The lease was released: the next scan is not a 409.
      const third = await fetch(`http://127.0.0.1:${slow.port}/api/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectPath: '/repo/third' }),
      });
      expect(third.status).toBe(200);
    } finally {
      release();
      await slow.close();
    }
  });

  it('aborts the engine when the client disconnects mid-scan and removes the temp dir', async () => {
    let sawAbort = false;
    let tempSeen = '';
    const blocking = await startDashboardServer({
      port: 0,
      assetsRoot,
      toolVersion: '0.1.0-test',
      aiAvailable: false,
      analyze: async (options) => {
        tempSeen = options.outPath ?? '';
        await new Promise<void>((resolvePromise) => {
          options.signal?.addEventListener('abort', () => {
            sawAbort = true;
            resolvePromise();
          });
        });
        return { ok: false, cancelled: true };
      },
    });
    try {
      const controller = new AbortController();
      const pending = fetch(`http://127.0.0.1:${blocking.port}/api/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectPath: '/repo/demo' }),
        signal: controller.signal,
      });
      pending.catch(() => undefined);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      controller.abort();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
      expect(sawAbort).toBe(true);
      expect(tempSeen).not.toBe('');
      // The per-request temp dir is always removed.
      const tempDir = tempSeen.slice(0, tempSeen.lastIndexOf('/'));
      expect(() => readFileSync(join(tempDir, 'report.json'))).toThrow();
      const { existsSync } = await import('node:fs');
      expect(existsSync(tempDir)).toBe(false);
      // (Single-flight release after cancellation is covered by the 409 test above.)
    } finally {
      await blocking.close();
    }
  });

  it('streams the real progress events over SSE with package identity', async () => {
    const sse = await startDashboardServer({
      port: 0,
      assetsRoot,
      toolVersion: '0.1.0-test',
      aiAvailable: false,
      analyze: okAnalyze(),
    });
    try {
      // Subscribe first, then launch - the persistent channel replays nothing but
      // delivers every event from subscription onward.
      const stream = await readSseUntil(
        sse.port,
        (body) => body.includes('"state":"completed"'),
        async () => {
          await fetch(`http://127.0.0.1:${sse.port}/api/scan`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ projectPath: '/repo/demo' }),
          });
        },
      );
      expect(stream).toContain('event: progress');
      expect(stream).toContain('"done":1');
      expect(stream).toContain('"total":2');
      expect(stream).toContain('lodash@4.17.20');
      expect(stream).toContain('minimist@1.2.5');
      expect(stream).toContain('event: state');
      expect(stream).toContain('"state":"completed"');
    } finally {
      await sse.close();
    }
  });
  it('reports the live state on the events channel, idle included', async () => {
    const body = await readSseUntil(server.port, (text) => text.includes('"state":"idle"'));
    expect(body).toContain('event: state');
    expect(body).toContain('"state":"idle"');
  });
});
describe('dashboard server: scan route aiExplanations', () => {
  // The fixture already carries one suggestion (PyYAML); the Forge pass adds one for requests.
  const forgeSuggestion = {
    findingKey: 'CVE-2018-18074|requests@2.19.1',
    saferVersion: '2.20.0',
    alternativePackage: null,
    rationale: 'upgrade past the vulnerable line',
    provider: 'llm' as const,
  };

  async function startWith(suggest: SuggestFn): Promise<RunningServer> {
    return startDashboardServer({
      port: 0,
      assetsRoot,
      toolVersion: '0.1.0-test',
      aiAvailable: true,
      analyze: okAnalyze(),
      suggest,
    });
  }

  async function postScan(port: number, aiExplanations: boolean): Promise<unknown> {
    const res = await fetch(`http://127.0.0.1:${port}/api/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectPath: '/repo/demo', aiExplanations }),
    });
    expect(res.status).toBe(200);
    return res.json();
  }

  it('attaches Forge suggestions when the client asks and a provider is wired', async () => {
    const ai = await startWith((report) =>
      Promise.resolve({ ...report, suggestions: [...report.suggestions, forgeSuggestion] }),
    );
    try {
      const body = (await postScan(ai.port, true)) as {
        suggestions: { findingKey: string; provider: string }[];
      };
      expect(body.suggestions).toHaveLength(2);
      const added = body.suggestions.find(
        (entry) => entry.findingKey === forgeSuggestion.findingKey,
      );
      expect(added?.provider).toBe('llm');
    } finally {
      await ai.close();
    }
  });

  it('does not run the Forge pass when the client does not ask', async () => {
    let calls = 0;
    const ai = await startWith((report) => {
      calls += 1;
      return Promise.resolve(report);
    });
    try {
      const body = (await postScan(ai.port, false)) as { suggestions: unknown[] };
      expect(body.suggestions).toHaveLength(1);
      expect(calls).toBe(0);
    } finally {
      await ai.close();
    }
  });

  it('ignores aiExplanations when no provider is wired', async () => {
    // The shared test server has no suggest pass configured.
    const body = (await postScan(server.port, true)) as { suggestions: unknown[] };
    expect(body.suggestions).toHaveLength(1);
  });

  it('keeps the base report when the Forge pass throws', async () => {
    const ai = await startWith(() => Promise.reject(new Error('provider down')));
    try {
      const body = (await postScan(ai.port, true)) as { suggestions: unknown[] };
      expect(body.suggestions).toHaveLength(1);
    } finally {
      await ai.close();
    }
  });

  it('keeps the base report when the enriched report fails validation', async () => {
    const ai = await startWith((report) =>
      Promise.resolve({
        ...report,
        suggestions: [
          ...report.suggestions,
          { ...forgeSuggestion, findingKey: 'GHSA-0000-0000-0000|nope@1.0.0' },
        ],
      }),
    );
    try {
      const body = (await postScan(ai.port, true)) as { suggestions: unknown[] };
      expect(body.suggestions).toHaveLength(1);
    } finally {
      await ai.close();
    }
  });
});
describe('dashboard server: structure route', () => {
  it('lists the real tree with node_modules collapsed to package dirs', () => {
    const project = join(workDir, 'sample-project');
    mkdirSync(join(project, 'src', 'deep', 'deeper', 'tooDeep'), { recursive: true });
    mkdirSync(join(project, 'node_modules', 'lodash'), { recursive: true });
    mkdirSync(join(project, 'node_modules', '@scope', 'left-pad'), { recursive: true });
    mkdirSync(join(project, '.git', 'objects'), { recursive: true });
    writeFileSync(join(project, 'package.json'), '{}');
    writeFileSync(join(project, 'src', 'index.js'), '//');
    const { entries, truncated } = listStructure(project);
    expect(truncated).toBe(false);
    const paths = entries.map((entry) => entry.path);
    expect(paths).toContain('package.json');
    expect(paths).toContain('src');
    expect(paths).toContain('src/index.js');
    expect(paths).toContain('src/deep/deeper/tooDeep');
    expect(paths).toContain('node_modules');
    expect(paths).toContain('node_modules/lodash');
    expect(paths).toContain('node_modules/@scope/left-pad');
    // collapsed: nothing inside an installed package, nothing from .git
    expect(paths.some((p) => p.startsWith('node_modules/lodash/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('.git'))).toBe(false);
    // directories sort before files
    const names = entries.filter((e) => e.depth === 0).map((e) => e.path);
    expect(names.indexOf('node_modules')).toBeLessThan(names.indexOf('package.json'));
  });

  it('marks truncation instead of listing without end', () => {
    const project = join(workDir, 'wide-project');
    mkdirSync(project, { recursive: true });
    for (let i = 0; i < 450; i += 1) {
      writeFileSync(join(project, `file-${String(i).padStart(3, '0')}.txt`), 'x');
    }
    const { entries, truncated } = listStructure(project);
    expect(truncated).toBe(true);
    expect(entries.length).toBeLessThanOrEqual(400);
  });

  it('answers 404 for a missing path and 400 without a path param', async () => {
    const missing = await fetch(
      `${base}/api/structure?path=${encodeURIComponent(join(workDir, 'nope'))}`,
    );
    expect(missing.status).toBe(404);
    const bare = await fetch(`${base}/api/structure`);
    expect(bare.status).toBe(400);
    const ok = await fetch(`${base}/api/structure?path=${encodeURIComponent(workDir)}`);
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { root: string; entries: unknown[]; truncated: boolean };
    expect(body.root).toBe(workDir);
    expect(Array.isArray(body.entries)).toBe(true);
  });
});
