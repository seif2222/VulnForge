import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { maxSatisfying } from './npm-semver.js';
import type { PackageEntry, UnresolvedRequirement } from './types.js';

export const NPM_REGISTRY_ENDPOINT = 'https://registry.npmjs.org';
export const REGISTRY_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
export const REGISTRY_TIMEOUT_MS = 10_000;

export const REGISTRY_ERROR_CODES = [
  'network-unavailable',
  'timeout',
  'http-error',
  'not-found',
  'malformed-response',
] as const;

export type RegistryErrorCode = (typeof REGISTRY_ERROR_CODES)[number];

/** A failure to reach or understand the npm registry. Never a finding problem. */
export class RegistryError extends Error {
  readonly code: RegistryErrorCode;
  readonly status: number | null;

  constructor(code: RegistryErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = 'RegistryError';
    this.code = code;
    this.status = status;
  }
}

export interface RegistryPackageMetadata {
  readonly versions: readonly string[];
  readonly distTags: Readonly<Record<string, string>>;
}

/** The injectable registry layer. Tests pass their own; core never calls fetch directly. */
export interface NpmRegistry {
  metadata(name: string): Promise<RegistryPackageMetadata>;
}

export interface NpmRegistryOptions {
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  /** Injected for tests; must behave like `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Metadata cache directory; default ~/.vulnforge/cache/npm-meta. Pass null to disable. */
  readonly cacheDir?: string | null;
  readonly cacheTtlMs?: number;
  readonly now?: () => number;
  readonly signal?: AbortSignal;
}

interface CacheFile {
  readonly recordedAt: number;
  readonly versions: readonly string[];
  readonly distTags: Readonly<Record<string, string>>;
}

function defaultCacheDir(): string {
  return join(homedir(), '.vulnforge', 'cache', 'npm-meta');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMetadata(name: string, body: unknown): RegistryPackageMetadata {
  if (!isRecord(body) || !isRecord(body['versions'])) {
    throw new RegistryError(
      'malformed-response',
      `registry metadata for "${name}" has no versions object`,
    );
  }
  const versions = Object.keys(body['versions']);
  const rawTags = body['dist-tags'];
  const distTags: Record<string, string> = {};
  if (isRecord(rawTags)) {
    for (const [tag, version] of Object.entries(rawTags)) {
      if (typeof version === 'string') {
        distTags[tag] = version;
      }
    }
  }
  return { versions, distTags };
}

export function createNpmRegistry(options: NpmRegistryOptions = {}): NpmRegistry {
  const endpoint = options.endpoint ?? NPM_REGISTRY_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? REGISTRY_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? fetch;
  const cacheDir = options.cacheDir === null ? null : (options.cacheDir ?? defaultCacheDir());
  const ttlMs = options.cacheTtlMs ?? REGISTRY_CACHE_TTL_MS;
  const now = options.now ?? (() => Date.now());

  const readCache = (path: string): CacheFile | null => {
    if (!existsSync(path)) {
      return null;
    }
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      if (
        isRecord(parsed) &&
        typeof parsed['recordedAt'] === 'number' &&
        Array.isArray(parsed['versions'])
      ) {
        return parsed as unknown as CacheFile;
      }
      return null;
    } catch {
      return null;
    }
  };

  return {
    async metadata(name: string): Promise<RegistryPackageMetadata> {
      const cachePath =
        cacheDir === null ? null : join(cacheDir, `${encodeURIComponent(name)}.json`);
      const cached = cachePath === null ? null : readCache(cachePath);
      if (cached !== null && now() - cached.recordedAt < ttlMs) {
        return { versions: cached.versions, distTags: cached.distTags };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = (): void => controller.abort();
      options.signal?.addEventListener('abort', onAbort, { once: true });
      let response: Response;
      try {
        response = await doFetch(`${endpoint}/${encodeURIComponent(name)}`, {
          headers: { accept: 'application/json' },
          signal: controller.signal,
        });
      } catch (error) {
        if (options.signal?.aborted === true) {
          throw error;
        }
        // Graceful degrade: a stale cache beats no answer when the network is gone.
        if (cached !== null) {
          return { versions: cached.versions, distTags: cached.distTags };
        }
        const timedOut = error instanceof Error && error.name === 'AbortError';
        throw new RegistryError(
          timedOut ? 'timeout' : 'network-unavailable',
          timedOut
            ? `npm registry did not answer within ${timeoutMs}ms`
            : `npm registry unreachable: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
      }

      if (response.status === 404) {
        throw new RegistryError('not-found', `npm registry has no package named "${name}"`, 404);
      }
      if (!response.ok) {
        if (cached !== null) {
          return { versions: cached.versions, distTags: cached.distTags };
        }
        throw new RegistryError(
          'http-error',
          `npm registry answered HTTP ${response.status}`,
          response.status,
        );
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new RegistryError(
          'malformed-response',
          `registry metadata for "${name}" is not JSON`,
        );
      }
      const metadata = parseMetadata(name, body);
      if (cachePath !== null) {
        try {
          mkdirSync(cacheDir as string, { recursive: true });
          const record: CacheFile = {
            recordedAt: now(),
            versions: metadata.versions,
            distTags: metadata.distTags,
          };
          writeFileSync(cachePath, `${JSON.stringify(record)}\n`, 'utf8');
        } catch {
          // A cache write failure never fails a scan.
        }
      }
      return metadata;
    },
  };
}

/** Which manifest-only reasons the registry can answer. */
const REGISTRY_RESOLVABLE: ReadonlySet<string> = new Set([
  'not-pinned',
  'wildcard-pin',
  'multiple-pins',
]);

export interface RegistryResolution {
  /** Newly resolved direct packages (depth 0). */
  readonly packages: readonly PackageEntry[];
  /** Requirements the registry could not resolve, kept for honest meta. */
  readonly unresolved: readonly UnresolvedRequirement[];
  readonly warnings: readonly string[];
}

/** Picks a concrete version for one specifier: a dist-tag first, then max-satisfying. */
export function pickRegistryVersion(
  metadata: RegistryPackageMetadata,
  specifier: string,
): string | null {
  const trimmed = specifier.trim();
  if (trimmed === '' || trimmed === '*') {
    return metadata.distTags['latest'] ?? null;
  }
  const tagged = metadata.distTags[trimmed];
  if (tagged !== undefined) {
    return tagged;
  }
  return maxSatisfying(metadata.versions, trimmed);
}

/**
 * Resolves manifest ranges against registry metadata so a lockfile-less project
 * still scans. Resolution never fails the scan: unreachable registries, missing
 * packages and unsupported specifiers stay unresolved with a named warning.
 */
export async function resolveManifestRanges(
  projectDir: string,
  unresolved: readonly UnresolvedRequirement[],
  registry: NpmRegistry,
  signal?: AbortSignal,
): Promise<RegistryResolution> {
  // devDependencies is the only section distinction worth preserving; best effort.
  const devNames = new Set<string>();
  try {
    const manifest = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8')) as unknown;
    if (isRecord(manifest) && isRecord(manifest['devDependencies'])) {
      for (const name of Object.keys(manifest['devDependencies'])) {
        devNames.add(name);
      }
    }
  } catch {
    // The manifest parsed fine earlier; a re-read failure just means isDev stays null.
  }

  const resolved: PackageEntry[] = [];
  const left: UnresolvedRequirement[] = [];
  let unreachable = 0;
  let noMatch = 0;

  for (const entry of unresolved) {
    if (signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    if (!REGISTRY_RESOLVABLE.has(entry.reason)) {
      left.push(entry);
      continue;
    }
    try {
      const metadata = await registry.metadata(entry.name);
      const version = pickRegistryVersion(metadata, entry.specifier);
      if (version === null) {
        noMatch += 1;
        left.push(entry);
        continue;
      }
      resolved.push({
        name: entry.name,
        version,
        isDirect: true,
        depth: 0,
        parents: [],
        isDev: devNames.size === 0 ? null : devNames.has(entry.name),
      });
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      unreachable += 1;
      left.push(entry);
    }
  }

  const warnings: string[] = [];
  if (resolved.length > 0) {
    warnings.push(
      `${resolved.length} package(s) resolved from the npm registry (no lockfile): latest versions matching each range, which may differ from an installed tree`,
    );
  }
  if (unreachable > 0) {
    warnings.push(
      `${unreachable} requirement(s) stayed unresolved: the npm registry did not have them or was unreachable`,
    );
  }
  if (noMatch > 0) {
    warnings.push(`${noMatch} requirement(s) matched no published version of their package`);
  }
  return { packages: resolved, unresolved: left, warnings };
}
