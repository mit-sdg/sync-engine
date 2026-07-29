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
import type { PublicErrorCategory } from "@engine/reactions/concepts/concept-metadata";
import { ActionConcept } from "@engine/reactions/runtime/actions";
import type { InstrumentedConcept } from "@engine/reactions/runtime/instrumenting";
import {
  MemoryStore,
  type LogStore,
  type RetentionPolicy,
} from "@engine/reactions/runtime/log-store";
import { Logging } from "@engine/reactions/runtime/logging";
import type { EngineObserver } from "@engine/reactions/runtime/logging";
import { OperationalEvents } from "@engine/reactions/runtime/operational";
import type { OperationalObserver } from "@engine/reactions/runtime/operational";
import { Reacting } from "@engine/reactions/runtime/reacting";
import type {
  Mapping,
  Reaction,
  ReactionDeclaration,
  ReactionPartition,
  ReactionResult,
  Vars,
  WhenBuilder,
} from "@engine/reactions/types";
import type { ComputationFn } from "@engine/reads/computations";
import type { FormerRef, FusedFormer } from "@engine/reads/former-nodes";
import { isRelationView } from "@engine/reads/lines";
import type { RelationView } from "@engine/reads/lines";
import { canonicalValue } from "@engine/utils/canonical-json";
import { logger } from "@engine/utils/logger";
import { createRedactor } from "@engine/utils/redaction";
import type { RedactionPolicy } from "@engine/utils/redaction";
import { setOwn } from "@engine/utils/own-property";
import { brand, hasBrand } from "@engine/reads/brands";
import type { InputContractDecl, RequestBoundaryActions } from "../protocol/endpoints.ts";
import type { ApplicationInterface } from "../protocol/application-interface.ts";
import type { ContractShape } from "../protocol/contract-shape.ts";
import { assertPortableHttpPath } from "../protocol/http-path.ts";
import { assertEndpointValidators } from "../protocol/validation.ts";
import type { EndpointValidators } from "../protocol/validation.ts";
import { refusalFunnel } from "../invocation/funnel.ts";
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
import type { EndpointDeclaration, EndpointIdentity } from "./endpoint-portability.ts";
import { assertApplicationLocality } from "./locality-validation.ts";
import { validateConceptImplementation } from "./concept-set.ts";

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

/** Answer the request with an application-defined error value. */
export function fail(error: unknown = {}) {
  return Boundary.respond({ error, requestId: requestIdVar });
}

// ── endpoint — one path, one reaction, and an optional input contract ──────

const EndpointBrand: unique symbol = Symbol("EndpointBrand");

export interface EndpointDef<TResult extends ReactionResult = ReactionResult> {
  readonly path: string;
  readonly reaction: (vars: Vars) => TResult;
  readonly input?: InputContractDecl;
  readonly validators?: EndpointValidators;
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
  reaction: (vars: Vars) => ReactionDeclaration,
  opts?: EndpointOptions,
): EndpointDef<ReactionDeclaration>;
export function endpoint(
  path: string,
  reaction: (vars: Vars) => ReactionPartition,
  opts?: EndpointOptions,
): EndpointDef<ReactionPartition>;
export function endpoint(path: string, reaction: Reaction, opts?: EndpointOptions): EndpointDef {
  assertPortableHttpPath(path, "endpoint(...)");
  if (opts?.validators !== undefined) assertEndpointValidators(opts.validators, path);
  const def = {
    path,
    reaction,
    ...(opts?.input !== undefined ? { input: opts.input } : {}),
    ...(opts?.validators !== undefined ? { validators: opts.validators } : {}),
  } as EndpointDef;
  brand(def, EndpointBrand);
  return def;
}

export function isEndpointDef(value: unknown): value is EndpointDef {
  return hasBrand(value, EndpointBrand);
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

// ── assemble ────────────────────────────────────────────────────────────────

export type ConceptInitializers<T extends Record<string, ConceptClass>> = {
  [K in keyof T]?: ConstructorParameters<T[K]>;
};

export type ConceptInstances<T extends Record<string, ConceptClass>> = {
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
  /** The concept vocabulary: every name bound to its canonical class. */
  vocabulary: DeclaredVocabulary<Record<string, ConceptEntry>, Record<string, ComputationFn>>;
  /** Constructor args per name; classes callable without arguments may be omitted. */
  initialize?: ConceptInitializers<T>;
  /** Ready instances per name; these take precedence over `initialize`. */
  instances?: I;
  /**
   * The application composition: reactions, views, and formers. Endpoint
   * declarations are boundary-specialized reactions.
   */
  composition: Record<string, unknown>;
  /** Interpreter diagnostics; defaults to `Logging.OFF`. */
  logging?: Logging;
  /** In-memory occurrence retention; defaults to the 100 most recent settled flows. */
  retention?: RetentionPolicy;
  /** Application-owned occurrence store. It cannot be combined with `retention`. */
  logStore?: LogStore;
  /** Opt-in production execution limits. */
  executionLimits?: ExecutionLimits;
  /** Bounded synchronous handoff for stable operational events. */
  observers?: readonly OperationalObserver[];
  /** Additional sensitive field names for this assembly only. */
  redaction?: RedactionPolicy;
}

export type AssembleOptions<T extends Record<string, ConceptClass>> = AssembleBaseOptions<T> &
  RequiredConstructionSources<T>;

export interface AssembledApp<T extends Record<string, ConceptClass>> {
  engine: Reacting;
  invoker: Invoker<ContractShape>;
  boundary: Requesting;
  /** The boundary's instrumented actions for framework reactions and adapters. */
  boundaryActions: RequestBoundaryActions;
  /** The instrumented concepts, by vocabulary name — the canonical class types them. */
  concepts: { [K in keyof T]: InstrumentedConcept<InstanceType<T[K]>> };
  contracts: Record<string, InputContractDecl>;
  validators: Readonly<Record<string, EndpointValidators>>;
  beginDrain(): Promise<void>;
  whenIdle(): Promise<void>;
  /** The public route and admission facts a separate gateway may consume. */
  publicInterface: ApplicationInterface;
  /** Public boundary categories declared beside concept refusals. */
  publicErrors: Readonly<Record<string, PublicErrorCategory>>;
  /** Endpoint identity retained even when a reaction has no portable IR. */
  endpointOfReaction: ReadonlyMap<string, EndpointIdentity>;
  /** Every authored endpoint declaration, independent of lowering. */
  endpoints: readonly EndpointDeclaration[];
  /** Evaluate a fused former against this app's concepts, at the moment of asking. */
  form(fused: FusedFormer): Promise<unknown>;
}

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
  TEntries extends Record<string, ConceptEntry>,
  TComputations extends Record<string, ComputationFn>,
>(
  options: Omit<AssembleOptions<ConceptClassesOf<TEntries>>, "vocabulary"> & {
    vocabulary: DeclaredVocabulary<TEntries, TComputations>;
  },
): AssembledApp<ConceptClassesOf<TEntries>>;
export function assemble<T extends Record<string, ConceptClass>>(
  options: AssembleOptions<T>,
): AssembledApp<T> {
  if (options.logStore !== undefined && options.retention !== undefined) {
    throw new Error("assemble: logStore and retention cannot both be supplied.");
  }
  const operational = new OperationalEvents(options.observers);
  const lifecycle = new RuntimeLifecycle(options.executionLimits, operational);
  const store = options.logStore ?? new MemoryStore(options.retention ?? { window: 100 });
  const redactor = createRedactor(options.redaction);
  const engine = new Reacting(new ActionConcept(store, operational, redactor), lifecycle);
  engine.logging = options.logging ?? Logging.OFF;
  engine.registerComputations(vocabularyComputations(options.vocabulary));

  const boundary = new Requesting();
  engine.Action._onFlowQuiescent(({ flow, interpreterFailed }) => {
    if (interpreterFailed) settleRequestInterpreterFailure(boundary, flow);
    lifecycle.flowSettled(flow);
  });
  const instrumentedBoundary = engine.instrumentConcept(boundary, "RequestBoundary");

  // ── Concepts: instances win, initialize supplies args, no-arg classes default-construct ──
  const classes = vocabularyClasses(options.vocabulary);
  for (const source of [options.instances, options.initialize]) {
    for (const name of Object.keys(source ?? {})) {
      if (!Object.hasOwn(classes, name)) {
        throw new Error(`assemble: "${name}" is not a name in the vocabulary.`);
      }
    }
  }
  const concepts: Record<string, object> = {};
  const publicErrors: Record<string, PublicErrorCategory> = {};
  const metadataByName = vocabularyMetadata(options.vocabulary);
  for (const [name, cls] of Object.entries(classes)) {
    const supplied = options.instances as Record<string, object> | undefined;
    const provided =
      supplied !== undefined && Object.hasOwn(supplied, name) ? supplied[name] : undefined;
    const metadata = Object.hasOwn(metadataByName, name) ? metadataByName[name] : undefined;
    for (const [code, category] of Object.entries(metadata?.publicErrors ?? {})) {
      const prior = Object.hasOwn(publicErrors, code) ? publicErrors[code] : undefined;
      if (prior !== undefined && prior !== category) {
        throw new Error(
          `assemble: refusal "${code}" has conflicting public categories "${prior}" and "${category}".`,
        );
      }
      setOwn(publicErrors, code, category);
    }
    let instance = provided;
    if (instance === undefined) {
      const initialization = options.initialize as Record<string, readonly unknown[]> | undefined;
      const args =
        initialization !== undefined && Object.hasOwn(initialization, name)
          ? initialization[name]
          : undefined;
      if (args === undefined && cls.length > 0) {
        throw new Error(
          `assemble: concept "${name}" requires constructor arguments; supply initialize or instances.`,
        );
      }
      const Constructor = cls as new (...ctorArgs: unknown[]) => object;
      instance = new Constructor(...(args ?? []));
    }
    validateConceptImplementation("assemble", name, cls, instance);
    if (metadata !== undefined) attachConceptMetadata(instance, metadata);
    setOwn(concepts, name, engine.instrumentConcept(instance, name));
  }

  // ── The composition: tagged exports register under their dotted path ─────
  const reactions: Record<string, Reaction> = {};
  const contracts: Record<string, InputContractDecl> = {};
  const validators: Record<string, EndpointValidators> = {};
  const endpointOfReaction = new Map<string, EndpointIdentity>();
  const endpoints: EndpointDeclaration[] = [];
  const views: RelationView[] = [];
  const formers: FormerRef[] = [];

  const visit = (value: unknown, name: string): void => {
    if (isReaction(value)) {
      if (Object.hasOwn(reactions, name))
        throw new Error(`assemble: two reactions named "${name}".`);
      setOwn(reactions, name, value);
      return;
    }
    if (isEndpointDef(value)) {
      const declared = value.reaction($vars);
      const declarations = declarationsOf(declared);
      declarations.forEach((entry) => pinToPath(entry, value.path));
      const reactionNames = declarations.map((_, index) => {
        const reactionName = index === 0 ? name : `${name}:${index + 1}`;
        endpointOfReaction.set(reactionName, { name, path: value.path });
        return reactionName;
      });
      endpoints.push({ name, path: value.path, reactions: reactionNames });
      if (Object.hasOwn(reactions, name))
        throw new Error(`assemble: two reactions named "${name}".`);
      setOwn(reactions, name, () => declared);
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
        for (const kind of ["input", "output"] as const) {
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
      views.push(value);
      return;
    }
    if (isFormerRef(value)) {
      formers.push(value);
      return;
    }
    if (isWalkable(value)) {
      for (const [key, child] of Object.entries(value)) {
        visit(child, name === "" ? key : `${name}.${key}`);
      }
    }
    // Anything else — helpers, constants, computations — is authoring
    // material by the tag's contract: only tagged values register.
  };
  visit(options.composition, "");

  // Name order, deliberately: registration order carries no meaning.
  const ordered: Record<string, Reaction> = {};
  for (const name of Object.keys(reactions).sort()) setOwn(ordered, name, reactions[name]);
  engine.register(ordered);
  engine.declareViews(...views);
  engine.declareFormers(...formers);

  const app = engine.exportReactions();
  assertApplicationLocality("assemble", app);

  // Declared contracts take precedence; receive patterns fill missing entries.
  assertInputContractsMatchReceivePatterns(app, contracts);
  for (const [path, decl] of Object.entries(deriveInputContracts(app))) {
    if (!Object.hasOwn(contracts, path)) setOwn(contracts, path, decl);
  }

  engine.register(refusalFunnel(instrumentedBoundary as unknown as RequestBoundaryActions));
  engine.addObserver(respondRaceObserver);

  const endpointPaths = new Set(endpoints.map(({ path }) => path));
  const invoker = createInvoker({
    boundary,
    instrumented: instrumentedBoundary as unknown as RequestBoundaryActions,
    contracts,
    validators,
    routes: endpointPaths,
    lifecycle,
    onInvalidOutput: ({ path, requestId, errorClass }) => {
      engine.Action._recordIntegrityFailure({
        kind: "invalid-output",
        flow: requestId,
        route: path,
        errorClass,
        at: Date.now(),
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
  };

  return {
    engine,
    invoker,
    boundary,
    boundaryActions: instrumentedBoundary as unknown as RequestBoundaryActions,
    concepts: concepts as { [K in keyof T]: InstrumentedConcept<InstanceType<T[K]>> },
    contracts,
    validators,
    beginDrain: () => lifecycle.beginDrain(),
    whenIdle: () => lifecycle.whenIdle(),
    publicInterface,
    publicErrors,
    endpointOfReaction,
    endpoints,
    form: (fused) => engine.form(fused),
  };
}
