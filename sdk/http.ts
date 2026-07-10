import type { InvocationResult } from "./errors.ts";
import { FrameworkErrorCode } from "./errors.ts";
import type { ContractShape } from "./client.ts";
import type { Invoker } from "./invoke.ts";

function mapResultToResponse(result: InvocationResult): Response {
  if (result.ok) {
    return new Response(JSON.stringify(result.value), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (result.error.kind === "domain") {
    return new Response(JSON.stringify(result.error.value), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const code = result.error.code;
  const body = JSON.stringify({
    error: code,
    ...(result.error.detail !== undefined ? { detail: result.error.detail } : {}),
  });

  switch (code) {
    case FrameworkErrorCode.NOT_FOUND:
      return new Response(body, { status: 404, headers: { "Content-Type": "application/json" } });
    case FrameworkErrorCode.TIMED_OUT:
      return new Response(body, { status: 504, headers: { "Content-Type": "application/json" } });
    case FrameworkErrorCode.INVALID_INPUT:
      return new Response(body, { status: 422, headers: { "Content-Type": "application/json" } });
    default:
      return new Response(body, { status: 500, headers: { "Content-Type": "application/json" } });
  }
}

export function createHttpHandler(options: {
  invoker: Invoker<ContractShape>;
  basePath?: string;
}): (request: Request) => Promise<Response> {
  const base = options.basePath ?? "";

  return async (request) => {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ error: FrameworkErrorCode.BAD_STATUS, detail: "Method not allowed" }),
        { status: 405, headers: { "Content-Type": "application/json" } },
      );
    }

    const url = new URL(request.url);
    let path = url.pathname;
    if (base !== "" && path.startsWith(base)) {
      path = path.slice(base.length);
    }

    if (!path.startsWith("/") || path === "") {
      return new Response(
        JSON.stringify({
          error: FrameworkErrorCode.NOT_FOUND,
          detail: `Unknown endpoint: ${path}`,
        }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    let body: unknown;
    try {
      const text = await request.text();
      body = text === "" ? {} : JSON.parse(text);
    } catch {
      return new Response(
        JSON.stringify({ error: FrameworkErrorCode.BAD_JSON, detail: "Invalid request body" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const result = await options.invoker.invoke(path, body as never, {
      signal: request.signal,
    });

    return mapResultToResponse(result);
  };
}
