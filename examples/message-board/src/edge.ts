import {
  httpPolicy,
  type HttpPolicy,
  type HttpPublicErrorCategory,
} from "@mit-sdg/sync-engine-http/policy";

export const messageBoardPublicErrors: Readonly<Record<string, HttpPublicErrorCategory>> =
  Object.freeze({
    INVALID_USERNAME: "INVALID_REQUEST",
    WEAK_PASSWORD: "INVALID_REQUEST",
    USERNAME_TAKEN: "CONFLICT",
    INVALID_CREDENTIALS: "UNAUTHORIZED",
    UNKNOWN_SESSION: "UNAUTHORIZED",
    INVALID_POST_CONTENT: "INVALID_REQUEST",
    COMMENT_NOT_FOUND: "NOT_FOUND",
    COMMENT_AUTHOR_MISMATCH: "FORBIDDEN",
  });

/** Policy for callers that exchange session values in JSON rather than cookies. */
export function messageBoardApiPolicy(): HttpPolicy {
  return httpPolicy({
    basePath: "/api",
    publicErrors: messageBoardPublicErrors,
  });
}

/** Policy for the browser deployment, where HTTP owns the session cookie. */
export function messageBoardHttpPolicy(publicOrigin: string): HttpPolicy {
  return httpPolicy({
    publicOrigin,
    basePath: "/api",
    publicErrors: messageBoardPublicErrors,
    cookies: {
      session: {
        name: "message-board-session",
        input: "session",
        issue: [
          { path: "/auth/register", value: "session", expires: "expiresAt" },
          { path: "/auth/sign-in", value: "session", expires: "expiresAt" },
        ],
        clear: ["/auth/sign-out"],
      },
    },
  });
}

export const messageBoardPolicy = messageBoardHttpPolicy("http://localhost:3000");

export const messageBoardCorrelation = {
  resolve: (request: Request) => request.headers.get("X-Request-Id") ?? undefined,
  responseHeader: "X-Request-Id",
};
