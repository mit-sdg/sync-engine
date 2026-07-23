import type { Assembly } from "../boundary/assembly-facade.ts";
import { assemblyBehind } from "../boundary/assembly-registry.ts";
import { actionNameOf, conceptNameOf } from "../reactions/introspect.ts";
import type { AppIR, ConceptInventoryIR } from "../reads/ir.ts";
import type { ActionOutcome } from "../reactions/types.ts";
import type { InputContractDecl } from "../boundary/endpoints.ts";
import { redact } from "../utils/redaction.ts";

export interface ObservedOccurrence {
  concept: string;
  action: string;
  by?: string;
  output?: Record<string, unknown>;
  outcome?: ActionOutcome;
}

/** Return design data and field-name-redacted summaries of retained occurrences. */
export function inspectAssembly(
  assembly: Assembly<Record<string, new (...args: never[]) => object>>,
): {
  app: AppIR;
  concepts: ConceptInventoryIR[];
  inputContracts: Record<string, InputContractDecl>;
  occurrences: ObservedOccurrence[];
  readBack: string;
} {
  const assembled = assemblyBehind(assembly);
  return {
    app: assembled.engine.exportReactions(),
    concepts: assembled.engine.exportConcepts(),
    readBack: assembled.engine.readBack(),
    inputContracts: assembled.contracts,
    occurrences: [...assembled.engine.Action.actions.values()].map(
      ({ concept, action, by, output, outcome }): ObservedOccurrence => ({
        concept: conceptNameOf(concept),
        action: actionNameOf(action),
        ...(by === undefined ? {} : { by }),
        ...(output === undefined ? {} : { output: redact(output) as Record<string, unknown> }),
        ...(outcome === undefined ? {} : { outcome: redact(outcome) as ActionOutcome }),
      }),
    ),
  };
}
