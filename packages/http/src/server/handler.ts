import type { Assembly } from "@mit-sdg/sync-engine/assembly";
import {
  bindTransport,
  FrameworkErrorCode,
  serializeJsonValue,
  type Gateway,
  type InvocationResult,
} from "@mit-sdg/sync-engine/boundary";
import type { ContractShape } from "@mit-sdg/sync-engine/client";
import type { HttpFloor } from "./floor.ts";
import { credentialProtectedPaths, validateHttpFloor } from "./floor.ts";
import type { ProductionHttpProfile } from "./policy.ts";
import { normalizeHttpBasePath, normalizeProductionHttpProfile } from "./policy.ts";
import {
  publicErrorStatus,
  publicFrameworkCategoryOf,
  registeredPublicCategoryOf,
} from "./public-errors.ts";

type Application = Assembly<Record<string, new (...args: never[]) => object>>;

function internalErrorResponse(): Response {
  return new Response(`{"error":"${FrameworkErrorCode.INTERNAL_ERROR}"}`, {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}

const MAX_BODY_BYTES = 1_048_576;

export interface HttpCorrelationOptions {
  resolve(request: Request): string | undefined;
  responseHeader?: string;
}

function normalizeCorrelationOptions(
  options: HttpCorrelationOptions | undefined,
): HttpCorrelationOptions | undefined {
  if (options === undefined) return undefined;
  const resolve = options.resolve;
  const responseHeader = options.responseHeader;
  if (responseHeader !== undefined) {
    try {
      new Headers().set(responseHeader, "correlation");
    } catch {
      throw new Error("createHttpHandler: correlation.responseHeader must be a valid header name.");
    }
  }
  return { resolve, ...(responseHeader === undefined ? {} : { responseHeader }) };
}

function correlationIdFor(
  request: Request,
  options: HttpCorrelationOptions | undefined,
): string | undefined {
  if (options === undefined) return undefined;
  let resolved: string | undefined;
  try {
    resolved = options.resolve(request);
  } catch {
    resolved = undefined;
  }
  if (typeof resolved !== "string" || resolved.length === 0 || resolved.length > 128) {
    return crypto.randomUUID();
  }
  for (let index = 0; index < resolved.length; index++) {
    const code = resolved.charCodeAt(index);
    if (code < 32 || code === 127 || code > 255) return crypto.randomUUID();
  }
  if (resolved.startsWith(" ") || resolved.endsWith(" ")) return crypto.randomUUID();
  return resolved;
}

function withCorrelation(
  response: Response,
  correlationId: string | undefined,
  options: HttpCorrelationOptions | undefined,
): Response {
  const header = options?.responseHeader;
  if (correlationId !== undefined && header !== undefined && !response.headers.has(header)) {
    try {
      response.headers.set(header, correlationId);
    } catch {
      // Correlation decoration must not turn an otherwise handled request into a rejection.
    }
  }
  return response;
}

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

type FloorHandlerOptions = {
  gateway: Gateway<ContractShape>;
  application: Application;
  floor: HttpFloor;
  correlation?: HttpCorrelationOptions;
};

type ProfileHandlerOptions = {
  gateway: Gateway<ContractShape>;
  application: Application;
  profile: ProductionHttpProfile;
  correlation?: HttpCorrelationOptions;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

export function createHttpHandler(
  options: FloorHandlerOptions | ProfileHandlerOptions,
): (request: Request) => Promise<Response> {
  const binding = bindTransport({ application: options.application, gateway: options.gateway });
  const floor = "floor" in options ? options.floor : undefined;
  if (floor !== undefined) validateHttpFloor(binding, floor);
  const correlation = normalizeCorrelationOptions(options.correlation);
  const declaration = "floor" in options ? options.floor : options.profile;
  const profile = normalizeProductionHttpProfile(
    declaration,
    floor === undefined ? "productionHttpProfile" : "httpFloor",
    floor === undefined ? "" : " for secure cookies",
  );
  const base = normalizeHttpBasePath(profile.basePath);
  const credential = floor?.credential;
  const secure = new URL(profile.origin).protocol === "https:";
  const cookieName =
    credential === undefined ? "" : secure ? `__Host-${credential.name}` : credential.name;
  const protectedPaths =
    credential === undefined
      ? new Set<string>()
      : credentialProtectedPaths(binding.routes, credential.input);

  const cookie = (value: string, expires: Date) =>
    `${cookieName}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; ` +
    `Expires=${expires.toUTCString()}${secure ? "; Secure" : ""}`;
  const clearedCookie = () =>
    `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; ` +
    `Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0${secure ? "; Secure" : ""}`;

  return async (request) => {
    const correlationId = correlationIdFor(request, correlation);
    const reply = (response: Response) => withCorrelation(response, correlationId, correlation);
    const invalid = () => reply(publicJson({ error: "INVALID_REQUEST" }, 400));
    if (request.method !== "POST") return invalid();
    const origin = request.headers.get("Origin");
    if (floor !== undefined && origin !== null && origin !== profile.origin) {
      return reply(publicJson({ error: "FORBIDDEN" }, 403));
    }
    const contentType = request.headers.get("Content-Type");
    if (contentType !== null && !/^application\/json(?:\s*;|$)/i.test(contentType)) {
      return invalid();
    }
    let path = new URL(request.url).pathname;
    if (base !== "") {
      if (path !== base && !path.startsWith(`${base}/`)) {
        return reply(publicJson({ error: "NOT_FOUND" }, 404));
      }
      path = path.slice(base.length);
    }
    if (!path.startsWith("/") || path === "") {
      return reply(publicJson({ error: "NOT_FOUND" }, 404));
    }

    let body: unknown;
    const requestText = await readRequestText(request);
    if (!requestText.ok) return invalid();
    try {
      body = requestText.text === "" ? {} : JSON.parse(requestText.text);
    } catch {
      return invalid();
    }
    if (credential !== undefined && protectedPaths.has(path)) {
      if (!isPlainObject(body)) return invalid();
      setOwn(
        body,
        credential.input,
        cookieValue(request.headers.get("Cookie"), cookieName) ?? null,
      );
    }

    let result: InvocationResult;
    try {
      result = await binding.invoker.invoke(path, body as never, {
        signal: request.signal,
        correlationId,
      });
    } catch {
      return reply(internalErrorResponse());
    }
    try {
      if (!result.ok) {
        const failure = publicFailure(result, profile);
        const clear = protectedPaths.has(path) && failure.error === "UNAUTHORIZED";
        return reply(
          publicJson(
            { error: failure.error },
            failure.status,
            clear ? { cookie: clearedCookie(), noStore: true } : {},
          ),
        );
      }

      const value = result.value;
      if (credential === undefined) return reply(publicJson(value, 200));
      if (path === credential.issue.path) {
        if (!isPlainObject(value)) {
          return reply(publicJson({ error: "INTERNAL_ERROR" }, 500));
        }
        const token = value[credential.issue.output];
        const sourceExpiry = value[credential.issue.expires];
        const expires =
          sourceExpiry instanceof Date ? sourceExpiry : new Date(String(sourceExpiry));
        if (typeof token !== "string" || Number.isNaN(expires.getTime())) {
          return reply(publicJson({ error: "INTERNAL_ERROR" }, 500));
        }
        const publicValue = Object.fromEntries(
          Object.entries(value).filter(
            ([key]) => key !== credential.issue.output && key !== credential.issue.expires,
          ),
        );
        return reply(
          publicJson(publicValue, 200, { cookie: cookie(token, expires), noStore: true }),
        );
      }
      if (credential.clear.includes(path)) {
        return reply(publicJson(value, 200, { cookie: clearedCookie(), noStore: true }));
      }
      return reply(publicJson(value, 200));
    } catch {
      return reply(internalErrorResponse());
    }
  };
}

function publicFailure(
  result: Exclude<InvocationResult, { ok: true }>,
  profile: ProductionHttpProfile,
): { error: string; status: number } {
  const category =
    result.error.kind === "framework"
      ? publicFrameworkCategoryOf(result.error.code)
      : registeredPublicCategoryOf(
          typeof result.error.value === "string" ? result.error.value : "",
          profile.publicErrors,
        );
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

function publicJson(
  body: unknown,
  status: number,
  options: { cookie?: string; noStore?: boolean } = {},
): Response {
  try {
    const serialized = serializeJsonValue(body);
    const headers = new Headers({ "Content-Type": "application/json" });
    if (options.cookie !== undefined) headers.set("Set-Cookie", options.cookie);
    if (options.noStore === true) headers.set("Cache-Control", "no-store");
    return new Response(serialized, { status, headers });
  } catch {
    return internalErrorResponse();
  }
}
