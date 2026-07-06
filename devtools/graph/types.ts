/**
 * Core type definitions for the sync/concept graph visualization and advisory
 * diagnostics dev tool.
 *
 * This module is **app-agnostic**: it imports only from `@engine` and defines
 * types that any application using the engine can consume.  Zero imports from
 * `@concepts` or `@sdk`.
 */

// ── Request boundary ─────────────────────────────────────

/**
 * Describes the application's request boundary so the graph builder can
 * recognize endpoint anchors and the terminal response sink without knowing
 * any concrete concept by name. The app declares this from its own concept
 * class; the builder matches an action's concept against it with `instanceof`
 * (constructor identity), never by class-name string.
 */
export interface RequestBoundary {
  /** The boundary concept's class (e.g. the app's `RequestingConcept`). */
  conceptClass: new (
    ...args: never[]
  ) => object;
  /** Action that anchors an endpoint on a sync's `when` side (e.g. `"request"`). */
  entryAction: string;
  /** Terminal response action on a sync's `then` side (e.g. `"respond"`). */
  exitAction: string;
  /** Input key on the entry action carrying the literal endpoint path (e.g. `"path"`). */
  pathKey: string;
}

// ── Graph model ──────────────────────────────────────────

/** Where an action field's value originates, derived from the pattern mapping. */
export type BindingSource =
  | { kind: "var"; name: string } // logic-variable symbol; name = symbol.description
  | { kind: "literal"; value: string } // a primitive literal (path, method, role, status…)
  | { kind: "expr" }; // a non-symbol, non-primitive (computed) value

/** A single input or output field on an action pattern within a sync. */
export interface PatternBinding {
  /** The action's own field name, e.g. "user", "path", "session". */
  key: string;
  source: BindingSource;
}

/** Field-level bindings for one action pattern inside a sync clause. */
export interface ActionBinding {
  nodeId: string;
  input: PatternBinding[];
  output: PatternBinding[];
}

/** Discriminated kind of a node in the sync graph. */
export type NodeKind = "concept-action" | "endpoint" | "query";

/**
 * A single vertex in the causal sync graph.
 *
 * - **concept-action**: a concept method (e.g. `Authenticating.authenticate`).
 * - **endpoint**: a POST endpoint exposed to the client (e.g. `POST /auth/login`).
 * - **query**: a `_`-prefixed read-only action called inside a `where` clause.
 */
export interface GraphNode {
  /** Stable identifier, e.g. `"Authenticating.authenticate"` or `"POST /auth/login"`. */
  id: string;
  /** Discriminated node kind. */
  kind: NodeKind;
  /** Concept name when kind is `"concept-action"` or `"query"`; `undefined` for endpoints. */
  concept?: string;
  /** Input keys observed for this action across all sync clauses. */
  inputs?: string[];
  /** Output keys observed for this action (e.g. `["userId", "sessionId"]`). */
  outputs?: string[];
  /** `true` if this action was observed to produce an `"error"` key in its output. */
  producesError?: boolean;
}

/**
 * A directed edge in the sync graph, representing a synchronization that
 * wires one or more source actions to one or more target actions.
 */
export interface GraphEdge {
  /** The sync's registered name, e.g. `"LoginStartsSession"`. */
  syncName: string;
  /** Source node IDs (the sync's `when` clause). */
  from: string[];
  /** Target node IDs (the sync's `then` clause). */
  to: string[];
  /** Per-action binding details for the when clause. */
  when: ActionBinding[];
  /** Per-action binding details for the then clause. */
  then: ActionBinding[];
  /** Whether the sync has a `where` clause that filters/transforms frames. */
  hasWhere: boolean;
  /** The owning endpoint path when the sync is part of an endpoint cluster. */
  endpoint?: string;
  /** Best-effort file location hint for the sync's source definition. */
  fileHint?: string;
  /** Best-effort source code of the where function (via Function.toString()). */
  whereStr?: string;
}

/** Complete causal graph of synchronizations across all concepts and endpoints. */
export interface SyncGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /**
   * Stable id of the terminal response sink node, derived from the
   * {@link RequestBoundary}. Reachability reads this so it needs no hardcoded
   * concept name. Value is e.g. `"Requesting.respond"`.
   */
  responseSinkId: string;
}

// ── Reachability ─────────────────────────────────────────

/**
 * Per-endpoint reachability analysis.
 *
 * Determines whether every code path originating from an endpoint's `Request`
 * clause can reach a `Respond` (success or error).
 */
export interface EndpointReachability {
  /** Endpoint path, e.g. `"/auth/login"`. */
  endpoint: string;
  /** `true` when a `Respond` is reachable from every `Request` branch. */
  respondsReachable: boolean;
  /** Node IDs that are dead-ends — no path from them to any `Respond`. */
  deadEndNodes: string[];
  /** Longest causal chain length (number of hops) from `Request` to `Respond`. */
  longestChain: number;
}

// ── Diagnostics ──────────────────────────────────────────

/** Severity level of a diagnostic finding. */
export type DiagnosticSeverity = "info" | "warning";

/** Enumerated diagnostic codes for issues detected in the sync graph. */
export type DiagnosticCode =
  // Correctness smells (likely bugs)
  | "unreachable-response"
  | "unhandled-error-output"
  | "orphan-action"
  | "dangling-reference"
  | "dead-end-side-effect"
  | "missing-auth-guard"
  // Complexity heuristics
  | "heavy-where"
  | "high-fan"
  | "deep-chain"
  | "sync-cycle";

/**
 * A single diagnostic finding produced by analyzing the sync graph.
 */
export interface DiagnosticFinding {
  /** Machine-readable diagnostic code. */
  code: DiagnosticCode;
  /** Severity level. */
  severity: DiagnosticSeverity;
  /** Human-readable message describing the finding. */
  message: string;
  /** Sync names involved in this finding. */
  syncNames: string[];
  /** Node IDs involved in this finding. */
  nodeIds: string[];
  /** Best-effort file location hint for the source of the issue. */
  fileHint?: string;
  /** A suggestion for how to fix the issue, when applicable. */
  suggestion?: string;
}

/** Aggregated diagnostic results for the sync graph. */
export interface DiagnosticsReport {
  findings: DiagnosticFinding[];
  summary: {
    totalFindings: number;
    correctnessSmells: number;
    complexityHeuristics: number;
  };
}

// ── Combined report ──────────────────────────────────────

/** Complete analysis report combining graph structure, reachability, and diagnostics. */
export interface SyncGraphReport {
  graph: SyncGraph;
  reachability: EndpointReachability[];
  diagnostics: DiagnosticsReport;
  meta: {
    totalSyncs: number;
    totalEndpoints: number;
    totalConcepts: number;
    generatedAt: string;
  };
}

// ── Diagnostics configuration ────────────────────────────

/** Tuning knobs for diagnostic sensitivity thresholds. */
export interface DiagnosticsConfig {
  /** Number of query calls in a `where` clause that triggers a `heavy-where` warning. */
  heavyWhereQueryThreshold: number;
  /** Number of `when` clauses above which `high-fan` (fan-in) is reported. */
  highFanInThreshold: number;
  /** Number of `then` actions above which `high-fan` (fan-out) is reported. */
  highFanOutThreshold: number;
  /** Maximum causal hops before `deep-chain` is flagged. */
  deepChainThreshold: number;
}

/** Sensible defaults for {@link DiagnosticsConfig}. */
export const DEFAULT_DIAGNOSTICS_CONFIG: DiagnosticsConfig = {
  /** Syncs with fewer than this many distinct nodes in from/to aren't "heavy". */
  heavyWhereQueryThreshold: 5,
  highFanInThreshold: 4,
  highFanOutThreshold: 4,
  deepChainThreshold: 5,
};

// ── Plugin system ─────────────────────────────────────────

/**
 * An app-specific diagnostic detector that contributes findings to the
 * diagnostics report.  The core devtools ship only structural checks;
 * domain-aware detectors (e.g. "missing auth guard" that knows about
 * Sessioning/Roling) are plugged in from the app layer.
 */
export interface DiagnosticPlugin {
  /** Unique name for this plugin. */
  name: string;
  /** Produce findings from the graph and reachability results. */
  detect(
    graph: SyncGraph,
    reachability: EndpointReachability[],
  ): DiagnosticFinding[];
}
