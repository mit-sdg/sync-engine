import { assemble, type ImplementationOverrides } from "@mit-sdg/sync-engine/assembly";
import type { ExecutionLimits } from "@mit-sdg/sync-engine/boundary";
import * as Board from "./compositions/Board.ts";
import * as Sessions from "./compositions/Sessions.ts";
import { messageBoardConcepts, vocabulary } from "./vocabulary.ts";

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
    composition: {
      Sessions: { spec: Sessions.spec, ...Sessions.compositions },
      Board: { spec: Board.spec, ...Board.compositions, formers: Board.formers },
    },
    executionLimits: messageBoardExecutionLimits,
  });
}
