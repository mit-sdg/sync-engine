/**
 * Sync graph report assembler — composes the {@link buildSyncGraph},
 * {@link computeReachability}, and {@link runDiagnostics} stages into a
 * single {@link SyncGraphReport} with derived `meta` counts.
 *
 * This module is **app-agnostic**: it imports only from `@engine` and the
 * sibling sync-graph modules.  Zero imports from `@concepts` or `@sdk`.
 */

import type { SyncConcept } from "@sync-engine/engine";
import { buildSyncGraph } from "./builder.ts";
import { runDiagnostics } from "./diagnostics.ts";
import { computeReachability } from "./reachability.ts";
import type {
  DiagnosticPlugin,
  RequestBoundary,
  SyncGraphReport,
} from "./types.ts";

/**
 * Build the complete sync graph report for an engine: graph, endpoint
 * reachability, advisory diagnostics, and summary `meta` counts.
 *
 * @param boundary  The app's request boundary, declared from its own concept
 *                  class so the builder needs no concept identity of its own.
 * @param plugins   App-specific diagnostic detectors.  The core ships only
 *                  structural checks; domain-aware detectors are plugged in.
 */
export function assembleReport(
  engine: SyncConcept,
  boundary: RequestBoundary,
  plugins?: DiagnosticPlugin[],
): SyncGraphReport {
  const graph = buildSyncGraph(engine, boundary);
  const reachability = computeReachability(graph);
  const diagnostics = runDiagnostics(graph, reachability, undefined, plugins);

  const concepts = new Set<string>();
  let totalEndpoints = 0;
  for (const node of graph.nodes) {
    if (node.concept) concepts.add(node.concept);
    if (node.kind === "endpoint") totalEndpoints += 1;
  }

  return {
    graph,
    reachability,
    diagnostics,
    meta: {
      totalSyncs: Object.keys(engine.syncs).length,
      totalEndpoints,
      totalConcepts: concepts.size,
      generatedAt: new Date().toISOString(),
    },
  };
}
