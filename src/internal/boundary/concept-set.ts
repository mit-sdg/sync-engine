import {
  vocabulary,
  type ConceptClass,
  type ConceptClassesOf,
  type ConceptEntry,
  type DeclaredVocabulary,
} from "../reactions/refs.ts";
import type {
  ErrorConstructor,
  PublicErrorCategory as MetadataPublicErrorCategory,
  RefusalContracts,
} from "../reactions/concept-metadata.ts";
import type { ComputationFn } from "../reads/computations.ts";
import {
  validateQueryContractMap,
  type QueryPromises,
  type QueryPromise,
} from "../reads/query-contracts.ts";

export type PublicErrorCategory = MetadataPublicErrorCategory;

export const PublicError = {
  INVALID_REQUEST: "INVALID_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
} as const satisfies Record<PublicErrorCategory, PublicErrorCategory>;

type ImplementationMember<Member> = Member extends (...args: infer Args) => infer Result
  ? (...args: Args) => Result | Promise<Awaited<Result>>
  : Member;

export type ConceptImplementation<C extends ConceptClass> = {
  [Name in keyof InstanceType<C>]: ImplementationMember<InstanceType<C>[Name]>;
};

export type Implementations<
  V extends DeclaredVocabulary<Record<string, ConceptEntry>, Record<string, ComputationFn>>,
> =
  V extends DeclaredVocabulary<infer Entries, Record<string, ComputationFn>>
    ? {
        [Name in keyof ConceptClassesOf<Entries>]: ConceptImplementation<
          ConceptClassesOf<Entries>[Name]
        >;
      }
    : never;

export type ImplementationOverrides<
  V extends DeclaredVocabulary<Record<string, ConceptEntry>, Record<string, ComputationFn>>,
> = Partial<Implementations<V>>;

export interface ConceptFloor<
  V extends DeclaredVocabulary<Record<string, ConceptEntry>, Record<string, ComputationFn>>,
> {
  name: string;
  instances: Implementations<V>;
  resources: readonly string[];
  close(): Promise<void>;
}

export function conceptFloor<
  V extends DeclaredVocabulary<Record<string, ConceptEntry>, Record<string, ComputationFn>>,
>(vocabularyDeclaration: V, floor: ConceptFloor<V>): ConceptFloor<V> {
  if (floor.name.trim() === "") throw new Error("conceptFloor: name must not be empty.");
  const expected = Object.keys(vocabularyDeclaration.concepts).sort();
  const actual = Object.keys(floor.instances as object).sort();
  const missing = expected.filter((name) => !actual.includes(name));
  const unknown = actual.filter((name) => !expected.includes(name));
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(
      `conceptFloor: implementations must match the concept set` +
        `${missing.length === 0 ? "" : `; missing ${missing.join(", ")}`}` +
        `${unknown.length === 0 ? "" : `; unknown ${unknown.join(", ")}`}.`,
    );
  }
  if (!Array.isArray(floor.resources) || floor.resources.some((item) => typeof item !== "string")) {
    throw new Error("conceptFloor: resources must be a list of names.");
  }
  if (typeof floor.close !== "function") {
    throw new Error("conceptFloor: close must release the floor's resources.");
  }
  return floor;
}

type ActionName<C extends ConceptClass> = {
  [Name in keyof InstanceType<C>]: Name extends string
    ? Name extends `_${string}`
      ? never
      : InstanceType<C>[Name] extends (...args: never[]) => unknown
        ? Name
        : never
    : never;
}[keyof InstanceType<C>];

type QueryName<C extends ConceptClass> = {
  [Name in keyof InstanceType<C>]: Name extends string
    ? Name extends `_${string}`
      ? InstanceType<C>[Name] extends (...args: never[]) => unknown
        ? Name
        : never
      : never
    : never;
}[keyof InstanceType<C>];

export type QueryRegistration<C extends ConceptClass> = Partial<Record<QueryName<C>, QueryPromise>>;

type FloorFactory = (context: never) => object;

export interface RefusalRegistration<C extends ConceptClass> {
  error: ErrorConstructor;
  on: readonly ActionName<C>[];
  public?: PublicErrorCategory;
}

export interface ConceptRegistration<
  C extends ConceptClass,
  F extends Record<string, FloorFactory> = Record<never, never>,
> {
  class: C;
  spec: string;
  queries?: QueryRegistration<C>;
  refusals?: Record<string, RefusalRegistration<C>>;
  floors?: F;
}

declare const RegistrationBrand: unique symbol;

export type RegisteredConcept<
  C extends ConceptClass,
  F extends Record<string, FloorFactory> = Record<never, never>,
> = ConceptRegistration<C, F> & { readonly [RegistrationBrand]: true };

function isErrorConstructor(value: unknown): value is ErrorConstructor {
  return typeof value === "function" && value.prototype instanceof Error;
}

export function registerConcept<
  C extends ConceptClass,
  const F extends Record<string, FloorFactory> = Record<never, never>,
>(registration: ConceptRegistration<C, F>): RegisteredConcept<C, F> {
  if (typeof registration.class !== "function" || registration.class.prototype === undefined) {
    throw new Error("registerConcept: class must be a constructable concept class.");
  }
  if (typeof registration.spec !== "string") {
    throw new Error("registerConcept: spec must contain the concept specification.");
  }
  const prototype = registration.class.prototype as Record<string, unknown>;
  validateQueryContractMap(
    registration.queries,
    prototype,
    "registerConcept",
    registration.class.name,
  );
  const constructors = new Map<ErrorConstructor, string>();
  for (const [code, refusal] of Object.entries(registration.refusals ?? {})) {
    if (code === "" || !isErrorConstructor(refusal.error)) {
      throw new Error(`registerConcept: refusal "${code}" needs a distinct Error class.`);
    }
    const prior = constructors.get(refusal.error);
    if (prior !== undefined && prior !== code) {
      throw new Error(
        `registerConcept: refusal codes "${prior}" and "${code}" use the same Error class.`,
      );
    }
    constructors.set(refusal.error, code);
    if (!Array.isArray(refusal.on) || refusal.on.length === 0) {
      throw new Error(`registerConcept: refusal "${code}" must name at least one action.`);
    }
    const seen = new Set<string>();
    for (const action of refusal.on as readonly string[]) {
      if (seen.has(action)) {
        throw new Error(`registerConcept: refusal "${code}" repeats action "${action}".`);
      }
      seen.add(action);
      if (action.startsWith("_") || typeof prototype[action] !== "function") {
        throw new Error(`registerConcept: refusal "${code}" names unknown action "${action}".`);
      }
    }
  }
  for (const [name, factory] of Object.entries(registration.floors ?? {})) {
    if (name === "" || typeof factory !== "function") {
      throw new Error(`registerConcept: floor "${name}" needs an implementation factory.`);
    }
  }
  return registration as RegisteredConcept<C, F>;
}

type AnyRegistration = RegisteredConcept<ConceptClass, Record<string, FloorFactory>>;
type ClassOfRegistration<R> =
  R extends RegisteredConcept<infer C, Record<string, FloorFactory>> ? C : never;
type EntriesOf<S extends Record<string, AnyRegistration>> = {
  [Name in keyof S]: {
    class: ClassOfRegistration<S[Name]>;
    spec: string;
    queries?: QueryPromises;
    refusals?: RefusalContracts;
    publicErrors?: Record<string, PublicErrorCategory>;
  };
};
type VocabularyOf<S extends Record<string, AnyRegistration>> = DeclaredVocabulary<
  EntriesOf<S>,
  Record<never, never>
>;
type DeclaredFloorNames<S extends Record<string, AnyRegistration>> = {
  [Name in keyof S]: S[Name] extends RegisteredConcept<ConceptClass, infer F> ? keyof F : never;
}[keyof S] &
  string;
type MissingRegistrations<S extends Record<string, AnyRegistration>, Floor extends string> = {
  [Name in keyof S]: S[Name] extends RegisteredConcept<ConceptClass, infer F>
    ? Floor extends keyof F
      ? never
      : Name
    : Name;
}[keyof S];
type CompleteFloorName<
  S extends Record<string, AnyRegistration>,
  Floor extends string,
> = Floor extends unknown
  ? [MissingRegistrations<S, Floor>] extends [never]
    ? Floor
    : never
  : never;
type CompleteFloorNames<S extends Record<string, AnyRegistration>> = CompleteFloorName<
  S,
  DeclaredFloorNames<S>
>;
type FloorContext<
  S extends Record<string, AnyRegistration>,
  Floor extends CompleteFloorNames<S>,
> = {
  [Name in keyof S]: S[Name] extends RegisteredConcept<ConceptClass, infer F>
    ? Floor extends keyof F
      ? F[Floor] extends (context: infer Context) => object
        ? Context
        : never
      : never
    : never;
}[keyof S];

export interface RegisteredConceptSet<S extends Record<string, AnyRegistration>> {
  vocabulary: VocabularyOf<S>;
  concepts: VocabularyOf<S>["concepts"];
  publicErrors: Readonly<Record<string, PublicErrorCategory>>;
  implementations(): Implementations<VocabularyOf<S>>;
  implementations<Floor extends CompleteFloorNames<S>>(
    floor: Floor,
    context: FloorContext<S, Floor>,
  ): Implementations<VocabularyOf<S>>;
}

export function conceptSet<const S extends Record<string, AnyRegistration>>(
  registrations: S,
): RegisteredConceptSet<S> {
  const entries: Record<string, ConceptEntry> = {};
  const publicErrors: Record<string, PublicErrorCategory> = {};
  for (const [conceptName, registration] of Object.entries(registrations)) {
    const refusals: RefusalContracts = {};
    const conceptPublicErrors: Record<string, PublicErrorCategory> = {};
    for (const [code, refusal] of Object.entries(registration.refusals ?? {})) {
      for (const action of refusal.on as readonly string[]) {
        (refusals[action] ??= {})[code] = refusal.error;
      }
      if (refusal.public !== undefined) {
        conceptPublicErrors[code] = refusal.public;
        const prior = publicErrors[code];
        if (prior !== undefined && prior !== refusal.public) {
          throw new Error(
            `conceptSet: refusal "${code}" has conflicting public categories "${prior}" and "${refusal.public}".`,
          );
        }
        publicErrors[code] = refusal.public;
      }
    }
    entries[conceptName] = {
      class: registration.class,
      spec: registration.spec,
      ...(registration.queries === undefined ? {} : { queries: registration.queries }),
      ...(Object.keys(refusals).length === 0 ? {} : { refusals }),
      ...(Object.keys(conceptPublicErrors).length === 0
        ? {}
        : { publicErrors: conceptPublicErrors }),
    };
  }
  const declared = vocabulary({ concepts: entries, computations: {} });

  const implementations = (floor?: string, context?: unknown) => {
    if (floor !== undefined) {
      const missing = Object.entries(registrations)
        .filter(
          ([, registration]) =>
            registration.floors === undefined || !Object.hasOwn(registration.floors, floor),
        )
        .map(([name]) => name);
      if (missing.length > 0) {
        throw new Error(
          `conceptSet: floor "${floor}" is missing implementations for ${missing.join(", ")}.`,
        );
      }
    }

    const result: Record<string, object> = {};
    for (const [name, registration] of Object.entries(registrations)) {
      if (floor === undefined) {
        result[name] = new (registration.class as new () => object)();
      } else {
        result[name] = registration.floors![floor]!(context as never);
      }
    }
    return result;
  };

  return {
    vocabulary: declared as VocabularyOf<S>,
    concepts: declared.concepts as VocabularyOf<S>["concepts"],
    publicErrors,
    implementations,
  } as RegisteredConceptSet<S>;
}
