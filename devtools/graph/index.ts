/**
 * Sync/Concept Graph Dev Tool
 *
 * Builds a causal graph of concept actions, endpoints, and their
 * synchronization wiring.  App-agnostic — imports only from `@engine`.
 *
 * Modules:
 *  - types        — type vocabulary
 *  - builder      — walks engine.syncs → SyncGraph
 *  - reachability — BFS-based endpoint Respond reachability
 *  - diagnostics  — advisory correctness smells + complexity heuristics
 *  - exporters    — JSON, Mermaid, Graphviz DOT, CLI report
 *  - report       — composes the stages into a full SyncGraphReport
 */

export { buildSyncGraph } from "./builder.ts";
export { runDiagnostics } from "./diagnostics.ts";
export { toDot, toJson, toMermaid, toReport } from "./exporters.ts";
export { computeReachability } from "./reachability.ts";
export { assembleReport } from "./report.ts";
export type {
  DiagnosticCode,
  DiagnosticFinding,
  DiagnosticPlugin,
  DiagnosticSeverity,
  DiagnosticsConfig,
  DiagnosticsReport,
  EndpointReachability,
  GraphEdge,
  GraphNode,
  NodeKind,
  PatternBinding,
  RequestBoundary,
  SyncGraph,
  SyncGraphReport,
} from "./types.ts";
