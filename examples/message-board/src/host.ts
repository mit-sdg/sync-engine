import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Server } from "bun";
import { createHttpHandler } from "@mit-sdg/sync-engine-http/handler";
import { createMessageBoard } from "./application.ts";
import { messageBoardCorrelation, messageBoardHttpPolicy } from "./edge.ts";
import {
  listenerOptionsFromEnvironment,
  publicOriginFor,
  validateHostname,
  validateHttpOrigin,
  validatePort,
} from "./host-config.ts";

export interface MessageBoardHostOptions {
  readonly hostname?: string;
  readonly port?: number;
  readonly publicOrigin?: string;
}

export async function startMessageBoardHost({
  hostname = "localhost",
  port = 3000,
  publicOrigin,
}: MessageBoardHostOptions = {}): Promise<Server<undefined>> {
  validateHostname(hostname);
  validatePort(port);
  const effectivePublicOrigin = validateHttpOrigin(
    publicOrigin ?? publicOriginFor(hostname, port),
    "publicOrigin",
  );
  const policy = messageBoardHttpPolicy(effectivePublicOrigin);
  const { application, gateway } = createMessageBoard();
  const handler = createHttpHandler({
    application,
    gateway,
    policy,
    correlation: messageBoardCorrelation,
  });
  const [html, bundle] = await Promise.all([
    readFile(new URL("./web/index.html", import.meta.url), "utf8"),
    Bun.build({
      entrypoints: [fileURLToPath(new URL("./web/client.ts", import.meta.url))],
      target: "browser",
      minify: true,
    }),
  ]);
  if (!bundle.success || bundle.outputs.length !== 1) {
    throw new Error(`Could not build browser client: ${bundle.logs.join("\n")}`);
  }
  const javascript = await bundle.outputs[0].text();

  return Bun.serve({
    hostname,
    port,
    fetch(request) {
      const pathname = new URL(request.url).pathname;
      if (pathname.startsWith("/api/")) return handler(request);
      if (request.method !== "GET") {
        return new Response("Method not allowed", { status: 405 });
      }
      if (pathname === "/" || pathname === "/index.html") {
        return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      if (pathname === "/app.js") {
        return new Response(javascript, {
          headers: { "Content-Type": "text/javascript; charset=utf-8" },
        });
      }
      return new Response("Not found", { status: 404 });
    },
  });
}

if (import.meta.main) {
  const listener = listenerOptionsFromEnvironment();
  const server = await startMessageBoardHost({
    ...listener,
    ...(process.env.PUBLIC_ORIGIN === undefined
      ? {}
      : { publicOrigin: validateHttpOrigin(process.env.PUBLIC_ORIGIN, "PUBLIC_ORIGIN") }),
  });
  console.log(`Message board listening on ${server.url}`);
}
