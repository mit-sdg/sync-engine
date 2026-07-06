/**
 * Advisory diagnostic engine for the sync/concept causal graph.
 *
 * Analyzes a {@link SyncGraph} together with its reachability results and
 * emits {@link DiagnosticFinding}[] — correctness smells and complexity
 * heuristics.  These diagnostics are **advisory**: they never throw, never
 * gate CI.  They surface likely issues for developer review.
 *
 * This module is **app-agnostic**: it imports only from `./types.ts`.  Zero
 * imports from `@concepts` or `@sdk`.
 *
 * App-specific detectors (e.g. auth-guard checks that know about
 * Sessioning/Roling) live in {@link DiagnosticPlugin} instances wired from
 * the app layer — see `app/devtools/plugins/`.
 */

import type {
  DiagnosticFinding,
  DiagnosticPlugin,
  DiagnosticsConfig,
  DiagnosticsReport,
  EndpointReachability,
  SyncGraph,
} from "./types.ts";
import { DEFAULT_DIAGNOSTICS_CONFIG } from "./types.ts";

// ── Public API ────────────────────────────────────────────

/**
 * Run all diagnostics against the sync graph and reachability results.
 * Returns a {@link DiagnosticsReport} with all findings and summary counts.
 *
 * @param plugins  App-specific {@link DiagnosticPlugin} instances.  The core
 *                 ships only structural checks; domain-aware detectors are
 *                 plugged in from the app layer.
 */
export function runDiagnostics(
  graph: SyncGraph,
  reachability: EndpointReachability[],
  config: DiagnosticsConfig = DEFAULT_DIAGNOSTICS_CONFIG,
  plugins?: DiagnosticPlugin[],
): DiagnosticsReport {
  const findings: DiagnosticFinding[] = [];

  // 1. Correctness smells
  findings.push(...detectUnreachableResponses(reachability));
  findings.push(...detectDeadEndSideEffects(reachability));
  findings.push(...detectUnhandledErrorOutputs(graph));
  findings.push(...detectOrphanActions(graph));
  findings.push(...detectDanglingReferences(graph));

  // 2. Complexity heuristics
  findings.push(...detectHeavyWhere(graph, config));
  findings.push(...detectHighFan(graph, config));
  findings.push(...detectDeepChains(reachability, config));
  findings.push(...detectSyncCycles(graph));

  // 3. Plugins
  for (const plugin of plugins ?? []) {
    findings.push(...plugin.detect(graph, reachability));
  }

  const correctnessSmells = findings.filter(
    (f) =>
      f.code === "unreachable-response" ||
      f.code === "unhandled-error-output" ||
      f.code === "orphan-action" ||
      f.code === "dangling-reference" ||
      f.code === "missing-auth-guard",
  ).length;
  const complexityHeuristics = findings.length - correctnessSmells;

  return {
    findings,
    summary: {
      totalFindings: findings.length,
      correctnessSmells,
      complexityHeuristics,
    },
  };
}

// ── Correctness smell detectors ──────────────────────────

/**
 * Unreachable response: no code path from this endpoint can reach Respond
 * or Fail.  The request will hang until `REQUESTING_TIMEOUT` triggers a
 * `NoResponseGuard`.
 *
 * This ONLY fires when `respondsReachable` is false — i.e. even the
 * "happy path" cannot reach a response.  Side-effect dead ends (e.g. audit
 * syncs) that coexist with a working response path are reported separately
 * by {@link detectDeadEndSideEffects}.
 */
function detectUnreachableResponses(reachability: EndpointReachability[]): DiagnosticFinding[] {
  // ── Hoisted helper ──
  function format(r: EndpointReachability): DiagnosticFinding {
    return {
      code: "unreachable-response",
      severity: "warning" as const,
      message: `Endpoint "${r.endpoint}" has no reachable Respond/Fail from any code path. Request will hang until timeout.`,
      syncNames: [],
      nodeIds: [r.endpoint, ...r.deadEndNodes],
      suggestion:
        "Ensure every branch ends with a sync that calls Respond or Fail. Consider adding error-handling syncs for actions that can produce error outputs.",
    };
  }

  return reachability.filter((r) => !r.respondsReachable).map(format);
}

/**
 * Dead-end side-effect: an endpoint has one or more dead-end branches
 * (e.g. audit / notification syncs) BUT at least one other path DOES reach
 * Respond/Fail — so the request will NOT hang.
 *
 * These are normal for fire-and-forget patterns and are informational only.
 */
function detectDeadEndSideEffects(reachability: EndpointReachability[]): DiagnosticFinding[] {
  // ── Hoisted helper ──
  function format(r: EndpointReachability): DiagnosticFinding {
    const n = r.deadEndNodes.length;
    return {
      code: "dead-end-side-effect",
      severity: "info" as const,
      message: `Endpoint "${r.endpoint}" has ${n} side-effect path(s) that never reach Respond/Fail (e.g. audit/notification syncs). These don't cause request hangs since another sync in the cluster handles the response.`,
      syncNames: [],
      nodeIds: [r.endpoint, ...r.deadEndNodes],
      suggestion:
        "Side-effect syncs that fire and forget are normal. Only investigate if you expected a response from these paths.",
    };
  }

  return reachability.filter((r) => r.respondsReachable && r.deadEndNodes.length > 0).map(format);
}

/**
 * Unhandled error output: an action produces `error` but no sync routes it
 * to `Requesting.respond`.
 */
function detectUnhandledErrorOutputs(graph: SyncGraph): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];

  // Build map: which nodes are consumed (appear as a source in any edge)?
  const consumedBy = new Map<string, string[]>();
  for (const edge of graph.edges) {
    for (const fromId of edge.from) {
      let consumers = consumedBy.get(fromId);
      if (!consumers) {
        consumers = [];
        consumedBy.set(fromId, consumers);
      }
      consumers.push(edge.syncName);
    }
  }

  for (const node of graph.nodes) {
    if (node.kind !== "concept-action") continue;
    if (!node.producesError) continue;

    // Check if any edge consuming this action also routes to Respond
    const consumingSyncs = consumedBy.get(node.id) ?? [];
    const hasErrorHandler = consumingSyncs.some((syncName) => {
      const edge = graph.edges.find((e) => e.syncName === syncName);
      return edge?.to.includes(graph.responseSinkId);
    });

    if (!hasErrorHandler && consumingSyncs.length > 0) {
      findings.push({
        code: "unhandled-error-output",
        severity: "warning",
        message: `Action "${node.id}" can produce an error output, but no consuming sync routes it to Respond/Fail.`,
        syncNames: consumingSyncs,
        nodeIds: [node.id],
        suggestion:
          "Add an error-handling sync that matches the error output and routes it to Fail (or Respond with error details).",
      });
    }
  }

  return findings;
}

/**
 * Orphan action: an action never referenced by any `when` or `then` clause.
 *
 * These may be dead code — actions that exist in a concept but are never
 * wired into the causal graph.
 */
function detectOrphanActions(graph: SyncGraph): DiagnosticFinding[] {
  // Collect all node IDs that appear in any edge
  const referenced = new Set<string>();
  for (const edge of graph.edges) {
    for (const id of edge.from) referenced.add(id);
    for (const id of edge.to) referenced.add(id);
  }

  const findings: DiagnosticFinding[] = [];
  for (const node of graph.nodes) {
    if (node.kind === "endpoint") continue; // endpoints are always starting points
    if (node.id === graph.responseSinkId) continue; // terminal sink
    if (!referenced.has(node.id)) {
      findings.push({
        code: "orphan-action",
        severity: "info",
        message: `Action "${node.id}" is not referenced by any sync's when or then clause.`,
        syncNames: [],
        nodeIds: [node.id],
        suggestion:
          "This action may be dead code. Remove it or add a sync that wires it into the system.",
      });
    }
  }

  return findings;
}

/**
 * Dangling reference: sync edge references a node that does not exist in
 * the graph.
 *
 * The builder already produces a normalized graph where all edge references
 * point to existing nodes.  This is a safety net in case the graph is
 * hand-crafted.
 */
function detectDanglingReferences(graph: SyncGraph): DiagnosticFinding[] {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));

  const findings: DiagnosticFinding[] = [];
  for (const edge of graph.edges) {
    for (const id of edge.from) {
      if (!nodeIds.has(id)) {
        findings.push({
          code: "dangling-reference",
          severity: "warning",
          message: `Sync "${edge.syncName}" references non-existent source node "${id}".`,
          syncNames: [edge.syncName],
          nodeIds: [id],
          suggestion: "Check that the action name is correct and the concept is registered.",
        });
      }
    }
    for (const id of edge.to) {
      if (!nodeIds.has(id)) {
        findings.push({
          code: "dangling-reference",
          severity: "warning",
          message: `Sync "${edge.syncName}" references non-existent target node "${id}".`,
          syncNames: [edge.syncName],
          nodeIds: [id],
          suggestion: "Check that the action name is correct and the concept is registered.",
        });
      }
    }
  }

  return findings;
}

// ── Complexity heuristic detectors ───────────────────────

/**
 * Heavy where: syncs whose `where` clause appears complex.
 *
 * For the static builder, we have `hasWhere` on edges but no AST access.
 * The `hasWhere` flag is set when `sync.where !== undefined`.  We flag
 * syncs with where clauses that reference many unique actions as a rough
 * complexity proxy.
 */
function detectHeavyWhere(graph: SyncGraph, config: DiagnosticsConfig): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];

  for (const edge of graph.edges) {
    if (!edge.hasWhere) continue;

    // Count unique actions referenced as rough complexity proxy
    const uniqueActions = new Set([...edge.from, ...edge.to]).size;
    if (uniqueActions >= config.heavyWhereQueryThreshold) {
      findings.push({
        code: "heavy-where",
        severity: "info",
        message: `Sync "${edge.syncName}" has a where clause and involves ${uniqueActions} unique actions across when/then. Consider simplifying or splitting.`,
        syncNames: [edge.syncName],
        nodeIds: [...edge.from, ...edge.to],
        suggestion:
          "Syncs with where clauses that span many actions couple disparate concerns. Consider splitting into multiple smaller, single-responsibility syncs.",
      });
    }
  }

  return findings;
}

/**
 * High fan-in / fan-out: syncs with many when/then clauses, and hub actions
 * referenced by many syncs.
 */
function detectHighFan(graph: SyncGraph, config: DiagnosticsConfig): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];

  for (const edge of graph.edges) {
    if (edge.from.length >= config.highFanInThreshold) {
      findings.push({
        code: "high-fan",
        severity: "info",
        message: `Sync "${edge.syncName}" has ${edge.from.length} when clauses (high fan-in).`,
        syncNames: [edge.syncName],
        nodeIds: edge.from,
        suggestion:
          "High fan-in syncs are triggered by many different actions, making them hard to reason about. Consider if the sync can be split.",
      });
    }

    if (edge.to.length >= config.highFanOutThreshold) {
      findings.push({
        code: "high-fan",
        severity: "info",
        message: `Sync "${edge.syncName}" triggers ${edge.to.length} then actions (high fan-out).`,
        syncNames: [edge.syncName],
        nodeIds: edge.to,
        suggestion:
          "High fan-out syncs trigger many downstream actions. Consider chaining through intermediate syncs for clarity.",
      });
    }
  }

  // Detect hub actions referenced by many syncs
  const actionRefCount = new Map<string, number>();
  for (const edge of graph.edges) {
    for (const id of edge.from) {
      actionRefCount.set(id, (actionRefCount.get(id) ?? 0) + 1);
    }
    for (const id of edge.to) {
      actionRefCount.set(id, (actionRefCount.get(id) ?? 0) + 1);
    }
  }

  const hubThreshold = config.highFanInThreshold;
  for (const [nodeId, count] of actionRefCount) {
    if (count >= hubThreshold) {
      // Only flag concept-action nodes, not endpoints or Respond
      const node = graph.nodes.find((n) => n.id === nodeId);
      if (node?.kind === "concept-action") {
        findings.push({
          code: "high-fan",
          severity: "info",
          message: `Action "${nodeId}" is referenced by ${count} syncs (hub node).`,
          syncNames: [],
          nodeIds: [nodeId],
          suggestion:
            "Hub actions couple many parts of the system together. Consider if the action's responsibility can be narrowed.",
        });
      }
    }
  }

  return findings;
}

/**
 * Deep chains: endpoints whose longest causal chain exceeds the threshold.
 *
 * Long chains are harder to trace and easier to break during refactoring.
 */
function detectDeepChains(
  reachability: EndpointReachability[],
  config: DiagnosticsConfig,
): DiagnosticFinding[] {
  // ── Hoisted helper ──
  function formatDeepChainFinding(r: EndpointReachability): DiagnosticFinding {
    return {
      code: "deep-chain",
      severity: "info",
      message: `Endpoint "${r.endpoint}" has a causal chain of ${r.longestChain} hops from Request to Respond.`,
      syncNames: [],
      nodeIds: [r.endpoint],
      suggestion:
        "Deep chains are hard to trace and easy to break. Consider collapsing intermediate syncs or adding intermediate Respond points.",
    };
  }

  return reachability
    .filter((r) => r.longestChain >= config.deepChainThreshold)
    .map(formatDeepChainFinding);
}

// ── Cycle detection (DFS with White / Gray / Black coloring) ──

// Sentinel values for the tri-color marking used in cycle detection.
const WHITE = 0;
const GRAY = 1;
const BLACK = 2;

/**
 * Sync cycles: detect cycles in the edge graph using DFS with white/gray/black
 * coloring (classic Tarjan-inspired algorithm).
 *
 * The engine's synced guard prevents infinite loops at runtime, but cycles
 * signal fragile design that should be reviewed.
 */
function detectSyncCycles(graph: SyncGraph): DiagnosticFinding[] {
  // Build adjacency: nodeId → list of successor nodeIds
  const adj = new Map<string, string[]>();
  for (const edge of graph.edges) {
    for (const fromId of edge.from) {
      let targets = adj.get(fromId);
      if (!targets) {
        targets = [];
        adj.set(fromId, targets);
      }
      for (const toId of edge.to) {
        if (!targets.includes(toId)) targets.push(toId);
      }
    }
  }

  // DFS-based cycle detection with white/gray/black coloring
  const color = new Map<string, number>();
  for (const nodeId of adj.keys()) color.set(nodeId, WHITE);

  const cycles: string[][] = [];

  function dfs(nodeId: string, path: string[]): void {
    color.set(nodeId, GRAY);
    path.push(nodeId);

    const targets = adj.get(nodeId) ?? [];
    for (const target of targets) {
      const targetColor = color.get(target) ?? WHITE;
      if (targetColor === GRAY) {
        // Found a cycle — extract it from the current path
        const cycleStart = path.indexOf(target);
        if (cycleStart >= 0) {
          const cycle = path.slice(cycleStart);
          cycle.push(target); // close the cycle
          cycles.push(cycle);
        }
      } else if (targetColor === WHITE) {
        dfs(target, path);
      }
      // BLACK nodes are already fully explored — skip
    }

    path.pop();
    color.set(nodeId, BLACK);
  }

  for (const [nodeId, c] of color) {
    if (c === WHITE) dfs(nodeId, []);
  }

  if (cycles.length === 0) return [];

  // Deduplicate cycles (same set of nodes presented in different rotations)
  const uniqueCycles = new Map<string, string[]>();
  for (const cycle of cycles) {
    const key = [...new Set(cycle)].sort().join(",");
    if (!uniqueCycles.has(key)) uniqueCycles.set(key, cycle);
  }

  return [...uniqueCycles.values()].map((cycle) => ({
    code: "sync-cycle",
    severity: "warning",
    message: `Detected sync cycle involving ${cycle.length} nodes: ${cycle.join(" → ")}`,
    syncNames: [],
    nodeIds: cycle,
    suggestion:
      "The engine's synced guard prevents infinite loops at runtime, but cycles signal fragile design. Consider restructuring to break the feedback loop.",
  }));
}
