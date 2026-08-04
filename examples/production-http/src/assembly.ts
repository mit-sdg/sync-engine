import { assemble, type ImplementationOverrides } from "@mit-sdg/sync-engine/assembly";
import type { ExecutionLimits } from "@mit-sdg/sync-engine/boundary";
import { productionHttpConcepts, vocabulary } from "./concept-set.ts";
import * as composition from "./composition.ts";

export type ProductionHttpOverrides = ImplementationOverrides<typeof vocabulary>;

export const productionExecutionLimits: ExecutionLimits = {
  maxActiveRootFlows: 100,
  maxPendingRequests: 100,
  maxActionsPerFlow: 50,
  maxFiringsPerFlow: 50,
  maxRowsPerEvaluation: 1_000,
  maxRequestDurationMs: 5_000,
};

export function assembleProductionHttp(instances: ProductionHttpOverrides = {}) {
  return assemble({
    vocabulary,
    instances: { ...productionHttpConcepts.implementations(), ...instances },
    composition,
    executionLimits: productionExecutionLimits,
  });
}
