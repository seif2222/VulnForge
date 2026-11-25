import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArgs } from './args.js';
import { runCli } from './run.js';
import { captureIo } from './test-helpers.js';

describe('opt-in source CLI', () => {
  it('never enables source inference on ordinary scans', () => {
    const result = parseArgs(['scan', '.']);
    expect(result.kind).toBe('analyze');
    expect(JSON.stringify(result)).not.toContain('source');
  });
  it('requires a configured endpoint before reading a project', async () => {
    const captured = captureIo();
    expect(await runCli(['source', '/not/a/project'], captured.io)).toBe(2);
    expect(captured.stderr()).toContain('no code read or sent');
  });
  it.each(['NaN', 'Infinity', 'oops', ''])('rejects invalid threshold %s', (value) => {
    expect(parseArgs(['source', '.', '--threshold', value]).kind).toBe('usage-error');
  });
  it('runs the separate source pipeline without an npm/Python manifest and writes no OSV findings', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'forge-source-cli-'));
    writeFileSync(join(cwd, 'test.c'), 'int f() { return 1; }');
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        const data = JSON.parse(body) as { functionId: string };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            contract: 'forge-source-v1',
            functionId: data.functionId,
            modelId: 'mock-not-real-forge',
            adapterSha256: 'b'.repeat(64),
            score: 1,
            truncated: false,
          }),
        );
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.address();
      if (address === null || typeof address === 'string')
        throw new Error('test server unavailable');
      const captured = captureIo({ cwd });
      const io = {
        ...captured.io,
        env: { VULNFORGE_SOURCE_ENDPOINT: `http://127.0.0.1:${address.port}/predict` },
      };
      expect(await runCli(['source', '.'], io)).toBe(0);
      const report: unknown = JSON.parse(
        readFileSync(join(cwd, 'forge-source-report.json'), 'utf8'),
      );
      expect(report).toMatchObject({ detector: 'forge-experimental', status: 'completed' });
      expect(report).not.toHaveProperty('vulnerabilities');
      expect(captured.stderr()).toContain('unconfirmed candidate');
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
