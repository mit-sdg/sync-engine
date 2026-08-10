import { createGateway } from "@mit-sdg/sync-engine/boundary";
import type { MessageBoardWire } from "../generated/wire.ts";
import {
  assembleMessageBoard,
  messageBoardExecutionLimits,
  type MessageBoardOverrides,
} from "./assembly.ts";

/** Construct the message-board application independently of any transport or deployment policy. */
export function createMessageBoard(instances: MessageBoardOverrides = {}) {
  const application = assembleMessageBoard(instances);
  const gateway = createGateway<MessageBoardWire>({
    application,
    executionLimits: messageBoardExecutionLimits,
  });
  return { application, gateway };
}
