/**
 * The dashboard renders through the exact adapter layer the TUI uses: the pure,
 * node-free modules of @vulnforge/core, bundled by Vite. No view math is duplicated
 * in this package.
 */
export {
  buildOverviewModel,
  buildFindingsModel,
  historyEntryFromReport,
} from '@vulnforge/core/dist/view-adapters.js';
export type {
  OverviewModel,
  FindingsModel,
  FindingRow,
  ScanHistoryEntry,
  PostureHeader,
  StatCard,
  DistributionRow,
  PriorityRow,
  TopPackageRow,
} from '@vulnforge/core/dist/view-adapters.js';
export { buildDependencyGraph } from '@vulnforge/core/dist/scene-graph.js';
export type { DependencyGraph, SceneNode, SceneEdge } from '@vulnforge/core/dist/scene-graph.js';
export { buildTree } from '@vulnforge/core/dist/build-tree.js';
export type { PackageTree, PackageTreeNode } from '@vulnforge/core/dist/build-tree.js';
export {
  AGENT_STATES,
  INITIAL_UI_STATE,
  UI_STATES,
  agentStateFor,
  transition,
} from '@vulnforge/core/dist/ui-state-machine.js';
export type {
  AgentState,
  ScanEvent,
  TransitionResult,
  UiScanState,
  UiState,
} from '@vulnforge/core/dist/ui-state-machine.js';
export type { Report, Severity, PackageEntry } from '@vulnforge/core/dist/types.js';
export { SEVERITIES } from '@vulnforge/core/dist/types.js';
