import type { Server } from "bun";
import { createHttpHandler } from "@mit-sdg/sync-engine-http/handler";
import { createMessageBoard } from "./application.ts";
import { messageBoardApiPolicy, messageBoardCorrelation } from "./edge.ts";
import { listenerOptionsFromEnvironment, validateHostname, validatePort } from "./host-config.ts";

export interface MessageBoardApiHostOptions {
  readonly hostname?: string;
  readonly port?: number;
}

/** Start a POST/JSON API that exchanges all endpoint inputs and outputs in JSON. */
export function startMessageBoardApiHost({
  hostname = "localhost",
  port = 3000,
}: MessageBoardApiHostOptions = {}): Server<undefined> {
  validateHostname(hostname);
  validatePort(port);
  const { application, gateway } = createMessageBoard();
  const handler = createHttpHandler({
    application,
    gateway,
    policy: messageBoardApiPolicy(),
    correlation: messageBoardCorrelation,
  });
  return Bun.serve({ hostname, port, fetch: handler });
}

if (import.meta.main) {
  const server = startMessageBoardApiHost(listenerOptionsFromEnvironment());
  console.log(`Message board API listening on ${server.url}`);
}
