import { createGateway } from "@mit-sdg/sync-engine/boundary";
import { httpPolicy, type HttpPolicy } from "@mit-sdg/sync-engine-http/policy";
import { createHttpHandler } from "@mit-sdg/sync-engine-http/server";
import type { MessageBoardWire } from "../generated/wire.ts";
import {
  assembleMessageBoard,
  messageBoardExecutionLimits,
  type MessageBoardOverrides,
} from "./assembly.ts";

export function messageBoardHttpPolicy(publicOrigin: string): HttpPolicy {
  return httpPolicy({
    publicOrigin,
    basePath: "/api",
    publicErrors: {
      INVALID_USERNAME: "INVALID_REQUEST",
      WEAK_PASSWORD: "INVALID_REQUEST",
      USERNAME_TAKEN: "CONFLICT",
      INVALID_CREDENTIALS: "UNAUTHORIZED",
      UNKNOWN_SESSION: "UNAUTHORIZED",
      INVALID_POST_CONTENT: "INVALID_REQUEST",
      COMMENT_NOT_FOUND: "NOT_FOUND",
      COMMENT_AUTHOR_MISMATCH: "FORBIDDEN",
    },
    cookies: {
      session: {
        name: "message-board-session",
        input: "session",
        issue: [{ path: "/auth/sign-in", value: "session", expires: "expiresAt" }],
        clear: ["/auth/sign-out"],
      },
    },
  });
}

export const messageBoardPolicy = messageBoardHttpPolicy("http://localhost:3000");

const correlation = {
  resolve: (request: Request) => request.headers.get("X-Request-Id") ?? undefined,
  responseHeader: "X-Request-Id",
};

export function buildMessageBoard(
  instances: MessageBoardOverrides = {},
  policy: HttpPolicy = messageBoardPolicy,
) {
  const application = assembleMessageBoard(instances);
  const gateway = createGateway<MessageBoardWire>({
    application,
    executionLimits: messageBoardExecutionLimits,
  });
  const handler = createHttpHandler({
    application,
    gateway,
    policy,
    correlation,
  });
  return { application, gateway, handler };
}
