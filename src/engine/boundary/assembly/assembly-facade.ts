import type { ComputationFn } from "@engine/reads/computations";
import type {
  ConceptClassesOf,
  ConceptEntry,
  DeclaredVocabulary,
} from "@engine/reactions/authoring/refs";
import { rememberApplicationInvoker } from "../protocol/gateway-registry.ts";
import { rememberAssembly } from "./assembly-registry.ts";
import { assemble as assembleEngine } from "./assemble.ts";
import type { AssembleBaseOptions, AssembledApp, RequiredConstructionSources } from "./assemble.ts";
import type {
  AnyRegisteredConcept,
  ConceptClassesOfSet,
  ConceptImplementation,
  RegisteredConceptSet,
} from "./concept-set.ts";

/** The application as its host consumes it — the engine and boundary internals stay behind. */
export type Assembly<TConcepts extends Record<string, new (...args: never[]) => object>> = Pick<
  AssembledApp<TConcepts>,
  "invoker" | "concepts" | "publicInterface" | "beginDrain" | "whenIdle" | "form"
>;

type BaseAssemblyOptions<T extends Record<string, new (...args: never[]) => object>> =
  AssembleBaseOptions<
    T,
    {
      [Name in keyof T]?: ConceptImplementation<T[Name]>;
    }
  > &
    RequiredConstructionSources<T>;

export type AssemblyOptions<
  TEntries extends Record<string, ConceptEntry>,
  TComputations extends Record<string, ComputationFn>,
> = BaseAssemblyOptions<ConceptClassesOf<TEntries>> & {
  vocabulary: DeclaredVocabulary<TEntries, TComputations>;
  conceptSet?: never;
};

export type ConceptSetAssemblyOptions<
  S extends Record<string, AnyRegisteredConcept>,
  TComputations extends Record<string, ComputationFn>,
> = BaseAssemblyOptions<ConceptClassesOfSet<S>> & {
  conceptSet: RegisteredConceptSet<S, TComputations>;
  vocabulary?: never;
};

export function assemble<
  S extends Record<string, AnyRegisteredConcept>,
  TComputations extends Record<string, ComputationFn>,
>(options: ConceptSetAssemblyOptions<S, TComputations>): Assembly<ConceptClassesOfSet<S>>;
export function assemble<
  TEntries extends Record<string, ConceptEntry>,
  TComputations extends Record<string, ComputationFn>,
>(options: AssemblyOptions<TEntries, TComputations>): Assembly<ConceptClassesOf<TEntries>>;
export function assemble(
  options:
    | ConceptSetAssemblyOptions<Record<string, AnyRegisteredConcept>, Record<string, ComputationFn>>
    | AssemblyOptions<Record<string, ConceptEntry>, Record<string, ComputationFn>>,
): Assembly<Record<string, new (...args: never[]) => object>> {
  const assembled =
    options.conceptSet === undefined ? assembleEngine(options) : assembleEngine(options);
  const facade: Assembly<Record<string, new (...args: never[]) => object>> = {
    invoker: assembled.invoker,
    concepts: assembled.concepts,
    publicInterface: assembled.publicInterface,
    beginDrain: assembled.beginDrain,
    whenIdle: assembled.whenIdle,
    form: assembled.form,
  };
  rememberApplicationInvoker(facade.invoker, facade, facade.publicInterface);
  rememberAssembly(facade, assembled);
  return facade;
}
