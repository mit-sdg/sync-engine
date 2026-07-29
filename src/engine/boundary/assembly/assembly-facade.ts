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
import type { ConceptImplementation } from "./concept-set.ts";

/** The application as its host consumes it — the engine and boundary internals stay behind. */
export type Assembly<TConcepts extends Record<string, new (...args: never[]) => object>> = Pick<
  AssembledApp<TConcepts>,
  "invoker" | "concepts" | "publicInterface" | "beginDrain" | "whenIdle" | "form"
>;

export type AssemblyOptions<
  TEntries extends Record<string, ConceptEntry>,
  TComputations extends Record<string, ComputationFn>,
> = Omit<
  AssembleBaseOptions<
    ConceptClassesOf<TEntries>,
    {
      [Name in keyof ConceptClassesOf<TEntries>]?: ConceptImplementation<
        ConceptClassesOf<TEntries>[Name]
      >;
    }
  >,
  "vocabulary"
> &
  RequiredConstructionSources<ConceptClassesOf<TEntries>> & {
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
    beginDrain: assembled.beginDrain,
    whenIdle: assembled.whenIdle,
    form: assembled.form,
  };
  rememberApplicationInvoker(facade.invoker, facade, facade.publicInterface);
  rememberAssembly(facade, assembled);
  return facade;
}
