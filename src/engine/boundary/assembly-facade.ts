import type { ComputationFn } from "../reads/computations.ts";
import type { ConceptClassesOf, ConceptEntry, DeclaredVocabulary } from "../reactions/refs.ts";
import { rememberAssembly } from "./assembly-registry.ts";
import { assemble as assembleEngine } from "./assemble.ts";
import type { AssembledApp, AssembleOptions } from "./assemble.ts";

/** The application as its host consumes it — the engine and boundary internals stay behind. */
export type Assembly<TConcepts extends Record<string, new (...args: never[]) => object>> = Pick<
  AssembledApp<TConcepts>,
  "invoker" | "concepts" | "publicInterface" | "form"
>;

export type AssemblyOptions<
  TEntries extends Record<string, ConceptEntry>,
  TComputations extends Record<string, ComputationFn>,
> = Omit<AssembleOptions<ConceptClassesOf<TEntries>>, "vocabulary"> & {
  vocabulary: DeclaredVocabulary<TEntries, TComputations>;
};

export function assemble<
  TEntries extends Record<string, ConceptEntry>,
  TComputations extends Record<string, ComputationFn>,
>(options: AssemblyOptions<TEntries, TComputations>): Assembly<ConceptClassesOf<TEntries>> {
  const assembled = assembleEngine(options);
  const facade: Assembly<ConceptClassesOf<TEntries>> = {
    invoker: assembled.invoker,
    concepts: assembled.concepts,
    publicInterface: assembled.publicInterface,
    form: assembled.form,
  };
  rememberAssembly(facade, assembled);
  return facade;
}
