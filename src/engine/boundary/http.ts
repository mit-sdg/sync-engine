import type { InvocationResult } from "./errors.ts";
import { FrameworkErrorCode } from "./errors.ts";
import type { ContractShape } from "./client.ts";
import { serializeEnvelope } from "./envelope.ts";
import type { Invoker } from "./invoke.ts";
import type { Assembly } from "./assembly-facade.ts";
import { assemblyBehind } from "./assembly-registry.ts";
import type { HttpFloor } from "./http-floor.ts";
import { validateHttpFloor } from "./http-floor.ts";

// The body is the flat wire envelope; http adds only the status decoration —
// 200 for success, 400 for a domain error, and the code's own status for a
// framework fault.
function mapResultToResponse(result: InvocationResult): Response {
  const body = serializeEnvelope(result);
  const status = result.ok
    ? 200
    : result.error.kind === "domain"
      ? 400
      : statusFor(result.error.code, 500);
  return new Response(body, {
    status,
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
  const base = options.basePath ?? "";
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

    const result = await target.invoke(path, body as never, {
      signal: request.signal,
    });

    return mapResultToResponse(result);
  };
}

const MAX_BODY_BYTES = 1_048_576;

type FloorHandlerOptions = {
  gateway: Invoker<ContractShape>;
  application: Assembly<Record<string, new (...args: never[]) => object>>;
  floor: HttpFloor;
};

function publicFailure(
  result: Exclude<InvocationResult, { ok: true }>,
  categories: Readonly<Record<string, string>>,
): { error: string; status: number } {
  if (result.error.kind === "framework") {
    switch (result.error.code) {
      case FrameworkErrorCode.NOT_FOUND:
        return { error: "NOT_FOUND", status: 404 };
      case FrameworkErrorCode.INVALID_INPUT:
      case FrameworkErrorCode.BAD_JSON:
      case FrameworkErrorCode.BAD_STATUS:
        return { error: "INVALID_REQUEST", status: 400 };
      default:
        return { error: "INTERNAL_ERROR", status: 500 };
    }
  }
  const code = typeof result.error.value === "string" ? result.error.value : "";
  const category =
    code === "INVALID_REQUEST" ||
    code === "UNAUTHORIZED" ||
    code === "FORBIDDEN" ||
    code === "NOT_FOUND" ||
    code === "CONFLICT"
      ? code
      : (categories[code] ?? "INTERNAL_ERROR");
  const status =
    category === "INVALID_REQUEST"
      ? 400
      : category === "UNAUTHORIZED"
        ? 401
        : category === "FORBIDDEN"
          ? 403
          : category === "NOT_FOUND"
            ? 404
            : category === "CONFLICT"
              ? 409
              : 500;
  return { error: category, status };
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
  const headers = new Headers({ "Content-Type": "application/json" });
  if (options.cookie !== undefined) headers.set("Set-Cookie", options.cookie);
  if (options.noStore === true) headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
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
    const declaredLength = Number(request.headers.get("Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return invalid();

    let path = new URL(request.url).pathname;
    if (!(path in routes) && path.startsWith("/api/")) path = path.slice("/api".length);

    let body: unknown;
    try {
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return invalid();
      body = text === "" ? {} : JSON.parse(text);
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
