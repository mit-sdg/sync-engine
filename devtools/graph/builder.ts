/**
 * Sync graph builder — walks the registered synchronizations on a
 * {@link SyncConcept} engine and produces a normalized {@link SyncGraph}
 * of concept-action nodes, endpoint nodes, and causal sync edges.
 *
 * This module is **app-agnostic**: it imports only from `@engine` and
 * `./types.ts`.  Zero imports from `@concepts` or `@sdk`.
 */

import type { ActionPattern, SyncConcept, ThenClause, ThenNode } from "@sync-engine/engine";
import { actionNameOf, actionNodeId, conceptNameOf } from "@sync-engine/engine";
import type {
  ActionBinding,
  BindingSource,
  GraphEdge,
  GraphNode,
  PatternBinding,
  RequestBoundary,
  SyncGraph,
} from "./types.ts";

/**
 * Classify a pattern mapping value into its {@link BindingSource}.
 * - `typeof "symbol"` → `{ kind: "var", name: symbol.description }`
 * - `typeof "string" | "number" | "boolean"` → `{ kind: "literal", value: String(v) }`
 * - everything else → `{ kind: "expr" }`
 */
function classifyValue(v: unknown): BindingSource {
  if (typeof v === "symbol") {
    return { kind: "var", name: v.description ?? "" };
  }
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return { kind: "literal", value: String(v) };
  }
  return { kind: "expr" };
}

/**
 * Convert a pattern's input and output mappings into an {@link ActionBinding},
 * classifying each field value via {@link classifyValue}.
 */
function buildActionBinding(
  nodeId: string,
  input: Record<string, unknown>,
  output?: Record<string, unknown>,
): ActionBinding {
  const inputBindings: PatternBinding[] = Object.entries(input).map(([key, val]) => ({
    key,
    source: classifyValue(val),
  }));
  const outputBindings: PatternBinding[] = output
    ? Object.entries(output).map(([key, val]) => ({
        key,
        source: classifyValue(val),
      }))
    : [];
  return { nodeId, input: inputBindings, output: outputBindings };
}

/**
 * Merge {@link ActionBinding}s that share the same `nodeId` — combining
 * input/output keys (preserving order, deduplicating by key name).
 *
 * This handles cases where a sync references the same action more than once,
 * e.g. duplicate endpoint anchors from an auto-prepended bare request anchor
 * plus the user's explicit `Request()` call.
 */
function mergeBindings(bindings: ActionBinding[]): ActionBinding[] {
  const merged = new Map<string, ActionBinding>();
  const order: string[] = [];
  for (const b of bindings) {
    const existing = merged.get(b.nodeId);
    if (existing) {
      const existingInputKeys = new Set(existing.input.map((p) => p.key));
      for (const p of b.input) {
        if (!existingInputKeys.has(p.key)) {
          existing.input.push(p);
          existingInputKeys.add(p.key);
        }
      }
      const existingOutputKeys = new Set(existing.output.map((p) => p.key));
      for (const p of b.output) {
        if (!existingOutputKeys.has(p.key)) {
          existing.output.push(p);
          existingOutputKeys.add(p.key);
        }
      }
    } else {
      merged.set(b.nodeId, b);
      order.push(b.nodeId);
    }
  }
  // SAFETY: every id in `order` was set via `merged.set(b.nodeId, b)` above.
  return order.map((id) => merged.get(id) as ActionBinding);
}

function flattenThenPatterns(then: ThenClause): ActionPattern[] {
  if (!then.some((item) => "kind" in item)) return then as ActionPattern[];

  const patterns: ActionPattern[] = [];
  const visit = (node: ThenNode): void => {
    if (node.kind === "step") {
      patterns.push(node.action);
    }
    for (const child of node.then ?? []) {
      visit(child);
    }
  };

  for (const node of then as ThenNode[]) {
    visit(node);
  }
  return patterns;
}

/**
 * Build a causal sync graph from the engine's registered synchronizations.
 *
 * Each registered sync contributes concept-action nodes (one per distinct
 * action in its `when`/`then` clauses), endpoint nodes (for syncs anchored
 * by the boundary's entry action carrying a literal path), and directed
 * edges from the sync's `when` actions to its `then` actions.
 *
 * The {@link RequestBoundary} tells the builder which concept marks the
 * request boundary and how to read it — matched by `instanceof`, never by
 * class name — so this module stays free of any concrete concept identity.
 *
 * Output-key inference is performed statically: any keys appearing in
 * `ActionPattern.output` are collected on the corresponding node, and the
 * presence of `"error"` among them sets {@link GraphNode.producesError}.
 *
 * Input-key inference is also performed: any keys appearing in
 * `ActionPattern.input` are collected via {@link addInputs}.
 */
export function buildSyncGraph(engine: SyncConcept, boundary: RequestBoundary): SyncGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  // Stable id of the terminal response sink, derived from the boundary using
  // the same "strip Concept suffix" convention as conceptNameOf — e.g.
  // RequestingConcept + "respond" → "Requesting.respond".
  const responseSinkId = `${boundary.conceptClass.name.replace(/Concept$/, "")}.${boundary.exitAction}`;

  /**
   * Return the existing node for `id`, or create one with the given `kind`
   * and optional `concept` name.
   */
  function ensureNode(id: string, kind: GraphNode["kind"], concept?: string): GraphNode {
    let node = nodes.get(id);
    if (!node) {
      node = { id, kind, concept };
      nodes.set(id, node);
    }
    return node;
  }

  /**
   * Add output keys observed for an action, deduplicating.
   * If `"error"` is among the keys, flag `producesError`.
   */
  function addOutputs(node: GraphNode, keys: string[]): void {
    if (!node.outputs) node.outputs = [];
    for (const key of keys) {
      if (!node.outputs.includes(key)) node.outputs.push(key);
    }
    if (keys.includes("error")) node.producesError = true;
  }

  /**
   * Add input keys observed for an action, deduplicating.
   */
  function addInputs(node: GraphNode, keys: string[]): void {
    if (!node.inputs) node.inputs = [];
    for (const key of keys) {
      if (!node.inputs.includes(key)) node.inputs.push(key);
    }
  }

  for (const sync of Object.values(engine.syncs)) {
    let endpointPath: string | undefined;
    const whenBindings: ActionBinding[] = [];
    const thenBindings: ActionBinding[] = [];

    // ── `when` side: detect endpoint anchors, create source nodes ──
    const fromIds: string[] = [];
    for (const pattern of sync.when) {
      // Detect endpoint request anchor: the boundary's entry action whose
      // input carries a literal path string (injected by createEndpointDsl).
      const inputPath = pattern.input[boundary.pathKey];
      if (
        typeof inputPath === "string" &&
        inputPath.length > 0 &&
        pattern.concept instanceof boundary.conceptClass &&
        actionNameOf(pattern.action) === boundary.entryAction
      ) {
        endpointPath = inputPath;
        const endpointNode = ensureNode(endpointPath, "endpoint");
        fromIds.push(endpointNode.id);

        const endpointBinding: ActionBinding = {
          nodeId: endpointPath,
          input: Object.entries(pattern.input).map(([key, val]) => ({
            key,
            source: classifyValue(val),
          })),
          output: [],
        };
        whenBindings.push(endpointBinding);

        continue; // the request anchor itself is not a concept-action node
      }

      const id = actionNodeId(pattern);
      const node = ensureNode(id, "concept-action", conceptNameOf(pattern.concept));
      fromIds.push(node.id);

      const actionBinding = buildActionBinding(id, pattern.input, pattern.output);
      whenBindings.push(actionBinding);
      const inputKeys = Object.keys(pattern.input);
      if (inputKeys.length > 0) {
        addInputs(node, inputKeys);
      }

      if (pattern.output) {
        addOutputs(node, Object.keys(pattern.output));
      }
    }

    // ── `then` side: create target nodes ──
    const toIds: string[] = [];
    for (const pattern of flattenThenPatterns(sync.then)) {
      // The boundary's exit action is terminal — collapse it to a stable sink
      // id regardless of which boundary instance it came from.
      const isExitAction =
        pattern.concept instanceof boundary.conceptClass &&
        actionNameOf(pattern.action) === boundary.exitAction;
      const id = isExitAction ? responseSinkId : actionNodeId(pattern);

      const node = ensureNode(id, "concept-action", conceptNameOf(pattern.concept));
      toIds.push(node.id);

      const actionBinding = buildActionBinding(id, pattern.input, pattern.output);
      thenBindings.push(actionBinding);
      const inputKeys = Object.keys(pattern.input);
      if (inputKeys.length > 0) {
        addInputs(node, inputKeys);
      }

      if (pattern.output) {
        addOutputs(node, Object.keys(pattern.output));
      }
    }

    // Merge bindings that share the same nodeId — a sync may reference the
    // same action more than once (e.g. duplicate endpoint anchors from the
    // auto-prepended bare request anchor + the user's explicit Request() call).
    const mergedWhen = mergeBindings(whenBindings);
    const mergedThen = mergeBindings(thenBindings);

    // `from`/`to` are sets of distinct nodes: a sync may reference the same
    // node id more than once (e.g. an endpoint path appearing on multiple
    // `when` patterns, or several `respond` actions collapsing to the stable
    // "Requesting.respond" id), but the edge links each node only once.
    edges.push({
      syncName: sync.sync,
      from: [...new Set(fromIds)],
      to: [...new Set(toIds)],
      when: mergedWhen,
      then: mergedThen,
      hasWhere: sync.where !== undefined,
      endpoint: endpointPath,
      whereStr: sync.where?.toString(),
    });
  }

  return { nodes: [...nodes.values()], edges, responseSinkId };
}
