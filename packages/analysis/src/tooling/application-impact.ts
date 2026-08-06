import {
  renderReaction,
  type ApplicationManifestV4,
  type FormerIR,
  type FormerNodeIR,
  type ManifestEndpointV4,
  type ReactionIR,
  type TriggerIR,
  type UnloweredIR,
  type ViewIR,
  type ViewOpIR,
  type WhereOpIR,
} from "@mit-sdg/sync-engine/tooling";
import type { ApplicationSourceIndex, SourceIndexEntry, SourceIndexIssue } from "./source-index.ts";

/** One named part of an assembled sync-engine design. */
export type DesignRef =
  | { readonly kind: "concept"; readonly concept: string }
  | { readonly kind: "action"; readonly concept: string; readonly action: string }
  | { readonly kind: "query"; readonly concept: string; readonly query: string }
  | { readonly kind: "reaction"; readonly reaction: string }
  | { readonly kind: "view"; readonly view: string }
  | { readonly kind: "former"; readonly former: string }
  | { readonly kind: "computation"; readonly computation: string }
  | { readonly kind: "endpoint"; readonly endpoint: string; readonly path: string };

/** Why a possible change can flow from one design reference to another. */
export type ImpactRelation =
  | "concept-member"
  | "action-trigger"
  | "channel-trigger"
  | "provenance-trigger"
  | "action-called"
  | "reaction-asks"
  | "earlier-action"
  | "query-read"
  | "view-read"
  | "former-use"
  | "computation-use"
  | "endpoint-stage"
  | "stage-affects-endpoint"
  | "same-concept-state";

/** How directly the supplied manifest establishes one impact edge. */
export type ImpactCertainty = "structural" | "conservative" | "opaque";

/** A directed possible-change edge. */
export interface ImpactEdge {
  readonly from: DesignRef;
  readonly to: DesignRef;
  readonly relation: ImpactRelation;
  readonly certainty: ImpactCertainty;
}

export type AnalysisIssueCode =
  | "OPAQUE_DEFINITION"
  | "UNRESOLVED_ENDPOINT_STAGE"
  | "UNKNOWN_SEED"
  | "TRACE_LIMIT_REACHED";

/** A bounded-analysis limitation that callers should make visible. */
export interface AnalysisIssue {
  readonly code: AnalysisIssueCode;
  readonly message: string;
  readonly ref?: DesignRef;
}

/** Deterministic dependency and possible-impact data for one exact manifest. */
export interface ApplicationIndex {
  readonly format: "sync-engine.application-index";
  readonly version: 1;
  readonly manifestDigest: string;
  readonly nodes: readonly DesignRef[];
  readonly edges: readonly ImpactEdge[];
  readonly issues: readonly AnalysisIssue[];
}

export interface TraceOptions {
  /** Maximum number of edges in one witness path. Defaults to 12. */
  readonly maxDepth?: number;
  /** Maximum number of distinct reached nodes, including seeds. Defaults to 500. */
  readonly maxNodes?: number;
}

/** One reached design reference and one deterministic shortest witness. */
export interface ImpactTraceEntry {
  readonly ref: DesignRef;
  readonly depth: number;
  readonly path: readonly ImpactEdge[];
}

/** Bounded possible impact from explicit design seeds. */
export interface ImpactTrace {
  readonly format: "sync-engine.impact-trace";
  readonly version: 1;
  readonly manifestDigest: string;
  readonly seeds: readonly DesignRef[];
  readonly affected: readonly ImpactTraceEntry[];
  readonly issues: readonly AnalysisIssue[];
}

export interface ContextSelection {
  readonly ref: DesignRef;
  readonly roles: readonly ("seed" | "affected" | "support")[];
}

export interface ContextReaction {
  readonly name: string;
  readonly portable: boolean;
  readonly definition: ReactionIR | UnloweredIR;
  readonly rendered?: string;
}

/** Preselected manifest context suitable for an agent or another inspection tool. */
export interface ContextBundle {
  readonly format: "sync-engine.impact-context";
  readonly version: 1;
  readonly manifestDigest: string;
  readonly selection: readonly ContextSelection[];
  readonly concepts: ApplicationManifestV4["concepts"];
  readonly reactions: readonly ContextReaction[];
  readonly views: readonly ViewIR[];
  readonly formers: readonly FormerIR[];
  readonly endpoints: readonly ManifestEndpointV4[];
  readonly computations: readonly string[];
  readonly sources: readonly SourceIndexEntry[];
  readonly trace: ImpactTrace;
  readonly issues: readonly AnalysisIssue[];
  readonly sourceIssues: readonly SourceIndexIssue[];
}

type ConsumerRef =
  | Extract<DesignRef, { kind: "reaction" }>
  | Extract<DesignRef, { kind: "view" }>
  | Extract<DesignRef, { kind: "former" }>;

const ROLE_ORDER = ["seed", "affected", "support"] as const;
const CERTAINTY_RANK: Record<ImpactCertainty, number> = {
  structural: 0,
  conservative: 1,
  opaque: 2,
};

function ordinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** A stable, unambiguous key for maps, logs, and tool arguments. */
export function designRefKey(ref: DesignRef): string {
  switch (ref.kind) {
    case "concept":
      return JSON.stringify([ref.kind, ref.concept]);
    case "action":
      return JSON.stringify([ref.kind, ref.concept, ref.action]);
    case "query":
      return JSON.stringify([ref.kind, ref.concept, ref.query]);
    case "reaction":
      return JSON.stringify([ref.kind, ref.reaction]);
    case "view":
      return JSON.stringify([ref.kind, ref.view]);
    case "former":
      return JSON.stringify([ref.kind, ref.former]);
    case "computation":
      return JSON.stringify([ref.kind, ref.computation]);
    case "endpoint":
      return JSON.stringify([ref.kind, ref.endpoint, ref.path]);
  }
}

function edgeKey(edge: ImpactEdge): string {
  return JSON.stringify([
    designRefKey(edge.from),
    designRefKey(edge.to),
    edge.relation,
    edge.certainty,
  ]);
}

function issueKey(issue: AnalysisIssue): string {
  return JSON.stringify([
    issue.code,
    issue.ref === undefined ? "" : designRefKey(issue.ref),
    issue.message,
  ]);
}

function uncertain(declared: ImpactCertainty, minimum: ImpactCertainty): ImpactCertainty {
  return CERTAINTY_RANK[declared] >= CERTAINTY_RANK[minimum] ? declared : minimum;
}

function conceptRef(concept: string): Extract<DesignRef, { kind: "concept" }> {
  return { kind: "concept", concept };
}

function actionRef(concept: string, action: string): Extract<DesignRef, { kind: "action" }> {
  return { kind: "action", concept, action };
}

function queryRef(concept: string, query: string): Extract<DesignRef, { kind: "query" }> {
  return { kind: "query", concept, query };
}

function reactionRef(reaction: string): Extract<DesignRef, { kind: "reaction" }> {
  return { kind: "reaction", reaction };
}

function viewRef(view: string): Extract<DesignRef, { kind: "view" }> {
  return { kind: "view", view };
}

function formerRef(former: string): Extract<DesignRef, { kind: "former" }> {
  return { kind: "former", former };
}

function computationRef(computation: string): Extract<DesignRef, { kind: "computation" }> {
  return { kind: "computation", computation };
}

function endpointRef(endpoint: ManifestEndpointV4): Extract<DesignRef, { kind: "endpoint" }> {
  return { kind: "endpoint", endpoint: endpoint.name, path: endpoint.path };
}

function assertManifest(manifest: ApplicationManifestV4): void {
  if (manifest.format !== "sync-engine.application-manifest" || manifest.version !== 4) {
    throw new Error("analysis requires a sync-engine application manifest at version 4");
  }
  if (manifest.digest.trim() === "") throw new Error("analysis requires a manifest digest");
}

function assertSameManifest(
  manifestDigest: string,
  value: { readonly manifestDigest: string },
  label: string,
): void {
  if (manifestDigest !== value.manifestDigest) {
    throw new Error(`${label} belongs to a different application manifest`);
  }
}

function forEachFormerUse(value: unknown, use: (name: string) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) forEachFormerUse(item, use);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const marker = record.$former;
  if (
    Object.keys(record).length === 1 &&
    typeof marker === "object" &&
    marker !== null &&
    typeof (marker as { name?: unknown }).name === "string"
  ) {
    use((marker as { name: string }).name);
    return;
  }
  for (const child of Object.values(record)) forEachFormerUse(child, use);
}

/** Build the stable possible-impact graph for one assembled application manifest. */
export function indexApplication(manifest: ApplicationManifestV4): ApplicationIndex {
  assertManifest(manifest);
  const nodes = new Map<string, DesignRef>();
  const edges = new Map<string, ImpactEdge>();
  const issues = new Map<string, AnalysisIssue>();

  const addNode = (ref: DesignRef): void => {
    nodes.set(designRefKey(ref), ref);
  };
  const addIssue = (issue: AnalysisIssue): void => {
    issues.set(issueKey(issue), issue);
  };
  const addEdge = (
    from: DesignRef,
    to: DesignRef,
    relation: ImpactRelation,
    certainty: ImpactCertainty,
  ): void => {
    addNode(from);
    addNode(to);
    const edge = { from, to, relation, certainty } as const;
    edges.set(edgeKey(edge), edge);
  };

  const addFormerUses = (
    value: unknown,
    consumer: ConsumerRef,
    certainty: ImpactCertainty,
  ): void => {
    forEachFormerUse(value, (name) => addEdge(formerRef(name), consumer, "former-use", certainty));
  };

  const addRead = (
    consumer: ConsumerRef,
    operation: WhereOpIR | ViewOpIR,
    certainty: ImpactCertainty,
  ): void => {
    if ("query" in operation && operation.query !== undefined) {
      addEdge(
        queryRef(operation.query.concept, operation.query.query),
        consumer,
        "query-read",
        certainty,
      );
    }
    if ("view" in operation && operation.view !== undefined) {
      addEdge(viewRef(operation.view), consumer, "view-read", certainty);
    }
    if (operation.op === "holds" || operation.op === "compute") {
      addEdge(computationRef(operation.computation), consumer, "computation-use", certainty);
    }
    if (operation.op === "earlier") {
      addEdge(
        actionRef(operation.when.concept, operation.when.action),
        consumer,
        "earlier-action",
        certainty,
      );
      if (operation.when.by !== undefined) {
        addEdge(reactionRef(operation.when.by), consumer, "provenance-trigger", certainty);
      }
    }
    addFormerUses(operation, consumer, certainty);
  };

  const addTrigger = (
    owner: Extract<DesignRef, { kind: "reaction" }>,
    trigger: TriggerIR,
    certainty: ImpactCertainty,
  ): void => {
    if (trigger.kind === "action") {
      addEdge(actionRef(trigger.concept, trigger.action), owner, "action-trigger", certainty);
      if (trigger.by !== undefined) {
        addEdge(reactionRef(trigger.by), owner, "provenance-trigger", certainty);
      }
    } else {
      const channelCertainty = uncertain(certainty, "conservative");
      for (const concept of manifest.concepts) {
        if (trigger.except.includes(concept.name)) continue;
        for (const action of concept.actions) {
          addEdge(actionRef(concept.name, action.name), owner, "channel-trigger", channelCertainty);
        }
      }
      if (trigger.by !== undefined) {
        addEdge(reactionRef(trigger.by), owner, "provenance-trigger", certainty);
      }
    }
    addFormerUses(trigger, owner, certainty);
  };

  const addReaction = (definition: ReactionIR | UnloweredIR, certainty: ImpactCertainty): void => {
    const owner = reactionRef(definition.name);
    addNode(owner);
    const body = "known" in definition ? definition.known : definition;
    for (const trigger of body.when) addTrigger(owner, trigger, certainty);
    for (const operation of body.where) addRead(owner, operation, certainty);
    for (const consequence of body.then) {
      const action = actionRef(consequence.concept, consequence.action);
      addEdge(action, owner, "action-called", certainty);
      addEdge(owner, action, "reaction-asks", certainty);
      addFormerUses(consequence.input, owner, certainty);
    }
  };

  const addFormerSource = (
    owner: Extract<DesignRef, { kind: "former" }>,
    source: Extract<FormerNodeIR, { node: "each" | "count" | "first" | "distinct" }>["from"],
  ): void => {
    if (source.query !== undefined) {
      addEdge(
        queryRef(source.query.concept, source.query.query),
        owner,
        "query-read",
        "structural",
      );
    }
    if (source.view !== undefined) {
      addEdge(viewRef(source.view), owner, "view-read", "structural");
    }
    addFormerUses(source, owner, "structural");
  };

  const addFormerNode = (
    owner: Extract<DesignRef, { kind: "former" }>,
    node: FormerNodeIR,
  ): void => {
    switch (node.node) {
      case "leaf":
        return;
      case "record":
        for (const operation of node.where ?? []) addRead(owner, operation, "structural");
        for (const splice of node.splices ?? []) {
          addEdge(formerRef(splice.fragment), owner, "former-use", "structural");
          addFormerUses(splice.in, owner, "structural");
        }
        for (const entry of Object.values(node.entries)) addFormerNode(owner, entry);
        return;
      case "former":
        addEdge(formerRef(node.former), owner, "former-use", "structural");
        addFormerUses(node.in, owner, "structural");
        return;
      case "each":
        addFormerSource(owner, node.from);
        for (const operation of node.where ?? []) addRead(owner, operation, "structural");
        addFormerNode(owner, node.as);
        return;
      case "count":
      case "first":
      case "distinct":
        addFormerSource(owner, node.from);
        for (const operation of node.where ?? []) addRead(owner, operation, "structural");
        return;
    }
  };

  for (const concept of manifest.concepts) {
    const conceptNode = conceptRef(concept.name);
    addNode(conceptNode);
    for (const action of concept.actions) {
      const actionNode = actionRef(concept.name, action.name);
      addEdge(conceptNode, actionNode, "concept-member", "structural");
      for (const query of concept.queries) {
        addEdge(
          actionNode,
          queryRef(concept.name, query.name),
          "same-concept-state",
          "conservative",
        );
      }
    }
    for (const query of concept.queries) {
      addEdge(conceptNode, queryRef(concept.name, query.name), "concept-member", "structural");
    }
  }

  for (const view of manifest.application.views) {
    const owner = viewRef(view.name);
    addNode(owner);
    for (const alternative of view.alternatives) {
      for (const operation of alternative) addRead(owner, operation, "structural");
    }
  }

  for (const former of manifest.application.formers) {
    const owner = formerRef(former.name);
    addNode(owner);
    addFormerNode(owner, former.body);
  }

  for (const reaction of manifest.application.reactions) addReaction(reaction, "structural");
  for (const reaction of manifest.application.unlowered) {
    addReaction(reaction, "opaque");
    addIssue({
      code: "OPAQUE_DEFINITION",
      ref: reactionRef(reaction.name),
      message: `Reaction ${reaction.name} contains local behavior; only its retained known structure is indexed.`,
    });
  }

  const reactionNames = [...manifest.application.reactions, ...manifest.application.unlowered].map(
    ({ name }) => name,
  );
  for (const endpoint of manifest.endpoints) {
    const endpointNode = endpointRef(endpoint);
    addNode(endpointNode);
    const bases = [...new Set([endpoint.name, ...endpoint.reactions])];
    const family = reactionNames.filter((name) =>
      bases.some(
        (base) => name === base || name.startsWith(`${base}#`) || name.startsWith(`${base}:`),
      ),
    );
    for (const reaction of family) {
      const reactionNode = reactionRef(reaction);
      addEdge(endpointNode, reactionNode, "endpoint-stage", "structural");
      addEdge(reactionNode, endpointNode, "stage-affects-endpoint", "structural");
    }
    if (family.length === 0) {
      addIssue({
        code: "UNRESOLVED_ENDPOINT_STAGE",
        ref: endpointNode,
        message: `Endpoint ${endpoint.name} at ${endpoint.path} has no reaction family in the manifest.`,
      });
    }
  }

  return {
    format: "sync-engine.application-index",
    version: 1,
    manifestDigest: manifest.digest,
    nodes: [...nodes.values()].sort((left, right) =>
      ordinal(designRefKey(left), designRefKey(right)),
    ),
    edges: [...edges.values()].sort((left, right) => ordinal(edgeKey(left), edgeKey(right))),
    issues: [...issues.values()].sort((left, right) => ordinal(issueKey(left), issueKey(right))),
  };
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  name: string,
): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < minimum) {
    throw new Error(`${name} must be a safe integer greater than or equal to ${minimum}`);
  }
  return selected;
}

/** Trace bounded, deterministic possible impact from explicit design references. */
export function traceApplicationImpact(
  index: ApplicationIndex,
  seeds: readonly DesignRef[],
  options: TraceOptions = {},
): ImpactTrace {
  const maxDepth = boundedInteger(options.maxDepth, 12, 0, "maxDepth");
  const maxNodes = boundedInteger(options.maxNodes, 500, 1, "maxNodes");
  const nodes = new Map(index.nodes.map((ref) => [designRefKey(ref), ref]));
  const adjacency = new Map<string, ImpactEdge[]>();
  for (const edge of index.edges) {
    const key = designRefKey(edge.from);
    const outgoing = adjacency.get(key) ?? [];
    outgoing.push(edge);
    adjacency.set(key, outgoing);
  }
  for (const outgoing of adjacency.values())
    outgoing.sort((left, right) => ordinal(edgeKey(left), edgeKey(right)));

  const normalizedSeeds = [...new Map(seeds.map((ref) => [designRefKey(ref), ref])).values()].sort(
    (left, right) => ordinal(designRefKey(left), designRefKey(right)),
  );
  const issues = new Map<string, AnalysisIssue>();
  const reached = new Map<string, ImpactTraceEntry>();
  const queue: ImpactTraceEntry[] = [];
  let limited = false;

  const reportLimit = (): void => {
    if (limited) return;
    limited = true;
    const issue: AnalysisIssue = {
      code: "TRACE_LIMIT_REACHED",
      message: `Impact tracing stopped at maxDepth ${maxDepth} or maxNodes ${maxNodes}.`,
    };
    issues.set(issueKey(issue), issue);
  };

  for (const seed of normalizedSeeds) {
    const key = designRefKey(seed);
    const known = nodes.get(key);
    if (known === undefined) {
      const issue: AnalysisIssue = {
        code: "UNKNOWN_SEED",
        ref: seed,
        message: `The seed ${key} does not occur in this application index.`,
      };
      issues.set(issueKey(issue), issue);
      continue;
    }
    const entry = { ref: known, depth: 0, path: [] } as const;
    reached.set(key, entry);
    queue.push(entry);
  }

  for (let position = 0; position < queue.length; position += 1) {
    const current = queue[position];
    const outgoing = adjacency.get(designRefKey(current.ref)) ?? [];
    if (current.depth >= maxDepth) {
      if (outgoing.some((edge) => !reached.has(designRefKey(edge.to)))) reportLimit();
      continue;
    }
    for (const edge of outgoing) {
      const targetKey = designRefKey(edge.to);
      if (reached.has(targetKey)) continue;
      if (reached.size >= maxNodes) {
        reportLimit();
        continue;
      }
      const entry: ImpactTraceEntry = {
        ref: edge.to,
        depth: current.depth + 1,
        path: [...current.path, edge],
      };
      reached.set(targetKey, entry);
      queue.push(entry);
    }
  }

  return {
    format: "sync-engine.impact-trace",
    version: 1,
    manifestDigest: index.manifestDigest,
    seeds: normalizedSeeds,
    affected: [...reached.values()].sort((left, right) =>
      ordinal(designRefKey(left.ref), designRefKey(right.ref)),
    ),
    issues: [...issues.values()].sort((left, right) => ordinal(issueKey(left), issueKey(right))),
  };
}

/** Select complete manifest facts needed to understand one impact trace. */
export function contextForImpact(
  manifest: ApplicationManifestV4,
  index: ApplicationIndex,
  trace: ImpactTrace,
  sourceIndex?: ApplicationSourceIndex,
): ContextBundle {
  assertManifest(manifest);
  assertSameManifest(manifest.digest, index, "application index");
  assertSameManifest(manifest.digest, trace, "impact trace");
  if (sourceIndex !== undefined) assertSameManifest(manifest.digest, sourceIndex, "source index");

  const refs = new Map(index.nodes.map((ref) => [designRefKey(ref), ref]));
  const roles = new Map<string, Set<(typeof ROLE_ORDER)[number]>>();
  const queue: string[] = [];
  const queued = new Set<string>();

  const select = (ref: DesignRef, role: (typeof ROLE_ORDER)[number]): void => {
    const key = designRefKey(ref);
    const selected = roles.get(key) ?? new Set<(typeof ROLE_ORDER)[number]>();
    const wasSelected = selected.size > 0;
    selected.add(role);
    roles.set(key, selected);
    if (!wasSelected && !queued.has(key)) {
      queued.add(key);
      queue.push(key);
    }
  };

  for (const seed of trace.seeds) select(seed, "seed");
  for (const entry of trace.affected) select(entry.ref, "affected");

  const incoming = new Map<string, ImpactEdge[]>();
  const outgoing = new Map<string, ImpactEdge[]>();
  for (const edge of index.edges) {
    const fromKey = designRefKey(edge.from);
    const toKey = designRefKey(edge.to);
    const fromEdges = outgoing.get(fromKey) ?? [];
    fromEdges.push(edge);
    outgoing.set(fromKey, fromEdges);
    const toEdges = incoming.get(toKey) ?? [];
    toEdges.push(edge);
    incoming.set(toKey, toEdges);
  }

  for (let position = 0; position < queue.length; position += 1) {
    const key = queue[position];
    const ref = refs.get(key);
    if (ref === undefined) continue;
    if (ref.kind === "action" || ref.kind === "query") {
      select(conceptRef(ref.concept), "support");
    }
    if (["reaction", "view", "former"].includes(ref.kind)) {
      for (const edge of incoming.get(key) ?? []) select(edge.from, "support");
    }
    if (ref.kind === "reaction") {
      for (const edge of outgoing.get(key) ?? []) {
        if (edge.relation === "reaction-asks" || edge.relation === "stage-affects-endpoint") {
          select(edge.to, "support");
        }
      }
    }
    if (ref.kind === "endpoint") {
      for (const edge of outgoing.get(key) ?? []) {
        if (edge.relation === "endpoint-stage") select(edge.to, "support");
      }
    }
  }

  const selected = new Set(roles.keys());
  const has = (ref: DesignRef): boolean => selected.has(designRefKey(ref));
  const reactions: ContextReaction[] = [
    ...manifest.application.reactions
      .filter(({ name }) => has(reactionRef(name)))
      .map((definition) => ({
        name: definition.name,
        portable: true,
        definition,
        rendered: renderReaction(definition),
      })),
    ...manifest.application.unlowered
      .filter(({ name }) => has(reactionRef(name)))
      .map((definition) => ({ name: definition.name, portable: false, definition })),
  ].sort((left, right) => ordinal(left.name, right.name));

  const combinedIssues = new Map<string, AnalysisIssue>();
  for (const issue of [...index.issues, ...trace.issues])
    combinedIssues.set(issueKey(issue), issue);

  return {
    format: "sync-engine.impact-context",
    version: 1,
    manifestDigest: manifest.digest,
    selection: [...roles.entries()]
      .map(([key, selectedRoles]) => ({
        ref: refs.get(key) ?? trace.seeds.find((ref) => designRefKey(ref) === key)!,
        roles: ROLE_ORDER.filter((role) => selectedRoles.has(role)),
      }))
      .sort((left, right) => ordinal(designRefKey(left.ref), designRefKey(right.ref))),
    concepts: manifest.concepts
      .filter(({ name }) => has(conceptRef(name)))
      .sort((left, right) => ordinal(left.name, right.name)),
    reactions,
    views: manifest.application.views
      .filter(({ name }) => has(viewRef(name)))
      .sort((left, right) => ordinal(left.name, right.name)),
    formers: manifest.application.formers
      .filter(({ name }) => has(formerRef(name)))
      .sort((left, right) => ordinal(left.name, right.name)),
    endpoints: manifest.endpoints
      .filter((endpoint) => has(endpointRef(endpoint)))
      .sort((left, right) => ordinal(`${left.path}\0${left.name}`, `${right.path}\0${right.name}`)),
    computations: [...selected]
      .map((key) => refs.get(key))
      .filter(
        (ref): ref is Extract<DesignRef, { kind: "computation" }> => ref?.kind === "computation",
      )
      .map(({ computation }) => computation)
      .sort(ordinal),
    sources:
      sourceIndex?.entries
        .filter(({ ref }) => selected.has(designRefKey(ref)))
        .sort((left, right) => ordinal(designRefKey(left.ref), designRefKey(right.ref))) ?? [],
    trace,
    issues: [...combinedIssues.values()].sort((left, right) =>
      ordinal(issueKey(left), issueKey(right)),
    ),
    sourceIssues:
      sourceIndex?.issues.filter(
        ({ ref }) => ref === undefined || selected.has(designRefKey(ref)),
      ) ?? [],
  };
}
