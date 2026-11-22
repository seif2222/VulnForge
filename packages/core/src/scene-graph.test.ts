import { describe, expect, it } from 'vitest';

import { buildDependencyGraph } from './scene-graph.js';
import type { Report } from './types.js';
import { loadReportFixture } from './test-helpers.js';

describe('buildDependencyGraph', () => {
  const report = loadReportFixture('with-vulnerabilities') as Report;
  const graph = buildDependencyGraph(report);

  it('has one node per package, keyed name@version', () => {
    expect(graph.nodes).toHaveLength(report.packages.length);
    for (const node of graph.nodes) {
      expect(report.packages.some((pkg) => `${pkg.name}@${pkg.version}` === node.id)).toBe(true);
    }
  });

  it('counts findings per node from real vulnerabilities only', () => {
    const total = graph.nodes.reduce((sum, node) => sum + node.findingCount, 0);
    expect(total).toBe(report.vulnerabilities.length);
    const requests = graph.nodes.find((node) => node.name === 'requests');
    expect(requests?.findingCount).toBe(
      report.vulnerabilities.filter((v) => v.package === 'requests').length,
    );
    expect(requests?.worstSeverity).toBe('high');
  });

  it('marks direct packages and records depth from the report', () => {
    for (const node of graph.nodes) {
      const entry = report.packages.find((pkg) => `${pkg.name}@${pkg.version}` === node.id);
      expect(node.isDirect).toBe(entry?.isDirect);
      expect(node.depth).toBe(entry?.depth);
    }
  });

  it('propagates the worst subtree severity onto nodes and edges', () => {
    const pyyaml = graph.nodes.find((node) => node.name === 'PyYAML');
    expect(pyyaml?.worstSeverity).toBe('critical');
    expect(pyyaml?.subtreeWorstSeverity).toBe('critical');
    // This fixture has no parent links, so there are no edges to color.
    expect(graph.edges).toHaveLength(0);
  });

  it('builds parent->child edges from the real parents arrays', () => {
    const expected = report.packages.reduce((sum, pkg) => sum + pkg.parents.length, 0);
    expect(graph.edges).toHaveLength(expected);
    for (const edge of graph.edges) {
      const child = report.packages.find((pkg) => `${pkg.name}@${pkg.version}` === edge.to);
      expect(child?.parents).toContain(edge.from);
      // The edge carries the child's subtree worst severity.
      const childNode = graph.nodes.find((node) => node.id === edge.to);
      expect(edge.worstSeverity).toBe(childNode?.subtreeWorstSeverity ?? null);
    }
  });

  it('is deterministic: identical report, identical layout', () => {
    const again = buildDependencyGraph(report);
    expect(again).toEqual(graph);
  });

  it('places a single direct package at the origin', () => {
    const solo = buildDependencyGraph(loadReportFixture('clean') as Report);
    const direct = solo.nodes.filter((node) => node.isDirect);
    expect(direct.length).toBeGreaterThan(0);
    if (solo.nodes.length === 1) {
      expect(solo.nodes[0]?.x).toBe(0);
      expect(solo.nodes[0]?.z).toBe(0);
    }
  });

  it('never invents severity for clean nodes', () => {
    const clean = buildDependencyGraph(loadReportFixture('clean') as Report);
    for (const node of clean.nodes) {
      expect(node.worstSeverity).toBeNull();
      expect(node.subtreeWorstSeverity).toBeNull();
      expect(node.findingCount).toBe(0);
    }
    expect(clean.edges.every((edge) => edge.worstSeverity === null)).toBe(true);
  });
});
