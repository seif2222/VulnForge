import { compareSeverity, SEVERITIES } from './index.js';
import type { Report, Severity } from './types.js';

/**
 * The scene model (G4): one pure function shared by the dashboard 3D graph, the TUI
 * 3D views and the Dependency Tree screen. Layout is deterministic - same report in,
 * same coordinates out - so tests and screenshots are reproducible without a seed
 * argument. Positions derive only from sorted order and a string hash of each id.
 */

export interface SceneNode {
  /** `name@version`. */
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly isDirect: boolean;
  readonly depth: number;
  /** Findings on this exact `name@version`, counted by severity. */
  readonly findings: Readonly<Record<Severity, number>>;
  readonly findingCount: number;
  /** Worst severity among this node's own findings; null when clean. */
  readonly worstSeverity: Severity | null;
  /** Worst severity anywhere in this node's dependency subtree; null when clean. */
  readonly subtreeWorstSeverity: Severity | null;
  /** How many installed packages require this one. */
  readonly dependentCount: number;
  /** Deterministic world position for 3D rendering. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SceneEdge {
  /** Parent (requiring) package id. */
  readonly from: string;
  /** Child (required) package id. */
  readonly to: string;
  /** Worst severity in the child's subtree, for edge coloring. */
  readonly worstSeverity: Severity | null;
}

export interface DependencyGraph {
  readonly nodes: readonly SceneNode[];
  readonly edges: readonly SceneEdge[];
  readonly maxDepth: number;
}

/** 32-bit FNV-1a: stable across runs and platforms, unlike Math.random or Date. */
function hashId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Golden-angle spread so layered rings do not line up in spokes. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** World units between depth rings. */
const RING_SPACING = 90;
/** Radius of the direct-dependency ring. */
const BASE_RADIUS = 60;

export function buildDependencyGraph(report: Report): DependencyGraph {
  const tally = new Map<string, Record<Severity, number>>();
  for (const vulnerability of report.vulnerabilities) {
    const key = `${vulnerability.package}@${vulnerability.installedVersion}`;
    const entry = tally.get(key) ?? emptyTally();
    entry[vulnerability.severity] += 1;
    tally.set(key, entry);
  }

  const ids: string[] = [];
  const depthOf = new Map<string, number>();
  const parentsOf = new Map<string, readonly string[]>();
  for (const entry of report.packages) {
    const id = `${entry.name}@${entry.version}`;
    ids.push(id);
    depthOf.set(id, entry.depth);
    parentsOf.set(id, entry.parents);
  }
  ids.sort();

  // Worst severity per subtree, memoised; cycles resolve to the node's own worst.
  const ownWorst = new Map<string, Severity | null>();
  for (const id of ids) {
    ownWorst.set(id, worstOf(tally.get(id)));
  }
  const subtreeWorst = new Map<string, Severity | null>();
  const visiting = new Set<string>();
  const childrenOf = new Map<string, string[]>();
  for (const id of ids) {
    childrenOf.set(id, []);
  }
  for (const id of ids) {
    for (const parent of parentsOf.get(id) ?? []) {
      if (childrenOf.has(parent)) {
        childrenOf.get(parent)?.push(id);
      }
    }
  }
  const resolveSubtree = (id: string): Severity | null => {
    const memo = subtreeWorst.get(id);
    if (memo !== undefined) {
      return memo;
    }
    if (visiting.has(id)) {
      return ownWorst.get(id) ?? null;
    }
    visiting.add(id);
    let worst = ownWorst.get(id) ?? null;
    for (const child of childrenOf.get(id) ?? []) {
      const childWorst = resolveSubtree(child);
      if (childWorst !== null && (worst === null || compareSeverity(childWorst, worst) < 0)) {
        worst = childWorst;
      }
    }
    visiting.delete(id);
    subtreeWorst.set(id, worst);
    return worst;
  };
  for (const id of ids) {
    resolveSubtree(id);
  }

  // Deterministic layout: one ring per depth, golden-angle spread inside a ring,
  // hash-based jitter so overlapping rings separate without randomness.
  const byDepth = new Map<number, string[]>();
  let maxDepth = 0;
  for (const id of ids) {
    const depth = depthOf.get(id) ?? 0;
    maxDepth = Math.max(maxDepth, depth);
    const ring = byDepth.get(depth) ?? [];
    ring.push(id);
    byDepth.set(depth, ring);
  }
  const positionOf = new Map<string, { x: number; y: number; z: number }>();
  for (const [depth, ring] of byDepth) {
    ring.forEach((id, index) => {
      const hash = hashId(id);
      const angle = index * GOLDEN_ANGLE + (hash % 360) * (Math.PI / 180) * 0.05;
      const radius = depth === 0 && ring.length === 1 ? 0 : BASE_RADIUS + depth * RING_SPACING;
      positionOf.set(id, {
        x: round3(Math.cos(angle) * radius),
        y: round3(((hash >> 8) % 1000) / 1000 - 0.5) * 30,
        z: round3(Math.sin(angle) * radius),
      });
    });
  }

  const byId = new Map(report.packages.map((pkg) => [`${pkg.name}@${pkg.version}`, pkg]));
  const nodes: SceneNode[] = ids.map((id) => {
    const entry = byId.get(id);
    const findings = tally.get(id) ?? emptyTally();
    const position = positionOf.get(id) ?? { x: 0, y: 0, z: 0 };
    return {
      id,
      name: entry?.name ?? id,
      version: entry?.version ?? '',
      isDirect: entry?.isDirect ?? false,
      depth: depthOf.get(id) ?? 0,
      findings,
      findingCount: SEVERITIES.reduce((sum, severity) => sum + findings[severity], 0),
      worstSeverity: ownWorst.get(id) ?? null,
      subtreeWorstSeverity: subtreeWorst.get(id) ?? null,
      dependentCount: (parentsOf.get(id) ?? []).length,
      ...position,
    };
  });

  const edges: SceneEdge[] = [];
  for (const id of ids) {
    for (const parent of parentsOf.get(id) ?? []) {
      if (subtreeWorst.has(parent)) {
        edges.push({ from: parent, to: id, worstSeverity: subtreeWorst.get(id) ?? null });
      }
    }
  }
  edges.sort((left, right) =>
    left.from === right.from
      ? left.to.localeCompare(right.to)
      : left.from.localeCompare(right.from),
  );

  return { nodes, edges, maxDepth };
}

function emptyTally(): Record<Severity, number> {
  return { critical: 0, high: 0, medium: 0, low: 0 };
}

function worstOf(tally: Record<Severity, number> | undefined): Severity | null {
  if (tally === undefined) {
    return null;
  }
  for (const severity of SEVERITIES) {
    if (tally[severity] > 0) {
      return severity;
    }
  }
  return null;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
