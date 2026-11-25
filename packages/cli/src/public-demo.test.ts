import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startDashboardServer, type AnalyzeFn, type RunningServer } from './dashboard-server.js';

/** Public demo mode: no path scans, no structure, no history, manifest whitelist, rate limit. */

let server: RunningServer;
let base: string;
let seenDir = '';

const analyze: AnalyzeFn = (options) => {
  seenDir = options.projectDir;
  return Promise.resolve({
    ok: false,
    cancelled: false,
    error: { code: 'stub', message: 'stub engine' },
  } as never);
};

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vulnforge-public-test-'));
  const assets = join(dir, 'assets');
  mkdirSync(assets, { recursive: true });
  writeFileSync(join(assets, 'index.html'), '<!doctype html><title>vf</title>');
  server = await startDashboardServer({
    port: 0,
    assetsRoot: assets,
    toolVersion: 't',
    aiAvailable: false,
    analyze,
    publicDemo: { host: '127.0.0.1', maxScansPerWindow: 2, windowMs: 60_000, scanTimeoutMs: 5_000 },
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server.close();
});

async function post(body: unknown): Promise<Response> {
  return fetch(`${base}/api/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify(body),
  });
}

describe('public demo mode', () => {
  it('reports the public capability and serves empty history', async () => {
    const status = (await (await fetch(`${base}/api/status`)).json()) as {
      capabilities: { publicDemo?: boolean; ai: boolean };
    };
    expect(status.capabilities.publicDemo).toBe(true);
    expect(status.capabilities.ai).toBe(false);
    const history = (await (await fetch(`${base}/api/history`)).json()) as { reports: unknown[] };
    expect(history.reports).toEqual([]);
  });

  it('refuses structure listing and server path scans', async () => {
    expect((await fetch(`${base}/api/structure?path=/etc`)).status).toBe(404);
    expect((await post({ projectPath: '/etc' })).status).toBe(400);
  });

  it('only accepts whitelisted manifest names and valid JSON', async () => {
    expect((await post({ manifestName: '../evil.json', manifestContent: '{}' })).status).toBe(400);
    expect((await post({ manifestName: 'package.json', manifestContent: '{nope' })).status).toBe(
      400,
    );
  });

  it('scans a private temp dir that is removed afterwards, then rate limits', async () => {
    const first = await post({ manifestName: 'package.json', manifestContent: '{"name":"x"}' });
    expect(first.status).toBe(500); // stub engine error, but the scan ran
    expect(seenDir).toContain('vulnforge-public-');
    expect(readdirSync(tmpdir()).includes(seenDir.split(/[\\/]/).pop() ?? '')).toBe(false);
    await post({ manifestName: 'package.json', manifestContent: '{"name":"x"}' });
    const limited = await post({ manifestName: 'package.json', manifestContent: '{"name":"x"}' });
    expect(limited.status).toBe(429);
  });
});
