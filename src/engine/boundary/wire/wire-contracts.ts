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
import { inferInputWireType, inferPatternWireType } from "./wire-inference.ts";
import { analyzeReactionProvenance } from "./wire-provenance.ts";
import type { ProvenanceCell } from "./wire-provenance.ts";
import { JSON_TYPE, unionWireTypes } from "./wire-types.ts";
import type { WireType } from "./wire-types.ts";

export interface WireEndpoint {
  path: string;
  input: WireType;
  output: WireType;
  /** Refusal codes this path's own reactions and asked actions can answer. */
  errors: string[];
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
      if (isGlobalGuard(reaction)) collectReactionErrors(reaction, boundary, refusalsOf, appWide);
      continue;
    }
    const bucket = bucketFor(path);
    const provenance = analyzeReactionProvenance(reaction, boundary, viewsByName);
    for (const consequence of reaction.then) {
      if (consequence.concept === boundary.concept && consequence.action === boundary.respond) {
        const { error, body } = splitRespond(consequence.input);
        if (error !== undefined) {
          if (typeof error === "string") bucket.errors.add(error);
          else bucket.openError = true;
        } else {
          bucket.outputs.push(
            inferPatternWireType(body, formersByName, provenance.env, viewsByName),
          );
        }
      } else {
        for (const code of refusalsOf(consequence.concept, consequence.action)) {
          bucket.errors.add(code);
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

  const endpoints: WireEndpoint[] = [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
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
      out[path] = { required: [...required].sort() };
    }
  }
  return out;
}

function buildRefusalIndex(
  inventories: ConceptInventoryIR[],
): (concept: string, action: string) => readonly string[] {
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
  refusalsOf: (concept: string, action: string) => readonly string[],
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
    else body[key] = value;
  }
  return { error, body };
}
