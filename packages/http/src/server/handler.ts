import type { Assembly } from "@mit-sdg/sync-engine/assembly";
import {
  bindTransport,
  FrameworkErrorCode,
  serializeJsonValue,
  type Gateway,
  type InvocationResult,
} from "@mit-sdg/sync-engine/boundary";
import type { ContractShape } from "@mit-sdg/sync-engine/client";
import { cookieIssues, cookieProtectedPaths, validateHttpCookiePolicy } from "./cookie-policy.ts";
import { httpPolicy, type HttpPolicy } from "./policy.ts";
import {
  publicErrorStatus,
  publicFrameworkCategoryOf,
  registeredPublicCategoryOf,
} from "./public-errors.ts";
import { readCappedUtf8Stream } from "../stream.ts";

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

type RequestTextResult = { ok: true; text: string } | { ok: false };

async function readRequestText(request: Request): Promise<RequestTextResult> {
  const declared = request.headers.get("Content-Length");
  try {
    const result = await readCappedUtf8Stream(
      request.body,
      MAX_BODY_BYTES,
      declared === null ? undefined : Number(declared),
    );
    return "aborted" in result ? { ok: false } : result;
  } catch {
    return { ok: false };
  }
}

type HttpHandlerOptions = {
  gateway: Gateway<ContractShape>;
  application: Application;
  policy: HttpPolicy;
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
  options: HttpHandlerOptions,
): (request: Request) => Promise<Response> {
  const binding = bindTransport({ application: options.application, gateway: options.gateway });
  const policy = httpPolicy(options.policy);
  if (policy.cookie !== undefined) validateHttpCookiePolicy(binding, policy);
  const correlation = normalizeCorrelationOptions(options.correlation);
  const base = policy.basePath ?? "";
  const cookiePolicy = policy.cookie;
  const secure = new URL(policy.origin).protocol === "https:";
  const cookiePath = cookiePolicy?.path ?? "/";
  const cookieDomain = cookiePolicy?.domain;
  const cookieName =
    cookiePolicy === undefined
      ? ""
      : secure
        ? `${cookieDomain === undefined && cookiePath === "/" ? "__Host-" : "__Secure-"}${cookiePolicy.name}`
        : cookiePolicy.name;
  const protectedPaths =
    cookiePolicy === undefined
      ? new Set<string>()
      : cookieProtectedPaths(binding.routes, cookiePolicy.input);
  const issuesByPath = new Map(
    cookiePolicy === undefined
      ? []
      : cookieIssues(cookiePolicy).map((issue) => [issue.path, issue] as const),
  );
  const cookieAttributes =
    `; HttpOnly; SameSite=${cookiePolicy?.sameSite ?? "Strict"}; Path=${cookiePath}` +
    (cookieDomain === undefined ? "" : `; Domain=${cookieDomain}`);
  const cookie = (value: string, expires: Date): string | undefined => {
    if (value.length === 0) return undefined;
    let encoded: string;
    try {
      encoded = encodeURIComponent(value);
    } catch {
      return undefined;
    }
    const serialized =
      `${cookieName}=${encoded}${cookieAttributes}; Expires=${expires.toUTCString()}` +
      (secure ? "; Secure" : "");
    return serialized.length <= 4_096 ? serialized : undefined;
  };
  const clearedCookie = () =>
    `${cookieName}=${cookieAttributes}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0` +
    (secure ? "; Secure" : "");

  return async (request) => {
    const correlationId = correlationIdFor(request, correlation);
    const reply = (response: Response) => withCorrelation(response, correlationId, correlation);
    const invalid = () => reply(publicJson({ error: "INVALID_REQUEST" }, 400));
    const origin = request.headers.get("Origin");
    const allowedOrigins = cookiePolicy?.origins;
    if (
      cookiePolicy !== undefined &&
      allowedOrigins !== false &&
      (origin === null || !(allowedOrigins ?? [policy.origin]).includes(origin))
    ) {
      return reply(publicJson({ error: "FORBIDDEN" }, 403));
    }
    if (request.method !== "POST") return invalid();
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
    if (cookiePolicy !== undefined && protectedPaths.has(path)) {
      if (!isPlainObject(body)) return invalid();
      setOwn(
        body,
        cookiePolicy.input,
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
        const failure = publicFailure(result, policy);
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
      if (cookiePolicy === undefined) return reply(publicJson(value, 200));
      const issue = issuesByPath.get(path);
      if (issue !== undefined) {
        if (!isPlainObject(value)) {
          return reply(publicJson({ error: "INTERNAL_ERROR" }, 500, { noStore: true }));
        }
        const token = value[issue.value];
        const sourceExpiry = value[issue.expires];
        const expires =
          sourceExpiry instanceof Date ? sourceExpiry : new Date(String(sourceExpiry));
        const issuedCookie =
          typeof token === "string" && expires.getTime() > Date.now()
            ? cookie(token, expires)
            : undefined;
        if (issuedCookie === undefined) {
          return reply(publicJson({ error: "INTERNAL_ERROR" }, 500, { noStore: true }));
        }
        const publicValue = Object.fromEntries(
          Object.entries(value).filter(([key]) => key !== issue.value && key !== issue.expires),
        );
        return reply(publicJson(publicValue, 200, { cookie: issuedCookie, noStore: true }));
      }
      if (cookiePolicy.clear?.includes(path)) {
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
  policy: HttpPolicy,
): { error: string; status: number } {
  const category =
    result.error.kind === "framework"
      ? publicFrameworkCategoryOf(result.error.code)
      : registeredPublicCategoryOf(
          typeof result.error.value === "string" ? result.error.value : "",
          policy.publicErrors,
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
