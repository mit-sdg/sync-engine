/**
 * Assemble a vocabulary and composition into one application.
 *
 * The composition may nest records and module namespaces. Reactions register
 * under dotted paths such as `threads.CreateThread`; endpoints are reactions
 * specialized for the application boundary. Views and formers register the
 * same way. Untagged helpers and constants do not register.
 * Reactions register in name order, but applications must not use that order as
 * priority. If two reactions answer one request, the boundary accepts the first,
 * refuses the second with `NOT_PENDING`, and logs both reaction names.
 */

import {
  isReaction,
  vocabulary as makeVocabulary,
  vocabularyClasses,
  vocabularyComputations,
  vocabularyMetadata,
} from "@engine/reactions/authoring/refs";
import type {
  ConceptClass,
  ConceptClassesOf,
  ConceptEntry,
  DeclaredVocabulary,
} from "@engine/reactions/authoring/refs";
import { declarationsOf } from "@engine/reactions/authoring/partitions";
import { $vars } from "@engine/reactions/authoring/vars";
import { when } from "@engine/reactions/authoring/words";
import { attachConceptMetadata } from "@engine/reactions/concepts/concept-metadata";
import { actionNameOf, conceptNameOf, rolesOf } from "@engine/reactions/concepts/introspect";
import { ActionConcept } from "@engine/reactions/runtime/actions";
import type { InstrumentedConcept, QueryCacheMode } from "@engine/reactions/runtime/instrumenting";
import {
  MemoryStore,
  type LogSink,
  type RetentionPolicy,
} from "@engine/reactions/runtime/log-store";
import { Logging } from "@engine/reactions/runtime/logging";
import type { EngineObserver } from "@engine/reactions/runtime/logging";
import { OperationalEvents } from "@engine/reactions/runtime/operational";
import type { OperationalObserver, RawFaultReporter } from "@engine/reactions/runtime/operational";
import { Reacting } from "@engine/reactions/runtime/reacting";
import type {
  Mapping,
  Reaction,
  ReactionDeclaration,
  ReactionPartition,
  ReactionResult,
  WhenBuilder,
} from "@engine/reactions/types";
import { standardComputations, type ComputationFn } from "@engine/reads/computations";
import {
  conceptSetVocabulary,
  type AnyRegisteredConcept,
  type ConceptClassesOfSet,
  type RegisteredConceptSet,
} from "./concept-set.ts";
import {
  AuthoredDeclarationIdentities,
  type AuthoredDeclarationIdentity,
} from "@engine/reads/declaration-identity";
import type { FormerRef, FusedFormer } from "@engine/reads/former-nodes";
import type { ComputationInventoryIR, ConceptImplementationProvenanceIR } from "@engine/reads/ir";
import { isRelationView } from "@engine/reads/lines";
import type { RelationView } from "@engine/reads/lines";
import { canonicalValue } from "@engine/utils/canonical-json";
import { logger } from "@engine/utils/logger";
import { ordinal } from "@engine/utils/ordinal";
import { createRedactor } from "@engine/utils/redaction";
import type { RedactionPolicy } from "@engine/utils/redaction";
import { setOwn } from "@engine/utils/own-property";
import { ListenerSet } from "@engine/utils/listener-set";
import type { InputContractDecl, RequestBoundaryActions } from "../protocol/endpoints.ts";
import type { ApplicationInterface, ContractShape } from "../protocol/types.ts";
import {
  assertPortableRoutePath,
  assertPortableRoutePrefix,
  routeClaimsOverlap,
} from "../protocol/route-path.ts";
import { assertEndpointValidators } from "../protocol/validation.ts";
import type { EndpointValidators } from "../protocol/validation.ts";
import { standardBoundaryOutcomeReactions } from "../invocation/funnel.ts";
import type { Invoker } from "../invocation/invoke.ts";
import {
  createInvoker,
  Requesting,
  settleRequestInterpreterFailure,
} from "../invocation/invoke.ts";
import { RuntimeLifecycle } from "../invocation/lifecycle.ts";
import type { ExecutionLimits } from "../invocation/lifecycle.ts";
import {
  assertInputContractsMatchReceivePatterns,
  deriveInputContracts,
} from "../wire/wire-contracts.ts";
import type { EndpointDeclaration } from "./endpoint-portability.ts";
import { assertApplicationLocality } from "./locality-validation.ts";
import { validateConceptImplementation } from "./concept-set.ts";
import { implementationFloorOf } from "./implementation-registry.ts";
import { walkValueTree } from "@engine/reads/value-tree";
import type { AssembledInterfaces } from "../protocol/interface-definition.ts";
import { brandEndpointDef, collectInterfaceExports, isEndpointDef } from "./interface-exports.ts";

// Endpoints author against these request-boundary references.

const Boundary = makeVocabulary({
  concepts: { RequestBoundary: Requesting },
  computations: {},
}).concepts.RequestBoundary;

/** One correlation variable per process: request/respond pair by requestId. */
const requestIdVar = Symbol("requestId");

export function receive(input: Mapping = {}): WhenBuilder {
  if (Object.hasOwn(input, "path")) {
    throw new Error('receive(...) cannot author the boundary-owned "path" field.');
  }
  if (Object.hasOwn(input, "requestId")) {
    throw new Error('receive(...) cannot author the boundary-owned "requestId" field.');
  }
  if (Object.hasOwn(input, "route")) {
    throw new Error('receive(...) cannot author the boundary-owned "route" field.');
  }
  return when(Boundary.request({ ...input, requestId: requestIdVar }).responds());
}

/** Answer the request this reaction was triggered by. */
export function respond(body: Mapping = {}) {
  for (const field of ["requestId", "errorKind"]) {
    if (Object.hasOwn(body, field)) {
      throw new Error(`respond(...) cannot author the boundary-owned "${field}" field.`);
    }
  }
  return Boundary.respond({ ...body, requestId: requestIdVar });
}

// ── endpoint — one path, one reaction, and an optional input contract ──────

// Endpoint variables are an open authoring proxy: every property access creates
// one stable logic-variable symbol. TypeScript cannot express that guarantee
// for arbitrary property names under `noUncheckedIndexedAccess`; `any` here is
// confined to the fluent declaration callback, before patterns are checked.
// biome-ignore lint/suspicious/noExplicitAny: open proxy keys are intentionally unenumerated.
type EndpointVars = Record<string, any>;

export interface EndpointDef<TResult extends ReactionResult = ReactionResult> {
  readonly path: string;
  readonly match?: "prefix";
  readonly reaction: (vars: EndpointVars, route?: EndpointRouteContext) => TResult;
  readonly input?: InputContractDecl;
  readonly validators?: EndpointValidators;
}

export interface EndpointRouteContext {
  readonly path: symbol;
}

export interface EndpointOptions {
  readonly input?: InputContractDecl;
  readonly validators?: EndpointValidators;
}

/**
 * An endpoint specializes a reaction: the export names it, the path pins its
 * `receive(...)` trigger, and the optional `input` contract is checked before
 * the request is recorded. Several branches of one path are
 * several `endpoint(...)` exports with the same path; the contract may be
 * declared on at most one of them.
 */
export function endpoint(
  path: string,
  reaction: (vars: EndpointVars) => ReactionDeclaration,
  opts?: EndpointOptions,
): EndpointDef<ReactionDeclaration>;
export function endpoint(
  path: string,
  reaction: (vars: EndpointVars) => ReactionPartition,
  opts?: EndpointOptions,
): EndpointDef<ReactionPartition>;
export function endpoint(path: string, reaction: Reaction, opts?: EndpointOptions): EndpointDef {
  assertPortableRoutePath(path, "endpoint(...)");
  if (opts?.validators !== undefined) assertEndpointValidators(opts.validators, path);
  const def = {
    path,
    reaction,
    ...(opts?.input !== undefined ? { input: opts.input } : {}),
    ...(opts?.validators !== undefined ? { validators: opts.validators } : {}),
  } as EndpointDef;
  return brandEndpointDef(def);
}

export function endpointPrefix(
  prefix: string,
  reaction: (vars: EndpointVars, route: EndpointRouteContext) => ReactionDeclaration,
  opts?: EndpointOptions,
): EndpointDef<ReactionDeclaration>;
export function endpointPrefix(
  prefix: string,
  reaction: (vars: EndpointVars, route: EndpointRouteContext) => ReactionPartition,
  opts?: EndpointOptions,
): EndpointDef<ReactionPartition>;
export function endpointPrefix(
  prefix: string,
  reaction: (vars: EndpointVars, route: EndpointRouteContext) => ReactionResult,
  opts?: EndpointOptions,
): EndpointDef {
  assertPortableRoutePrefix(prefix, "endpointPrefix(...)");
  if (opts?.validators !== undefined) assertEndpointValidators(opts.validators, prefix);
  const def = {
    path: prefix,
    match: "prefix" as const,
    reaction,
    ...(opts?.input !== undefined ? { input: opts.input } : {}),
    ...(opts?.validators !== undefined ? { validators: opts.validators } : {}),
  } as EndpointDef;
  return brandEndpointDef(def);
}

/** Pin every boundary-request trigger in a declaration to the endpoint's path. */
function pinToPath(decl: ReactionDeclaration, path: string): ReactionDeclaration {
  for (const clause of decl.when) {
    if ("channel" in clause) continue;
    if (clause.action === Boundary.request) {
      clause.input = { ...clause.input, path };
    }
  }
  return decl;
}

function pinToPrefix(decl: ReactionDeclaration, prefix: string, path: symbol): ReactionDeclaration {
  for (const clause of decl.when) {
    if ("channel" in clause) continue;
    if (clause.action === Boundary.request) {
      clause.input = { ...clause.input, path, route: prefix };
    }
  }
  return decl;
}

// ── assemble ────────────────────────────────────────────────────────────────

type ConceptInitializers<T extends Record<string, ConceptClass>> = {
  [K in keyof T]?: ConstructorParameters<T[K]>;
};

type ConceptInstances<T extends Record<string, ConceptClass>> = {
  [K in keyof T]?: object;
};

type RequiredConstructorName<T extends Record<string, ConceptClass>> = {
  [K in keyof T]: [] extends ConstructorParameters<T[K]> ? never : K;
}[keyof T];

export type RequiredConstructionSources<T extends Record<string, ConceptClass>> = [
  RequiredConstructorName<T>,
] extends [never]
  ? unknown
  :
      | {
          initialize: {
            [K in RequiredConstructorName<T>]: ConstructorParameters<T[K]>;
          };
        }
      | { instances: Record<RequiredConstructorName<T>, object> };

export interface AssembleBaseOptions<
  T extends Record<string, ConceptClass>,
  I extends ConceptInstances<T> = ConceptInstances<T>,
> {
  /** Constructor args per name; classes callable without arguments may be omitted. */
  initialize?: ConceptInitializers<T>;
  /** Ready instances per name; these take precedence over `initialize`. */
  instances?: I;
  /**
   * The application composition: reactions, views, and formers. Endpoint
   * declarations are boundary-specialized reactions.
   */
  composition: Record<string, unknown>;
  /** Flat canonical declaration exports and named participant interfaces. */
  interfaces?: Record<string, unknown>;
  /** Interpreter diagnostics; defaults to `Logging.OFF`. */
  logging?: Logging;
  /** In-memory occurrence retention; defaults to the 100 most recent settled flows. */
  retention?: RetentionPolicy;
  /** Query evaluation policy; defaults to flow-local memoization. */
  queryCache?: QueryCacheMode;
  /** Synchronous application-owned destination for already-redacted occurrence entries. */
  logSink?: LogSink;
  /** Opt-in production execution limits. */
  executionLimits?: ExecutionLimits;
  /** Bounded synchronous handoff for stable operational events. */
  observers?: readonly OperationalObserver[];
  /** Privileged unsanitized failure handoff; applications must treat it as a sensitive sink. */
  rawFaultReporter?: RawFaultReporter;
  /** Additional sensitive field names for this assembly only. */
  redaction?: RedactionPolicy;
}

type AssembleOptions<T extends Record<string, ConceptClass>> = AssembleBaseOptions<T> &
  RequiredConstructionSources<T>;

type VocabularyAssemblyOptions<
  TEntries extends Record<string, ConceptEntry>,
  TComputations extends Record<string, ComputationFn>,
> = AssembleOptions<ConceptClassesOf<TEntries>> & {
  vocabulary: DeclaredVocabulary<TEntries, TComputations>;
  conceptSet?: never;
};

type ConceptSetAssemblyOptions<
  S extends Record<string, AnyRegisteredConcept>,
  TComputations extends Record<string, ComputationFn>,
> = AssembleOptions<ConceptClassesOfSet<S>> & {
  conceptSet: RegisteredConceptSet<S, TComputations>;
  vocabulary?: never;
};

export interface AssembledApp<T extends Record<string, ConceptClass>> {
  engine: Reacting;
  invoker: Invoker<ContractShape>;
  /** The instrumented concepts, by vocabulary name — the canonical class types them. */
  concepts: { [K in keyof T]: InstrumentedConcept<InstanceType<T[K]>> };
  /** Portable facts for every installed standard and vocabulary computation. */
  computations: readonly ComputationInventoryIR[];
  /** Portable canonical/selected implementation facts, including the request boundary. */
  conceptImplementations: readonly ConceptImplementationProvenanceIR[];
  contracts: Record<string, InputContractDecl>;
  validators: Readonly<Record<string, EndpointValidators>>;
  beginDrain(): Promise<void>;
  whenIdle(): Promise<void>;
  observeSettledChanges(observer: SettledChangeObserver): () => void;
  /** The public route and admission facts a separate gateway may consume. */
  publicInterface: ApplicationInterface;
  /** Every selected authored declaration, once per installed composition object. */
  authoredDeclarations: readonly AuthoredDeclarationIdentity[];
  /** Every authored endpoint declaration, independent of lowering. */
  endpoints: readonly EndpointDeclaration[];
  /** Process-local canonical interface declarations and named selections. */
  interfaces: AssembledInterfaces;
  /** Evaluate a fused former against this app's concepts, at the moment of asking. */
  form(fused: FusedFormer): Promise<unknown>;
}

export interface SettledOccurrence {
  readonly concept: string;
  readonly action: string;
}

export interface SettledChange {
  /** Monotonic within one assembled application; suitable for delivery order, not persistence. */
  readonly sequence: number;
  readonly concepts: readonly string[];
  readonly occurrences: readonly SettledOccurrence[];
}

export type SettledChangeObserver = (change: SettledChange) => void | Promise<void>;

function isFormerRef(value: unknown): value is FormerRef {
  return typeof value === "function" && typeof (value as FormerRef).formerName === "string";
}

function portableInputContract(path: string, contract: InputContractDecl): InputContractDecl {
  let defaults: Record<string, unknown> | undefined;
  try {
    defaults =
      contract.defaults === undefined
        ? undefined
        : (canonicalValue(contract.defaults) as Record<string, unknown>);
  } catch (error) {
    throw new TypeError(`assemble: input defaults for ${path} must be canonical JSON-portable.`, {
      cause: error,
    });
  }
  return {
    ...(contract.required === undefined ? {} : { required: [...contract.required] }),
    ...(defaults === undefined ? {} : { defaults }),
  };
}

function portableConstructorName(name: string | undefined): string | undefined {
  return name === undefined || name === "" || name === "Object" ? undefined : name;
}

function classConstructorName(cls: ConceptClass): string | undefined {
  return portableConstructorName(cls.name);
}

function instanceConstructorName(instance: object): string | undefined {
  let prototype = Object.getPrototypeOf(instance) as object | null;
  while (prototype !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "constructor");
    if (descriptor !== undefined) {
      return portableConstructorName(
        typeof descriptor.value === "function" ? descriptor.value.name : undefined,
      );
    }
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }
  return undefined;
}

interface SelectedConceptImplementation {
  readonly name: string;
  readonly cls: ConceptClass;
  readonly implementation: unknown;
  readonly selectedVia: "default" | "initialize" | "instances";
}

/** Reject raw identity aliases before metadata or instrumentation mutates any implementation. */
function assertDistinctRawConceptImplementations(
  selected: readonly SelectedConceptImplementation[],
): void {
  const firstNameByImplementation = new Map<object, string>();
  for (const { name, implementation } of selected) {
    if (implementation === null || typeof implementation !== "object") continue;
    const firstName = firstNameByImplementation.get(implementation);
    if (firstName !== undefined) {
      throw new Error(
        `assemble: raw concept implementation object is selected under both "${firstName}" and "${name}"; ` +
          "each selected name in one assembly requires a distinct object.",
      );
    }
    firstNameByImplementation.set(implementation, name);
  }
}

/**
 * A value the composition walk may descend into: a plain record or a module
 * namespace. Namespaces are recognized by their `Symbol.toStringTag` as well
 * as by a null prototype — runtimes disagree on the prototype (Node's is
 * null per spec; Bun's is not), and the walk must behave the same in both
 * runtimes.
 */
function isWalkable(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if ((value as { [Symbol.toStringTag]?: unknown })[Symbol.toStringTag] === "Module") return true;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

/** Report the names of reactions that both answer one request. */
const respondRaceObserver: EngineObserver = {
  onAction(ev) {
    if (ev.concept !== "RequestBoundary" || ev.action !== "respond") return;
    if (ev.outcome?.kind !== "error") return;
    if ((ev.outcome.error as { error?: unknown }).error !== "NOT_PENDING") return;
    const path = typeof ev.input.path === "string" ? ev.input.path : "?";
    logger.warn(
      `Reaction "${ev.by ?? "<direct>"}" answered a request on "${path}" after it stopped pending. ` +
        "Reactions that can answer the same request must partition their conditions; " +
        "registration order never decides. A timeout can also make an answer arrive late.",
      { requestId: ev.input.requestId },
    );
  },
};

/**
 * Assemble the application: construct and instrument the vocabulary's
 * concepts, walk the composition registering every tagged export under its
 * dotted path, declare the exported views and formers, collect input
 * contracts (declared first, then derived from the reactions themselves), attach
 * the refusal funnel, and return the engine with its invoker.
 */
export function assemble<
  S extends Record<string, AnyRegisteredConcept>,
  TComputations extends Record<string, ComputationFn>,
>(options: ConceptSetAssemblyOptions<S, TComputations>): AssembledApp<ConceptClassesOfSet<S>>;
export function assemble<
  TEntries extends Record<string, ConceptEntry>,
  TComputations extends Record<string, ComputationFn>,
>(
  options: VocabularyAssemblyOptions<TEntries, TComputations>,
): AssembledApp<ConceptClassesOf<TEntries>>;
export function assemble<T extends Record<string, ConceptClass>>(
  options: AssembleOptions<T> & {
    conceptSet?: RegisteredConceptSet<
      Record<string, AnyRegisteredConcept>,
      Record<string, ComputationFn>
    >;
    vocabulary?: DeclaredVocabulary<Record<string, ConceptEntry>, Record<string, ComputationFn>>;
  },
): AssembledApp<T> {
  if ((options.conceptSet === undefined) === (options.vocabulary === undefined)) {
    throw new Error("assemble: supply exactly one conceptSet or vocabulary declaration.");
  }
  const vocabularyDeclaration =
    options.conceptSet === undefined
      ? options.vocabulary!
      : conceptSetVocabulary(options.conceptSet);
  if (options.queryCache !== undefined && !["memoize", "none"].includes(options.queryCache)) {
    throw new Error('assemble: queryCache must be "memoize" or "none".');
  }

  // Resolve every selected raw object before attaching metadata or instrumenting any of them.
  // The identity check is deliberately local to this assembly construction.
  const classes = vocabularyClasses(vocabularyDeclaration);
  if (Object.hasOwn(classes, "RequestBoundary")) {
    throw new Error('assemble: "RequestBoundary" is reserved for the core request boundary.');
  }
  for (const source of [options.instances, options.initialize]) {
    for (const name of Object.keys(source ?? {})) {
      if (!Object.hasOwn(classes, name)) {
        throw new Error(`assemble: "${name}" is not a name in the vocabulary.`);
      }
    }
  }
  const supplied = options.instances as Record<string, object> | undefined;
  const selectedConcepts: SelectedConceptImplementation[] = [];
  for (const [name, cls] of Object.entries(classes)) {
    const provided =
      supplied !== undefined && Object.hasOwn(supplied, name) ? supplied[name] : undefined;
    let implementation: unknown = provided;
    let selectedVia: SelectedConceptImplementation["selectedVia"] = "instances";
    if (implementation === undefined) {
      const initialization = options.initialize as Record<string, readonly unknown[]> | undefined;
      const args =
        initialization !== undefined && Object.hasOwn(initialization, name)
          ? initialization[name]
          : undefined;
      selectedVia = args === undefined ? "default" : "initialize";
      if (args === undefined && cls.length > 0) {
        throw new Error(
          `assemble: concept "${name}" requires constructor arguments; supply initialize or instances.`,
        );
      }
      const Constructor = cls as new (...ctorArgs: unknown[]) => object;
      implementation = new Constructor(...(args ?? []));
    }
    selectedConcepts.push({ name, cls, implementation, selectedVia });
  }
  assertDistinctRawConceptImplementations(selectedConcepts);

  const operational = new OperationalEvents(options.observers);
  const lifecycle = new RuntimeLifecycle(options.executionLimits, operational);
  const store = new MemoryStore(options.retention ?? { window: 100 }, options.logSink);
  const redactor = createRedactor(options.redaction);
  const engine = new Reacting(
    new ActionConcept(store, operational, redactor, options.rawFaultReporter),
    lifecycle,
    true,
    options.queryCache,
  );
  engine.logging = options.logging ?? Logging.OFF;
  const settledChangeObservers = new ListenerSet<SettledChangeObserver>();
  let settledChangeSequence = 0;
  const declaredComputations = vocabularyComputations(vocabularyDeclaration);
  engine.registerComputations(declaredComputations);
  const computations: ComputationInventoryIR[] = [
    ...standardComputations,
    ...Object.values(declaredComputations),
  ]
    .map((ref) => {
      const observed = rolesOf(ref.fn);
      const inputs =
        observed !== undefined && new Set(observed).size === observed.length ? observed : undefined;
      return {
        name: ref.computationName,
        source: ref.source,
        ...(inputs === undefined ? {} : { inputs }),
      };
    })
    .sort((left, right) => ordinal(left.name, right.name));

  const boundary = new Requesting();
  engine.Action._onFlowQuiescent(({ flow, interpreterFailed }) => {
    if (interpreterFailed) settleRequestInterpreterFailure(boundary, flow);
    lifecycle.flowSettled(flow);
    const occurrences = (engine.Action._getByFlow(flow) ?? [])
      .filter(
        (record) =>
          record.outcome?.kind === "result" && conceptNameOf(record.concept) !== "RequestBoundary",
      )
      .map((record) =>
        Object.freeze({
          concept: conceptNameOf(record.concept),
          action: actionNameOf(record.action),
        }),
      );
    if (occurrences.length === 0) return;
    const concepts = [...new Set(occurrences.map(({ concept }) => concept))].sort(ordinal);
    const change = Object.freeze({
      sequence: ++settledChangeSequence,
      concepts: Object.freeze(concepts),
      occurrences: Object.freeze(occurrences),
    });
    settledChangeObservers.notify(
      (observer, event) => observer(event),
      change,
      (error) => logger.error("Settled change observer failed", { error }),
    );
  });
  const instrumentedBoundary = engine.instrumentConcept(boundary, "RequestBoundary");
  const boundaryConstructorName = instanceConstructorName(boundary);
  const conceptImplementations: ConceptImplementationProvenanceIR[] = [
    {
      concept: "RequestBoundary",
      canonical: {
        owner: "core",
        ...(boundaryConstructorName === undefined
          ? {}
          : { constructorName: boundaryConstructorName }),
      },
      selected: { via: "core" },
    },
  ];

  // ── Concepts: validate and instrument the preflighted raw implementations ──
  const concepts: Record<string, object> = {};
  const metadataByName = vocabularyMetadata(vocabularyDeclaration);
  for (const { name, cls, implementation, selectedVia } of selectedConcepts) {
    validateConceptImplementation("assemble", name, cls, implementation);
    const instance = implementation;
    const metadata = Object.hasOwn(metadataByName, name) ? metadataByName[name] : undefined;
    const canonicalConstructorName = classConstructorName(cls);
    const selectedConstructorName =
      selectedVia === "instances" ? instanceConstructorName(instance) : undefined;
    const floor =
      selectedVia === "instances" && supplied !== undefined
        ? implementationFloorOf(supplied, name, instance)
        : undefined;
    const selected: ConceptImplementationProvenanceIR["selected"] =
      selectedVia === "instances"
        ? {
            via: "instances",
            ...(selectedConstructorName === undefined
              ? {}
              : { constructorName: selectedConstructorName }),
            ...(floor === undefined ? {} : { floor }),
          }
        : {
            via: selectedVia,
          };
    conceptImplementations.push({
      concept: name,
      canonical: {
        owner: "application",
        ...(canonicalConstructorName === undefined
          ? {}
          : { constructorName: canonicalConstructorName }),
      },
      selected,
    });
    if (metadata !== undefined) attachConceptMetadata(instance, metadata);
    setOwn(concepts, name, engine.instrumentConcept(instance, name));
  }

  // ── The composition: tagged exports register under their dotted path ─────
  const reactions: Record<string, Reaction> = {};
  const authoredReactions: Record<string, AuthoredDeclarationIdentity> = {};
  const declarationIdentities = new AuthoredDeclarationIdentities();
  const contracts: Record<string, InputContractDecl> = {};
  const validators: Record<string, EndpointValidators> = {};
  const endpoints: EndpointDeclaration[] = [];
  const views: Array<readonly [RelationView, AuthoredDeclarationIdentity]> = [];
  const formers: Array<readonly [FormerRef, AuthoredDeclarationIdentity]> = [];
  const activeContainerPaths = new WeakMap<object, string>();
  const shownContainerPath = (path: string): string => (path === "" ? "<composition>" : path);
  const collectedInterfaces = collectInterfaceExports("assemble", options.interfaces ?? {});
  const interfaceDeclarations = collectedInterfaces.declarations;
  const interfaceDefinitions = collectedInterfaces.definitions;
  const endpointDependencies = new Map<string, Set<string>>();

  const visit = (value: unknown, name: string): void => {
    if (isReaction(value)) {
      const authored = declarationIdentities.install(value, "reaction", name);
      if (Object.hasOwn(reactions, name))
        throw new Error(`assemble: two reactions named "${name}".`);
      setOwn(reactions, name, value);
      setOwn(authoredReactions, name, authored);
      return;
    }
    if (isEndpointDef(value)) {
      const authored = declarationIdentities.install(value, "endpoint", name);
      const routeContext: EndpointRouteContext | undefined =
        value.match === "prefix" ? Object.freeze({ path: Symbol("path") }) : undefined;
      const declared = value.reaction($vars, routeContext);
      const declarations = declarationsOf(declared);
      declarations.forEach((entry) =>
        value.match === "prefix"
          ? pinToPrefix(entry, value.path, routeContext!.path)
          : pinToPath(entry, value.path),
      );
      const dependencies = new Set<string>();
      walkValueTree(declared, (node) => {
        if (typeof node !== "object" || node === null) return;
        const candidate = node as { format?: unknown; identity?: unknown };
        if (candidate.format === "sync-engine.renderer" && typeof candidate.identity === "string") {
          if (interfaceDeclarations[candidate.identity] === undefined) {
            throw new Error(
              `assemble: endpoint ${JSON.stringify(name)} reaches renderer ${JSON.stringify(candidate.identity)} outside the complete interface exports.`,
            );
          }
          dependencies.add(candidate.identity);
        }
      });
      endpointDependencies.set(name, dependencies);
      const reactionNames = declarations.map((_, index) =>
        index === 0 ? name : `${name}:${index + 1}`,
      );
      endpoints.push({
        name,
        path: value.path,
        ...(value.match === "prefix" ? { match: "prefix" as const } : {}),
        reactions: reactionNames,
      });
      if (Object.hasOwn(reactions, name))
        throw new Error(`assemble: two reactions named "${name}".`);
      setOwn(reactions, name, () => declared);
      setOwn(authoredReactions, name, authored);
      if (value.input !== undefined) {
        if (Object.hasOwn(contracts, value.path)) {
          throw new Error(
            `assemble: duplicate input contract for ${value.path} — a path's contract is declared at most once.`,
          );
        }
        setOwn(contracts, value.path, portableInputContract(value.path, value.input));
      }
      if (value.validators !== undefined) {
        let existing = validators[value.path] ?? {};
        for (const kind of ["input", "output", "domainError"] as const) {
          const validator = value.validators[kind];
          if (validator === undefined) continue;
          if (existing[kind] !== undefined) {
            throw new Error(
              `assemble: duplicate ${kind} validator for ${value.path} — a path's validator is declared at most once.`,
            );
          }
          existing = { ...existing, [kind]: validator };
          setOwn(validators, value.path, existing);
        }
      }
      return;
    }
    if (isRelationView(value)) {
      views.push([value, declarationIdentities.install(value, "view", name)]);
      return;
    }
    if (isFormerRef(value)) {
      formers.push([value, declarationIdentities.install(value, "former", name)]);
      return;
    }
    if (isWalkable(value)) {
      const activePath = activeContainerPaths.get(value);
      if (activePath !== undefined) {
        throw new Error(
          `assemble: cyclic container first appears at ${JSON.stringify(shownContainerPath(activePath))} ` +
            `and appears again at ${JSON.stringify(shownContainerPath(name))}.`,
        );
      }
      activeContainerPaths.set(value, name);
      try {
        for (const [key, child] of Object.entries(value)) {
          visit(child, name === "" ? key : `${name}.${key}`);
        }
      } finally {
        activeContainerPaths.delete(value);
      }
    }
    // Anything else — helpers, constants, computations — is authoring
    // material by the tag's contract: only tagged values register.
  };
  visit(options.composition, "");
  for (const declaration of Object.values(interfaceDeclarations)) {
    if (declaration.kind === "endpoint") visit(declaration.value, declaration.identity);
  }

  for (let left = 0; left < endpoints.length; left += 1) {
    for (let right = left + 1; right < endpoints.length; right += 1) {
      const first = endpoints[left];
      const second = endpoints[right];
      if (first.path === second.path && first.match === second.match) continue;
      if (routeClaimsOverlap(first, second)) {
        throw new Error(
          `assemble: endpoint route ${JSON.stringify(first.path)} from ${JSON.stringify(first.name)} overlaps ` +
            `${second.match === "prefix" ? "prefix" : "exact path"} ${JSON.stringify(second.path)} from ${JSON.stringify(second.name)}.`,
        );
      }
    }
  }

  // Name order, deliberately: registration order carries no meaning.
  const ordered: Record<string, Reaction> = {};
  const orderedAuthored: Record<string, AuthoredDeclarationIdentity> = {};
  for (const name of Object.keys(reactions).sort()) {
    setOwn(ordered, name, reactions[name]);
    setOwn(orderedAuthored, name, authoredReactions[name]);
  }
  engine.register(ordered, orderedAuthored);
  engine.declareAuthoredViews(...views);
  engine.declareAuthoredFormers(...formers);

  const app = engine.exportReactions();
  assertApplicationLocality("assemble", app);
  const boundaryOutcomes = standardBoundaryOutcomeReactions();
  const reservedOutcomeNames = new Set(boundaryOutcomes.map(({ name }) => name));
  const outcomeCollision = [...app.reactions, ...app.unlowered].find(({ name }) =>
    reservedOutcomeNames.has(name),
  );
  if (outcomeCollision !== undefined) {
    throw new Error(
      `assemble: reaction name "${outcomeCollision.name}" is reserved for boundary outcome delivery.`,
    );
  }

  // Declared contracts take precedence; receive patterns fill missing entries.
  assertInputContractsMatchReceivePatterns(app, contracts);
  for (const [path, decl] of Object.entries(deriveInputContracts(app))) {
    if (!Object.hasOwn(contracts, path)) setOwn(contracts, path, decl);
  }

  engine.registerReactions(boundaryOutcomes);
  engine.addObserver(respondRaceObserver);

  const endpointPaths = new Set(
    endpoints.filter(({ match }) => match !== "prefix").map(({ path }) => path),
  );
  const endpointPrefixes = new Set(
    endpoints.filter(({ match }) => match === "prefix").map(({ path }) => path),
  );
  const invoker = createInvoker({
    boundary,
    instrumented: instrumentedBoundary as unknown as RequestBoundaryActions,
    contracts,
    validators,
    routes: endpointPaths,
    prefixes: endpointPrefixes,
    lifecycle,
    onInvalidResponse: ({ path, requestId, phase, errorClass }) => {
      engine.Action._recordIntegrityFailure({
        kind: phase === "output" ? "invalid-output" : "invalid-domain-error",
        flow: requestId,
        route: path,
        errorClass,
        at: Date.now(),
      });
    },
    onValidatorFault: ({ path, requestId, correlationId, phase, error }) => {
      engine.Action._reportRawFault({
        kind: "endpoint-validator",
        error,
        at: Date.now(),
        ...(requestId === undefined ? {} : { flow: requestId }),
        ...(correlationId === undefined ? {} : { correlationId }),
        route: path,
        phase,
      });
    },
    refresh: () => engine.invalidateAllCaches(),
  });

  const publicInterface: ApplicationInterface = {
    routes: Object.fromEntries(
      [...endpointPaths]
        .sort()
        .map((path) => [path, canonicalValue(contracts[path] ?? {}) as InputContractDecl]),
    ),
    ...(endpointPrefixes.size === 0
      ? {}
      : {
          prefixes: Object.fromEntries(
            [...endpointPrefixes]
              .sort()
              .map((prefix) => [
                prefix,
                canonicalValue(contracts[prefix] ?? {}) as InputContractDecl,
              ]),
          ),
        }),
  };

  const assembledInterfaces: AssembledInterfaces = Object.freeze({
    declarations: Object.freeze({ ...interfaceDeclarations }),
    definitions: Object.freeze(
      interfaceDefinitions.map(({ identity, definition }) =>
        Object.freeze({
          identity,
          definition,
          members: Object.freeze(Object.keys(definition.members).sort(ordinal)),
          dependencies: Object.freeze(
            Object.fromEntries(
              Object.keys(definition.members)
                .sort(ordinal)
                .map((member) => [
                  member,
                  Object.freeze([...(endpointDependencies.get(member) ?? [])].sort(ordinal)),
                ]),
            ),
          ),
        }),
      ),
    ),
  });

  return {
    engine,
    invoker,
    concepts: concepts as { [K in keyof T]: InstrumentedConcept<InstanceType<T[K]>> },
    computations,
    conceptImplementations: conceptImplementations.sort((left, right) =>
      ordinal(left.concept, right.concept),
    ),
    contracts,
    validators,
    beginDrain: () => lifecycle.beginDrain(),
    whenIdle: () => lifecycle.whenIdle(),
    observeSettledChanges: (observer) => settledChangeObservers.add(observer),
    publicInterface,
    authoredDeclarations: [...declarationIdentities.inventory()].sort((left, right) =>
      ordinal(`${left.identity}\0${left.kind}`, `${right.identity}\0${right.kind}`),
    ),
    endpoints,
    interfaces: assembledInterfaces,
    form: (fused) => engine.form(fused),
  };
}
