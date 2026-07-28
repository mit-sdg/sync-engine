import type { ConsequenceIR, TriggerIR, ViewOpIR, WhereOpIR } from "@engine/reads/ir";
import { analyzeLocalBehavior, type LocalBehaviorDefinition } from "@engine/reads/local-behavior";
import { foldFormerNode, foldOps, foldReaction, foldView } from "@engine/reads/schema";
import { canonicalDigest, canonicalValue } from "@engine/utils/canonical-json";
import { setOwn } from "@engine/utils/own-property";
import type { ApplicationManifestV2 } from "./manifest.ts";

export type DependencyNodeKind =
  | "endpoint"
  | "output"
  | "reaction"
  | "action"
  | "query"
  | "view"
  | "former"
  | "computation"
  | "review"
  | "opaque";

export interface DependencyNode {
  id: string;
  kind: DependencyNodeKind;
  name: string;
  digest: string;
  opaque?: true;
}

export type DependencyEdgeKind =
  | "implements"
  | "produces"
  | "triggers-on"
  | "requests"
  | "reads"
  | "uses"
  | "invalidated-by"
  | "opaque-dependency";

export interface DependencyEdge {
  from: string;
  to: string;
  kind: DependencyEdgeKind;
}

export interface ApplicationDependencyGraphV2 {
  format: "sync-engine.application-dependency-graph";
  version: 2;
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  reverse: Record<string, string[]>;
}

export interface ApplicationImpact {
  directlyChanged: string[];
  affected: string[];
  endpoints: string[];
  outputs: string[];
  wholeApplication: boolean;
}

const ordinal = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

function nodeId(kind: DependencyNodeKind, name: string): string {
  return `${kind}:${encodeURIComponent(name)}`;
}

function definitionNode(definition: LocalBehaviorDefinition): string {
  return nodeId(definition.kind, definition.name);
}

export function applicationDependencyGraph(
  manifest: ApplicationManifestV2,
): ApplicationDependencyGraphV2 {
  const nodes = new Map<string, DependencyNode>();
  const edges = new Map<string, DependencyEdge>();
  const addNode = (
    kind: DependencyNodeKind,
    name: string,
    payload?: unknown,
    opaque = false,
  ): string => {
    const id = nodeId(kind, name);
    if (nodes.has(id) && payload === undefined && !opaque) return id;
    nodes.set(id, {
      id,
      kind,
      name,
      digest: canonicalDigest(payload ?? { kind, name }),
      ...(opaque ? { opaque: true } : {}),
    });
    return id;
  };
  const addEdge = (from: string, to: string, kind: DependencyEdgeKind) => {
    const edge = { from, to, kind };
    edges.set(`${from}\0${to}\0${kind}`, edge);
  };

  for (const concept of manifest.concepts) {
    for (const action of concept.actions) {
      addNode("action", `${concept.name}.${action.name}`, action);
    }
    for (const query of concept.queries) addNode("query", `${concept.name}.${query.name}`, query);
    for (const action of concept.actions) {
      for (const query of concept.queries) {
        addEdge(
          nodeId("query", `${concept.name}.${query.name}`),
          nodeId("action", `${concept.name}.${action.name}`),
          "invalidated-by",
        );
      }
    }
  }

  addNode("review", "local-behavior", manifest.localBehavior);

  const connectOp = (owner: string, op: WhereOpIR | ViewOpIR) => {
    if ("query" in op && op.query !== undefined) {
      addEdge(owner, addNode("query", `${op.query.concept}.${op.query.query}`), "reads");
    }
    if ("view" in op && typeof op.view === "string") {
      addEdge(owner, addNode("view", op.view), "reads");
    }
    if ("computation" in op && typeof op.computation === "string") {
      addEdge(owner, addNode("computation", op.computation, { name: op.computation }), "uses");
    }
  };
  const connectTrigger = (owner: string, trigger: TriggerIR) => {
    if (trigger.kind !== "action") return;
    addEdge(owner, addNode("action", `${trigger.concept}.${trigger.action}`), "triggers-on");
    if (trigger.by !== undefined) {
      addEdge(owner, addNode("reaction", trigger.by), "uses");
    }
  };
  const connectConsequence = (owner: string, consequence: ConsequenceIR) => {
    addEdge(owner, addNode("action", `${consequence.concept}.${consequence.action}`), "requests");
  };

  for (const reaction of manifest.application.reactions) {
    const owner = addNode("reaction", reaction.name, reaction);
    foldReaction(reaction, {
      trigger: (trigger) => connectTrigger(owner, trigger),
      consequence: (consequence) => connectConsequence(owner, consequence),
      op: (op) => connectOp(owner, op),
    });
  }
  for (const reaction of manifest.application.unlowered) {
    const owner = addNode("reaction", reaction.name, reaction);
    for (const trigger of reaction.known.when) connectTrigger(owner, trigger);
    foldOps(reaction.known.where, { op: (op) => connectOp(owner, op) });
    for (const consequence of reaction.known.then) connectConsequence(owner, consequence);
  }
  for (const view of manifest.application.views) {
    const owner = addNode("view", view.name, view);
    foldView(view, { op: (op) => connectOp(owner, op) });
  }
  for (const former of manifest.application.formers) {
    const owner = addNode("former", former.name, former);
    foldFormerNode(former.body, { op: (op) => connectOp(owner, op) });
  }

  const local = analyzeLocalBehavior(manifest.application);
  for (const dependency of local.dependencies) {
    const target = addNode(dependency.to.kind, dependency.to.name);
    addEdge(
      addNode(dependency.from.kind, dependency.from.name),
      target,
      dependency.to.kind === "view" ? "reads" : "uses",
    );
  }
  for (const occurrence of local.occurrences) {
    const name = `${occurrence.definition.kind}:${occurrence.definition.name}/${occurrence.kind}/${occurrence.occurrence}`;
    const opaque = addNode("opaque", name, occurrence, true);
    addEdge(definitionNode(occurrence.definition), opaque, "opaque-dependency");
  }

  for (const endpoint of manifest.endpoints) {
    const endpointName = `${endpoint.path}#${endpoint.name}`;
    const endpointNode = addNode("endpoint", endpointName, endpoint);
    const outputNode = addNode(
      "output",
      endpointName,
      manifest.wire.endpoints.find(({ path }) => path === endpoint.path)?.output ?? null,
    );
    addEdge(outputNode, endpointNode, "produces");
    for (const reactionName of endpoint.reactions) {
      const matching = [
        ...manifest.application.reactions,
        ...manifest.application.unlowered,
      ].filter(
        ({ name }) =>
          name === reactionName ||
          name.startsWith(`${reactionName}#`) ||
          name.startsWith(`${reactionName}:`),
      );
      for (const reaction of matching) {
        addEdge(endpointNode, nodeId("reaction", reaction.name), "implements");
      }
    }
  }

  const sortedNodes = [...nodes.values()].sort((left, right) => ordinal(left.id, right.id));
  const sortedEdges = [...edges.values()]
    .filter(({ from, to }) => nodes.has(from) && nodes.has(to))
    .sort((left, right) =>
      ordinal(
        `${left.to}\0${left.from}\0${left.kind}`,
        `${right.to}\0${right.from}\0${right.kind}`,
      ),
    );
  const reverse: Record<string, string[]> = {};
  for (const edge of sortedEdges) {
    const dependents = reverse[edge.to] ?? [];
    dependents.push(edge.from);
    setOwn(reverse, edge.to, dependents);
  }
  for (const id of Object.keys(reverse)) reverse[id]?.sort(ordinal);
  return canonicalValue({
    format: "sync-engine.application-dependency-graph",
    version: 2,
    nodes: sortedNodes,
    edges: sortedEdges,
    reverse,
  }) as unknown as ApplicationDependencyGraphV2;
}

export function diffManifestNodes(
  before: ApplicationManifestV2,
  after: ApplicationManifestV2,
): string[] {
  const left = new Map(
    applicationDependencyGraph(before).nodes.map((node) => [node.id, node.digest]),
  );
  const right = new Map(
    applicationDependencyGraph(after).nodes.map((node) => [node.id, node.digest]),
  );
  return [...new Set([...left.keys(), ...right.keys()])]
    .filter((id) => left.get(id) !== right.get(id))
    .sort(ordinal);
}

export function affectedNodes(
  graph: ApplicationDependencyGraphV2,
  directlyChanged: readonly string[],
): string[] {
  const affected = new Set(directlyChanged);
  const queue = [...directlyChanged];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const dependent of graph.reverse[current] ?? []) {
      if (affected.has(dependent)) continue;
      affected.add(dependent);
      queue.push(dependent);
    }
  }
  return [...affected].sort(ordinal);
}

function graphHasOpaque(graph: ApplicationDependencyGraphV2): boolean {
  return graph.nodes.some(({ kind, opaque }) => kind === "opaque" && opaque === true);
}

export function applicationImpact(
  before: ApplicationManifestV2,
  after: ApplicationManifestV2,
): ApplicationImpact {
  const beforeGraph = applicationDependencyGraph(before);
  const afterGraph = applicationDependencyGraph(after);
  const directlyChanged = diffManifestNodes(before, after);
  const wholeApplication =
    directlyChanged.length > 0 && (graphHasOpaque(beforeGraph) || graphHasOpaque(afterGraph));
  const affected = wholeApplication
    ? afterGraph.nodes.map(({ id }) => id).sort(ordinal)
    : affectedNodes(afterGraph, directlyChanged);
  const byId = new Map(afterGraph.nodes.map((node) => [node.id, node]));
  return {
    directlyChanged,
    affected,
    endpoints: affected
      .filter((id) => byId.get(id)?.kind === "endpoint")
      .map((id) => byId.get(id)?.name as string)
      .sort(ordinal),
    outputs: affected
      .filter((id) => byId.get(id)?.kind === "output")
      .map((id) => byId.get(id)?.name as string)
      .sort(ordinal),
    wholeApplication,
  };
}
