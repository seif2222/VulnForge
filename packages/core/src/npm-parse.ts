import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { ProjectParseError } from './errors.js';
import { packageId, sortPackageEntries } from './package-key.js';
import type { PackageEntry, UnresolvedReason, UnresolvedRequirement } from './types.js';

const MANIFEST_FILE = 'package.json';
const LOCKFILE = 'package-lock.json';
const NODE_MODULES = 'node_modules/';

export const SUPPORTED_LOCKFILE_VERSIONS = [2, 3] as const;

export interface NpmProject {
  readonly ecosystem: 'npm';
  readonly projectName: string;
  readonly manifestPath: string;
  readonly packages: readonly PackageEntry[];
  /** Installed packages that nothing in the dependency graph requires. */
  readonly orphans: readonly string[];
  /** Recoverable problems, e.g. a manifest dependency missing from the lockfile. */
  readonly warnings: readonly string[];
  /** Empty on the lockfile path; non-pinned requirements on the manifest-only path. */
  readonly unresolved: readonly UnresolvedRequirement[];
}

interface InstalledPackage {
  readonly path: string;
  readonly name: string;
  readonly version: string;
  /** true for a dev-only dependency, false for production. */
  readonly isDev: boolean | null;
}

type InstalledIndex = ReadonlyMap<string, InstalledPackage>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(
  path: string,
  malformedCode: 'malformed-manifest' | 'malformed-lockfile',
): unknown {
  const text = readFileSync(path, 'utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'invalid JSON';
    throw new ProjectParseError(malformedCode, path, detail);
  }
}

/** Reads a dependency map such as `dependencies`, rejecting anything that is not one. */
function dependencyMap(
  source: Record<string, unknown>,
  key: string,
  path: string,
  malformedCode: 'malformed-manifest' | 'malformed-lockfile',
): Readonly<Record<string, string>> {
  const value = source[key];
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new ProjectParseError(malformedCode, path, `"${key}" must be an object`);
  }
  const result: Record<string, string> = {};
  for (const [name, range] of Object.entries(value)) {
    if (typeof range !== 'string') {
      throw new ProjectParseError(malformedCode, path, `"${key}.${name}" must be a string`);
    }
    result[name] = range;
  }
  return result;
}

/**
 * Resolves a dependency the way Node does: look in the requiring package's own
 * `node_modules`, then walk up towards the project root. Lockfile paths are never treated
 * as depth, because npm hoists and dedupes.
 */
function resolveFrom(
  installed: InstalledIndex,
  fromPath: string,
  name: string,
): string | undefined {
  let prefix = fromPath;
  for (;;) {
    const candidate = prefix === '' ? `${NODE_MODULES}${name}` : `${prefix}/${NODE_MODULES}${name}`;
    const found = installed.get(candidate);
    if (found !== undefined) {
      return candidate;
    }
    if (prefix === '') {
      return undefined;
    }
    const parent = prefix.lastIndexOf(`/${NODE_MODULES}`);
    prefix = parent === -1 ? '' : prefix.slice(0, parent);
  }
}

function nameFromPath(path: string): string {
  return path.slice(path.lastIndexOf(NODE_MODULES) + NODE_MODULES.length);
}

/**
 * Reads an npm project: every installed package keyed by `name@version`, with `isDirect`,
 * `depth` (shortest distance from the manifest) and `parents` taken from the dependency
 * graph rather than from lockfile paths, because npm hoists and dedupes.
 */
export function parseNpm(projectDir: string): NpmProject {
  const manifestPath = join(projectDir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw new ProjectParseError('missing-manifest', manifestPath, 'file does not exist');
  }
  const rawManifest = readJson(manifestPath, 'malformed-manifest');
  if (!isRecord(rawManifest)) {
    throw new ProjectParseError('malformed-manifest', manifestPath, 'expected a JSON object');
  }

  const lockPath = join(projectDir, LOCKFILE);
  if (!existsSync(lockPath)) {
    throw new ProjectParseError('missing-lockfile', lockPath, 'file does not exist');
  }
  const rawLock = readJson(lockPath, 'malformed-lockfile');
  if (!isRecord(rawLock)) {
    throw new ProjectParseError('malformed-lockfile', lockPath, 'expected a JSON object');
  }

  const lockfileVersion = rawLock['lockfileVersion'];
  if (
    typeof lockfileVersion !== 'number' ||
    !SUPPORTED_LOCKFILE_VERSIONS.includes(lockfileVersion as 2 | 3)
  ) {
    throw new ProjectParseError(
      'unsupported-lockfile-version',
      lockPath,
      `lockfileVersion ${JSON.stringify(lockfileVersion ?? null)} is not one of ${SUPPORTED_LOCKFILE_VERSIONS.join(', ')}`,
    );
  }

  const rawPackages = rawLock['packages'];
  if (!isRecord(rawPackages)) {
    throw new ProjectParseError('malformed-lockfile', lockPath, '"packages" must be an object');
  }

  const installed = new Map<string, InstalledPackage>();
  for (const [path, value] of Object.entries(rawPackages)) {
    if (path === '' || !isRecord(value) || value['link'] === true) {
      continue;
    }
    const entryVersion = value['version'];
    if (typeof entryVersion !== 'string' || entryVersion.length === 0) {
      continue;
    }
    installed.set(path, {
      path,
      name: nameFromPath(path),
      version: entryVersion,
      // npm writes dev: true only for dev-only entries, so its absence means production.
      isDev: value['dev'] === true,
    });
  }

  const installedByName = new Map<string, InstalledPackage[]>();
  for (const entry of installed.values()) {
    const existing = installedByName.get(entry.name) ?? [];
    existing.push(entry);
    installedByName.set(entry.name, existing);
  }

  const warnings: string[] = [];
  const resolveDependency = (fromPath: string, name: string): string | undefined => {
    const resolved = resolveFrom(installed, fromPath, name);
    if (resolved !== undefined) {
      return resolved;
    }
    const candidates = installedByName.get(name) ?? [];
    const only = candidates.length === 1 ? candidates[0] : undefined;
    if (only !== undefined) {
      warnings.push(`"${name}" required by "${fromPath || '<project>'}" is installed elsewhere`);
      return only.path;
    }
    return undefined;
  };

  const manifestDependencies = {
    ...dependencyMap(rawManifest, 'dependencies', manifestPath, 'malformed-manifest'),
    ...dependencyMap(rawManifest, 'devDependencies', manifestPath, 'malformed-manifest'),
    ...dependencyMap(rawManifest, 'optionalDependencies', manifestPath, 'malformed-manifest'),
  };

  const rootPaths: string[] = [];
  for (const name of Object.keys(manifestDependencies).sort()) {
    const resolved = resolveDependency('', name);
    if (resolved === undefined) {
      warnings.push(`manifest dependency "${name}" is not in the lockfile`);
      continue;
    }
    rootPaths.push(resolved);
  }

  const depthByPath = new Map<string, number>();
  const parentsByPath = new Map<string, Set<string>>();
  const queue: string[] = [];
  for (const path of rootPaths) {
    if (!depthByPath.has(path)) {
      depthByPath.set(path, 0);
      queue.push(path);
    }
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const path = queue[cursor];
    if (path === undefined) {
      continue;
    }
    const entry = installed.get(path);
    const parentDepth = depthByPath.get(path);
    if (entry === undefined || parentDepth === undefined) {
      continue;
    }
    const parentId = packageId(entry.name, entry.version);
    const rawEntry = rawPackages[path];
    const declared = isRecord(rawEntry)
      ? {
          ...dependencyMap(rawEntry, 'dependencies', lockPath, 'malformed-lockfile'),
          ...dependencyMap(rawEntry, 'optionalDependencies', lockPath, 'malformed-lockfile'),
        }
      : {};

    for (const name of Object.keys(declared).sort()) {
      const resolved = resolveDependency(path, name);
      if (resolved === undefined) {
        warnings.push(`"${name}" required by "${entry.name}" is not installed`);
        continue;
      }
      const child = installed.get(resolved);
      if (child === undefined) {
        continue;
      }
      const parents = parentsByPath.get(resolved) ?? new Set<string>();
      parents.add(parentId);
      parentsByPath.set(resolved, parents);

      if (!depthByPath.has(resolved)) {
        depthByPath.set(resolved, parentDepth + 1);
        queue.push(resolved);
      }
    }
  }

  const depthById = new Map<string, number>();
  const parentsById = new Map<string, Set<string>>();
  const identityById = new Map<string, InstalledPackage>();

  for (const [path, depth] of depthByPath) {
    const entry = installed.get(path);
    if (entry === undefined) {
      continue;
    }
    const id = packageId(entry.name, entry.version);
    identityById.set(id, entry);
    const existingDepth = depthById.get(id);
    if (existingDepth === undefined || depth < existingDepth) {
      depthById.set(id, depth);
    }
    const parents = parentsById.get(id) ?? new Set<string>();
    for (const parent of parentsByPath.get(path) ?? []) {
      parents.add(parent);
    }
    parentsById.set(id, parents);
  }

  const directIds = new Set<string>();
  for (const path of rootPaths) {
    const entry = installed.get(path);
    if (entry !== undefined) {
      directIds.add(packageId(entry.name, entry.version));
    }
  }

  const packages: PackageEntry[] = [];
  for (const [id, entry] of identityById) {
    const depth = depthById.get(id);
    if (depth === undefined) {
      continue;
    }
    packages.push({
      name: entry.name,
      version: entry.version,
      isDirect: directIds.has(id),
      depth,
      parents: [...(parentsById.get(id) ?? new Set<string>())].sort(),
      isDev: entry.isDev,
    });
  }

  const orphans = [...installed.values()]
    .filter((entry) => !depthByPath.has(entry.path))
    .map((entry) => packageId(entry.name, entry.version))
    .sort();

  const manifestName = rawManifest['name'];
  const fallbackName = basename(projectDir);

  return {
    ecosystem: 'npm',
    projectName:
      typeof manifestName === 'string' && manifestName.length > 0 ? manifestName : fallbackName,
    manifestPath: MANIFEST_FILE,
    packages: sortPackageEntries(packages),
    orphans,
    warnings,
    unresolved: [],
  };
}

const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const URL_SPECIFIER_PATTERN = /^(?:https?|git\+?|ssh|file|link|workspace):/u;

/** Why one manifest specifier cannot be resolved without a lockfile. */
function manifestSpecifierReason(specifier: string): UnresolvedReason | null {
  const trimmed = specifier.trim();
  if (EXACT_VERSION_PATTERN.test(trimmed)) {
    return null;
  }
  if (trimmed === '*' || trimmed === '' || trimmed.toLowerCase() === 'latest') {
    return 'wildcard-pin';
  }
  if (URL_SPECIFIER_PATTERN.test(trimmed)) {
    return 'url-reference';
  }
  if (trimmed.includes('||')) {
    return 'multiple-pins';
  }
  return 'not-pinned';
}

/** 1-based line of the first `"name"` occurrence in the raw manifest text. */
function manifestLine(rawText: string, name: string): number {
  const needle = `"${name}"`;
  const at = rawText.indexOf(needle);
  if (at === -1) {
    return 1;
  }
  return rawText.slice(0, at).split('\n').length;
}

/**
 * The manifest-only fallback: when a project has no lockfile, only exact pins can be
 * resolved. Everything else becomes an UnresolvedRequirement with its reason, so the
 * report says NOT FULLY SCANNED instead of silently skipping the dependency.
 */
export function parseNpmManifestOnly(projectDir: string): NpmProject {
  const manifestPath = join(projectDir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw new ProjectParseError('missing-manifest', manifestPath, 'file does not exist');
  }
  const rawText = readFileSync(manifestPath, 'utf8');
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(rawText);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'invalid JSON';
    throw new ProjectParseError('malformed-manifest', manifestPath, detail);
  }
  if (!isRecord(rawManifest)) {
    throw new ProjectParseError('malformed-manifest', manifestPath, 'expected a JSON object');
  }

  const packages: PackageEntry[] = [];
  const unresolved: UnresolvedRequirement[] = [];

  const sections: readonly (readonly [string, boolean])[] = [
    ['dependencies', false],
    ['devDependencies', true],
  ];

  for (const [section, isDev] of sections) {
    const dependencies = dependencyMap(rawManifest, section, manifestPath, 'malformed-manifest');
    for (const [name, specifier] of Object.entries(dependencies)) {
      const reason = manifestSpecifierReason(specifier);
      const raw = `"${name}": "${specifier}"`;
      if (reason === null) {
        packages.push({
          name,
          version: specifier.trim(),
          isDirect: true,
          depth: 0,
          parents: [],
          isDev,
        });
      } else {
        unresolved.push({
          raw,
          name,
          specifier,
          line: manifestLine(rawText, name),
          reason,
        });
      }
    }
  }

  const manifestName = rawManifest['name'];

  return {
    ecosystem: 'npm',
    projectName:
      typeof manifestName === 'string' && manifestName.length > 0
        ? manifestName
        : basename(projectDir),
    manifestPath: MANIFEST_FILE,
    packages: sortPackageEntries(packages),
    orphans: [],
    warnings:
      unresolved.length > 0
        ? [
            'no package-lock.json: ranges resolve from the npm registry when reachable; npm install locks versions',
          ]
        : [],
    unresolved,
  };
}

/** True when the directory has a usable lockfile for the full parser. */
export function hasNpmLockfile(projectDir: string): boolean {
  return existsSync(join(projectDir, LOCKFILE));
}
