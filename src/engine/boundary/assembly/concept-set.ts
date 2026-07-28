import {
  vocabulary,
  type ConceptClass,
  type ConceptClassesOf,
  type ConceptEntry,
  type DeclaredVocabulary,
} from "@engine/reactions/authoring/refs";
import type {
  ErrorConstructor,
  PublicErrorCategory as MetadataPublicErrorCategory,
  RefusalContracts,
} from "@engine/reactions/concepts/concept-metadata";
import { parseSpec, type ConceptSpec } from "@engine/reactions/concepts/concept-spec";
import { rolesOf } from "@engine/reactions/concepts/introspect";
import type { ComputationFn } from "@engine/reads/computations";
import type { QueryPromises, QueryPromise } from "@engine/reads/query-metadata";
import { PUBLIC_ERROR_CATEGORIES } from "../protocol/public-errors.ts";

export type PublicErrorCategory = MetadataPublicErrorCategory;

export const PublicError = PUBLIC_ERROR_CATEGORIES;

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

/**
 * Builds one concept instance for a named floor. The registered concept name
 * arrives as the second argument, so a registry never has to spell its own
 * application name.
 */
type FloorFactory = (context: never, name: string) => object;

export interface ConceptRegistration<
  C extends ConceptClass,
  F extends Record<string, FloorFactory> = Record<never, never>,
> {
  class: C;
  /** Markdown containing the concept's parsed registration contract and human prose. */
  spec: string;
  /** The Error class that signals each refusal code the specification declares. */
  refusals?: Readonly<Record<string, ErrorConstructor>>;
  /** The boundary category for refusal codes that reach a public caller. */
  publicErrors?: Readonly<Record<string, PublicErrorCategory>>;
  floors?: F;
}

declare const RegistrationBrand: unique symbol;

export type RegisteredConcept<
  C extends ConceptClass,
  F extends Record<string, FloorFactory> = Record<never, never>,
> = ConceptRegistration<C, F> & {
  readonly [RegistrationBrand]: true;
  /** The machine-readable contract extracted from the registration's specification. */
  readonly specification: ConceptSpec;
};

function isErrorConstructor(value: unknown): value is ErrorConstructor {
  return typeof value === "function" && value.prototype instanceof Error;
}

/** The class's own action and query method names, read without invoking getters. */
function membersOf(cls: ConceptClass): { actions: string[]; queries: string[] } {
  const prototype = cls.prototype as object;
  const actions: string[] = [];
  const queries: string[] = [];
  for (const name of Object.getOwnPropertyNames(prototype)) {
    if (name === "constructor") continue;
    if (typeof Object.getOwnPropertyDescriptor(prototype, name)?.value !== "function") continue;
    (name.startsWith("_") ? queries : actions).push(name);
  }
  return { actions, queries };
}

function listed(names: readonly string[]): string {
  return names.map((name) => `\`${name}\``).join(", ");
}

/**
 * Compare parsed action and query declarations with class methods. State prose
 * and implementation fields are outside this comparison.
 */
function checkAgainstClass(cls: ConceptClass, spec: ConceptSpec): void {
  const fail = (what: string): never => {
    throw new Error(`registerConcept(${cls.name}): ${what}`);
  };
  const implemented = membersOf(cls);
  const prototype = cls.prototype as Record<string, (...args: never[]) => unknown>;

  for (const [kind, declarations, members] of [
    ["action", spec.actions, implemented.actions],
    ["query", spec.queries, implemented.queries],
  ] as const) {
    const declared = declarations.map((declaration) => declaration.name);
    const missing = declared.filter((name) => !members.includes(name));
    if (missing.length > 0) {
      fail(
        `the specification declares the ${kind} ${listed(missing)}, which the class does not implement.`,
      );
    }
    const unspecified = members.filter((name) => !declared.includes(name));
    if (unspecified.length > 0) {
      fail(
        `the class implements the ${kind} ${listed(unspecified)}, which the specification does not declare.`,
      );
    }
    for (const declaration of declarations) {
      // A member that takes a placeholder parameter, or destructures nothing
      // from it, names no roles: its inputs were erased with its type, and
      // nothing here can recover them. `scripts/check-specs.ts` compares those
      // signatures against the source, where the declared type survives.
      const roles = rolesOf(prototype[declaration.name]);
      if (roles === undefined || roles.length === 0) continue;
      const inputs = [...declaration.inputs].sort();
      if (inputs.join() === [...roles].sort().join()) continue;
      fail(
        `the ${kind} \`${declaration.name}\` declares the inputs ${listed(declaration.inputs)} ` +
          `but the class takes ${listed(roles)}.`,
      );
    }
  }
}

/** Pair every refusal code the specification declares with the class that signals it. */
function checkRefusals(
  cls: ConceptClass,
  spec: ConceptSpec,
  registration: ConceptRegistration<ConceptClass, Record<string, FloorFactory>>,
): void {
  const fail = (what: string): never => {
    throw new Error(`registerConcept(${cls.name}): ${what}`);
  };
  const signals = registration.refusals ?? {};
  const declared = new Set(
    spec.actions.flatMap((action) => action.refusals.map(({ code }) => code)),
  );

  const unsignalled = [...declared].filter((code) => signals[code] === undefined);
  if (unsignalled.length > 0) {
    fail(`the specification refuses with ${listed(unsignalled)}, which no Error class signals.`);
  }
  const byClass = new Map<ErrorConstructor, string>();
  for (const [code, error] of Object.entries(signals)) {
    if (!declared.has(code)) {
      fail(`the refusal ${listed([code])} names no branch of the specification.`);
    }
    if (!isErrorConstructor(error)) fail(`the refusal \`${code}\` needs an Error class.`);
    const prior = byClass.get(error);
    if (prior !== undefined) {
      fail(`the refusals \`${prior}\` and \`${code}\` share one Error class.`);
    }
    byClass.set(error, code);
  }
  for (const code of Object.keys(registration.publicErrors ?? {})) {
    if (!declared.has(code)) fail(`the public error \`${code}\` is not a declared refusal.`);
  }
}

export function registerConcept<
  C extends ConceptClass,
  const F extends Record<string, FloorFactory> = Record<never, never>,
>(registration: ConceptRegistration<C, F>): RegisteredConcept<C, F> {
  if (typeof registration.class !== "function" || registration.class.prototype === undefined) {
    throw new Error("registerConcept: class must be a constructable concept class.");
  }
  const specification = parseSpec(registration.spec);
  checkAgainstClass(registration.class, specification);
  checkRefusals(
    registration.class,
    specification,
    registration as ConceptRegistration<ConceptClass, Record<string, FloorFactory>>,
  );
  for (const [name, factory] of Object.entries(registration.floors ?? {})) {
    if (name === "" || typeof factory !== "function") {
      throw new Error(`registerConcept: floor "${name}" needs an implementation factory.`);
    }
  }
  return { ...registration, specification } as RegisteredConcept<C, F>;
}

type AnyRegistration = RegisteredConcept<ConceptClass, Record<string, FloorFactory>>;
type ClassOfRegistration<R> =
  R extends RegisteredConcept<infer C, Record<string, FloorFactory>> ? C : never;
type EntriesOf<S extends Record<string, AnyRegistration>> = {
  [Name in keyof S]: {
    class: ClassOfRegistration<S[Name]>;
    purpose?: string;
    principle?: string;
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
type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : never;
type FloorContext<
  S extends Record<string, AnyRegistration>,
  Floor extends CompleteFloorNames<S>,
> = UnionToIntersection<
  {
    [Name in keyof S]: S[Name] extends RegisteredConcept<ConceptClass, infer F>
      ? Floor extends keyof F
        ? Parameters<F[Floor]>[0]
        : never
      : never;
  }[keyof S]
>;

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
    const { purpose, principle, actions, queries } = registration.specification;
    const signals = registration.refusals ?? {};

    // The specification says which action refuses with which code and sentence;
    // the registration says which Error class signals each code.
    const refusals: RefusalContracts = {};
    for (const action of actions) {
      if (action.refusals.length === 0) continue;
      refusals[action.name] = action.refusals.map(({ code, message }) => ({
        code,
        message,
        error: signals[code],
      }));
    }
    const promises: Record<string, QueryPromise> = {};
    for (const query of queries) promises[query.name] = query.promise;

    for (const [code, category] of Object.entries(registration.publicErrors ?? {})) {
      const prior = publicErrors[code];
      if (prior !== undefined && prior !== category) {
        throw new Error(
          `conceptSet: refusal "${code}" has conflicting public categories "${prior}" and "${category}".`,
        );
      }
      publicErrors[code] = category;
    }

    entries[conceptName] = {
      class: registration.class,
      purpose,
      principle,
      ...(queries.length === 0 ? {} : { queries: promises }),
      ...(Object.keys(refusals).length === 0 ? {} : { refusals }),
      ...(registration.publicErrors === undefined
        ? {}
        : { publicErrors: { ...registration.publicErrors } }),
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
        const factory = registration.floors?.[floor];
        if (factory === undefined) {
          throw new Error(`conceptSet: floor "${floor}" disappeared during construction.`);
        }
        result[name] = factory(context as never, name);
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
