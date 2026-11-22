export {
  CORE_PACKAGE_NAME,
  ECOSYSTEMS,
  IGNORE_SOURCES,
  INCOMPLETE_REASONS,
  REPORT_SCHEMA_VERSION,
  SEVERITIES,
  TOOL_NAME,
  UNRESOLVED_REASONS,
} from './types.js';
export type {
  AiExplanation,
  CvssScore,
  Ecosystem,
  IgnoredFinding,
  IgnoreSource,
  IncompleteAdvisory,
  IncompleteReason,
  PackageEntry,
  Report,
  ReportMeta,
  ReportStats,
  RiskAssessment,
  RiskFlags,
  Severity,
  Suggestion,
  ToolInfo,
  UnresolvedReason,
  UnresolvedRequirement,
  Vulnerability,
} from './types.js';

export { compareSeverity, isSeverity, sortVulnerabilitiesBySeverity } from './severity.js';

export { computeStats, countBySeverity, emptySeverityCounts } from './stats.js';

export { isDeepEqual, validateJsonSchema } from './json-schema.js';
export type { JsonSchema, JsonSchemaType, ValidationIssue } from './json-schema.js';

export { REPORT_SCHEMA } from './report-schema.js';

export { isReport, validateReport } from './validate-report.js';
export type { ReportValidationResult } from './validate-report.js';

export { PARSE_ERROR_CODES, ProjectParseError, isProjectParseError } from './errors.js';
export type { ParseErrorCode } from './errors.js';

export {
  comparePackageEntries,
  compareVersions,
  packageId,
  sortPackageEntries,
  splitPackageId,
} from './package-key.js';

export {
  SUPPORTED_LOCKFILE_VERSIONS,
  hasNpmLockfile,
  parseNpm,
  parseNpmManifestOnly,
} from './npm-parse.js';
export {
  PNPM_LOCKFILE,
  SUPPORTED_PNPM_LOCKFILE_VERSIONS,
  hasPnpmLockfile,
  parsePnpm,
  stripPeerSuffix,
} from './pnpm-parse.js';
export type { NpmProject } from './npm-parse.js';

export { normalizePythonName, parsePython } from './python-parse.js';
export type { PythonProject } from './python-parse.js';

export { buildTree } from './build-tree.js';
export type { PackageTree, PackageTreeNode } from './build-tree.js';

export { cvss3BaseScore, cvssBaseScore, parseCvssVector } from './cvss.js';
export type { CvssVector, CvssVersion } from './cvss.js';

export {
  cvssFromVectors,
  decideSeverity,
  severityFromCvssScore,
  severityFromGithubRating,
} from './severity-map.js';
export type { SeverityDecision, SeverityReason } from './severity-map.js';

export type {
  OsvAffected,
  OsvEvent,
  OsvPackageRef,
  OsvQuery,
  OsvRange,
  OsvReference,
  OsvSeverityEntry,
  OsvVulnerability,
} from './osv-types.js';

export {
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_MS,
  OSV_BATCH_ENDPOINT,
  OSV_ERROR_CODES,
  OSV_MAX_BATCH_SIZE,
  OsvError,
  createOsvHttp,
  isOsvError,
} from './osv-http.js';
export type { OsvErrorCode, OsvHttp, OsvHttpOptions } from './osv-http.js';

export {
  NPM_REGISTRY_ENDPOINT,
  REGISTRY_ERROR_CODES,
  RegistryError,
  createNpmRegistry,
  pickRegistryVersion,
  resolveManifestRanges,
} from './npm-registry.js';
export type {
  NpmRegistry,
  NpmRegistryOptions,
  RegistryErrorCode,
  RegistryPackageMetadata,
  RegistryResolution,
} from './npm-registry.js';

export { compareSemver, maxSatisfying, parseSemver, satisfiesSemver } from './npm-semver.js';
export type { Semver } from './npm-semver.js';

export {
  DEFAULT_CACHE_TTL_MS,
  OSV_CACHE_MISS_CODES,
  OsvCacheMissError,
  cacheKeyFor,
  createFileCache,
  createMemoryCache,
  defaultCacheDir,
  isOsvCacheMissError,
} from './osv-cache.js';
export type { OsvCache, OsvCacheLookup, OsvCacheMissCode, OsvCacheOptions } from './osv-cache.js';

export {
  OSV_SOURCE,
  matchVulnerabilities,
  osvEcosystemName,
  osvLookupName,
  recordCveIds,
  recordGhsaIds,
} from './match.js';
export type { MatchOptions, MatchProgress, QueryGap, UnidentifiedAdvisory } from './match.js';

export { rankFindings, scoreFinding } from './rank.js';

export { IgnoreFileError, applyIgnores, parseIgnoreFile, rulesFromFlags } from './ignore.js';
export type { IgnoreResult, IgnoreRule } from './ignore.js';

export { ANALYZE_ERROR_CODES, AnalyzeError, analyzeProject, writeReportAtomic } from './analyze.js';
export type {
  AnalyzeDeps,
  AnalyzeErrorCode,
  AnalyzeOptions,
  AnalyzeProgress,
  AnalyzeResult,
} from './analyze.js';

export { buildDependencyGraph } from './scene-graph.js';
export type { DependencyGraph, SceneEdge, SceneNode } from './scene-graph.js';

export {
  AGENT_STATES,
  INITIAL_UI_STATE,
  UI_STATES,
  agentStateFor,
  transition,
} from './ui-state-machine.js';
export type {
  AgentState,
  ScanEvent,
  TransitionResult,
  UiScanState,
  UiState,
} from './ui-state-machine.js';

export { buildFindingsModel, buildOverviewModel, historyEntryFromReport } from './view-adapters.js';
export type {
  DistributionRow,
  FindingRow,
  FindingsModel,
  OverviewModel,
  PostureHeader,
  PriorityRow,
  ScanHistoryEntry,
  StatCard,
  TopPackageRow,
} from './view-adapters.js';
