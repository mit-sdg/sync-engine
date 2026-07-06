/**
 * Reachability analysis for the sync/concept causal graph.
 *
 * Given a {@link SyncGraph} (from the builder), for each endpoint cluster this
 * module BFS-traverses the edge graph to determine whether every code path
 * originating from the endpoint can reach the response sink node.
 *
 * This analysis catches the class of bugs where a sync branch never calls
 * `Respond` (or `Respond({ error: ... })`), causing the request to hang until
 * the configured `REQUESTING_TIMEOUT` triggers a `NoResponseGuard`.
 *
 * This module is **app-agnostic**: it imports only from `./types.ts`.  Zero
 * imports from `@concepts` or `@sdk`.
 */

import type { EndpointReachability, GraphEdge, SyncGraph } from "./types.ts";

/**
 * Compute reachability for every endpoint in the graph.
 *
 * For each endpoint node, BFS finds all reachable nodes from the endpoint,
 * identifies dead-end leaf nodes (concept-action nodes with no outgoing edges
 * that are not themselves the response sink), and determines whether the
 * response sink is reachable at all. The sink id comes from the graph itself
 * ({@link SyncGraph.responseSinkId}), so this module knows no concept name.
 */
export function computeReachability(graph: SyncGraph): EndpointReachability[] {
  const responseSinkId = graph.responseSinkId;

  // ── Build adjacency list: nodeId → list of outgoing edge targets ──
  const outgoing = buildOutgoingMap(graph.edges);

  // ── Only endpoints are starting points for reachability ──
  const endpointNodes = graph.nodes.filter((n) => n.kind === "endpoint");

  const results: EndpointReachability[] = [];

  for (const endpoint of endpointNodes) {
    // BFS from the endpoint to discover every reachable node
    const reachable = bfsReachable(endpoint.id, outgoing);

    // Dead-end nodes: reachable, not the endpoint itself, not the Respond sink,
    // and have zero outgoing edges (graph leaves with nowhere to go).
    const deadEndNodes: string[] = [];
    for (const nodeId of reachable) {
      if (nodeId === responseSinkId) continue;
      if (nodeId === endpoint.id) continue;

      const targets = outgoing.get(nodeId);
      if (!targets || targets.length === 0) {
        deadEndNodes.push(nodeId);
      }
    }

    const respondsReachable = reachable.has(responseSinkId);
    const longestChain = computeLongestPath(endpoint.id, responseSinkId, outgoing, reachable);

    results.push({
      endpoint: endpoint.id,
      respondsReachable,
      deadEndNodes,
      longestChain,
    });
  }

  return results;
}

// ── Helpers ────────────────────────────────────────────────

/**
 * Build a `sourceId → targetId[]` adjacency map from the graph's edges.
 *
 * Each edge is a fan-out relation: every source node in `edge.from` is
 * connected to every target node in `edge.to`.
 */
function buildOutgoingMap(edges: GraphEdge[]): Map<string, string[]> {
  const outgoing = new Map<string, string[]>();

  for (const edge of edges) {
    for (const fromId of edge.from) {
      let targets = outgoing.get(fromId);
      if (!targets) {
        targets = [];
        outgoing.set(fromId, targets);
      }
      for (const toId of edge.to) {
        if (!targets.includes(toId)) {
          targets.push(toId);
        }
      }
    }
  }

  return outgoing;
}

/**
 * Standard BFS from `startId` through the outgoing adjacency map.
 *
 * Returns the set of all node IDs reachable from `startId` (including
 * `startId` itself).
 */
function bfsReachable(startId: string, outgoing: Map<string, string[]>): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [startId];
  visited.add(startId);

  while (queue.length > 0) {
    const current = queue.shift() as string;
    const targets = outgoing.get(current);
    if (targets) {
      for (const target of targets) {
        if (!visited.has(target)) {
          visited.add(target);
          queue.push(target);
        }
      }
    }
  }

  return visited;
}

/**
 * Compute the longest causal chain length (number of hops) from `startId` to
 * `endId`.
 *
 * Uses max-distance relaxation over the subgraph of reachable nodes.  The
 * number of iterations is bounded by the size of the reachable set to prevent
 * unbounded inflation when the graph contains cycles (cycle detection is a
 * separate diagnostic).  For cycle-free graphs this computes the exact longest
 * path; for cyclic graphs it returns a conservative approximation.
 */
function computeLongestPath(
  startId: string,
  endId: string,
  outgoing: Map<string, string[]>,
  reachable: Set<string>,
): number {
  if (!reachable.has(endId)) return 0;

  const maxDist = new Map<string, number>();
  maxDist.set(startId, 0);

  const nodesToProcess = [...reachable];
  // Cap iterations to the number of reachable nodes: the longest *simple* path
  // can visit each node at most once, so this bound prevents cycle-induced
  // runaway.
  const maxIterations = nodesToProcess.length;

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;
    for (const current of nodesToProcess) {
      const curDist = maxDist.get(current);
      if (curDist === undefined) continue;

      const targets = outgoing.get(current);
      if (targets) {
        for (const target of targets) {
          if (!reachable.has(target)) continue;
          const newDist = curDist + 1;
          const existing = maxDist.get(target);
          if (existing === undefined || newDist > existing) {
            maxDist.set(target, newDist);
            changed = true;
          }
        }
      }
    }
    if (!changed) break; // converged — no more improvement possible
  }

  return maxDist.get(endId) ?? 0;
}
