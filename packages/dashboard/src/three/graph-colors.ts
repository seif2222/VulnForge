import type { SceneNode, Severity } from '../lib/core.js';
import { WEBGL_COLORS } from '../tokens.generated.js';

/**
 * Pure color and size mapping for the 3D dependency graph. Kept three-free so
 * it is unit-testable in node; GraphScene applies these to instanced meshes.
 */
export const CLEAN_NODE_HEX = WEBGL_COLORS.borderStrong;
export const DIM_NODE_HEX = WEBGL_COLORS.bgOverlay;
export const DIM_EDGE_HEX = WEBGL_COLORS.bgRaised;
export const CLEAN_EDGE_HEX = WEBGL_COLORS.borderSubtle;

export function severityHex(severity: Severity): string {
  switch (severity) {
    case 'critical':
      return WEBGL_COLORS.severityCritical;
    case 'high':
      return WEBGL_COLORS.severityHigh;
    case 'medium':
      return WEBGL_COLORS.severityMedium;
    case 'low':
      return WEBGL_COLORS.severityLow;
  }
}

/** Node color: the subtree-worst severity, or the clean-node color. */
export function nodeHex(node: Pick<SceneNode, 'subtreeWorstSeverity'>): string {
  return node.subtreeWorstSeverity === null
    ? CLEAN_NODE_HEX
    : severityHex(node.subtreeWorstSeverity);
}

/** Edge color: the child subtree's worst severity, or the clean-edge color. */
export function edgeHex(worstSeverity: Severity | null): string {
  return worstSeverity === null ? CLEAN_EDGE_HEX : severityHex(worstSeverity);
}

/**
 * Node radius in world units. Direct dependencies anchor the graph; hubs
 * (many dependents) and finding-heavy packages read larger. Bounded so a huge
 * hub never swallows the layout.
 */
export function nodeRadius(
  node: Pick<SceneNode, 'isDirect' | 'findingCount' | 'dependentCount'>,
): number {
  const base = node.isDirect ? 7 : 4;
  const hubBoost = Math.min(6, node.dependentCount) * 0.8;
  const findingBoost = Math.min(5, node.findingCount) * 0.6;
  return base + hubBoost + findingBoost;
}
