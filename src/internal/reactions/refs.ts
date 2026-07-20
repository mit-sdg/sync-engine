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

import { computationRef } from "../reads/computations.ts";
import { lineOf } from "../reads/lines.ts";
import type { QueryReadLine, SlotPattern } from "../reads/lines.ts";
import { parseSpecProse } from "./concept-spec.ts";
import type { ComputationFn, ComputationRef } from "../reads/computations.ts";
import type { ConceptMetadata } from "./concept-metadata.ts";
import type { Mapping, Reaction } from "./types.ts";
import type { QueryPromise } from "../reads/query-contracts.ts";

const ActionRefBrand: unique symbol = Symbol("ActionRefBrand");
const QueryRefBrand: unique symbol = Symbol("QueryRefBrand");
const ReactionBrand: unique symbol = Symbol("ReactionBrand");
const VocabularyClasses: unique symbol = Symbol("VocabularyClasses");
const VocabularyComputations: unique symbol = Symbol("VocabularyComputations");
const VocabularyMetadata: unique symbol = Symbol("VocabularyMetadata");

/** Any concept class the vocabulary can hold. */
export type ConceptClass = new (...args: never[]) => object;

/** A static reference to one concept action: `{ concept, action }` as data. */
export interface ActionRef {
  (...args: never[]): unknown;
  readonly refConcept: string;
  readonly refAction: string;
}

/**
 * A static reference to one concept query. Calling it with an input pattern
 * returns a typed query line whose `.is(...)` method declares output matches.
 * The reference carries the query's name and promise; a missing `.concept`
 * marks it unresolved.
 */
export interface QueryRef {
  (pattern: Mapping): QueryReadLine;
  readonly refConcept: string;
  readonly refQuery: string;
  readonly queryName: string;
  readonly queryPromise?: QueryPromise;
}

export function isActionRef(value: unknown): value is ActionRef {
  return typeof value === "function" && (value as never)[ActionRefBrand] === true;
}

export function isQueryRef(value: unknown): value is QueryRef {
  return typeof value === "function" && (value as never)[QueryRefBrand] === true;
}

function refThrows(concept: string, member: string): never {
  throw new Error(
    `${concept}.${member} is a static ref — it runs only through an assembled engine ` +
      "(inside a registered reaction, view, or former), never called directly.",
  );
}

function makeActionRef(concept: string, action: string): ActionRef {
  const ref = (() => refThrows(concept, action)) as unknown as ActionRef;
  Object.defineProperty(ref, "name", { value: `${concept}.${action}` });
  Object.defineProperty(ref, "refConcept", { value: concept, enumerable: true });
  Object.defineProperty(ref, "refAction", { value: action, enumerable: true });
  Object.defineProperty(ref, ActionRefBrand, { value: true });
  return ref;
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
  Object.defineProperty(ref, QueryRefBrand, { value: true });
  return ref;
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
export type QueryLineFn<F> = F extends (input: infer I) => infer A
  ? {
      (pattern: SlotPattern<I>): QueryReadLine<QueryRow<A>>;
      (input: I): A;
    }
  : F;

/**
 * The members of a concept instance as its vocabulary ref exposes them:
 * actions keep the class's own signatures (for `when`/`request` patterns);
 * queries become typed line builders — the callable vocabulary proxy.
 */
export type ConceptRef<I> = {
  readonly [K in keyof I as I[K] extends (...args: never[]) => unknown
    ? K
    : never]: K extends `_${string}` ? QueryLineFn<I[K]> : I[K];
};

/** The vocabulary's refs: one `ConceptRef` per declared name. */
export type VocabularyRefs<T extends Record<string, ConceptClass>> = {
  readonly [K in keyof T]: ConceptRef<InstanceType<T[K]>>;
};

/** A concept class plus metadata owned by its vocabulary name. */
export type ConceptDeclaration<C extends ConceptClass> = ConceptMetadata & {
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

type InvalidQueryKeys<I> = {
  [K in QueryKeys<I>]: I[K] extends (...args: never[]) => infer Answer
    ? QueryAnswerIsValid<Answer> extends true
      ? never
      : K
    : K;
}[QueryKeys<I>];

type ValidConceptClass<C extends ConceptClass> =
  InvalidQueryKeys<InstanceType<C>> extends never ? C : never;

type CheckedConceptEntry<E extends ConceptEntry> = E extends ConceptClass
  ? ValidConceptClass<E>
  : E extends ConceptDeclaration<infer C>
    ? "queries" extends keyof E
      ? never
      : E & { readonly class: ValidConceptClass<C> }
    : never;

type CheckedConceptEntries<T extends Record<string, ConceptEntry>> = {
  [K in keyof T]: CheckedConceptEntry<T[K]>;
};

type ClassOf<E extends ConceptEntry> =
  E extends ConceptDeclaration<infer C> ? C : E extends ConceptClass ? E : never;

export type ConceptClassesOf<T extends Record<string, ConceptEntry>> = {
  readonly [K in keyof T]: ClassOf<T[K]>;
};

export type ComputationRefs<T extends Record<string, ComputationFn>> = {
  readonly [K in keyof T]: ComputationRef;
};

/** Concept and computation refs grouped by their role. */
export interface DeclaredVocabulary<
  TConcepts extends Record<string, ConceptEntry>,
  TComputations extends Record<string, ComputationFn>,
> {
  readonly concepts: VocabularyRefs<ConceptClassesOf<TConcepts>>;
  readonly computations: ComputationRefs<TComputations>;
  readonly [VocabularyClasses]: ConceptClassesOf<TConcepts>;
  readonly [VocabularyComputations]: ComputationRefs<TComputations>;
  readonly [VocabularyMetadata]: Record<string, ConceptMetadata>;
}

export interface VocabularyDeclaration<
  TConcepts extends Record<string, ConceptEntry>,
  TComputations extends Record<string, ComputationFn>,
> {
  concepts: TConcepts;
  computations?: TComputations;
}

function validateConceptMetadata(
  conceptName: string,
  cls: ConceptClass,
  metadata: ConceptMetadata,
): void {
  const prototype = cls.prototype as Record<string, unknown>;
  for (const action of new Set([
    ...Object.keys(metadata.outcomes ?? {}),
    ...Object.keys(metadata.refusals ?? {}),
  ])) {
    if (action.startsWith("_") || typeof prototype[action] !== "function") {
      throw new Error(`Vocabulary: "${conceptName}.${action}" is not an action of ${cls.name}.`);
    }
  }
  for (const [action, refusals] of Object.entries(metadata.refusals ?? {})) {
    const constructors = Object.entries(refusals);
    for (const [code, Constructor] of constructors) {
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
    for (let left = 0; left < constructors.length; left += 1) {
      for (let right = left + 1; right < constructors.length; right += 1) {
        const Left = constructors[left][1];
        const Right = constructors[right][1];
        if (Left === Right || Left.prototype instanceof Right || Right.prototype instanceof Left) {
          throw new Error(
            `Vocabulary: refusal classes for "${conceptName}.${action}" must not overlap.`,
          );
        }
      }
    }
  }
  const declaredCodes = new Set(
    Object.values(metadata.refusals ?? {}).flatMap((refusals) => Object.keys(refusals)),
  );
  for (const code of Object.keys(metadata.publicErrors ?? {})) {
    if (!declaredCodes.has(code)) {
      throw new Error(
        `Vocabulary: public error "${conceptName}.${code}" is not a declared refusal.`,
      );
    }
  }
}

function conceptRefProxy(conceptName: string, cls: ConceptClass): object {
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
  TConcepts extends Record<string, ConceptEntry>,
  TComputations extends Record<string, ComputationFn>,
>(
  declaration: VocabularyDeclaration<TConcepts, TComputations> & {
    concepts: CheckedConceptEntries<TConcepts>;
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
    classes[name] = cls;
    if (descriptor !== undefined) {
      if (Object.hasOwn(descriptor, "queries")) {
        throw new Error(
          `Vocabulary: "${name}" repeats query cardinality in metadata; return one record or an array of records from each query instead.`,
        );
      }
      const { class: _class, spec, ...contracts } = descriptor;
      const declaredMetadata =
        spec === undefined ? contracts : { ...parseSpecProse(spec), ...contracts };
      validateConceptMetadata(name, cls, declaredMetadata);
      metadata[name] = declaredMetadata;
    }
    refs[name] = conceptRefProxy(name, cls);
  }
  Object.defineProperty(refs, VocabularyClasses, { value: { ...classes } });

  const definitions = (source.computations ?? {}) as Record<string, ComputationFn>;
  const computations: Record<string, ComputationRef> = {};
  for (const [name, fn] of Object.entries(definitions)) {
    computations[name] = computationRef(name, fn, "vocabulary");
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
  Object.defineProperty(reaction, ReactionBrand, { value: true });
  return reaction;
}

export function isReaction(value: unknown): value is Reaction {
  return typeof value === "function" && (value as never)[ReactionBrand] === true;
}
