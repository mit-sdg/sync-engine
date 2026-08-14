import {
  validateApplicationManifest,
  type ApplicationManifestV1,
  type FormerNodeIR,
  type ManifestEndpointV1,
  type ReactionIR,
  type TriggerIR,
  type UnloweredIR,
  type ViewOpIR,
  type WhereOpIR,
} from "@mit-sdg/sync-engine/tooling";
import {
  AnalysisController,
  usageDelta,
  type AnalysisOptions,
  type AnalysisResourceUsage,
  type AnalysisSeverity,
} from "./analysis-foundation.ts";
import {
  analysisProvenance,
  assertArtifactProvenance,
  freezeAnalysisData,
  type AnalysisProvenance,
} from "./analysis-provenance.ts";

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
  | "UNKNOWN_REFERENCE"
  | "UNKNOWN_SEED"
  | "TRACE_LIMIT_REACHED";

/** A bounded-analysis limitation that callers should make visible. */
export interface AnalysisIssue {
  readonly code: AnalysisIssueCode;
  readonly severity: AnalysisSeverity;
  readonly message: string;
  readonly ref?: DesignRef;
  readonly suggestions?: readonly DesignRef[];
}

/** Deterministic dependency and possible-impact data for one exact manifest. */
export interface ApplicationIndex {
  readonly format: "sync-engine.application-index";
  readonly version: 3;
  readonly provenance: AnalysisProvenance;
  readonly manifestDigest: string;
  readonly inventory: readonly DesignRef[];
  readonly referencedOnly: readonly DesignRef[];
  readonly nodes: readonly DesignRef[];
  readonly edges: readonly ImpactEdge[];
  readonly issues: readonly AnalysisIssue[];
  readonly resourceUsage: AnalysisResourceUsage;
}

export interface TraceOptions extends AnalysisOptions {
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
  readonly version: 3;
  readonly provenance: AnalysisProvenance;
  readonly manifestDigest: string;
  readonly seeds: readonly DesignRef[];
  readonly affected: readonly ImpactTraceEntry[];
  readonly issues: readonly AnalysisIssue[];
  readonly complete: boolean;
  readonly resourceUsage: AnalysisResourceUsage;
}

type ConsumerRef =
  | Extract<DesignRef, { kind: "reaction" }>
  | Extract<DesignRef, { kind: "view" }>
  | Extract<DesignRef, { kind: "former" }>;

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
    issue.severity,
    issue.ref === undefined ? "" : designRefKey(issue.ref),
    issue.message,
    issue.suggestions?.map(designRefKey) ?? [],
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

function runtimeReactionRef(
  manifest: ApplicationManifestV1,
  name: string,
): Extract<DesignRef, { kind: "reaction" }> {
  const runtime = [...manifest.application.reactions, ...manifest.application.unlowered].find(
    (candidate) => candidate.name === name,
  );
  return reactionRef(runtime?.authored?.identity ?? name);
}

function viewRef(view: string): Extract<DesignRef, { kind: "view" }> {
  return { kind: "view", view };
}

function runtimeViewRef(
  manifest: ApplicationManifestV1,
  name: string,
): Extract<DesignRef, { kind: "view" }> {
  const runtime = manifest.application.views.find((candidate) => candidate.name === name);
  return viewRef(runtime?.authored?.identity ?? name);
}

function formerRef(former: string): Extract<DesignRef, { kind: "former" }> {
  return { kind: "former", former };
}

function runtimeFormerRef(
  manifest: ApplicationManifestV1,
  name: string,
): Extract<DesignRef, { kind: "former" }> {
  const runtime = manifest.application.formers.find((candidate) => candidate.name === name);
  return formerRef(runtime?.authored?.identity ?? name);
}

function computationRef(computation: string): Extract<DesignRef, { kind: "computation" }> {
  return { kind: "computation", computation };
}

function endpointRef(endpoint: ManifestEndpointV1): Extract<DesignRef, { kind: "endpoint" }> {
  return { kind: "endpoint", endpoint: endpoint.name, path: endpoint.path };
}

function refKind(ref: DesignRef): DesignRef["kind"] {
  return ref.kind;
}

function refSearchText(ref: DesignRef): string {
  switch (ref.kind) {
    case "concept":
      return ref.concept;
    case "action":
      return `${ref.concept}.${ref.action}`;
    case "query":
      return `${ref.concept}.${ref.query}`;
    case "reaction":
      return ref.reaction;
    case "view":
      return ref.view;
    case "former":
      return ref.former;
    case "computation":
      return ref.computation;
    case "endpoint":
      return `${ref.endpoint} ${ref.path}`;
  }
}

function editDistance(left: string, right: string): number {
  const prior = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = prior[0];
    prior[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = prior[rightIndex];
      prior[rightIndex] = Math.min(
        prior[rightIndex] + 1,
        prior[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return prior[right.length];
}

function suggestionScope(seed: DesignRef, candidate: DesignRef): number {
  if (seed.kind !== candidate.kind) return 2;
  if (seed.kind === "action" && candidate.kind === "action") {
    return seed.concept === candidate.concept ? 0 : 1;
  }
  if (seed.kind === "query" && candidate.kind === "query") {
    return seed.concept === candidate.concept ? 0 : 1;
  }
  if (seed.kind === "endpoint" && candidate.kind === "endpoint") {
    return seed.path === candidate.path ? 0 : 1;
  }
  return 0;
}

function suggestionsFor(seed: DesignRef, candidates: Iterable<DesignRef>): DesignRef[] {
  const needle = refSearchText(seed).toLowerCase();
  return [...candidates]
    .filter((candidate) => refKind(candidate) === refKind(seed))
    .map((candidate) => ({
      candidate,
      scope: suggestionScope(seed, candidate),
      distance: editDistance(needle, refSearchText(candidate).toLowerCase()),
    }))
    .sort(
      (left, right) =>
        left.scope - right.scope ||
        left.distance - right.distance ||
        ordinal(designRefKey(left.candidate), designRefKey(right.candidate)),
    )
    .slice(0, 3)
    .map(({ candidate }) => candidate);
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
export function indexApplication(
  manifest: ApplicationManifestV1,
  options: AnalysisOptions = {},
): ApplicationIndex {
  return indexApplicationWithController(manifest, new AnalysisController(options));
}

export function indexApplicationWithController(
  manifest: ApplicationManifestV1,
  controller: AnalysisController,
): ApplicationIndex {
  controller.checkpoint();
  validateApplicationManifest(manifest);
  const before = controller.usage();
  const inventory = new Map<string, DesignRef>();
  const referencedOnly = new Map<string, DesignRef>();
  const nodes = new Map<string, DesignRef>();
  const edges = new Map<string, ImpactEdge>();
  const issues = new Map<string, AnalysisIssue>();

  const addInventory = (ref: DesignRef): void => {
    const key = designRefKey(ref);
    if (!inventory.has(key)) inventory.set(key, ref);
    if (!nodes.has(key)) {
      controller.addGraphNode();
      nodes.set(key, ref);
    }
  };
  const addIssue = (issue: AnalysisIssue): void => {
    const key = issueKey(issue);
    if (issues.has(key)) return;
    controller.addDiagnostic();
    issues.set(key, issue);
  };
  const addReference = (ref: DesignRef): void => {
    const key = designRefKey(ref);
    if (nodes.has(key)) return;
    controller.addGraphNode();
    nodes.set(key, ref);
    referencedOnly.set(key, ref);
    const suggestions = suggestionsFor(ref, inventory.values());
    addIssue({
      code: "UNKNOWN_REFERENCE",
      severity: "error",
      ref,
      ...(suggestions.length === 0 ? {} : { suggestions }),
      message: `The reference ${key} occurs in application IR but is absent from manifest inventory.`,
    });
  };
  const addEdge = (
    from: DesignRef,
    to: DesignRef,
    relation: ImpactRelation,
    certainty: ImpactCertainty,
  ): void => {
    addReference(from);
    addReference(to);
    const edge = { from, to, relation, certainty } as const;
    const key = edgeKey(edge);
    if (edges.has(key)) return;
    controller.addGraphEdge();
    edges.set(key, edge);
  };

  // Inventory must be complete before an IR reference can be classified as referenced-only.
  for (const concept of manifest.concepts) {
    controller.checkpoint();
    addInventory(conceptRef(concept.name));
    for (const action of concept.actions) addInventory(actionRef(concept.name, action.name));
    for (const query of concept.queries) addInventory(queryRef(concept.name, query.name));
  }
  for (const computation of manifest.computations) {
    controller.checkpoint();
    addInventory(computationRef(computation.name));
  }
  for (const declaration of manifest.design.declarations) {
    controller.checkpoint();
    if (declaration.kind === "reaction") addInventory(reactionRef(declaration.identity));
    if (declaration.kind === "view") addInventory(viewRef(declaration.identity));
    if (declaration.kind === "former") addInventory(formerRef(declaration.identity));
  }
  for (const reaction of [...manifest.application.reactions, ...manifest.application.unlowered]) {
    controller.checkpoint();
    addInventory(runtimeReactionRef(manifest, reaction.name));
  }
  for (const view of manifest.application.views) {
    controller.checkpoint();
    addInventory(runtimeViewRef(manifest, view.name));
  }
  for (const former of manifest.application.formers) {
    controller.checkpoint();
    addInventory(runtimeFormerRef(manifest, former.name));
  }
  for (const endpoint of manifest.endpoints) {
    controller.checkpoint();
    addInventory(endpointRef(endpoint));
  }

  const addFormerUses = (
    value: unknown,
    consumer: ConsumerRef,
    certainty: ImpactCertainty,
  ): void => {
    forEachFormerUse(value, (name) =>
      addEdge(runtimeFormerRef(manifest, name), consumer, "former-use", certainty),
    );
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
      addEdge(runtimeViewRef(manifest, operation.view), consumer, "view-read", certainty);
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
        addEdge(
          runtimeReactionRef(manifest, operation.when.by),
          consumer,
          "provenance-trigger",
          certainty,
        );
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
        addEdge(runtimeReactionRef(manifest, trigger.by), owner, "provenance-trigger", certainty);
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
        addEdge(runtimeReactionRef(manifest, trigger.by), owner, "provenance-trigger", certainty);
      }
    }
    addFormerUses(trigger, owner, certainty);
  };

  const addReaction = (definition: ReactionIR | UnloweredIR, certainty: ImpactCertainty): void => {
    const owner = runtimeReactionRef(manifest, definition.name);
    addReference(owner);
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
      addEdge(runtimeViewRef(manifest, source.view), owner, "view-read", "structural");
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
          addEdge(runtimeFormerRef(manifest, splice.fragment), owner, "former-use", "structural");
          addFormerUses(splice.in, owner, "structural");
        }
        for (const entry of Object.values(node.entries)) addFormerNode(owner, entry);
        return;
      case "former":
        addEdge(runtimeFormerRef(manifest, node.former), owner, "former-use", "structural");
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
    controller.checkpoint();
    const conceptNode = conceptRef(concept.name);
    addReference(conceptNode);
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
    controller.checkpoint();
    const owner = runtimeViewRef(manifest, view.name);
    addReference(owner);
    for (const alternative of view.alternatives) {
      for (const operation of alternative) addRead(owner, operation, "structural");
    }
  }

  for (const former of manifest.application.formers) {
    controller.checkpoint();
    const owner = runtimeFormerRef(manifest, former.name);
    addReference(owner);
    addFormerNode(owner, former.body);
  }

  for (const reaction of manifest.application.reactions) {
    controller.checkpoint();
    addReaction(reaction, "structural");
  }
  for (const reaction of manifest.application.unlowered) {
    controller.checkpoint();
    addReaction(reaction, "opaque");
    addIssue({
      code: "OPAQUE_DEFINITION",
      severity: "info",
      ref: runtimeReactionRef(manifest, reaction.name),
      message: `Reaction ${reaction.name} contains local behavior; only its retained known structure is indexed.`,
    });
  }

  const reactionNames = [...manifest.application.reactions, ...manifest.application.unlowered].map(
    ({ name }) => name,
  );
  for (const endpoint of manifest.endpoints) {
    controller.checkpoint();
    const endpointNode = endpointRef(endpoint);
    addReference(endpointNode);
    const bases = [...new Set(endpoint.reactions)];
    for (const base of bases) {
      if (!reactionNames.includes(base)) addReference(runtimeReactionRef(manifest, base));
    }
    const family = reactionNames.filter((name) =>
      bases.some((base) => name === base || name.startsWith(`${base}#`)),
    );
    for (const reaction of family) {
      const reactionNode = runtimeReactionRef(manifest, reaction);
      addEdge(endpointNode, reactionNode, "endpoint-stage", "structural");
      addEdge(reactionNode, endpointNode, "stage-affects-endpoint", "structural");
    }
    if (family.length === 0) {
      addIssue({
        code: "UNRESOLVED_ENDPOINT_STAGE",
        severity: "warning",
        ref: endpointNode,
        message: `Endpoint ${endpoint.name} at ${endpoint.path} has no reaction family in the manifest.`,
      });
    }
  }

  return freezeAnalysisData({
    format: "sync-engine.application-index",
    version: 3,
    provenance: analysisProvenance(manifest),
    manifestDigest: manifest.digest,
    inventory: [...inventory.values()].sort((left, right) =>
      ordinal(designRefKey(left), designRefKey(right)),
    ),
    referencedOnly: [...referencedOnly.values()].sort((left, right) =>
      ordinal(designRefKey(left), designRefKey(right)),
    ),
    nodes: [...nodes.values()].sort((left, right) =>
      ordinal(designRefKey(left), designRefKey(right)),
    ),
    edges: [...edges.values()].sort((left, right) => ordinal(edgeKey(left), edgeKey(right))),
    issues: [...issues.values()].sort((left, right) => ordinal(issueKey(left), issueKey(right))),
    resourceUsage: usageDelta(before, controller.usage()),
  });
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
  const controller = new AnalysisController(options);
  const before = controller.usage();
  assertArtifactProvenance(index, "application index");
  if (
    index.format !== "sync-engine.application-index" ||
    index.version !== 3 ||
    !Array.isArray(index.inventory) ||
    !Array.isArray(index.referencedOnly) ||
    !Array.isArray(index.nodes) ||
    !Array.isArray(index.edges) ||
    !Array.isArray(index.issues)
  ) {
    throw new TypeError("application index is not a version-3 application index");
  }
  if (!Array.isArray(seeds)) throw new TypeError("seeds must be an array");
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

  const normalizedSeeds = [
    ...new Map(seeds.map((ref) => [designRefKey(ref), { ...ref } as DesignRef])).values(),
  ].sort((left, right) => ordinal(designRefKey(left), designRefKey(right)));
  const issues = new Map<string, AnalysisIssue>();
  const reached = new Map<string, ImpactTraceEntry>();
  const queue: ImpactTraceEntry[] = [];
  let limited = false;

  const addIssue = (issue: AnalysisIssue): void => {
    const key = issueKey(issue);
    if (issues.has(key)) return;
    controller.addDiagnostic();
    issues.set(key, issue);
  };

  const reportLimit = (): void => {
    if (limited) return;
    limited = true;
    const issue: AnalysisIssue = {
      code: "TRACE_LIMIT_REACHED",
      severity: "warning",
      message: `Impact tracing stopped at maxDepth ${maxDepth} or maxNodes ${maxNodes}.`,
    };
    addIssue(issue);
  };

  for (const seed of normalizedSeeds) {
    controller.checkpoint();
    const key = designRefKey(seed);
    const known = nodes.get(key);
    if (known === undefined) {
      const issue: AnalysisIssue = {
        code: "UNKNOWN_SEED",
        severity: "error",
        ref: seed,
        suggestions: suggestionsFor(seed, index.inventory),
        message: `The seed ${key} does not occur in this application index.`,
      };
      addIssue(issue);
      continue;
    }
    if (reached.size >= maxNodes) {
      reportLimit();
      continue;
    }
    const entry = { ref: known, depth: 0, path: [] } as const;
    reached.set(key, entry);
    queue.push(entry);
  }

  for (let position = 0; position < queue.length; position += 1) {
    controller.checkpoint();
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

  return freezeAnalysisData(
    structuredClone({
      format: "sync-engine.impact-trace" as const,
      version: 3 as const,
      provenance: index.provenance,
      manifestDigest: index.manifestDigest,
      seeds: normalizedSeeds,
      affected: [...reached.values()].sort((left, right) =>
        ordinal(designRefKey(left.ref), designRefKey(right.ref)),
      ),
      issues: [...issues.values()].sort((left, right) => ordinal(issueKey(left), issueKey(right))),
      complete: !limited && ![...issues.values()].some(({ code }) => code === "UNKNOWN_SEED"),
      resourceUsage: usageDelta(before, controller.usage()),
    }),
  );
}
