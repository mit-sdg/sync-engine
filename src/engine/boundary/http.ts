import type { InvocationResult } from "./errors.ts";
import { FrameworkErrorCode } from "./errors.ts";
import type { ContractShape } from "./client.ts";
import { serializeEnvelope, serializeJsonValue } from "./envelope.ts";
import type { Invoker } from "./invoke.ts";
import type { Assembly } from "./assembly-facade.ts";
import { assemblyBehind } from "./assembly-registry.ts";
import type { HttpFloor } from "./http-floor.ts";
import { validateHttpFloor } from "./http-floor.ts";
import type { PublicErrorCategory } from "@engine/reactions/concept-metadata";
import { publicCategoryOf, publicErrorStatus } from "./public-errors.ts";

// The body is the flat wire envelope; http adds only the status decoration —
// 200 for success, 400 for a domain error, and the code's own status for a
// framework fault.
function mapResultToResponse(result: InvocationResult): Response {
  const status = result.ok
    ? 200
    : result.error.kind === "domain"
      ? 400
      : statusFor(result.error.code, 500);
  const exposed =
    !result.ok && result.error.kind === "framework" && status >= 500
      ? ({
          ok: false,
          error: { kind: "framework", code: result.error.code },
        } satisfies InvocationResult)
      : result;
  let body: string;
  try {
    body = serializeEnvelope(exposed);
  } catch {
    return internalErrorResponse();
  }
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function internalErrorResponse(): Response {
  return new Response(`{"error":"${FrameworkErrorCode.INTERNAL_ERROR}"}`, {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}

function statusFor(code: unknown, fallback = 400): number {
  switch (code) {
    case FrameworkErrorCode.NOT_FOUND:
      return 404;
    case FrameworkErrorCode.INVALID_INPUT:
      return 422;
    case FrameworkErrorCode.TIMED_OUT:
      return 504;
    case FrameworkErrorCode.ABORTED:
      return 499;
    case FrameworkErrorCode.INTERNAL_ERROR:
      return 500;
    default:
      return fallback;
  }
}

const MAX_BODY_BYTES = 1_048_576;

type RequestTextResult =
  | { ok: true; text: string }
  | { ok: false; reason: "too_large" | "unreadable" };

function cancelStream(stream: ReadableStream<Uint8Array> | null): void {
  if (stream !== null) void stream.cancel().catch(() => undefined);
}

async function readRequestText(request: Request): Promise<RequestTextResult> {
  const declared = request.headers.get("Content-Length");
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) {
    cancelStream(request.body);
    return { ok: false, reason: "too_large" };
  }
  if (request.body === null) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return { ok: true, text: parts.join("") };
  } catch {
    return { ok: false, reason: "unreadable" };
  } finally {
    reader.releaseLock();
  }
}

function normalizeBasePath(basePath: string | undefined): string {
  if (basePath === undefined || basePath === "" || basePath === "/") return "";
  if (!basePath.startsWith("/")) throw new TypeError("basePath must start with '/'.");
  return basePath.replace(/\/+$/, "");
}

export function createHttpHandler(
  options:
    | { gateway: Invoker<ContractShape>; basePath?: string }
    | { invoker: Invoker<ContractShape>; basePath?: string }
    | {
        gateway: Invoker<ContractShape>;
        application: Assembly<Record<string, new (...args: never[]) => object>>;
        floor: HttpFloor;
      },
): (request: Request) => Promise<Response> {
  if ("floor" in options) return createFloorHandler(options);
  const base = normalizeBasePath(options.basePath);
  const target = "gateway" in options ? options.gateway : options.invoker;

  return async (request) => {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ error: FrameworkErrorCode.BAD_STATUS, detail: "Method not allowed" }),
        { status: 405, headers: { "Content-Type": "application/json" } },
      );
    }

    const url = new URL(request.url);
    let path = url.pathname;
    if (base !== "" && path !== base && !path.startsWith(`${base}/`)) {
      return new Response(
        JSON.stringify({
          error: FrameworkErrorCode.NOT_FOUND,
          detail: `Unknown endpoint: ${path}`,
        }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
    if (base !== "") {
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
    const requestText = await readRequestText(request);
    if (!requestText.ok) {
      if (requestText.reason === "too_large") {
        return new Response(
          JSON.stringify({
            error: FrameworkErrorCode.INVALID_INPUT,
            detail: "Request body exceeds the 1 MiB limit",
          }),
          { status: 413, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ error: FrameworkErrorCode.BAD_JSON, detail: "Invalid request body" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    try {
      body = requestText.text === "" ? {} : JSON.parse(requestText.text);
    } catch {
      return new Response(
        JSON.stringify({ error: FrameworkErrorCode.BAD_JSON, detail: "Invalid request body" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const result = await target.invoke(path, body as never, {
      signal: request.signal,
    });

    return mapResultToResponse(result);
  };
}

type FloorHandlerOptions = {
  gateway: Invoker<ContractShape>;
  application: Assembly<Record<string, new (...args: never[]) => object>>;
  floor: HttpFloor;
};

function publicFailure(
  result: Exclude<InvocationResult, { ok: true }>,
  categories: Readonly<Record<string, PublicErrorCategory>>,
): { error: string; status: number } {
  const code =
    result.error.kind === "framework"
      ? result.error.code
      : typeof result.error.value === "string"
        ? result.error.value
        : "";
  const category = publicCategoryOf(code, categories);
  return { error: category, status: publicErrorStatus(category) };
}

function cookieValue(header: string | null, name: string): string | undefined {
  if (header === null) return undefined;
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator === -1 || item.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function floorJson(
  body: unknown,
  status: number,
  options: { cookie?: string; noStore?: boolean } = {},
): Response {
  let serialized: string;
  try {
    serialized = serializeJsonValue(body);
  } catch {
    return internalErrorResponse();
  }
  const headers = new Headers({ "Content-Type": "application/json" });
  if (options.cookie !== undefined) headers.set("Set-Cookie", options.cookie);
  if (options.noStore === true) headers.set("Cache-Control", "no-store");
  return new Response(serialized, { status, headers });
}

function createFloorHandler(options: FloorHandlerOptions): (request: Request) => Promise<Response> {
  validateHttpFloor(options.application, options.floor);
  const assembled = assemblyBehind(options.application);
  const routes = assembled.publicInterface.routes;
  const categories = assembled.publicErrors;
  const credential = options.floor.credential;
  const secure = new URL(options.floor.origin).protocol === "https:";
  const cookieName = secure ? `__Host-${credential.name}` : credential.name;
  const protectedPaths = new Set(
    Object.entries(assembled.contracts)
      .filter(([, contract]) => contract.required?.includes(credential.input))
      .map(([path]) => path),
  );

  const cookie = (value: string, expires: Date) =>
    `${cookieName}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; ` +
    `Expires=${expires.toUTCString()}${secure ? "; Secure" : ""}`;
  const clearedCookie = () =>
    `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; ` +
    `Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0${secure ? "; Secure" : ""}`;

  return async (request) => {
    const invalid = () => floorJson({ error: "INVALID_REQUEST" }, 400);
    if (request.method !== "POST") return invalid();
    const origin = request.headers.get("Origin");
    if (origin !== null && origin !== options.floor.origin) {
      return floorJson({ error: "FORBIDDEN" }, 403);
    }
    const contentType = request.headers.get("Content-Type");
    if (contentType !== null && !/^application\/json(?:\s*;|$)/i.test(contentType)) {
      return invalid();
    }
    let path = new URL(request.url).pathname;
    if (!(path in routes) && path.startsWith("/api/")) path = path.slice("/api".length);

    let body: unknown;
    const requestText = await readRequestText(request);
    if (!requestText.ok) return invalid();
    try {
      body = requestText.text === "" ? {} : JSON.parse(requestText.text);
    } catch {
      return invalid();
    }
    if (protectedPaths.has(path)) {
      if (typeof body !== "object" || body === null || Array.isArray(body)) return invalid();
      (body as Record<string, unknown>)[credential.input] =
        cookieValue(request.headers.get("Cookie"), cookieName) ?? null;
    }

    const result = await options.gateway.invoke(path, body as never, { signal: request.signal });
    if (!result.ok) {
      const failure = publicFailure(result, categories);
      const clear = protectedPaths.has(path) && failure.error === "UNAUTHORIZED";
      return floorJson(
        { error: failure.error },
        failure.status,
        clear ? { cookie: clearedCookie(), noStore: true } : {},
      );
    }

    const value = result.value;
    if (path === credential.issue.path) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return floorJson({ error: "INTERNAL_ERROR" }, 500);
      }
      const record = value as Record<string, unknown>;
      const token = record[credential.issue.output];
      const sourceExpiry = record[credential.issue.expires];
      const expires = sourceExpiry instanceof Date ? sourceExpiry : new Date(String(sourceExpiry));
      if (typeof token !== "string" || Number.isNaN(expires.getTime())) {
        return floorJson({ error: "INTERNAL_ERROR" }, 500);
      }
      const publicValue = Object.fromEntries(
        Object.entries(record).filter(
          ([key]) => key !== credential.issue.output && key !== credential.issue.expires,
        ),
      );
      return floorJson(publicValue, 200, { cookie: cookie(token, expires), noStore: true });
    }
    if (credential.clear.includes(path)) {
      return floorJson(value, 200, { cookie: clearedCookie(), noStore: true });
    }
    return floorJson(value, 200);
  };
}
