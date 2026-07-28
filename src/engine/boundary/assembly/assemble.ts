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
import { MemoryStore, type RetentionPolicy } from "@engine/reactions/runtime/log-store";
import { Logging } from "@engine/reactions/runtime/logging";
import type { EngineObserver } from "@engine/reactions/runtime/observer";
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
import { logger } from "@engine/utils/logger";
import { brand, hasBrand } from "@engine/reads/brands";
import type { InputContractDecl, RequestBoundaryActions } from "../protocol/endpoints.ts";
import type { ApplicationInterface } from "../protocol/application-interface.ts";
import type { ContractShape } from "../protocol/contract-shape.ts";
import { refusalFunnel } from "../invocation/funnel.ts";
import type { Invoker } from "../invocation/invoke.ts";
import {
  createInvoker,
  Requesting,
  settleRequestInterpreterFailure,
} from "../invocation/invoke.ts";
import { deriveInputContracts, wireContracts } from "../wire/wire.ts";

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
  opts?: { input?: InputContractDecl },
): EndpointDef<ReactionDeclaration>;
export function endpoint(
  path: string,
  reaction: (vars: Vars) => ReactionPartition,
  opts?: { input?: InputContractDecl },
): EndpointDef<ReactionPartition>;
export function endpoint(
  path: string,
  reaction: Reaction,
  opts?: { input?: InputContractDecl },
): EndpointDef {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new Error(`endpoint(...): "${path}" is not a path.`);
  }
  const def = {
    path,
    reaction,
    ...(opts?.input !== undefined ? { input: opts.input } : {}),
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

export interface AssembleOptions<T extends Record<string, ConceptClass>> {
  /** The concept vocabulary: every name bound to its canonical class. */
  vocabulary: DeclaredVocabulary<Record<string, ConceptEntry>, Record<string, ComputationFn>>;
  /** Constructor args per name; by default every concept is constructed with no arguments. */
  initialize?: { [K in keyof T]?: ConstructorParameters<T[K]> };
  /** Ready instances per name; these take precedence over `initialize`. */
  instances?: { [K in keyof T]?: object };
  /**
   * The application composition: reactions, views, and formers. Endpoint
   * declarations are boundary-specialized reactions.
   */
  composition: Record<string, unknown>;
  /** Interpreter diagnostics; defaults to `Logging.OFF`. */
  logging?: Logging;
  /** In-memory occurrence retention; defaults to the 100 most recent settled flows. */
  retention?: RetentionPolicy;
}

export interface AssembledApp<T extends Record<string, ConceptClass>> {
  engine: Reacting;
  invoker: Invoker<ContractShape>;
  boundary: Requesting;
  /** The boundary's instrumented actions for framework reactions and adapters. */
  boundaryActions: RequestBoundaryActions;
  /** The instrumented concepts, by vocabulary name — the canonical class types them. */
  concepts: { [K in keyof T]: InstrumentedConcept<InstanceType<T[K]>> };
  contracts: Record<string, InputContractDecl>;
  /** The public route and admission facts a separate gateway may consume. */
  publicInterface: ApplicationInterface;
  /** Public boundary categories declared beside concept refusals. */
  publicErrors: Readonly<Record<string, PublicErrorCategory>>;
  /** Endpoint identity retained even when a reaction has no portable IR. */
  endpointOfReaction: ReadonlyMap<string, { name: string; path: string }>;
  /** Evaluate a fused former against this app's concepts, at the moment of asking. */
  form(fused: FusedFormer): Promise<unknown>;
}

function isFormerRef(value: unknown): value is FormerRef {
  return typeof value === "function" && typeof (value as FormerRef).formerName === "string";
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
  const engine = new Reacting(
    new ActionConcept(new MemoryStore(options.retention ?? { window: 100 })),
  );
  engine.logging = options.logging ?? Logging.OFF;
  engine.registerComputations(vocabularyComputations(options.vocabulary));

  const boundary = new Requesting();
  engine.Action._onFlowQuiescent(({ flow, interpreterFailed }) => {
    if (interpreterFailed) settleRequestInterpreterFailure(boundary, flow);
  });
  const instrumentedBoundary = engine.instrumentConcept(boundary, "RequestBoundary");

  // ── Concepts: instances win, initialize supplies args, default is no-arg ──
  const classes = vocabularyClasses(options.vocabulary);
  for (const source of [options.instances, options.initialize]) {
    for (const name of Object.keys(source ?? {})) {
      if (!(name in classes)) {
        throw new Error(`assemble: "${name}" is not a name in the vocabulary.`);
      }
    }
  }
  const concepts: Record<string, object> = {};
  const publicErrors: Record<string, PublicErrorCategory> = {};
  for (const [name, cls] of Object.entries(classes)) {
    const provided = (options.instances as Record<string, object> | undefined)?.[name];
    const metadata = vocabularyMetadata(options.vocabulary)[name];
    for (const [code, category] of Object.entries(metadata?.publicErrors ?? {})) {
      const prior = publicErrors[code];
      if (prior !== undefined && prior !== category) {
        throw new Error(
          `assemble: refusal "${code}" has conflicting public categories "${prior}" and "${category}".`,
        );
      }
      publicErrors[code] = category;
    }
    if (provided !== undefined) {
      if (metadata !== undefined) attachConceptMetadata(provided, metadata);
      concepts[name] = engine.instrumentConcept(provided, name);
      continue;
    }
    const args = (options.initialize as Record<string, readonly unknown[]> | undefined)?.[name];
    const Constructor = cls as new (...ctorArgs: unknown[]) => object;
    const instance = new Constructor(...(args ?? []));
    if (metadata !== undefined) attachConceptMetadata(instance, metadata);
    concepts[name] = engine.instrumentConcept(instance, name);
  }

  // ── The composition: tagged exports register under their dotted path ─────
  const reactions: Record<string, Reaction> = {};
  const contracts: Record<string, InputContractDecl> = {};
  const endpointOfReaction = new Map<string, { name: string; path: string }>();
  const views: RelationView[] = [];
  const formers: FormerRef[] = [];

  const visit = (value: unknown, name: string): void => {
    if (isReaction(value)) {
      if (reactions[name] !== undefined)
        throw new Error(`assemble: two reactions named "${name}".`);
      reactions[name] = value;
      return;
    }
    if (isEndpointDef(value)) {
      const declared = value.reaction($vars);
      const declarations = declarationsOf(declared);
      declarations.forEach((entry) => pinToPath(entry, value.path));
      declarations.forEach((_, index) => {
        const reactionName = index === 0 ? name : `${name}:${index + 1}`;
        endpointOfReaction.set(reactionName, { name, path: value.path });
      });
      if (reactions[name] !== undefined)
        throw new Error(`assemble: two reactions named "${name}".`);
      reactions[name] = () => declared;
      if (value.input !== undefined) {
        if (contracts[value.path] !== undefined) {
          throw new Error(
            `assemble: duplicate input contract for ${value.path} — a path's contract is declared at most once.`,
          );
        }
        contracts[value.path] = value.input;
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
  for (const name of Object.keys(reactions).sort()) ordered[name] = reactions[name];
  engine.register(ordered);
  engine.declareViews(...views);
  engine.declareFormers(...formers);

  // Declared contracts take precedence; receive patterns fill missing entries.
  for (const [path, decl] of Object.entries(deriveInputContracts(engine.exportReactions()))) {
    contracts[path] ??= decl;
  }

  engine.register(refusalFunnel(instrumentedBoundary as unknown as RequestBoundaryActions));
  engine.addObserver(respondRaceObserver);

  const invoker = createInvoker({
    boundary,
    instrumented: instrumentedBoundary as unknown as RequestBoundaryActions,
    contracts,
    refresh: () => engine.invalidateAllCaches(),
  });

  const publicInterface: ApplicationInterface = {
    routes: Object.fromEntries(
      wireContracts(engine.exportReactions(), { contracts }).endpoints.map(({ path }) => [
        path,
        contracts[path] ?? {},
      ]),
    ),
  };

  return {
    engine,
    invoker,
    boundary,
    boundaryActions: instrumentedBoundary as unknown as RequestBoundaryActions,
    concepts: concepts as { [K in keyof T]: InstrumentedConcept<InstanceType<T[K]>> },
    contracts,
    publicInterface,
    publicErrors,
    endpointOfReaction,
    form: (fused) => engine.form(fused),
  };
}
