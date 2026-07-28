import type { Assembly } from "@engine/boundary/assembly/assembly-facade";
import { assemblyBehind } from "@engine/boundary/assembly/assembly-registry";
import type { InputContractDecl } from "@engine/boundary/protocol/endpoints";
import { actionNameOf, conceptNameOf } from "@engine/reactions/concepts/introspect";
import type { AppIR, ConceptInventoryIR } from "@engine/reads/ir";
import type { ActionOutcome } from "@engine/reactions/types";
import { wireContracts } from "@engine/boundary/wire/wire";
import { applicationDiagnostics } from "./diagnostics.ts";
import type { ApplicationDiagnostic } from "./diagnostics.ts";

const INTERNAL_BOUNDARY_ACTIONS = new Set(["register", "cancel", "respondFramework"]);

function applicationConcepts(concepts: ConceptInventoryIR[]): ConceptInventoryIR[] {
  return concepts.map((concept) =>
    concept.name === "RequestBoundary"
      ? {
          ...concept,
          actions: concept.actions.filter(({ name }) => !INTERNAL_BOUNDARY_ACTIONS.has(name)),
        }
      : concept,
  );
}

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
  diagnostics: ApplicationDiagnostic[];
} {
  const assembled = assemblyBehind(assembly);
  const redactor = assembled.engine.Action.redactor;
  const app = assembled.engine.exportReactions();
  const concepts = applicationConcepts(assembled.engine.exportConcepts());
  const wire = wireContracts(app, { contracts: assembled.contracts, inventories: concepts });
  return {
    app,
    concepts,
    readBack: assembled.engine.readBack(),
    inputContracts: assembled.contracts,
    diagnostics: applicationDiagnostics(app, assembled.endpoints, wire),
    occurrences: [...assembled.engine.Action.actions.values()].map(
      ({ concept, action, by, output, outcome }): ObservedOccurrence => ({
        concept: conceptNameOf(concept),
        action: actionNameOf(action),
        ...(by === undefined ? {} : { by }),
        ...(output === undefined
          ? {}
          : { output: redactor.redact(output) as Record<string, unknown> }),
        ...(outcome === undefined ? {} : { outcome: redactor.redact(outcome) as ActionOutcome }),
      }),
    ),
  };
}
