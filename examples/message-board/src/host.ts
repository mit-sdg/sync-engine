import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Server } from "bun";
import { buildMessageBoard, messageBoardHttpPolicy } from "./edge.ts";

export interface MessageBoardHostOptions {
  readonly hostname?: string;
  readonly port?: number;
}

export async function startMessageBoardHost({
  hostname = "localhost",
  port = 3000,
}: MessageBoardHostOptions = {}): Promise<Server<undefined>> {
  const publicHostname = hostname.includes(":") ? `[${hostname}]` : hostname;
  const policy = messageBoardHttpPolicy(`http://${publicHostname}:${port}`);
  const [{ handler }, html, bundle] = await Promise.all([
    Promise.resolve(buildMessageBoard({}, policy)),
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
  const server = await startMessageBoardHost({
    hostname: process.env.HOST ?? "localhost",
    port: Number(process.env.PORT ?? 3000),
  });
  console.log(`Message board listening on ${server.url}`);
}
