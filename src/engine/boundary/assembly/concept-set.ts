import {
  vocabulary,
  vocabularyClasses,
  type ConceptClass,
  type ConceptClassesOf,
  type ConceptEntry,
  type DeclaredVocabulary,
} from "@engine/reactions/authoring/refs";
import type {
  ErrorConstructor,
  RefusalContracts,
} from "@engine/reactions/concepts/concept-metadata";
import {
  callableConceptMember,
  conceptProtocolOf,
} from "@engine/reactions/concepts/concept-metadata";
import { parseSpec, type ConceptSpec } from "@engine/reactions/concepts/concept-spec";
import { rolesOf } from "@engine/reactions/concepts/introspect";
import type { CheckedComputationFns, ComputationFn } from "@engine/reads/computations";
import type { QueryPromises, QueryPromise } from "@engine/reads/query-metadata";
import { setOwn } from "@engine/utils/own-property";
import { rememberImplementations } from "./implementation-registry.ts";

type ImplementationMember<Member> = Member extends (...args: infer Args) => infer Result
  ? (...args: Args) => Result | PromiseLike<Awaited<Result>>
  : Member;

export type ConceptImplementation<C extends ConceptClass> = object & {
  [Name in keyof InstanceType<C> as InstanceType<C>[Name] extends (...args: never[]) => unknown
    ? Name
    : never]: ImplementationMember<InstanceType<C>[Name]>;
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
  const classes = vocabularyClasses(vocabularyDeclaration);
  for (const name of expected) {
    validateConceptImplementation("conceptFloor", name, classes[name], floor.instances[name]);
  }
  rememberImplementations(floor.instances as Record<string, object>, floor.name);
  return floor;
}

/**
 * Builds one concept instance for a named floor. The registered concept name
 * arrives as the second argument, so a registry never has to spell its own
 * application name.
 */
type FloorFactory<C extends ConceptClass = ConceptClass> = (
  context: never,
  name: string,
) => ConceptImplementation<C>;

export interface ConceptRegistration<
  C extends ConceptClass,
  F extends Record<string, FloorFactory<C>> = Record<never, never>,
> {
  class: C;
  /** Markdown containing the concept's parsed authored contract. */
  spec: string;
  /** The Error class that signals each refusal code the specification declares. */
  refusals?: Readonly<Record<string, ErrorConstructor>>;
  floors?: F;
}

declare const RegistrationBrand: unique symbol;

export type RegisteredConcept<
  C extends ConceptClass,
  F extends Record<string, FloorFactory<C>> = Record<never, never>,
> = ConceptRegistration<C, F> & {
  readonly [RegistrationBrand]: true;
  /** The machine-readable authored contract extracted from the registration's specification. */
  readonly specification: ConceptSpec;
};

function isErrorConstructor(value: unknown): value is ErrorConstructor {
  return typeof value === "function" && value.prototype instanceof Error;
}

export function validateConceptImplementation(
  source: string,
  conceptName: string,
  cls: ConceptClass,
  implementation: unknown,
): asserts implementation is object {
  if (implementation === null || typeof implementation !== "object") {
    throw new Error(`${source}: implementation for "${conceptName}" must be an object.`);
  }
  const expected = conceptProtocolOf(cls.prototype as object);
  const missing = [...expected.actions, ...expected.queries].filter(
    (name) => callableConceptMember(implementation, name) === undefined,
  );
  if (missing.length > 0) {
    throw new Error(
      `${source}: implementation for "${conceptName}" does not implement ${listed(missing)}.`,
    );
  }
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
  const implemented = conceptProtocolOf(cls.prototype as object);
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

  const unsignalled = [...declared].filter((code) => !Object.hasOwn(signals, code));
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
}

export function registerConcept<
  C extends ConceptClass,
  const F extends Record<string, FloorFactory<C>> = Record<never, never>,
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
type ClassOfRegistration<R> = R extends RegisteredConcept<infer C, infer _F> ? C : never;
type EntriesOf<S extends Record<string, AnyRegistration>> = {
  [Name in keyof S]: {
    class: ClassOfRegistration<S[Name]>;
    purpose?: string;
    principle?: string;
    queries?: QueryPromises;
    refusals?: RefusalContracts;
    specification?: ConceptSpec;
  };
};
type VocabularyOf<
  S extends Record<string, AnyRegistration>,
  Computations extends Record<string, ComputationFn> = Record<never, never>,
> = DeclaredVocabulary<EntriesOf<S>, Computations>;
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

type RequiredConstructorRegistration<S extends Record<string, AnyRegistration>> = {
  [Name in keyof S]: S[Name] extends RegisteredConcept<infer C, infer _F>
    ? [] extends ConstructorParameters<C>
      ? never
      : Name
    : Name;
}[keyof S];

export interface RegisteredConceptSet<
  S extends Record<string, AnyRegistration>,
  Computations extends Record<string, ComputationFn> = Record<never, never>,
> {
  vocabulary: VocabularyOf<S, Computations>;
  concepts: VocabularyOf<S, Computations>["concepts"];
  computations: VocabularyOf<S, Computations>["computations"];
  implementations(
    ...args: [RequiredConstructorRegistration<S>] extends [never] ? [] : [never]
  ): Implementations<VocabularyOf<S, Computations>>;
  implementations<Floor extends CompleteFloorNames<S>>(
    floor: Floor,
    context: FloorContext<S, Floor>,
  ): Implementations<VocabularyOf<S, Computations>>;
}

export function conceptSet<
  const S extends Record<string, AnyRegistration>,
  const Computations extends Record<string, ComputationFn> = Record<never, never>,
>(
  registrations: S,
  computations: Computations & CheckedComputationFns<Computations> = {} as Computations &
    CheckedComputationFns<Computations>,
): RegisteredConceptSet<S, Computations> {
  const entries: Record<string, ConceptEntry> = {};
  for (const [conceptName, registration] of Object.entries(registrations)) {
    const { purpose, principle, actions, queries } = registration.specification;
    const signals = registration.refusals ?? {};

    // The specification says which action refuses with which code and sentence;
    // the registration says which Error class signals each code.
    const refusals: RefusalContracts = {};
    for (const action of actions) {
      if (action.refusals.length === 0) continue;
      setOwn(
        refusals,
        action.name,
        action.refusals.map(({ code, message }) => ({
          code,
          message,
          error: signals[code],
        })),
      );
    }
    const promises: Record<string, QueryPromise> = {};
    for (const query of queries) setOwn(promises, query.name, query.promise);

    setOwn(entries, conceptName, {
      class: registration.class,
      purpose,
      principle,
      ...(queries.length === 0 ? {} : { queries: promises }),
      ...(Object.keys(refusals).length === 0 ? {} : { refusals }),
      specification: registration.specification,
    });
  }
  const declared = vocabulary({
    concepts: entries,
    computations: computations as unknown as Record<string, () => unknown>,
  });

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
      let implementation: unknown;
      if (floor === undefined) {
        if (registration.class.length > 0) {
          throw new Error(
            `conceptSet: concept "${name}" requires constructor arguments; use a named floor.`,
          );
        }
        implementation = new (registration.class as new () => object)();
      } else {
        const factory = registration.floors?.[floor];
        if (factory === undefined) {
          throw new Error(`conceptSet: floor "${floor}" disappeared during construction.`);
        }
        implementation = factory(context as never, name);
      }
      validateConceptImplementation(
        floor === undefined ? "conceptSet" : `conceptSet: floor "${floor}"`,
        name,
        registration.class,
        implementation,
      );
      setOwn(result, name, implementation);
    }
    rememberImplementations(result, floor);
    return result;
  };

  return {
    vocabulary: declared as unknown as VocabularyOf<S, Computations>,
    concepts: declared.concepts as VocabularyOf<S, Computations>["concepts"],
    computations: declared.computations as unknown as VocabularyOf<S, Computations>["computations"],
    implementations,
  } as RegisteredConceptSet<S, Computations>;
}
