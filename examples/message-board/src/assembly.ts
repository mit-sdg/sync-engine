import { assemble, type ImplementationOverrides } from "@mit-sdg/sync-engine/assembly";
import type { ExecutionLimits } from "@mit-sdg/sync-engine/boundary";
import { messageBoardConcepts, vocabulary } from "./concept-set.ts";
import * as composition from "./composition.ts";

export type MessageBoardOverrides = ImplementationOverrides<typeof vocabulary>;

export const messageBoardExecutionLimits: ExecutionLimits = {
  maxActiveRootFlows: 100,
  maxPendingRequests: 100,
  maxActionsPerFlow: 50,
  maxFiringsPerFlow: 50,
  maxRowsPerEvaluation: 1_000,
  maxRequestDurationMs: 5_000,
};

export function assembleMessageBoard(instances: MessageBoardOverrides = {}) {
  return assemble({
    vocabulary,
    instances: { ...messageBoardConcepts.implementations(), ...instances },
    composition,
    executionLimits: messageBoardExecutionLimits,
  });
}
