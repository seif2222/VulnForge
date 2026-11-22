import { Suspense, lazy, useMemo, useState } from 'react';

import type { PackageTreeNode } from '../lib/core.js';
import { buildDependencyGraph, buildTree } from '../lib/core.js';
import type { ScanSession } from '../lib/useScan.js';
import { isWebGLAvailable, usePrefersReducedMotion } from '../three/capabilities.js';

const GraphSceneLazy = lazy(() =>
  import('../three/GraphScene.js').then((module) => ({ default: module.GraphScene })),
);

/**
 * Dependency Tree: the real graph from the report - fold/expand, search, and a
 * vulnerable-path filter. The interactive 3D graph renders beside it when
 * WebGL and motion are available; the accessible list always carries the same
 * data and is the documented fallback.
 */
export function TreeScreen(props: { readonly session: ScanSession }) {
  const { report } = props.session;
  const [query, setQuery] = useState('');
  const [vulnerableOnly, setVulnerableOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const tree = useMemo(() => (report === null ? null : buildTree(report.packages)), [report]);
  const graph = useMemo(() => (report === null ? null : buildDependencyGraph(report)), [report]);

  const findingCountById = useMemo(() => {
    const counts = new Map<string, number>();
    if (report !== null) {
      for (const vuln of report.vulnerabilities) {
        const id = `${vuln.package}@${vuln.installedVersion}`;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return counts;
  }, [report]);

  const vulnerableIds = useMemo(() => {
    // A node is "on a vulnerable path" when itself or any descendant has findings.
    const onPath = new Set<string>();
    if (graph !== null) {
      for (const node of graph.nodes) {
        if ((findingCountById.get(node.id) ?? 0) > 0) {
          onPath.add(node.id);
        }
        if (node.subtreeWorstSeverity !== null) {
          onPath.add(node.id);
        }
      }
    }
    return onPath;
  }, [graph, findingCountById]);

  if (report === null || tree === null || graph === null) {
    return <div className="empty">no report loaded — run a scan first</div>;
  }

  const needle = query.trim().toLowerCase();
  const visible = (node: PackageTreeNode): boolean => {
    if (vulnerableOnly && !vulnerableIds.has(node.id)) {
      return false;
    }
    if (needle !== '' && !node.id.toLowerCase().includes(needle)) {
      // Keep ancestors of matches visible so the path stays readable.
      return node.children.some(visible);
    }
    return true;
  };

  const toggle = (id: string): void => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const renderNode = (node: PackageTreeNode, depth: number): React.ReactNode => {
    if (!visible(node)) {
      return null;
    }
    const findings = findingCountById.get(node.id) ?? 0;
    const isCollapsed = collapsed.has(node.id);
    return (
      <li key={node.id}>
        <div className="tree-row" data-depth={depth}>
          <button
            type="button"
            className="tree-fold mono"
            onClick={() => toggle(node.id)}
            aria-label={isCollapsed ? `expand ${node.id}` : `collapse ${node.id}`}>
            {node.children.length === 0 ? '·' : isCollapsed ? '▸' : '▾'}
          </button>
          <span className="mono tree-id">{node.id}</span>
          {node.isDirect && <span className="badge low">direct</span>}
          {findings > 0 && (
            <span className="badge high">
              {findings} finding{findings === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {!isCollapsed && node.children.length > 0 && (
          <ul className="tree-children">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="grid-tree">
      <section className="panel">
        <h2>dependency tree</h2>
        <div className="findings-controls">
          <input
            className="text"
            placeholder="search packages"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="search packages"
          />
          <label className="mono muted tree-toggle">
            <input
              type="checkbox"
              checked={vulnerableOnly}
              onChange={(event) => setVulnerableOnly(event.target.checked)}
            />
            vulnerable paths only
          </label>
        </div>
        <p className="muted mono">
          {graph.nodes.length} packages · {graph.edges.length} edges · max depth {graph.maxDepth}
        </p>
        {tree.roots.length === 0 ? (
          <p className="muted">no dependencies</p>
        ) : (
          <ul className="tree-list">{tree.roots.map((root) => renderNode(root, 0))}</ul>
        )}
      </section>
      <section className="panel">
        <h2>3d graph</h2>
        <GraphPanel graph={graph} report={report} pathIds={vulnerableOnly ? vulnerableIds : null} />
      </section>
    </div>
  );
}

/** The 3D graph behind its capability gates; the 2D tree is the fallback. */
function GraphPanel(props: {
  readonly graph: NonNullable<ReturnType<typeof buildDependencyGraph>>;
  readonly report: NonNullable<ScanSession['report']>;
  readonly pathIds: ReadonlySet<string> | null;
}) {
  const reducedMotion = usePrefersReducedMotion();
  if (!isWebGLAvailable()) {
    return (
      <p className="muted mono">
        WebGL is not available in this browser — the tree on the left carries the same data.
      </p>
    );
  }
  if (reducedMotion) {
    return (
      <p className="muted mono">
        Reduced motion is on — the interactive graph is paused; the tree on the left carries the
        same data.
      </p>
    );
  }
  return (
    <Suspense fallback={<p className="muted mono">loading the 3d graph…</p>}>
      <GraphSceneLazy graph={props.graph} report={props.report} pathIds={props.pathIds} />
    </Suspense>
  );
}
