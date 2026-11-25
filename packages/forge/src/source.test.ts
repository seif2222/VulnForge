import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  extractCFunctions,
  scanSource,
  validateSourceEndpoint,
  type SourceFunction,
} from './source.js';

const dirs: string[] = [];
const endpoint = 'http://127.0.0.1:8765/predict';
const code = 'int test(int n) { return n + 1; }';
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-source-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'test.c'), code);
  return dir;
}
function reply(score: number, changes: Record<string, unknown> = {}): typeof fetch {
  return (_input, init) => {
    if (typeof init?.body !== 'string') throw new Error('expected JSON request');
    const request = JSON.parse(init.body) as { functionId: string; code: string };
    return Promise.resolve(
      new Response(
        JSON.stringify({
          contract: 'forge-source-v1',
          functionId: request.functionId,
          modelId: 'test-adapter',
          adapterSha256: 'a'.repeat(64),
          score,
          truncated: false,
          ...changes,
        }),
      ),
    );
  };
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('C function extraction', () => {
  it('keeps exact source and line bounds; ignores braces in comments and strings', () => {
    const source =
      '#include <stdio.h>\nint one() { /* } */ puts("{"); return 1; }\n\nint two() { return 2; }';
    const functions = extractCFunctions(source, 'test.c');
    expect(functions.map((fn) => [fn.name, fn.startLine, fn.endLine])).toEqual([
      ['one', 2, 2],
      ['two', 4, 4],
    ]);
    expect(functions[0]?.code).toBe('int one() { /* } */ puts("{"); return 1; }');
    expect(functions[0]?.id).toMatch(/^[a-f0-9]{64}$/u);
  });
  it('ignores declarations and incomplete braces', () => {
    expect(extractCFunctions('int f();\nint f() {', 'x.c')).toEqual([]);
    expect(extractCFunctions('struct A { int x; };', 'x.c')).toEqual([]);
  });
});

describe('source detector', () => {
  it('uses raw logit-margin threshold inclusively, never creates CVEs or calibrated probabilities', async () => {
    const result = await scanSource(fixture(), { endpoint, fetch: reply(0) });
    expect(result.status).toBe('completed');
    expect(result.predictions).toEqual([
      {
        functionId: result.functions[0]?.id,
        score: 0,
        candidate: true,
        status: 'unconfirmed-model-prediction',
        severity: 'unknown',
      },
    ]);
    expect((result.functions[0] as SourceFunction).code).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('return n');
  });
  it('does not call a negative prediction safe and supports explicit thresholds', async () => {
    const result = await scanSource(fixture(), { endpoint, threshold: 1, fetch: reply(0.9) });
    expect(result.predictions[0]?.candidate).toBe(false);
    expect(result.warnings.join(' ')).toContain('not proof of safety');
  });
  it.each([
    { contract: 'other' },
    { functionId: 'wrong' },
    { score: '0.8' },
    { score: null },
    { truncated: true },
    { adapterSha256: 'missing' },
    { modelId: '' },
  ])('rejects invalid model response %j', async (change) => {
    const result = await scanSource(fixture(), { endpoint, fetch: reply(2, change) });
    expect(result.status).toBe('unavailable');
    expect(result.predictions).toEqual([]);
  });
  it('fails closed on response size, HTTP error, network failure or cancellation', async () => {
    const fetches: (typeof fetch)[] = [
      () => Promise.resolve(new Response('x'.repeat(17000))),
      () => Promise.resolve(new Response('', { status: 503 })),
      () => Promise.reject(new Error('offline')),
    ];
    for (const fake of fetches) {
      const result = await scanSource(fixture(), { endpoint, fetch: fake });
      expect(result.status).toBe('unavailable');
      expect(result.predictions).toHaveLength(0);
    }
  });
  it('skips macros, oversized functions, unsupported languages, excluded folders and symlinks', async () => {
    const dir = fixture();
    writeFileSync(join(dir, 'macro.c'), '#ifdef TEST\nint f(){ return 0; }\n#endif');
    writeFileSync(join(dir, 'large.c'), `int large(){ /* ${'x'.repeat(3501)} */ return 0; }`);
    writeFileSync(join(dir, 'ignored.py'), 'print(1)');
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', 'ignored.c'), code);
    symlinkSync(join(dir, 'test.c'), join(dir, 'linked.c'));
    const result = await scanSource(dir, { endpoint, fetch: reply(1) });
    expect(result.status).toBe('partial');
    expect(result.predictions).toHaveLength(1);
    expect(result.skipped).toHaveLength(4);
  });
  it('does not call an empty project clean', async () => {
    const dir = fixture();
    rmSync(join(dir, 'test.c'));
    const result = await scanSource(dir, { endpoint, fetch: reply(1) });
    expect(result.status).toBe('partial');
    expect(result.predictions).toHaveLength(0);
  });
  it('stops if adapter identity changes mid-scan', async () => {
    const dir = fixture();
    writeFileSync(join(dir, 'second.c'), code);
    let calls = 0;
    const fake: typeof fetch = (input, init) =>
      reply(1, { modelId: ++calls === 1 ? 'one' : 'two' })(input, init);
    const result = await scanSource(dir, { endpoint, fetch: fake });
    expect(result.status).toBe('partial');
    expect(result.predictions).toHaveLength(1);
  });
  it.each([
    'https://example.com/predict',
    'http://localhost:8765/predict',
    'http://127.0.0.1.evil.test/',
    'http://user:pass@127.0.0.1:8765/',
    'file:///etc/passwd',
    'http://127.0.0.1:8765/?key=x',
  ])('forbids source disclosure to %s', (url) => {
    expect(() => validateSourceEndpoint(url)).toThrow();
  });
  it('permits explicit IPv6 loopback', () => {
    expect(validateSourceEndpoint('http://[::1]:8765/predict').hostname).toBe('[::1]');
  });
});
