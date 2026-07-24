/**
 * Derive a TypeScript wire contract from registered endpoint IR.
 *
 * Request patterns and input declarations provide input fields. Formers and
 * response mappings provide output fields. Explicit endpoint errors and the
 * declared refusals of requested actions provide error unions.
 *
 * A vocabulary type anchor traces leaf fields to concept action and query
 * signatures. Without an anchor, unresolved leaves render as `Json`. A reaction
 * belongs to a path when its trigger contains that literal path or an
 * `earlier` read links it to such a request. Boundary reactions without a path
 * contribute errors to `AppWideError`.
 */

import type {
  ActionTriggerIR,
  AppIR,
  ConceptInventoryIR,
  FormerIR,
  FormerNodeIR,
  PatternIR,
  ReactionIR,
  ValueIR,
} from "../reactions/index.ts";
import { asMarker } from "../reads/ir.ts";
import type { InputContractDecl } from "./endpoints.ts";
import {
  analyzeReactionProvenance,
  applyOpsProvenance,
  sharedChildEnv,
  instantiateEnv,
  referenceOf,
  referenceOfValue,
} from "./wire-provenance.ts";
import type { ProvenanceCell, ProvenanceEnv, WireOrigin } from "./wire-provenance.ts";

// ── The wire-type AST ─────────────────────────────────────────────────────

export type WireType =
  | { kind: "json" }
  | { kind: "reference"; allOf: WireOrigin[]; sites: string[] }
  | { kind: "number" }
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "object"; fields: { key: string; type: WireType; optional?: boolean }[] }
  | { kind: "array"; of: WireType }
  | { kind: "union"; of: WireType[] };

const JSON_TYPE: WireType = { kind: "json" };
const NULL_TYPE: WireType = { kind: "literal", value: null };

function union(of: WireType[]): WireType {
  const flat: WireType[] = [];
  for (const t of of) {
    if (t.kind === "union") flat.push(...t.of);
    else flat.push(t);
  }
  const shaped: WireType[] = [];
  for (const candidate of flat) {
    if (candidate.kind !== "object") {
      shaped.push(candidate);
      continue;
    }
    const matching = shaped.find(
      (other): other is Extract<WireType, { kind: "object" }> =>
        other.kind === "object" && hasOneNullDifference(other, candidate),
    );
    if (matching === undefined) {
      shaped.push(candidate);
      continue;
    }
    matching.fields = matching.fields.map((field, index) => ({
      ...field,
      type: union([field.type, candidate.fields[index].type]),
    }));
  }
  const seen = new Set<string>();
  const distinct = shaped.filter((t) => {
    const key =
      t.kind === "reference" ? JSON.stringify({ kind: t.kind, allOf: t.allOf }) : JSON.stringify(t);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const absorbed = distinct.filter((candidate, index, all) => {
    if (candidate.kind !== "reference") return true;
    const candidateKeys = new Set(candidate.allOf.map((origin) => JSON.stringify(origin)));
    return !all.some(
      (other, otherIndex) =>
        otherIndex !== index &&
        other.kind === "reference" &&
        other.allOf.length < candidate.allOf.length &&
        other.allOf.every((origin) => candidateKeys.has(JSON.stringify(origin))),
    );
  });
  // Json absorbs everything except null (Json | null is a real distinction
  // only when null is the stated absence value; keep it visible).
  if (absorbed.some((t) => t.kind === "json")) {
    const keepNull = absorbed.some((t) => t.kind === "literal" && t.value === null);
    return keepNull ? { kind: "union", of: [JSON_TYPE, NULL_TYPE] } : JSON_TYPE;
  }
  return absorbed.length === 1 ? absorbed[0] : { kind: "union", of: absorbed };
}

function nullable(t: WireType): WireType {
  return union([t, NULL_TYPE]);
}

function hasOneNullDifference(
  left: Extract<WireType, { kind: "object" }>,
  right: Extract<WireType, { kind: "object" }>,
): boolean {
  if (left.fields.length !== right.fields.length) return false;
  let differences = 0;
  for (let index = 0; index < left.fields.length; index += 1) {
    const leftField = left.fields[index];
    const rightField = right.fields[index];
    if (leftField.key !== rightField.key || leftField.optional !== rightField.optional)
      return false;
    if (JSON.stringify(leftField.type) === JSON.stringify(rightField.type)) continue;
    const leftIsNull = leftField.type.kind === "literal" && leftField.type.value === null;
    const rightIsNull = rightField.type.kind === "literal" && rightField.type.value === null;
    if (!leftIsNull && !rightIsNull) return false;
    differences += 1;
  }
  return differences === 1;
}

function referenceType(reference: Exclude<ReturnType<typeof referenceOf>, undefined>): WireType {
  return union(
    reference.alternatives.map((allOf) => ({
      kind: "reference" as const,
      allOf,
      sites: reference.sites,
    })),
  );
}

// ── One endpoint's derived contract ───────────────────────────────────────

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

// ── Options ───────────────────────────────────────────────────────────────

export interface WireOptions {
  /** The request-boundary names as they appear in the IR. */
  boundary?: { concept?: string; request?: string; respond?: string };
  /** Declared endpoint input contracts, by path. */
  contracts?: Record<string, InputContractDecl>;
  /** Concept inventories, for the declared refusal codes of asked actions. */
  inventories?: ConceptInventoryIR[];
}

// ── Request-boundary vocabulary ────────────────────────────────────────────

/** The keys the request boundary injects; never part of a path's own input. */
const RESERVED_BOUNDARY_KEYS = new Set(["path", "requestId", "correlationId"]);

/** The request-boundary names, as they appear in the IR. */
interface BoundaryNames {
  concept: string;
  request: string;
}

/** Whether a trigger fires on the boundary's inbound request. */
function isBoundaryRequest(
  t: ReactionIR["when"][number],
  boundary: BoundaryNames,
): t is ActionTriggerIR {
  return t.kind === "action" && t.concept === boundary.concept && t.action === boundary.request;
}

/**
 * The request patterns bucketed by the literal path they pin. Both the wire
 * derivation and input-contract derivation read a path's input from these
 * same patterns — a reaction contributes at most one (its single request trigger).
 */
function collectRequestPatternsByPath(
  reactions: readonly ReactionIR[],
  boundary: BoundaryNames,
): Map<string, PatternIR[]> {
  const byPath = new Map<string, PatternIR[]>();
  for (const reaction of reactions) {
    for (const t of reaction.when) {
      if (isBoundaryRequest(t, boundary) && typeof t.input.path === "string") {
        const list = byPath.get(t.input.path) ?? [];
        list.push(t.input);
        byPath.set(t.input.path, list);
      }
    }
  }
  return byPath;
}

// ── Derivation ────────────────────────────────────────────────────────────

export function wireContracts(app: AppIR, opts: WireOptions = {}): WireContractsIR {
  const boundary = {
    concept: opts.boundary?.concept ?? "RequestBoundary",
    request: opts.boundary?.request ?? "request",
    respond: opts.boundary?.respond ?? "respond",
  };
  const formersByName = new Map<string, FormerIR>(app.formers.map((f) => [f.name, f]));
  const viewsByName = new Map(app.views.map((view) => [view.name, view]));
  const refusalsOf = buildRefusalIndex(opts.inventories ?? []);
  const requestPatternsByPath = collectRequestPatternsByPath(app.reactions, boundary);

  const isRequestTrigger = (t: ReactionIR["when"][number]): t is ActionTriggerIR =>
    isBoundaryRequest(t, boundary);

  /** The path a reaction serves, from its trigger or an `earlier` pin; null = none. */
  function pathOf(reaction: ReactionIR): string | null {
    for (const t of reaction.when) {
      if (isRequestTrigger(t) && typeof t.input.path === "string") return t.input.path;
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
  }

  /** A global guard: triggers on the boundary's request without a path literal. */
  function isGlobalGuard(reaction: ReactionIR): boolean {
    return reaction.when.some((t) => isRequestTrigger(t) && typeof t.input.path !== "string");
  }

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
    let b = buckets.get(path);
    if (b === undefined) {
      b = {
        requestPatterns: requestPatternsByPath.get(path) ?? [],
        inputOrigins: new Map(),
        outputs: [],
        errors: new Set(),
        openError: false,
      };
      buckets.set(path, b);
    }
    return b;
  };

  // Every declared path exists even if its reactions never respond (or the
  // contract arrived without a reaction) — absence should be visible, not
  // silently dropped from the generated surface.
  for (const path of Object.keys(opts.contracts ?? {})) bucketFor(path);

  for (const reaction of app.reactions) {
    const path = pathOf(reaction);
    if (path === null) {
      if (isGlobalGuard(reaction)) collectReactionErrors(reaction, boundary, refusalsOf, appWide);
      continue;
    }
    const bucket = bucketFor(path);
    const provenance = analyzeReactionProvenance(reaction, boundary, viewsByName);
    for (const c of reaction.then) {
      if (c.concept === boundary.concept && c.action === boundary.respond) {
        const { error, body } = splitRespond(c.input);
        if (error !== undefined) {
          if (typeof error === "string") bucket.errors.add(error);
          else bucket.openError = true;
        } else {
          bucket.outputs.push(
            typeOfPattern(body, formersByName, provenance.env, viewsByName, new Set()),
          );
        }
      } else {
        for (const code of refusalsOf(c.concept, c.action)) bucket.errors.add(code);
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
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, bucket]) => ({
      path,
      input: inputTypeOf(bucket.requestPatterns, opts.contracts?.[path], bucket.inputOrigins),
      output: bucket.outputs.length === 0 ? JSON_TYPE : union(bucket.outputs),
      errors: [
        ...bucket.errors,
        ...(opts.contracts?.[path] !== undefined ? ["INVALID_INPUT"] : []),
      ].sort(),
      openError: bucket.openError,
    }));

  return { endpoints, appWide: [...appWide].sort() };
}

/**
 * Derive required input keys from registered request patterns: the keys
 * every one of its request patterns mentions (bound or pinned to a literal) —
 * a body missing one of them can match no reaction, so admission returns
 * `INVALID_INPUT` instead of leaving the ask unanswered until a timeout.
 * Explicit declarations stay authoritative per path (they may carry
 * `defaults`, or deliberately loosen admission); merge derived contracts
 * beneath them: `declared ?? derived`.
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
  for (const inv of inventories) {
    for (const action of inv.actions) {
      if (action.refusals !== undefined) index.set(`${inv.name}.${action.name}`, action.refusals);
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
  for (const c of reaction.then) {
    if (c.concept === boundary.concept && c.action === boundary.respond) {
      const { error } = splitRespond(c.input);
      if (typeof error === "string") into.add(error);
    } else {
      for (const code of refusalsOf(c.concept, c.action)) into.add(code);
    }
  }
}

/** Split a respond mapping into its error (when present) and its body. */
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

// ── Input types ───────────────────────────────────────────────────────────

/**
 * Declared `required` keys are required `Json` (an explicit null
 * passes admission because only presence is checked); declared `defaults` are
 * optional; keys the request patterns mention are optional `Json`; keys the
 * patterns pin to literals are required literal unions — the dispatch enums
 * (`sort: "activity" | "created"`) made visible.
 */
function inputTypeOf(
  patterns: PatternIR[],
  contract: InputContractDecl | undefined,
  origins: ReadonlyMap<string, ProvenanceCell[]> = new Map(),
): WireType {
  const literals = new Map<string, WireType[]>();
  const mentioned = new Set<string>();
  for (const pattern of patterns) {
    for (const [key, value] of Object.entries(pattern)) {
      if (RESERVED_BOUNDARY_KEYS.has(key)) continue;
      if (value !== null && typeof value === "object" && "$var" in value) {
        mentioned.add(key);
      } else if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        const forKey = literals.get(key) ?? [];
        forKey.push({ kind: "literal", value });
        literals.set(key, forKey);
      } else {
        mentioned.add(key); // structural pattern — beyond the input type's grain
      }
    }
  }

  const required = new Set(contract?.required ?? []);
  const defaults = contract?.defaults ?? {};
  const fields: { key: string; type: WireType; optional?: boolean }[] = [];
  const done = new Set<string>();

  const inferred = (key: string): WireType | undefined => {
    const candidates = (origins.get(key) ?? [])
      .map((source) => referenceOf(source))
      .filter((source) => source !== undefined)
      .map(referenceType);
    return candidates.length === 0 ? undefined : union(candidates);
  };

  for (const key of required) {
    fields.push({
      key,
      type: literals.has(key) ? union(literals.get(key)!) : (inferred(key) ?? JSON_TYPE),
    });
    done.add(key);
  }
  for (const key of Object.keys(defaults)) {
    if (done.has(key)) continue;
    fields.push({ key, type: inferred(key) ?? JSON_TYPE, optional: true });
    done.add(key);
  }
  for (const [key, variants] of literals) {
    if (done.has(key)) continue;
    fields.push({ key, type: union(variants) });
    done.add(key);
  }
  for (const key of mentioned) {
    if (done.has(key)) continue;
    fields.push({ key, type: inferred(key) ?? JSON_TYPE, optional: true });
    done.add(key);
  }
  fields.sort((a, b) => a.key.localeCompare(b.key));
  return { kind: "object", fields };
}

// ── Output types ──────────────────────────────────────────────────────────

function typeOfPattern(
  pattern: PatternIR,
  formers: Map<string, FormerIR>,
  env: ProvenanceEnv,
  views: ReadonlyMap<string, AppIR["views"][number]>,
  visiting: ReadonlySet<string>,
): WireType {
  const fields = Object.entries(pattern)
    .map(([key, value]) => ({ key, type: typeOfValue(value, formers, env, views, visiting) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return { kind: "object", fields };
}

function typeOfValue(
  value: ValueIR,
  formers: Map<string, FormerIR>,
  env: ProvenanceEnv,
  views: ReadonlyMap<string, AppIR["views"][number]>,
  visiting: ReadonlySet<string>,
): WireType {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return { kind: "literal", value };
  }
  if (Array.isArray(value)) {
    return {
      kind: "array",
      of: union(value.map((v) => typeOfValue(v, formers, env, views, visiting))),
    };
  }
  // One decoder for the `$`-marker vocabulary (ir.ts): a var, closed matcher,
  // or opaque predicate is `Json`; a `$former` resolves to its walked body; a
  // `$lit` is the pattern it wraps. Anything else is a plain nested mapping.
  const marker = asMarker(value);
  if (marker !== null) {
    switch (marker.tag) {
      case "$var": {
        const reference = referenceOfValue(value, env);
        if (reference === undefined) return JSON_TYPE;
        const inferred = referenceType(reference);
        return reference.maybe ? nullable(inferred) : inferred;
      }
      case "$former": {
        const ref = marker.payload as { name: string; in: PatternIR };
        const former = formers.get(ref.name);
        if (former === undefined || visiting.has(ref.name)) return JSON_TYPE;
        const next = new Set(visiting);
        next.add(ref.name);
        const local = instantiateEnv(ref.in, env);
        return typeOfFormer(former.body, formers, local, views, next, ref.name);
      }
      case "$lit":
        return typeOfPattern(
          marker.payload as Record<string, ValueIR>,
          formers,
          env,
          views,
          visiting,
        );
      default:
        return JSON_TYPE;
    }
  }
  return typeOfPattern(value as PatternIR, formers, env, views, visiting);
}

/**
 * A former's wire shape, walked with the variables that `whether` may leave
 * blank. The leaves they feed are `Json | null` on the page, so they are here
 * too.
 */
function typeOfFormer(
  node: FormerNodeIR,
  formers: Map<string, FormerIR>,
  env: ProvenanceEnv,
  views: ReadonlyMap<string, AppIR["views"][number]>,
  visiting: ReadonlySet<string>,
  site: string,
): WireType {
  switch (node.node) {
    case "leaf": {
      const source = referenceOf(env.get(node.var));
      if (source === undefined) return JSON_TYPE;
      const inferred = referenceType(source);
      return source.maybe ? nullable(inferred) : inferred;
    }
    case "count": {
      const local = sharedChildEnv(env);
      applyOpsProvenance(local, [node.from], views, `${site} count source`);
      applyOpsProvenance(local, node.where ?? [], views, `${site} count`);
      return { kind: "number" };
    }
    case "first": {
      const local = sharedChildEnv(env);
      applyOpsProvenance(local, [node.from], views, `${site} first source`);
      applyOpsProvenance(local, node.where ?? [], views, `${site} first`);
      const source = referenceOf(local.get(node.value));
      return nullable(source === undefined ? JSON_TYPE : referenceType(source));
    }
    case "distinct": {
      const local = sharedChildEnv(env);
      applyOpsProvenance(local, [node.from], views, `${site} distinct source`);
      applyOpsProvenance(local, node.where ?? [], views, `${site} distinct`);
      const source = referenceOf(local.get(node.value));
      return {
        kind: "array",
        of: source === undefined ? JSON_TYPE : referenceType(source),
      };
    }
    case "each": {
      const local = sharedChildEnv(env);
      applyOpsProvenance(local, [node.from], views, `${site} each source`);
      applyOpsProvenance(local, node.where ?? [], views, `${site} each`);
      return {
        kind: "array",
        of: typeOfFormer(node.as, formers, local, views, visiting, site),
      };
    }
    case "former": {
      const nested = formers.get(node.former);
      if (nested === undefined || visiting.has(node.former)) return JSON_TYPE;
      const next = new Set(visiting);
      next.add(node.former);
      const type = typeOfFormer(
        nested.body,
        formers,
        instantiateEnv(node.in, env),
        views,
        next,
        node.former,
      );
      return node.whether ? nullableLeaves(type) : type;
    }
    case "record": {
      const inner = sharedChildEnv(env);
      applyOpsProvenance(inner, node.where ?? [], views, `${site} where`);
      const fields: { key: string; type: WireType; optional?: boolean }[] = [];
      for (const [key, child] of Object.entries(node.entries)) {
        fields.push({ key, type: typeOfFormer(child, formers, inner, views, visiting, site) });
      }
      for (const splice of node.splices ?? []) {
        const fragment = formers.get(splice.fragment);
        if (
          fragment === undefined ||
          fragment.body.node !== "record" ||
          visiting.has(splice.fragment)
        ) {
          continue;
        }
        const next = new Set(visiting);
        next.add(splice.fragment);
        const fragmentEnv = instantiateEnv(splice.in, inner);
        const fragmentType = typeOfFormer(
          fragment.body,
          formers,
          fragmentEnv,
          views,
          next,
          splice.fragment,
        );
        if (fragmentType.kind !== "object") continue;
        for (const field of fragmentType.fields) {
          fields.push(
            splice.whether
              ? { key: field.key, type: nullable(field.type) }
              : { key: field.key, type: field.type },
          );
        }
      }
      fields.sort((a, b) => a.key.localeCompare(b.key));
      return { kind: "object", fields };
    }
  }
}

function nullableLeaves(type: WireType): WireType {
  if (type.kind === "object") {
    return {
      kind: "object",
      fields: type.fields.map((field) => ({ ...field, type: nullableLeaves(field.type) })),
    };
  }
  return nullable(type);
}

// ── Emission ──────────────────────────────────────────────────────────────

export interface WireRenderOptions {
  moduleName?: string;
  vocabulary?: { from: string; export: string };
  strictLeaves?: boolean;
  /** Name of this contract's application-wide error union. */
  appWideErrorName?: string;
  /** Omit shared imports and helpers when appending another contract. */
  preamble?: boolean;
}

function unresolvedLeaves(type: WireType, site: string, into: string[]): void {
  switch (type.kind) {
    case "json":
      into.push(site);
      return;
    case "object":
      for (const field of type.fields) {
        unresolvedLeaves(field.type, `${site}.${field.key}`, into);
      }
      return;
    case "array":
      unresolvedLeaves(type.of, `${site}[]`, into);
      return;
    case "union":
      for (const member of type.of) unresolvedLeaves(member, site, into);
      return;
    case "reference":
    case "number":
    case "literal":
      return;
  }
}

function originType(origin: WireOrigin): string {
  switch (origin.source) {
    case "literal":
      return JSON.stringify(origin.value);
    case "number":
      return "number";
    case "action-input":
    case "query-input":
      return `AtPath<Parameters<(typeof ApplicationVocabulary.concepts)[${JSON.stringify(origin.concept)}][${JSON.stringify(origin.member)}]>[0], ${JSON.stringify(origin.path)}>`;
    case "action-output":
      return `AtPath<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)[${JSON.stringify(origin.concept)}][${JSON.stringify(origin.member)}]>>, ${JSON.stringify(origin.path)}>`;
    case "query-output":
      return `AtPath<QueryRow<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)[${JSON.stringify(origin.concept)}][${JSON.stringify(origin.member)}]>>>, ${JSON.stringify(origin.path)}>`;
  }
}

function referenceSource(type: Extract<WireType, { kind: "reference" }>): string {
  const sources = type.allOf.map(originType);
  return sources.length === 1 ? sources[0] : `AllOf<[${sources.join(", ")}]>`;
}

function printType(t: WireType, indent: string, anchored = false): string {
  switch (t.kind) {
    case "json":
      return "Json";
    case "reference":
      return anchored ? `Jsonify<${referenceSource(t)}>` : "Json";
    case "number":
      return "number";
    case "literal":
      return JSON.stringify(t.value);
    case "array": {
      const inner = printType(t.of, indent, anchored);
      return inner.includes(" | ") ? `(${inner})[]` : `${inner}[]`;
    }
    case "union":
      // An empty union is `never` — an empty-array literal types `never[]`,
      // the honest spelling of "this key is always an empty list."
      if (t.of.length === 0) return "never";
      if (!anchored) {
        const withoutDuplicateJson = t.of.some((member) => member.kind === "reference")
          ? [JSON_TYPE, ...t.of.filter((member) => member.kind !== "reference")]
          : t.of;
        return withoutDuplicateJson.map((m) => printType(m, indent, false)).join(" | ");
      }
      const references = t.of.filter(
        (member): member is Extract<WireType, { kind: "reference" }> => member.kind === "reference",
      );
      const rendered = t.of
        .filter((member) => member.kind !== "reference")
        .map((member) => printType(member, indent, true));
      if (references.length === 1) rendered.unshift(`Jsonify<${referenceSource(references[0])}>`);
      if (references.length > 1) {
        rendered.unshift(`Jsonify<OneOf<[${references.map(referenceSource).join(", ")}]>>`);
      }
      return rendered.join(" | ");
    case "object": {
      if (t.fields.length === 0) return "Record<string, never>";
      const deeper = indent + "  ";
      const lines = t.fields.map(
        (f) =>
          `${deeper}${JSON.stringify(f.key)}${f.optional === true ? "?" : ""}: ${printType(f.type, deeper, anchored)};`,
      );
      return `{\n${lines.join("\n")}\n${indent}}`;
    }
  }
}

/**
 * Emit the generated contract module: a `Json` alias, the app-wide error
 * union, and one `{ input; output; error }` triple per path — the exact
 * shape `createClient<C>` is generic over. Regenerate-and-diff is the
 * intended discipline: the file is a golden, so a design edit that moves
 * the wire is a visible diff, never a silent drift.
 */
export function renderWireTypes(wire: WireContractsIR, moduleName?: string): string;
export function renderWireTypes(wire: WireContractsIR, options?: WireRenderOptions): string;
export function renderWireTypes(
  wire: WireContractsIR,
  moduleNameOrOptions: string | WireRenderOptions = "WireContracts",
): string {
  const options =
    typeof moduleNameOrOptions === "string"
      ? { moduleName: moduleNameOrOptions }
      : moduleNameOrOptions;
  const moduleName = options.moduleName ?? "WireContracts";
  const appWideErrorName = options.appWideErrorName ?? "AppWideError";
  const anchored = options.vocabulary !== undefined;
  if (options.strictLeaves === true) {
    if (!anchored) {
      throw new Error("renderWireTypes: strictLeaves requires a vocabulary type anchor.");
    }
    const unresolved: string[] = [];
    for (const endpoint of wire.endpoints) {
      unresolvedLeaves(endpoint.input, `${endpoint.path}.input`, unresolved);
      unresolvedLeaves(endpoint.output, `${endpoint.path}.output`, unresolved);
    }
    if (unresolved.length > 0) {
      throw new Error(
        `renderWireTypes: strictLeaves found unresolved Json at ${unresolved.join(", ")}.`,
      );
    }
  }
  const lines: string[] = [];
  if (options.preamble !== false) {
    lines.push(
      "// Generated wire contracts — do not edit.",
      "// Regenerated from registered formers, action outcomes, and input contracts.",
      "",
    );
  }
  if (options.preamble !== false && options.vocabulary !== undefined) {
    lines.push(
      `import type { ${options.vocabulary.export} as ApplicationVocabulary } from ${JSON.stringify(options.vocabulary.from)};`,
      "",
      "type AtPath<T, P extends readonly string[]> = P extends readonly [infer H extends string, ...infer R extends string[]] ? H extends keyof T ? AtPath<T[H], R> : never : T;",
      "type QueryRow<T> = T extends readonly (infer Row)[] ? Row : T;",
      "type AllOf<T extends readonly unknown[]> = T extends readonly [infer Head, ...infer Rest] ? Head & AllOf<Rest> : unknown;",
      "type OneOf<T extends readonly unknown[]> = T[number];",
      "type Jsonify<T> = T extends Date ? string : T extends null | boolean | number | string ? T : T extends (...args: never[]) => unknown ? never : T extends readonly (infer Item)[] ? Jsonify<Item>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : never;",
      "",
    );
  }
  if (options.preamble !== false) {
    lines.push(
      "export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };",
      "",
    );
  }
  const appWide =
    wire.appWide.length === 0
      ? "never"
      : wire.appWide.map((code) => JSON.stringify(code)).join(" | ");
  lines.push(`export type ${appWideErrorName} = ${appWide};`, "");
  // A type ALIAS, deliberately: aliases carry the implicit index signature
  // that `createClient<C extends Record<string, …>>` constraints need;
  // an interface does not, and the module's whole point is plugging into
  // the consumer's client generic directly.
  lines.push(`export type ${moduleName} = {`);
  for (const endpoint of wire.endpoints) {
    const own = endpoint.errors.map((code) => JSON.stringify(code));
    if (endpoint.openError) own.push("string");
    const errorUnion = [appWideErrorName, ...own].join(" | ");
    lines.push(`  ${JSON.stringify(endpoint.path)}: {`);
    lines.push(`    input: ${printType(endpoint.input, "    ", anchored)};`);
    lines.push(`    output: ${printType(endpoint.output, "    ", anchored)};`);
    lines.push(`    error: { error: ${errorUnion} };`);
    lines.push(`  };`);
  }
  lines.push("};", "");
  return lines.join("\n");
}
