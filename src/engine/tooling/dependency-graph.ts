import type {
  ConsequenceIR,
  PatternIR,
  TriggerIR,
  ValueIR,
  ViewOpIR,
  WhereOpIR,
} from "@engine/reads/ir";
import { foldFormerNode, foldReaction, foldView } from "@engine/reads/schema";
import { canonicalDigest, canonicalValue } from "@engine/utils/canonical-json";
import type { ApplicationManifestV1 } from "./manifest.ts";

export type DependencyNodeKind =
  | "endpoint"
  | "output"
  | "reaction"
  | "action"
  | "query"
  | "view"
  | "former"
  | "computation"
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

export interface ApplicationDependencyGraphV1 {
  format: "sync-engine.application-dependency-graph";
  version: 1;
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

function ordinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function nodeId(kind: DependencyNodeKind, name: string): string {
  return `${kind}:${encodeURIComponent(name)}`;
}

function patternFormerNames(pattern: PatternIR): string[] {
  const names = new Set<string>();
  const visit = (value: ValueIR) => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const former = (value as { $former?: unknown }).$former;
    if (
      typeof former === "object" &&
      former !== null &&
      typeof (former as { name?: unknown }).name === "string"
    ) {
      names.add((former as { name: string }).name);
    }
    for (const entry of Object.values(value)) {
      if (typeof entry === "object" && entry !== null) visit(entry as ValueIR);
    }
  };
  for (const value of Object.values(pattern)) visit(value);
  return [...names];
}

export function applicationDependencyGraph(
  manifest: ApplicationManifestV1,
): ApplicationDependencyGraphV1 {
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
    for (const action of concept.actions)
      addNode("action", `${concept.name}.${action.name}`, action);
    for (const query of concept.queries) addNode("query", `${concept.name}.${query.name}`, query);
    for (const action of concept.actions) {
      const actionNode = nodeId("action", `${concept.name}.${action.name}`);
      for (const query of concept.queries) {
        const queryNode = nodeId("query", `${concept.name}.${query.name}`);
        addEdge(queryNode, actionNode, "invalidated-by");
      }
    }
  }

  const opaqueApplication = addNode("opaque", "application", { opaque: true }, true);
  let hasOpaque = false;

  const connectPattern = (owner: string, pattern: PatternIR) => {
    for (const name of patternFormerNames(pattern)) {
      addEdge(owner, addNode("former", name), "uses");
    }
  };
  const connectOp = (owner: string, op: WhereOpIR | ViewOpIR) => {
    if ("query" in op && op.query !== undefined) {
      addEdge(owner, addNode("query", `${op.query.concept}.${op.query.query}`), "reads");
    }
    if ("view" in op && typeof op.view === "string") {
      addEdge(owner, addNode("view", op.view), "reads");
    }
    if ("computation" in op && typeof op.computation === "string") {
      addEdge(
        owner,
        addNode("computation", op.computation, { name: op.computation }, true),
        "uses",
      );
    }
    if (op.op === "custom") {
      hasOpaque = true;
      const custom = addNode("opaque", `${owner}/custom`, op, true);
      addEdge(owner, custom, "opaque-dependency");
      addEdge(custom, opaqueApplication, "opaque-dependency");
    }
  };
  const connectTrigger = (owner: string, trigger: TriggerIR) => {
    if (trigger.kind === "action") {
      addEdge(owner, addNode("action", `${trigger.concept}.${trigger.action}`), "triggers-on");
      connectPattern(owner, trigger.input);
      connectPattern(owner, trigger.output);
    } else {
      connectPattern(owner, trigger.pattern);
    }
  };
  const connectConsequence = (owner: string, consequence: ConsequenceIR) => {
    addEdge(owner, addNode("action", `${consequence.concept}.${consequence.action}`), "requests");
    connectPattern(owner, consequence.input);
  };

  for (const reaction of manifest.application.reactions) {
    const owner = addNode("reaction", reaction.name, reaction);
    foldReaction(reaction, {
      trigger: (trigger) => connectTrigger(owner, trigger),
      consequence: (consequence) => connectConsequence(owner, consequence),
      op: (op) => connectOp(owner, op),
      pattern: (pattern) => connectPattern(owner, pattern),
    });
  }
  for (const reaction of manifest.application.unlowered) {
    hasOpaque = true;
    const owner = addNode("reaction", reaction.name, reaction, true);
    addEdge(owner, opaqueApplication, "opaque-dependency");
  }
  for (const view of manifest.application.views) {
    const owner = addNode("view", view.name, view);
    foldView(view, {
      op: (op) => connectOp(owner, op),
      pattern: (pattern) => connectPattern(owner, pattern),
    });
  }
  for (const former of manifest.application.formers) {
    const owner = addNode("former", former.name, former);
    foldFormerNode(former.body, {
      op: (op) => connectOp(owner, op),
      pattern: (pattern) => connectPattern(owner, pattern),
      node: (node) => {
        if (node.node === "former") addEdge(owner, addNode("former", node.former), "uses");
      },
      splice: ({ fragment }) => addEdge(owner, addNode("former", fragment), "uses"),
    });
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
      const matching = manifest.application.reactions.filter(
        ({ name }) =>
          name === reactionName ||
          name.startsWith(`${reactionName}#`) ||
          name.startsWith(`${reactionName}:`),
      );
      for (const reaction of matching) {
        addEdge(endpointNode, nodeId("reaction", reaction.name), "implements");
      }
    }
    if (hasOpaque) addEdge(endpointNode, opaqueApplication, "opaque-dependency");
  }

  if (!hasOpaque) nodes.delete(opaqueApplication);
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
    reverse[edge.to] = dependents;
  }
  for (const id of Object.keys(reverse)) reverse[id]?.sort(ordinal);
  return canonicalValue({
    format: "sync-engine.application-dependency-graph",
    version: 1,
    nodes: sortedNodes,
    edges: sortedEdges,
    reverse,
  }) as unknown as ApplicationDependencyGraphV1;
}

export function diffManifestNodes(
  before: ApplicationManifestV1,
  after: ApplicationManifestV1,
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
  graph: ApplicationDependencyGraphV1,
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

export function applicationImpact(
  before: ApplicationManifestV1,
  after: ApplicationManifestV1,
): ApplicationImpact {
  const graph = applicationDependencyGraph(after);
  const directlyChanged = diffManifestNodes(before, after);
  const wholeApplication =
    directlyChanged.length > 0 &&
    graph.nodes.some(({ kind, opaque }) => kind === "opaque" && opaque);
  const affected = wholeApplication
    ? graph.nodes.map(({ id }) => id).sort(ordinal)
    : affectedNodes(graph, directlyChanged);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
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
