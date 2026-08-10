import type { Client } from "@mit-sdg/sync-engine/client";
import type { MessageBoardWireHttp } from "../generated/wire.ts";

declare const client: Client<MessageBoardWireHttp>;

void client.board.post({ content: "hello" });
void client.board.comment({ target: "post-1", content: "content-reference" });
void client.auth["sign-in"]({ username: "ari", password: "correct horse" });

// @ts-expect-error HTTP policy consumes session from its cookie.
void client.board.post({ session: "credential", content: "hello" });

// @ts-expect-error Authentication, not the caller, decides the post author.
void client.board.post({ author: "admin", content: "hello" });

// @ts-expect-error Authentication, not the caller, decides the comment author.
void client.board.comment({ target: "post-1", author: "admin", content: "reference" });

void client.board["retract-comment"]({ comment: "comment-1" });

// @ts-expect-error The retracting author comes from the session, not the body.
void client.board["retract-comment"]({ comment: "comment-1", author: "admin" });
