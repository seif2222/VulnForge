import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { RegistryError, createNpmRegistry, pickRegistryVersion } from './npm-registry.js';

const BODY = {
  versions: { '1.0.0': {}, '1.2.0': {}, '2.0.0': {} },
  'dist-tags': { latest: '2.0.0' },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let dir = '';
function cacheDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'vulnforge-registry-test-'));
  return dir;
}

afterEach(() => {
  if (dir !== '') {
    rmSync(dir, { recursive: true, force: true });
    dir = '';
  }
});

describe('createNpmRegistry', () => {
  it('parses registry metadata into versions and dist-tags', async () => {
    let calls = 0;
    const registry = createNpmRegistry({
      cacheDir: null,
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(jsonResponse(BODY));
      },
    });
    const meta = await registry.metadata('lodash');
    expect(meta.versions).toEqual(['1.0.0', '1.2.0', '2.0.0']);
    expect(meta.distTags['latest']).toBe('2.0.0');
    expect(calls).toBe(1);
  });

  it('maps a 404 to a not-found error', async () => {
    const registry = createNpmRegistry({
      cacheDir: null,
      fetchImpl: () => Promise.resolve(jsonResponse({}, 404)),
    });
    await expect(registry.metadata('no-such-package')).rejects.toMatchObject({
      code: 'not-found',
      status: 404,
    });
  });

  it('serves a fresh cache entry without fetching', async () => {
    let calls = 0;
    const fetchImpl = (): Promise<Response> => {
      calls += 1;
      return Promise.resolve(jsonResponse(BODY));
    };
    const registry = createNpmRegistry({ cacheDir: cacheDir(), fetchImpl });
    await registry.metadata('lodash');
    const again = createNpmRegistry({ cacheDir: dir, fetchImpl });
    const meta = await again.metadata('lodash');
    expect(meta.versions).toContain('2.0.0');
    expect(calls).toBe(1);
  });

  it('falls back to a stale cache entry when the network is gone', async () => {
    const target = cacheDir();
    const online = createNpmRegistry({
      cacheDir: target,
      fetchImpl: () => Promise.resolve(jsonResponse(BODY)),
      now: () => 1_000,
    });
    await online.metadata('lodash');
    const offline = createNpmRegistry({
      cacheDir: target,
      fetchImpl: () => Promise.reject(new Error('ECONNREFUSED')),
      now: () => 999_999_999,
    });
    const meta = await offline.metadata('lodash');
    expect(meta.distTags['latest']).toBe('2.0.0');
  });

  it('throws network-unavailable when offline with no cache', async () => {
    const registry = createNpmRegistry({
      cacheDir: null,
      fetchImpl: () => Promise.reject(new Error('ENOTFOUND')),
    });
    await expect(registry.metadata('lodash')).rejects.toBeInstanceOf(RegistryError);
    await expect(registry.metadata('lodash')).rejects.toMatchObject({
      code: 'network-unavailable',
    });
  });

  it('rejects a malformed metadata body', async () => {
    const registry = createNpmRegistry({
      cacheDir: null,
      fetchImpl: () => Promise.resolve(jsonResponse({ name: 'lodash' })),
    });
    await expect(registry.metadata('lodash')).rejects.toMatchObject({
      code: 'malformed-response',
    });
  });
});

describe('pickRegistryVersion', () => {
  const meta = { versions: ['1.0.0', '1.2.3', '1.3.0', '2.0.0'], distTags: { latest: '2.0.0' } };

  it('prefers the dist-tag for wildcard ranges', () => {
    expect(pickRegistryVersion(meta, '*')).toBe('2.0.0');
  });

  it('picks the highest version matching the range', () => {
    expect(pickRegistryVersion(meta, '^1.0.0')).toBe('1.3.0');
    expect(pickRegistryVersion(meta, '~1.2.0')).toBe('1.2.3');
    expect(pickRegistryVersion(meta, '^3.0.0')).toBeNull();
  });
});
