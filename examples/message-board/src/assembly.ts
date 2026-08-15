import { assemble, type ImplementationOverrides } from "@mit-sdg/sync-engine/assembly";
import type { ExecutionLimits } from "@mit-sdg/sync-engine/boundary";
import { composition as boardComposition } from "./compositions/Board.ts";
import { composition as sessionsComposition } from "./compositions/Sessions.ts";
import { applicationConceptSet } from "./concepts.ts";

export type MessageBoardOverrides = ImplementationOverrides<typeof applicationConceptSet>;

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
    conceptSet: applicationConceptSet,
    instances: { ...applicationConceptSet.implementations(), ...instances },
    composition: {
      Sessions: sessionsComposition,
      Board: boardComposition,
    },
    executionLimits: messageBoardExecutionLimits,
  });
}
