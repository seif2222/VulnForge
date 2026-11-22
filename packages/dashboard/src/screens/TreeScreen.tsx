import { useMemo, useState } from 'react';

import type { PackageTreeNode } from '../lib/core.js';
import { buildDependencyGraph, buildTree } from '../lib/core.js';
import type { ScanSession } from '../lib/useScan.js';

/**
 * Dependency Tree: the real graph from the report - fold/expand, search, and a
 * vulnerable-path filter. The interactive 3D graph lives in the scene panel and
 * falls back to this accessible list on WebGL-less or reduced-motion setups.
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
        <p className="muted mono">
          The interactive WebGL graph renders here when WebGL is available; this accessible tree
          always carries the same data. (Scene component lands with the 3D slice.)
        </p>
      </section>
    </div>
  );
}
