/** Derive endpoint contracts from registered application and concept IR. */

import type {
  ActionTriggerIR,
  AppIR,
  ConceptInventoryIR,
  PatternIR,
  ReactionIR,
  ValueIR,
} from "@engine/reads/ir";
import type { InputContractDecl } from "../protocol/endpoints.ts";
import { unifyPattern } from "@engine/reactions/runtime/matching";
import { inferInputWireType, inferPatternWireType } from "./wire-inference.ts";
import { analyzeReactionProvenance } from "./wire-provenance.ts";
import type { ProvenanceCell } from "./wire-provenance.ts";
import { JSON_TYPE, unionWireTypes } from "./wire-types.ts";
import type { WireType } from "./wire-types.ts";
import { ordinal } from "@engine/utils/ordinal";
import { setOwn } from "@engine/utils/own-property";

export interface WireEndpoint {
  path: string;
  input: WireType;
  output: WireType;
  /** Refusal codes this path's own and causally surrounding reactions can answer. */
  errors: string[];
  /** Whether boundary input admission can add framework `INVALID_INPUT`. */
  inputAdmissionError?: boolean;
  /** True when some respond's error is not a literal (a code decided at run time). */
  openError: boolean;
}

export interface WireContractsIR {
  endpoints: WireEndpoint[];
  /** Codes any path can answer: global guards on the boundary's request. */
  appWide: string[];
}

export interface WireOptions {
  /** The request-boundary names as they appear in the IR. */
  boundary?: { concept?: string; request?: string; respond?: string };
  /** Declared endpoint input contracts, by path. */
  contracts?: Record<string, InputContractDecl>;
  /** Concept inventories, for the declared refusal codes of asked actions. */
  inventories?: ConceptInventoryIR[];
}

/** The keys the request boundary injects; never part of a path's own input. */
const RESERVED_BOUNDARY_KEYS = new Set(["path", "requestId", "correlationId"]);

interface BoundaryNames {
  concept: string;
  request: string;
}

type RefusalsOf = (concept: string, action: string) => readonly string[];

interface AskedAction {
  concept: string;
  action: string;
  by: string;
}

function triggerCanObserve(
  trigger: ReactionIR["when"][number],
  asked: AskedAction,
  refusalsOf: RefusalsOf,
): boolean {
  if (trigger.by !== undefined && trigger.by !== asked.by) return false;
  if (trigger.kind === "action") {
    if (trigger.concept !== asked.concept || trigger.action !== asked.action) return false;
    return trigger.posture !== "refused" || refusalsOf(asked.concept, asked.action).length > 0;
  }
  if (trigger.except.includes(asked.concept) || trigger.exceptBy?.includes(asked.by) === true) {
    return false;
  }
  return trigger.channel !== "refused" || refusalsOf(asked.concept, asked.action).length > 0;
}

type Multiplicity = number | "many";

interface AskedSite {
  occurrence: AskedAction;
  count: Multiplicity;
}

interface FlowEdge {
  to: number;
  reverse: number;
  capacity: number;
}

function canAssignTriggerFirings(
  triggers: readonly ReactionIR["when"][number][],
  asked: readonly AskedSite[],
  refusalsOf: RefusalsOf,
  firingCount: number,
): boolean {
  const source = 0;
  const triggerStart = 1;
  const askedStart = triggerStart + triggers.length;
  const sink = askedStart + asked.length;
  const graph: FlowEdge[][] = Array.from({ length: sink + 1 }, () => []);
  const addEdge = (from: number, to: number, capacity: number) => {
    const forward = { to, reverse: graph[to].length, capacity };
    const reverse = { to: from, reverse: graph[from].length, capacity: 0 };
    graph[from].push(forward);
    graph[to].push(reverse);
  };
  const demand = triggers.length * firingCount;
  for (let triggerIndex = 0; triggerIndex < triggers.length; triggerIndex += 1) {
    const triggerNode = triggerStart + triggerIndex;
    addEdge(source, triggerNode, firingCount);
    for (let askedIndex = 0; askedIndex < asked.length; askedIndex += 1) {
      if (triggerCanObserve(triggers[triggerIndex], asked[askedIndex].occurrence, refusalsOf)) {
        addEdge(triggerNode, askedStart + askedIndex, demand);
      }
    }
  }
  for (let askedIndex = 0; askedIndex < asked.length; askedIndex += 1) {
    const count = asked[askedIndex].count;
    addEdge(askedStart + askedIndex, sink, count === "many" ? demand : count);
  }

  let flow = 0;
  while (flow < demand) {
    const level = Array.from({ length: graph.length }, () => -1);
    level[source] = 0;
    const queue = [source];
    for (let index = 0; index < queue.length; index += 1) {
      const node = queue[index];
      for (const edge of graph[node]) {
        if (edge.capacity > 0 && level[edge.to] === -1) {
          level[edge.to] = level[node] + 1;
          queue.push(edge.to);
        }
      }
    }
    if (level[sink] === -1) break;
    const nextEdge = Array.from({ length: graph.length }, () => 0);
    const send = (node: number, available: number): number => {
      if (node === sink) return available;
      for (; nextEdge[node] < graph[node].length; nextEdge[node] += 1) {
        const edge = graph[node][nextEdge[node]];
        if (edge.capacity === 0 || level[edge.to] !== level[node] + 1) continue;
        const sent = send(edge.to, Math.min(available, edge.capacity));
        if (sent === 0) continue;
        edge.capacity -= sent;
        graph[edge.to][edge.reverse].capacity += sent;
        return sent;
      }
      return 0;
    };
    let sent = send(source, demand - flow);
    while (sent > 0) {
      flow += sent;
      sent = send(source, demand - flow);
    }
  }
  return flow === demand;
}

function possibleFirings(
  reaction: ReactionIR,
  asked: readonly AskedSite[],
  refusalsOf: RefusalsOf,
  exactLimit: number,
): Multiplicity {
  for (let count = 1; count <= exactLimit + 1; count += 1) {
    if (!canAssignTriggerFirings(reaction.when, asked, refusalsOf, count)) return count - 1;
  }
  return "many";
}

function addMultiplicity(
  current: Multiplicity,
  added: Multiplicity,
  exactLimit: number,
): Multiplicity {
  if (current === "many" || added === "many") return "many";
  const total = current + added;
  return total > exactLimit ? "many" : total;
}

function addedFirings(current: Multiplicity, next: Multiplicity): Multiplicity {
  if (current === "many" || current === next) return 0;
  if (next === "many") return "many";
  return next > current ? next - current : 0;
}

/** Follow only reactions whose complete trigger can observe actions asked by this causal flow. */
function causalReactionClosure(
  reactions: readonly ReactionIR[],
  seeds: readonly ReactionIR[],
  refusalsOf: RefusalsOf,
  terminal: { concept: string; action: string },
  include: (reaction: ReactionIR) => boolean,
): ReactionIR[] {
  // Counts stay exact while any trigger can distinguish them. Larger counts
  // saturate to `many`: unlike numeric truncation this can only widen causal
  // reachability, and cycles stabilize after each finite ask site saturates.
  const exactLimit = Math.max(1, ...reactions.map((reaction) => reaction.when.length));
  const firings = new Map<ReactionIR, Multiplicity>();
  const askedBySite = new Map<string, AskedSite>();
  const addAsked = (reaction: ReactionIR, count: Multiplicity) => {
    for (const consequence of reaction.then) {
      if (consequence.concept === terminal.concept && consequence.action === terminal.action) {
        continue;
      }
      const occurrence = {
        concept: consequence.concept,
        action: consequence.action,
        by: reaction.name,
      };
      const key = JSON.stringify([occurrence.concept, occurrence.action, occurrence.by]);
      const site = askedBySite.get(key);
      if (site === undefined) {
        askedBySite.set(key, { occurrence, count });
      } else {
        site.count = addMultiplicity(site.count, count, exactLimit);
      }
    }
  };
  for (const seed of new Set(seeds)) {
    firings.set(seed, 1);
    addAsked(seed, 1);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const reaction of reactions) {
      if (!include(reaction) || reaction.when.length === 0) {
        continue;
      }
      const possible = possibleFirings(reaction, [...askedBySite.values()], refusalsOf, exactLimit);
      const previous = firings.get(reaction) ?? 0;
      const added = addedFirings(previous, possible);
      if (added === 0) continue;
      firings.set(reaction, possible);
      addAsked(reaction, added);
      changed = true;
    }
  }
  return [...firings.keys()];
}

function isBoundaryRequest(
  trigger: ReactionIR["when"][number],
  boundary: BoundaryNames,
): trigger is ActionTriggerIR {
  return (
    trigger.kind === "action" &&
    trigger.concept === boundary.concept &&
    trigger.action === boundary.request
  );
}

function collectRequestPatternsByPath(
  reactions: readonly ReactionIR[],
  boundary: BoundaryNames,
): Map<string, PatternIR[]> {
  const byPath = new Map<string, PatternIR[]>();
  for (const reaction of reactions) {
    for (const trigger of reaction.when) {
      if (isBoundaryRequest(trigger, boundary) && typeof trigger.input.path === "string") {
        const list = byPath.get(trigger.input.path) ?? [];
        list.push(trigger.input);
        byPath.set(trigger.input.path, list);
      }
    }
  }
  return byPath;
}

export function wireContracts(app: AppIR, opts: WireOptions = {}): WireContractsIR {
  const boundary = {
    concept: opts.boundary?.concept ?? "RequestBoundary",
    request: opts.boundary?.request ?? "request",
    respond: opts.boundary?.respond ?? "respond",
  };
  const formersByName = new Map(app.formers.map((former) => [former.name, former]));
  const viewsByName = new Map(app.views.map((view) => [view.name, view]));
  const refusalsOf = buildRefusalIndex(opts.inventories ?? []);
  const requestPatternsByPath = collectRequestPatternsByPath(app.reactions, boundary);

  const isRequestTrigger = (trigger: ReactionIR["when"][number]): trigger is ActionTriggerIR =>
    isBoundaryRequest(trigger, boundary);

  const pathOf = (reaction: ReactionIR): string | null => {
    for (const trigger of reaction.when) {
      if (isRequestTrigger(trigger) && typeof trigger.input.path === "string") {
        return trigger.input.path;
      }
    }
    for (const op of reaction.where) {
      if (
        op.op === "earlier" &&
        op.when.concept === boundary.concept &&
        op.when.action === boundary.request &&
        typeof op.when.input.path === "string"
      ) {
        return op.when.input.path;
      }
    }
    return null;
  };

  const isGlobalGuard = (reaction: ReactionIR): boolean =>
    reaction.when.some(
      (trigger) => isRequestTrigger(trigger) && typeof trigger.input.path !== "string",
    );

  interface Bucket {
    requestPatterns: PatternIR[];
    inputOrigins: Map<string, ProvenanceCell[]>;
    outputs: WireType[];
    errors: Set<string>;
    openError: boolean;
  }
  const buckets = new Map<string, Bucket>();
  const appWide = new Set<string>();
  const directByPath = new Map<string, ReactionIR[]>();
  const globalSeeds: ReactionIR[] = [];

  const bucketFor = (path: string): Bucket => {
    let bucket = buckets.get(path);
    if (bucket === undefined) {
      bucket = {
        requestPatterns: requestPatternsByPath.get(path) ?? [],
        inputOrigins: new Map(),
        outputs: [],
        errors: new Set(),
        openError: false,
      };
      buckets.set(path, bucket);
    }
    return bucket;
  };

  // Declared paths remain visible even when their reactions never respond.
  for (const path of Object.keys(opts.contracts ?? {})) bucketFor(path);

  for (const reaction of app.reactions) {
    const path = pathOf(reaction);
    if (path === null) {
      if (isGlobalGuard(reaction)) {
        globalSeeds.push(reaction);
      }
      continue;
    }
    const direct = directByPath.get(path) ?? [];
    direct.push(reaction);
    directByPath.set(path, direct);
    const bucket = bucketFor(path);
    const provenance = analyzeReactionProvenance(reaction, boundary, viewsByName);
    for (const consequence of reaction.then) {
      if (consequence.concept === boundary.concept && consequence.action === boundary.respond) {
        const { error, body } = splitRespond(consequence.input);
        if (error !== undefined) {
          if (typeof error !== "string") bucket.openError = true;
        } else {
          bucket.outputs.push(
            inferPatternWireType(body, formersByName, provenance.env, viewsByName),
          );
        }
      }
    }
    for (const [key, source] of provenance.requestFields) {
      if (
        RESERVED_BOUNDARY_KEYS.has(key) ||
        !source.alternatives.some((alternative) => alternative.length > 0)
      ) {
        continue;
      }
      const forKey = bucket.inputOrigins.get(key) ?? [];
      forKey.push(source);
      bucket.inputOrigins.set(key, forKey);
    }
  }

  const terminal = { concept: boundary.concept, action: boundary.respond };
  const globalCausal = causalReactionClosure(
    app.reactions,
    globalSeeds,
    refusalsOf,
    terminal,
    (candidate) => pathOf(candidate) === null,
  );
  const globalOnly = new Set(globalCausal);
  for (const reaction of globalCausal) {
    collectReactionErrors(reaction, boundary, refusalsOf, appWide);
  }

  for (const [path, bucket] of buckets) {
    const causal = causalReactionClosure(
      app.reactions,
      [...globalSeeds, ...(directByPath.get(path) ?? [])],
      refusalsOf,
      terminal,
      (reaction) => {
        const ownedPath = pathOf(reaction);
        return ownedPath === null || ownedPath === path;
      },
    );
    for (const reaction of causal) {
      if (globalOnly.has(reaction)) continue;
      collectReactionErrors(reaction, boundary, refusalsOf, bucket.errors);
    }
  }

  const endpoints: WireEndpoint[] = [...buckets.entries()]
    .sort(([left], [right]) => ordinal(left, right))
    .map(([path, bucket]) => ({
      path,
      input: inferInputWireType(
        bucket.requestPatterns,
        opts.contracts?.[path],
        bucket.inputOrigins,
        RESERVED_BOUNDARY_KEYS,
      ),
      output: bucket.outputs.length === 0 ? JSON_TYPE : unionWireTypes(bucket.outputs),
      errors: [
        ...bucket.errors,
        ...(opts.contracts?.[path] !== undefined ? ["INVALID_INPUT"] : []),
      ].sort(),
      inputAdmissionError: opts.contracts?.[path] !== undefined,
      openError: bucket.openError,
    }));

  return { endpoints, appWide: [...appWide].sort() };
}

/**
 * Derive required input keys from registered request patterns. Explicit
 * declarations remain authoritative and are merged over this result by the
 * assembly boundary.
 */
export function deriveInputContracts(
  app: AppIR,
  opts: WireOptions = {},
): Record<string, InputContractDecl> {
  const boundary = {
    concept: opts.boundary?.concept ?? "RequestBoundary",
    request: opts.boundary?.request ?? "request",
  };
  const patternsByPath = collectRequestPatternsByPath(app.reactions, boundary);
  const out: Record<string, InputContractDecl> = {};
  for (const [path, patterns] of patternsByPath) {
    let required: Set<string> | undefined;
    for (const pattern of patterns) {
      const keys = new Set(Object.keys(pattern).filter((key) => !RESERVED_BOUNDARY_KEYS.has(key)));
      required =
        required === undefined ? keys : new Set([...required].filter((key) => keys.has(key)));
    }
    if (required !== undefined && required.size > 0) {
      setOwn(out, path, { required: [...required].sort() });
    }
  }
  return out;
}

/** Reject explicit contracts whose optional fields can strand a receive branch. */
export function assertInputContractsMatchReceivePatterns(
  app: AppIR,
  contracts: Readonly<Record<string, InputContractDecl>>,
  opts: WireOptions = {},
): void {
  const boundary = {
    concept: opts.boundary?.concept ?? "RequestBoundary",
    request: opts.boundary?.request ?? "request",
  };
  const patternsByPath = collectRequestPatternsByPath(app.reactions, boundary);
  for (const [path, contract] of Object.entries(contracts)) {
    const patterns = patternsByPath.get(path) ?? [];
    const required = new Set(contract.required ?? []);
    const defaults = contract.defaults ?? {};
    const viable = patterns.some((pattern) => {
      const defaultedPattern: PatternIR = {};
      for (const [key, value] of Object.entries(pattern)) {
        if (RESERVED_BOUNDARY_KEYS.has(key) || required.has(key)) continue;
        if (!Object.hasOwn(defaults, key)) return false;
        setOwn(defaultedPattern, key, value);
      }
      return unifyPattern(defaults as Record<string, unknown>, defaultedPattern, {}) !== undefined;
    });
    if (patterns.length > 0 && !viable) {
      throw new Error(
        `assemble: input contract for ${path} admits omitted optional keys that no receive alternative can match.`,
      );
    }
  }
}

function buildRefusalIndex(inventories: ConceptInventoryIR[]): RefusalsOf {
  const index = new Map<string, readonly string[]>();
  for (const inventory of inventories) {
    for (const action of inventory.actions) {
      if (action.refusals !== undefined) {
        index.set(`${inventory.name}.${action.name}`, action.refusals);
      }
    }
  }
  return (concept, action) => index.get(`${concept}.${action}`) ?? [];
}

function collectReactionErrors(
  reaction: ReactionIR,
  boundary: { concept: string; respond: string },
  refusalsOf: RefusalsOf,
  into: Set<string>,
): void {
  for (const consequence of reaction.then) {
    if (consequence.concept === boundary.concept && consequence.action === boundary.respond) {
      const { error } = splitRespond(consequence.input);
      if (typeof error === "string") into.add(error);
    } else {
      for (const code of refusalsOf(consequence.concept, consequence.action)) into.add(code);
    }
  }
}

function splitRespond(input: PatternIR): { error?: ValueIR; body: PatternIR } {
  const body: PatternIR = {};
  let error: ValueIR | undefined;
  for (const [key, value] of Object.entries(input)) {
    if (key === "requestId") continue;
    if (key === "error") error = value;
    else setOwn(body, key, value);
  }
  return { error, body };
}
