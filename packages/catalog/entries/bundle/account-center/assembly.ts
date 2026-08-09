import { assemble, type ImplementationOverrides } from "@mit-sdg/sync-engine/assembly";
import type { ExecutionLimits } from "@mit-sdg/sync-engine/boundary";
import { catalogComposition } from "@catalog/composition";
import { accountCenterConcepts, vocabulary } from "@catalog/concepts";

export type AccountCenterOverrides = ImplementationOverrides<typeof vocabulary>;

export const accountCenterExecutionLimits: ExecutionLimits = {
  maxActiveRootFlows: 100,
  maxPendingRequests: 100,
  maxActionsPerFlow: 100,
  maxFiringsPerFlow: 100,
  maxRowsPerEvaluation: 1_000,
  maxRequestDurationMs: 5_000,
};

export function assembleAccountCenter(instances: AccountCenterOverrides = {}) {
  return assemble({
    vocabulary,
    instances: { ...accountCenterConcepts.implementations(), ...instances },
    composition: catalogComposition,
    executionLimits: accountCenterExecutionLimits,
  });
}
