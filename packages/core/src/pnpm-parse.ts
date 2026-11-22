import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { ProjectParseError } from './errors.js';
import type { NpmProject } from './npm-parse.js';
import { packageId, sortPackageEntries } from './package-key.js';
import type { PackageEntry, WorkspaceScan } from './types.js';
import { YamlSubsetError, parseYamlSubset } from './yaml-subset.js';

const MANIFEST_FILE = 'package.json';
export const PNPM_LOCKFILE = 'pnpm-lock.yaml';

/** pnpm lockfile versions whose layout this parser reads exactly. */
export const SUPPORTED_PNPM_LOCKFILE_VERSIONS = ['6.0', '9.0'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringMap(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === 'string');
}

/** Strips the peer-suffix chain: `10.0.1(eslint@10.12.0)(typescript@5.9.3)` -> `10.0.1`. */
export function stripPeerSuffix(ref: string): string {
  const paren = ref.indexOf('(');
  return paren === -1 ? ref : ref.slice(0, paren);
}

/** True when a version reference points at a workspace link instead of a registry package. */
function isWorkspaceLink(ref: string): boolean {
  return ref.startsWith('link:') || ref.startsWith('workspace:');
}

interface SnapshotNode {
  readonly key: string;
  readonly dependencies: Readonly<Record<string, string>>;
}

/**
 * Indexes lockfile snapshot nodes so a dependency reference (`eslint: 10.12.0`,
 * possibly with peer suffixes) finds the snapshot that holds its own dependencies.
 */
function indexSnapshots(raw: unknown, lockPath: string): ReadonlyMap<string, SnapshotNode> {
  const nodes = new Map<string, SnapshotNode>();
  if (raw === null || raw === undefined) {
    return nodes;
  }
  if (!isRecord(raw)) {
    throw new ProjectParseError('malformed-lockfile', lockPath, '"snapshots" must be an object');
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) {
      continue;
    }
    const dependencies: Record<string, string> = {};
    for (const section of ['dependencies', 'optionalDependencies'] as const) {
      const rawSection = value[section];
      if (rawSection === undefined || rawSection === null) {
        continue;
      }
      if (!isStringMap(rawSection)) {
        throw new ProjectParseError(
          'malformed-lockfile',
          lockPath,
          `"snapshots.${key}.${section}" must be a string map`,
        );
      }
      Object.assign(dependencies, rawSection);
    }
    nodes.set(key, { key, dependencies });
  }
  return nodes;
}

/** Finds the snapshot key for `name` at version reference `ref` (with or without peer suffix). */
function findSnapshotKey(
  snapshots: ReadonlyMap<string, SnapshotNode>,
  name: string,
  ref: string,
): string | undefined {
  const exact = `${name}@${ref}`;
  if (snapshots.has(exact)) {
    return exact;
  }
  const base = stripPeerSuffix(ref);
  const bare = `${name}@${base}`;
  if (snapshots.has(bare)) {
    return bare;
  }
  const prefix = `${bare}(`;
  for (const key of [...snapshots.keys()].sort()) {
    if (key.startsWith(prefix)) {
      return key;
    }
  }
  return undefined;
}

/** Reads one importer's dependency sections: name -> { ref, isDev }. */
function dependenciesOf(
  importer: unknown,
  lockPath: string,
): ReadonlyMap<string, { ref: string; isDev: boolean }> {
  const roots = new Map<string, { ref: string; isDev: boolean }>();
  const source = isRecord(importer) ? importer : {};
  const sections: ReadonlyArray<readonly [string, boolean]> = [
    ['dependencies', false],
    ['optionalDependencies', false],
    ['devDependencies', true],
  ];
  for (const [section, isDev] of sections) {
    const raw = source[section];
    if (raw === undefined || raw === null) {
      continue;
    }
    if (!isRecord(raw)) {
      throw new ProjectParseError(
        'malformed-lockfile',
        lockPath,
        `importer "${section}" must be an object`,
      );
    }
    for (const [name, entry] of Object.entries(raw)) {
      if (!isRecord(entry) || typeof entry['version'] !== 'string') {
        throw new ProjectParseError(
          'malformed-lockfile',
          lockPath,
          `importer "${section}.${name}" must carry a version`,
        );
      }
      const existing = roots.get(name);
      // A package listed as both prod and dev is production, matching npm's dev-only rule.
      roots.set(name, {
        ref: entry['version'],
        isDev: existing === undefined ? isDev : existing.isDev && isDev,
      });
    }
  }
  return roots;
}

/**
 * Reads a pnpm project from pnpm-lock.yaml. Every importer in the lockfile is a
 * workspace manifest and contributes its own dependency tree: packages are merged
 * by `name@version`, isDirect means direct in any manifest, dev-only is judged
 * across all paths, and direct-dependency provenance lands in `workspace`.
 * Workspace links between importers are covered by the target's own manifest and
 * noted, not followed. Unknown refs are named in warnings, never guessed.
 */
export function parsePnpm(projectDir: string): NpmProject {
  const manifestPath = join(projectDir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw new ProjectParseError('missing-manifest', manifestPath, 'file does not exist');
  }
  const lockPath = join(projectDir, PNPM_LOCKFILE);
  if (!existsSync(lockPath)) {
    throw new ProjectParseError('missing-lockfile', lockPath, 'file does not exist');
  }

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
  } catch (error) {
    throw new ProjectParseError(
      'malformed-manifest',
      manifestPath,
      error instanceof Error ? error.message : 'invalid JSON',
    );
  }
  if (!isRecord(rawManifest)) {
    throw new ProjectParseError('malformed-manifest', manifestPath, 'expected a JSON object');
  }

  let document: unknown;
  try {
    document = parseYamlSubset(readFileSync(lockPath, 'utf8'));
  } catch (error) {
    throw new ProjectParseError(
      'malformed-lockfile',
      lockPath,
      error instanceof YamlSubsetError ? error.message : 'unreadable YAML',
    );
  }
  if (!isRecord(document)) {
    throw new ProjectParseError('malformed-lockfile', lockPath, 'expected a YAML mapping');
  }

  const rawVersion = document['lockfileVersion'];
  const lockfileVersion =
    typeof rawVersion === 'string' || typeof rawVersion === 'number' ? String(rawVersion) : '';
  if (!(SUPPORTED_PNPM_LOCKFILE_VERSIONS as readonly string[]).includes(lockfileVersion)) {
    throw new ProjectParseError(
      'unsupported-lockfile-version',
      lockPath,
      `lockfileVersion ${JSON.stringify(document['lockfileVersion'] ?? null)} is not one of ${SUPPORTED_PNPM_LOCKFILE_VERSIONS.join(', ')}`,
    );
  }

  const rawImporters = document['importers'];
  if (!isRecord(rawImporters) || !('.' in rawImporters)) {
    throw new ProjectParseError(
      'malformed-lockfile',
      lockPath,
      '"importers" must contain the root importer "."',
    );
  }
  const importerDirs = Object.keys(rawImporters).sort((a, b) =>
    a === '.' ? -1 : b === '.' ? 1 : a.localeCompare(b),
  );
  const isWorkspace = importerDirs.length > 1;

  const warnings: string[] = [];
  const snapshots = indexSnapshots(document['snapshots'], lockPath);

  const depthById = new Map<string, number>();
  const parentsById = new Map<string, Set<string>>();
  const devOnlyById = new Map<string, boolean>();
  const directIds = new Set<string>();
  const directOrigins = new Map<string, Set<string>>();
  const identityOf = new Map<string, string>(); // snapshot key -> package id

  interface QueueItem {
    readonly snapshotKey: string;
  }
  const queue: QueueItem[] = [];
  const enqueuedKeys = new Set<string>();
  const enqueue = (snapshotKey: string): void => {
    if (!enqueuedKeys.has(snapshotKey)) {
      enqueuedKeys.add(snapshotKey);
      queue.push({ snapshotKey });
    }
  };

  const scannedManifests: string[] = [];
  for (const importerDir of importerDirs) {
    // The root manifest was read above; workspace packages read their own.
    let importerManifest: Record<string, unknown> | null = rawManifest;
    if (importerDir !== '.') {
      const subPath = join(projectDir, importerDir, MANIFEST_FILE);
      if (!existsSync(subPath)) {
        warnings.push(`workspace package "${importerDir}" has no package.json - skipped`);
        continue;
      }
      try {
        const parsed: unknown = JSON.parse(readFileSync(subPath, 'utf8'));
        importerManifest = isRecord(parsed) ? parsed : null;
      } catch {
        importerManifest = null;
      }
      if (importerManifest === null) {
        warnings.push(
          `workspace package "${importerDir}" has an unreadable package.json - skipped`,
        );
        continue;
      }
    }
    scannedManifests.push(importerDir);

    const roots = dependenciesOf(rawImporters[importerDir], lockPath);
    for (const [name, root] of [...roots.entries()].sort()) {
      if (isWorkspaceLink(root.ref)) {
        warnings.push(
          `workspace dependency "${name}" (${root.ref}) is scanned via its own manifest`,
        );
        continue;
      }
      const snapshotKey = findSnapshotKey(snapshots, name, root.ref);
      if (snapshotKey === undefined) {
        warnings.push(
          `"${name}" declared by "${importerDir}" has no snapshot entry in the lockfile`,
        );
        continue;
      }
      const id = packageId(name, stripPeerSuffix(root.ref));
      directIds.add(id);
      const origins = directOrigins.get(id) ?? new Set<string>();
      origins.add(importerDir);
      directOrigins.set(id, origins);
      identityOf.set(snapshotKey, id);
      const depth = depthById.get(id);
      if (depth === undefined || depth > 0) {
        depthById.set(id, 0);
      }
      devOnlyById.set(id, (devOnlyById.get(id) ?? true) && root.isDev);
      enqueue(snapshotKey);
    }

    // Manifest consistency: a declared dependency missing from the lockfile is named.
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
      const declared = importerManifest[section];
      if (!isRecord(declared)) {
        continue;
      }
      for (const name of Object.keys(declared)) {
        if (!roots.has(name)) {
          warnings.push(
            `manifest dependency "${name}" of "${importerDir}" is not in the pnpm lockfile`,
          );
        }
      }
    }
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const item = queue[cursor];
    if (item === undefined) {
      continue;
    }
    const parentId = identityOf.get(item.snapshotKey);
    const parentDepth = parentId === undefined ? undefined : depthById.get(parentId);
    const parentDevOnly = parentId === undefined ? true : (devOnlyById.get(parentId) ?? true);
    if (parentId === undefined || parentDepth === undefined) {
      continue;
    }
    const node = snapshots.get(item.snapshotKey);
    if (node === undefined) {
      continue;
    }
    for (const [childName, childRef] of Object.entries(node.dependencies).sort()) {
      if (isWorkspaceLink(childRef)) {
        continue;
      }
      const childKey = findSnapshotKey(snapshots, childName, childRef);
      if (childKey === undefined) {
        warnings.push(
          `"${childName}" required by "${parentId}" has no snapshot entry in the lockfile`,
        );
        continue;
      }
      const childId = packageId(childName, stripPeerSuffix(childRef));
      identityOf.set(childKey, childId);
      const parents = parentsById.get(childId) ?? new Set<string>();
      parents.add(parentId);
      parentsById.set(childId, parents);
      const childDepth = depthById.get(childId);
      if (childDepth === undefined || parentDepth + 1 < childDepth) {
        depthById.set(childId, parentDepth + 1);
      }
      devOnlyById.set(childId, (devOnlyById.get(childId) ?? true) && parentDevOnly);
      enqueue(childKey);
    }
  }

  const packages: PackageEntry[] = [];
  for (const [id, depth] of depthById) {
    const at = id.lastIndexOf('@');
    packages.push({
      name: id.slice(0, at),
      version: id.slice(at + 1),
      isDirect: directIds.has(id),
      depth,
      parents: [...(parentsById.get(id) ?? new Set<string>())].sort(),
      isDev: devOnlyById.get(id) ?? null,
    });
  }

  // Orphans: locked packages no scanned manifest's tree uses.
  const orphans: string[] = [];
  const rawPackages = document['packages'];
  if (isRecord(rawPackages)) {
    for (const key of Object.keys(rawPackages)) {
      const normalized = key.startsWith('/') ? key.slice(1) : key;
      const at = normalized.lastIndexOf('@');
      if (at <= 0) {
        continue;
      }
      const id = packageId(normalized.slice(0, at), stripPeerSuffix(normalized.slice(at + 1)));
      if (!depthById.has(id) && !orphans.includes(id)) {
        orphans.push(id);
      }
    }
    orphans.sort();
  }

  let workspace: WorkspaceScan | undefined;
  if (isWorkspace) {
    workspace = {
      scannedManifests,
      directOrigins: Object.fromEntries(
        [...directOrigins.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, dirs]) => [id, [...dirs].sort()]),
      ),
    };
    warnings.push(
      `workspace scan: ${scannedManifests.length} manifests scanned (${scannedManifests.join(', ')})`,
    );
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
    orphans,
    warnings: [...new Set(warnings)].sort(),
    unresolved: [],
    ...(workspace === undefined ? {} : { workspace }),
  };
}

/** True when the directory has a pnpm lockfile. */
export function hasPnpmLockfile(projectDir: string): boolean {
  return existsSync(join(projectDir, PNPM_LOCKFILE));
}
