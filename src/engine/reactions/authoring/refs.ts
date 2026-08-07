/**
 * **Static concept refs** — authoring against names, not instances.
 *
 * The IR already references every action and query by name; these refs bring
 * the fluent authoring layer up to the same discipline. A vocabulary binds
 * each concept *name* to its canonical class and returns per-concept ref
 * objects whose members represent actions and queries as data:
 *
 * ```ts
 * export const { Posting, Conversing } = vocabulary({
 *   concepts: { Posting: PostingConcept, Conversing: ConversingConcept },
 * }).concepts;
 *
 * when(Posting.create, { content }, { post })        // a reaction against names
 * Posting._getPost({ post }).is({ author })          // a read against names
 * ```
 *
 * A ref resolves to the live instrumented member when the reaction, view, or
 * former registers with an engine — the same name→instance resolution the
 * IR import path uses. Until then it is inert data; calling one directly
 * throws an error that names the unresolved reference.
 *
 * Naming is a design choice: the vocabulary key is the concept's name in the
 * log, the rendered spec, and the wire. Two names may share one class (two
 * instances of one behavior), and a build may substitute any structurally
 * conforming implementation for a name (for example, a persistent version) —
 * the vocabulary's class stays the canonical, type-defining one.
 */

import { computationRef } from "@engine/reads/computations";
import { brand, hasFuncBrand } from "@engine/reads/brands";
import { actionLine } from "./nodes.ts";
import { lineOf } from "@engine/reads/lines";
import type { QueryReadLine, SlotPattern } from "@engine/reads/lines";
import type { ExactPattern } from "@engine/reads/type-inference";
import { parseSpec } from "../concepts/concept-spec.ts";
import type {
  CheckedComputationFns,
  ComputationFn,
  ComputationRef,
} from "@engine/reads/computations";
import {
  callableConceptMember,
  CONCEPT_MEMBER_ROLES,
  CONCEPT_PROTOCOL,
  conceptProtocolOf,
  type ConceptMetadata,
} from "../concepts/concept-metadata.ts";
import { rolesOf } from "../concepts/introspect.ts";
import type {
  ActionCall,
  InstrumentedAction,
  Mapping,
  Reaction,
  TriggerActionLine,
} from "../types.ts";
import { validateQueryContractMap } from "@engine/reads/query-contracts";
import type { QueryPromises, QueryPromise } from "@engine/reads/query-metadata";
import { setOwn } from "@engine/utils/own-property";
import { brandActionRef, brandQueryRef, type ActionRef, type QueryRef } from "./references.ts";

export { isActionRef, isQueryRef } from "./references.ts";
export type { ActionRef, QueryRef } from "./references.ts";

const ReactionBrand: unique symbol = Symbol("ReactionBrand");
const VocabularyClasses: unique symbol = Symbol("VocabularyClasses");
const VocabularyComputations: unique symbol = Symbol("VocabularyComputations");
const VocabularyMetadata: unique symbol = Symbol("VocabularyMetadata");
declare const ActionTypeAnchor: unique symbol;

/** Any concept class the vocabulary can hold. */
export type ConceptClass = new (...args: never[]) => object;

function makeActionRef(concept: string, action: string): ActionRef {
  const ref = ((input: Mapping) => actionLine(ref, input)) as unknown as ActionRef;
  Object.defineProperty(ref, "name", { value: `${concept}.${action}` });
  Object.defineProperty(ref, "refConcept", { value: concept, enumerable: true });
  Object.defineProperty(ref, "refAction", { value: action, enumerable: true });
  return brandActionRef(ref);
}

function makeQueryRef(concept: string, query: string, promise: QueryPromise | undefined): QueryRef {
  // Calling the ref with an input pattern answers a line — the callable
  // vocabulary proxy. The ref itself stays inert data: the line carries it
  // by name, and only an assembled engine resolves and reads it.
  const ref = ((pattern: Mapping) => lineOf({ query: ref }, pattern)) as unknown as QueryRef;
  Object.defineProperty(ref, "name", { value: `${concept}.${query}` });
  Object.defineProperty(ref, "refConcept", { value: concept, enumerable: true });
  Object.defineProperty(ref, "refQuery", { value: query, enumerable: true });
  Object.defineProperty(ref, "queryName", { value: query, enumerable: true });
  if (promise !== undefined) {
    Object.defineProperty(ref, "queryPromise", { value: promise, enumerable: true });
  }
  return brandQueryRef(ref);
}

/** Property names a ref proxy answers with `undefined` instead of an error. */
const INSPECTION_PROPS = new Set(["then", "toJSON", "constructor", "$$typeof", "nodeType"]);

/** The row shape a query's declared answer carries. */
type QueryRow<A> = Awaited<A> extends readonly (infer Row)[] ? Row : Awaited<A>;

/**
 * The line builder a query member becomes on its vocabulary ref: called with
 * a pattern over the query's own inputs, it answers a line typed by the
 * query's row — `.is` slots check against the row's fields. The second
 * overload is a type anchor only — `ReturnType` (how the generated wire
 * names a query's answer) resolves to the class's own declared answer; every
 * actual call matches the first overload and answers a line.
 */
type ExactSlotPattern<Shape, Pattern> = ExactPattern<Shape, Pattern>;

type QueryLineFn<F> = F extends (input: infer I) => infer A
  ? {
      <const Pattern extends SlotPattern<I>>(
        pattern: ExactSlotPattern<I, Pattern>,
      ): QueryReadLine<QueryRow<A>>;
      (input: I): A;
    }
  : F;

/**
 * An action member called as authored data instead of executed directly. The
 * final, uncallable overload anchors generated `ReturnType` and `Parameters`
 * references to the declared implementation signature; authored calls select
 * the generic line-builder overload so input completeness remains visible.
 */
type RequiredInputKeys<I> = {
  [K in keyof I]-?: [I[K]] extends [never] ? never : {} extends Pick<I, K> ? never : K;
}[keyof I];

type ActionLineFn<F> = F extends (input: infer I) => infer A
  ? {
      <P extends SlotPattern<I>>(
        pattern: P,
      ): RequiredInputKeys<I> extends keyof P
        ? ActionCall<F & InstrumentedAction, P, A>
        : TriggerActionLine<F & InstrumentedAction, P, A>;
      (input: I, anchor: typeof ActionTypeAnchor): A;
    }
  : F;

/**
 * The members of a concept instance as its vocabulary ref exposes them:
 * actions become callable data lines for `when` and `then`;
 * queries become typed line builders — the callable vocabulary proxy.
 */
type ConceptRef<Entry extends ConceptEntry, I = InstanceType<ClassOf<Entry>>> = {
  readonly [K in keyof I as I[K] extends (...args: never[]) => unknown
    ? K
    : never]: K extends `_${string}` ? QueryLineFn<I[K]> : ActionLineFn<I[K]>;
};

/** The vocabulary's refs: one `ConceptRef` per declared name. */
type VocabularyRefs<T extends Record<string, ConceptEntry>> = {
  readonly [K in keyof T]: ConceptRef<T[K]>;
};

/** A concept class plus metadata owned by its vocabulary name. */
type ConceptDeclaration<C extends ConceptClass> = ConceptMetadata & {
  readonly class: C;
  readonly spec?: string;
};

export type ConceptEntry = ConceptClass | ConceptDeclaration<ConceptClass>;

type QueryKeys<I> = Extract<keyof I, `_${string}`>;

type QueryRowIsValid<T> = T extends (...args: never[]) => unknown
  ? false
  : T extends readonly unknown[]
    ? false
    : T extends object
      ? true
      : false;

type QueryAnswerIsValid<T> =
  Awaited<T> extends readonly (infer Row)[] ? QueryRowIsValid<Row> : QueryRowIsValid<Awaited<T>>;

type QueryAnswerMatchesPromise<Answer, Promise> = [Promise] extends [never]
  ? QueryAnswerIsValid<Answer>
  : QueryPromise extends Promise
    ? QueryAnswerIsValid<Answer>
    : [Promise] extends ["one"]
      ? Awaited<Answer> extends readonly unknown[]
        ? false
        : QueryRowIsValid<Awaited<Answer>>
      : [Promise] extends ["optional" | "many"]
        ? Awaited<Answer> extends readonly (infer Row)[]
          ? QueryRowIsValid<Row>
          : false
        : QueryAnswerIsValid<Answer>;

type DeclaredQueryPromise<Entry, Key extends PropertyKey> = Entry extends {
  readonly queries: infer Queries;
}
  ? Key extends keyof Queries
    ? Queries[Key]
    : never
  : Entry extends { readonly class: infer Class }
    ? Class extends { readonly queries: infer Queries }
      ? Key extends keyof Queries
        ? Queries[Key]
        : never
      : never
    : never;

type InvalidQueryKeys<Entry extends ConceptEntry, I = InstanceType<ClassOf<Entry>>> = {
  [K in QueryKeys<I>]: I[K] extends (...args: never[]) => infer Answer
    ? QueryAnswerMatchesPromise<Answer, DeclaredQueryPromise<Entry, K>> extends true
      ? never
      : K
    : K;
}[QueryKeys<I>];

type CheckedConceptEntry<E extends ConceptEntry> = E extends ConceptClass
  ? InvalidQueryKeys<E> extends never
    ? E
    : never
  : E extends ConceptDeclaration<infer C>
    ? E & { readonly class: InvalidQueryKeys<E> extends never ? C : never }
    : never;

type CheckedConceptEntries<T extends Record<string, ConceptEntry>> = {
  [K in keyof T]: CheckedConceptEntry<T[K]>;
};

type ClassOf<E extends ConceptEntry> =
  E extends ConceptDeclaration<infer C> ? C : E extends ConceptClass ? E : never;

export type ConceptClassesOf<T extends Record<string, ConceptEntry>> = {
  readonly [K in keyof T]: ClassOf<T[K]>;
};

type ComputationRefs<T extends Record<string, ComputationFn>> = {
  readonly [K in keyof T]: ComputationRef<T[K]>;
};

/** Concept and computation refs grouped by their role. */
export interface DeclaredVocabulary<
  TConcepts extends Record<string, ConceptEntry>,
  TComputations extends Record<string, ComputationFn>,
> {
  readonly concepts: VocabularyRefs<TConcepts>;
  readonly computations: ComputationRefs<TComputations>;
  readonly [VocabularyClasses]: ConceptClassesOf<TConcepts>;
  readonly [VocabularyComputations]: ComputationRefs<TComputations>;
  readonly [VocabularyMetadata]: Record<string, ConceptMetadata>;
}

interface VocabularyDeclaration<
  TConcepts extends Record<string, ConceptEntry>,
  TComputations extends Record<string, ComputationFn>,
> {
  concepts: TConcepts;
  computations?: TComputations;
}

/**
 * The machine-readable metadata a specification supplies on its own. State
 * prose is not metadata. Refusal branches need the Error class that signals
 * each code, so a registration derives those separately.
 */
function specifiedContracts(spec: string): ConceptMetadata {
  const specification = parseSpec(spec);
  const { purpose, principle, queries } = specification;
  const promises: Record<string, QueryPromise> = {};
  for (const query of queries) setOwn(promises, query.name, query.promise);
  return { purpose, principle, queries: promises, specification };
}

function classContracts(cls: ConceptClass): ConceptMetadata {
  const canonical = cls as unknown as {
    purpose?: unknown;
    principle?: unknown;
    queries?: unknown;
    outcomes?: unknown;
  };
  return {
    ...(typeof canonical.purpose === "string" ? { purpose: canonical.purpose } : {}),
    ...(typeof canonical.principle === "string" ? { principle: canonical.principle } : {}),
    ...(canonical.queries === undefined
      ? {}
      : { queries: canonical.queries as ConceptMetadata["queries"] }),
    ...(canonical.outcomes === undefined
      ? {}
      : { outcomes: canonical.outcomes as ConceptMetadata["outcomes"] }),
  };
}

function validateConceptMetadata(
  conceptName: string,
  cls: ConceptClass,
  metadata: ConceptMetadata,
): void {
  const prototype = cls.prototype as Record<string, unknown>;
  validateQueryContractMap(metadata.queries, prototype, `Vocabulary: "${conceptName}"`, cls.name);
  for (const action of new Set([
    ...Object.keys(metadata.outcomes ?? {}),
    ...Object.keys(metadata.refusals ?? {}),
  ])) {
    if (action.startsWith("_") || typeof prototype[action] !== "function") {
      throw new Error(`Vocabulary: "${conceptName}.${action}" is not an action of ${cls.name}.`);
    }
  }
  for (const [action, branches] of Object.entries(metadata.refusals ?? {})) {
    for (const { code, error: Constructor } of branches) {
      if (
        code === "" ||
        typeof Constructor !== "function" ||
        !(Constructor.prototype instanceof Error)
      ) {
        throw new Error(
          `Vocabulary: refusal "${conceptName}.${action}.${code}" needs a distinct Error class.`,
        );
      }
    }
    // An action's branches are matched by `instanceof` in order, so two
    // branches on one action must never admit the same thrown error.
    for (let left = 0; left < branches.length; left += 1) {
      for (let right = left + 1; right < branches.length; right += 1) {
        const Left = branches[left].error;
        const Right = branches[right].error;
        if (Left === Right || Left.prototype instanceof Right || Right.prototype instanceof Left) {
          throw new Error(
            `Vocabulary: refusal classes for "${conceptName}.${action}" must not overlap.`,
          );
        }
      }
    }
  }
}

function conceptRefProxy(
  conceptName: string,
  cls: ConceptClass,
  queryPromises?: QueryPromises,
): object {
  const memo = new Map<string, ActionRef | QueryRef>();
  const prototype = cls.prototype as Record<string, unknown>;
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined;
        const existing = memo.get(prop);
        if (existing !== undefined) return existing;
        if (typeof prototype[prop] !== "function") {
          if (INSPECTION_PROPS.has(prop)) return undefined;
          throw new Error(
            `Vocabulary: "${conceptName}.${prop}" is not an action or query of ${cls.name}.`,
          );
        }
        const ref = prop.startsWith("_")
          ? makeQueryRef(
              conceptName,
              prop,
              queryPromises?.[prop] ??
                (cls as unknown as { queries?: Record<string, QueryPromise> }).queries?.[prop],
            )
          : makeActionRef(conceptName, prop);
        memo.set(prop, ref);
        return ref;
      },
      has(_target, prop) {
        return typeof prop === "string" && typeof prototype[prop] === "function";
      },
    },
  );
}

/**
 * Declare the application's concept vocabulary: each name bound to its
 * canonical class. Returns the refs used to author reactions. Assembly also
 * uses the declaration to construct default concept instances.
 */
export function vocabulary<
  const TConcepts extends Record<string, ConceptEntry>,
  const TComputations extends Record<string, ComputationFn>,
>(
  declaration: VocabularyDeclaration<TConcepts, TComputations> & {
    concepts: CheckedConceptEntries<TConcepts>;
    computations?: CheckedComputationFns<TComputations>;
  },
): DeclaredVocabulary<TConcepts, TComputations>;
export function vocabulary(
  declaration: object,
): DeclaredVocabulary<Record<string, ConceptEntry>, Record<string, ComputationFn>> {
  const source = declaration as Record<string, unknown>;
  const entries = source.concepts as Record<string, ConceptEntry>;
  if (entries === undefined || entries === null || typeof entries !== "object") {
    throw new Error("vocabulary(...) requires a concepts record.");
  }
  const refs: Record<string, object> = {};
  const classes: Record<string, ConceptClass> = {};
  const metadata: Record<string, ConceptMetadata> = {};
  for (const [name, entry] of Object.entries(entries)) {
    const descriptor =
      typeof entry === "object" && entry !== null && "class" in entry
        ? (entry as ConceptDeclaration<ConceptClass>)
        : undefined;
    const cls = descriptor?.class ?? (entry as ConceptClass);
    if (typeof cls !== "function" || cls.prototype === undefined) {
      throw new Error(`Vocabulary: "${name}" must be a concept class.`);
    }
    setOwn(classes, name, cls);
    let declaredContracts: ConceptMetadata = classContracts(cls);
    if (descriptor !== undefined) {
      const { class: _class, spec, ...contracts } = descriptor;
      declaredContracts =
        spec === undefined
          ? { ...declaredContracts, ...contracts }
          : { ...declaredContracts, ...specifiedContracts(spec), ...contracts };
    }
    const protocol = conceptProtocolOf(cls.prototype as object);
    const actionRoles: Record<string, readonly string[] | undefined> = {};
    const queryRoles: Record<string, readonly string[] | undefined> = {};
    for (const [names, roles] of [
      [protocol.actions, actionRoles],
      [protocol.queries, queryRoles],
    ] as const) {
      for (const memberName of names) {
        const member = callableConceptMember(cls.prototype as object, memberName);
        setOwn(roles, memberName, member === undefined ? undefined : rolesOf(member));
      }
    }
    const declaredMetadata: ConceptMetadata = {
      ...declaredContracts,
      [CONCEPT_PROTOCOL]: protocol,
      [CONCEPT_MEMBER_ROLES]: { actions: actionRoles, queries: queryRoles },
    };
    validateConceptMetadata(name, cls, declaredMetadata);
    setOwn(metadata, name, declaredMetadata);
    setOwn(refs, name, conceptRefProxy(name, cls, declaredMetadata.queries));
  }
  Object.defineProperty(refs, VocabularyClasses, { value: { ...classes } });

  const definitions = (source.computations ?? {}) as Record<string, ComputationFn>;
  const computations: Record<string, ComputationRef> = {};
  for (const [name, fn] of Object.entries(definitions)) {
    setOwn(computations, name, computationRef(name, fn, "vocabulary"));
  }
  const result = { concepts: refs, computations };
  Object.defineProperties(result, {
    [VocabularyClasses]: { value: { ...classes } },
    [VocabularyComputations]: { value: { ...computations } },
    [VocabularyMetadata]: { value: { ...metadata } },
  });
  return result as DeclaredVocabulary<Record<string, ConceptEntry>, Record<string, ComputationFn>>;
}

/** The class map a vocabulary was declared with (how `assemble` constructs). */
export function vocabularyClasses(
  vocab: DeclaredVocabulary<Record<string, ConceptEntry>, Record<string, ComputationFn>>,
): Record<string, ConceptClass> {
  const classes = (vocab as unknown as Record<symbol, unknown>)[VocabularyClasses];
  if (classes === undefined) {
    throw new Error("vocabularyClasses(...) takes the object vocabulary(...) returned.");
  }
  return classes as Record<string, ConceptClass>;
}

/** The vocabulary-scoped computations an assembly installs. */
export function vocabularyComputations(vocab: object): Record<string, ComputationRef> {
  return ((vocab as Record<symbol, unknown>)[VocabularyComputations] ?? {}) as Record<
    string,
    ComputationRef
  >;
}

/** Metadata associated with each vocabulary concept name. */
export function vocabularyMetadata(vocab: object): Record<string, ConceptMetadata> {
  return ((vocab as Record<symbol, unknown>)[VocabularyMetadata] ?? {}) as Record<
    string,
    ConceptMetadata
  >;
}

/**
 * Tag a reaction so an assembly can discover it in composition exports.
 * Views and formers carry their own tags, as do endpoint declarations that
 * specialize the reaction frame; untagged helpers remain ordinary exports.
 * The wrapper also lets the callback's destructured parameter infer as
 * {@link Vars}, so reactions need no type annotation.
 */
export function reaction(reaction: Reaction): Reaction {
  if (typeof reaction !== "function") {
    throw new Error("reaction(...) takes a function that declares the reaction.");
  }
  return brand(reaction, ReactionBrand);
}

export function isReaction(value: unknown): value is Reaction {
  return hasFuncBrand(value, ReactionBrand);
}
