import type { Assembly } from "@mit-sdg/sync-engine/assembly";
import { bindTransport, type Gateway, type InvocationResult } from "@mit-sdg/sync-engine/boundary";
import type { ContractShape } from "@mit-sdg/sync-engine/client";
import { validateCookieBindings, type ValidatedCookieBinding } from "../policy/cookies.ts";
import { matchDirectRoute, type CompiledDirectRoute } from "../policy/direct.ts";
import { requireHttpPolicy } from "../policy/normalize.ts";
import type { HttpPolicy } from "../policy/types.ts";
import { cancelReadable } from "../stream.ts";
import { clearedCookie, cookieValue, issuedCookie } from "./cookie-runtime.ts";
import { preflightAllowed, withCors } from "./cors.ts";
import {
  publicErrorStatus,
  publicFrameworkCategoryOf,
  registeredPublicCategoryOf,
} from "./public-errors.ts";
import { isPlainObject, readRequestText, setOwn } from "./request.ts";
import {
  internalErrorResponse,
  isReservedResponseHeader,
  publicJson,
  withResponseHeaders,
  type HttpResponseHeaders,
  type HttpResponseHeadersContext,
} from "./response.ts";

const DEFAULT_MAX_BODY_BYTES = 1_048_576;
type Application = Assembly<Record<string, new (...args: never[]) => object>>;

export interface HttpCorrelationOptions {
  resolve(request: Request): string | undefined;
  responseHeader?: string;
}

export interface HttpHandlerOptions {
  readonly gateway: Gateway<ContractShape>;
  readonly application: Application;
  readonly policy?: HttpPolicy;
  readonly correlation?: HttpCorrelationOptions;
  readonly responseHeaders?: HttpResponseHeaders;
}

function normalizeCorrelationOptions(
  options: HttpCorrelationOptions | undefined,
): HttpCorrelationOptions | undefined {
  if (options === undefined) return undefined;
  if (options.responseHeader !== undefined) {
    try {
      new Headers().set(options.responseHeader, "correlation");
    } catch {
      throw new Error("createHttpHandler: correlation.responseHeader must be a valid header name.");
    }
    if (isReservedResponseHeader(options.responseHeader)) {
      throw new Error("createHttpHandler: correlation.responseHeader is reserved by HTTP policy.");
    }
  }
  return Object.freeze({ ...options });
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
  for (let index = 0; index < resolved.length; index += 1) {
    const code = resolved.charCodeAt(index);
    if (code < 32 || code === 127 || code > 255) return crypto.randomUUID();
  }
  return resolved.startsWith(" ") || resolved.endsWith(" ") ? crypto.randomUUID() : resolved;
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
      // Correlation decoration must not replace a handled response.
    }
  }
  return response;
}

function pathFrom(request: Request, basePath: string): string | undefined {
  let path = new URL(request.url).pathname;
  if (basePath !== "") {
    if (path !== basePath && !path.startsWith(`${basePath}/`)) return undefined;
    path = path.slice(basePath.length);
  }
  return path.startsWith("/") && path !== "" ? path : undefined;
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

function originRejected(
  request: Request,
  path: string,
  bindings: readonly ValidatedCookieBinding[],
  policy: HttpPolicy,
): boolean {
  if (policy.requestOrigins === false || policy.requestOrigins === undefined) return false;
  if (!bindings.some((binding) => binding.touchedPaths.has(path))) return false;
  const origin = request.headers.get("Origin");
  if (origin === null) return policy.requestOrigins.requireOrigin === true;
  return !policy.requestOrigins.allowed.includes(origin);
}

/** Create a Fetch handler for one assembled application and gateway. */
export function createHttpHandler(
  options: HttpHandlerOptions,
): (request: Request) => Promise<Response> {
  const policy = requireHttpPolicy(options.policy, "createHttpHandler");
  const binding = bindTransport({ application: options.application, gateway: options.gateway });
  const cookies = policy.cookies === undefined ? [] : validateCookieBindings(binding, policy);
  const correlation = normalizeCorrelationOptions(options.correlation);
  const responseHeaders =
    typeof options.responseHeaders === "function" || options.responseHeaders === undefined
      ? options.responseHeaders
      : new Headers(options.responseHeaders);
  const basePath = policy.basePath ?? "";
  const applicationPaths = new Set(Object.keys(options.application.publicInterface.routes));
  const directRoutes = policy.direct as readonly CompiledDirectRoute[] | undefined;
  const maxBodyBytes = policy.limits?.requestBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const preflightPaths =
    policy.browser === undefined
      ? undefined
      : new Set([
          ...Object.keys(binding.routes),
          ...binding.logicalWire.endpoints.map(({ path }) => path),
        ]);

  return async (request) => {
    const correlationId = correlationIdFor(request, correlation);
    const path = pathFrom(request, basePath);
    const finish = async (response: Response, preflight = false): Promise<Response> => {
      const decorated = await withResponseHeaders(response, responseHeaders, {
        request,
        path,
        status: response.status,
        ...(correlationId === undefined ? {} : { correlationId }),
      });
      const safe = decorated ?? internalErrorResponse();
      return withCors(
        withCorrelation(safe, correlationId, correlation),
        request,
        policy.browser,
        preflight,
      );
    };
    const discardUnreadBody = (): void => {
      if (!request.bodyUsed) cancelReadable(request.body);
    };
    const finishUnread = (response: Response, preflight = false): Promise<Response> => {
      discardUnreadBody();
      return finish(response, preflight);
    };
    const invalid = () => finishUnread(publicJson({ error: "INVALID_REQUEST" }, 400));
    if (request.method === "OPTIONS" && policy.browser !== undefined) {
      const accepted =
        path !== undefined &&
        preflightPaths?.has(path) === true &&
        preflightAllowed(request, policy.browser);
      return finishUnread(
        accepted ? new Response(null, { status: 204 }) : publicJson({ error: "FORBIDDEN" }, 403),
        true,
      );
    }
    const direct =
      path === undefined ? undefined : matchDirectRoute(directRoutes, request.method, path);
    if (direct === undefined && request.method !== "POST") return invalid();
    if (path === undefined) return finishUnread(publicJson({ error: "NOT_FOUND" }, 404));
    if (direct !== undefined) {
      discardUnreadBody();
      let served: InvocationResult;
      try {
        served = await binding.invoker.invoke(direct.route.endpoint, direct.input as never, {
          signal: request.signal,
          correlationId,
        });
      } catch {
        return finish(internalErrorResponse());
      }
      if (!served.ok) {
        const failure = publicFailure(served, policy);
        return finish(publicJson({ error: failure.error }, failure.status));
      }
      return finish(directResponse(direct.route, served.value));
    }
    if (!applicationPaths.has(path)) {
      return finishUnread(publicJson({ error: "NOT_FOUND" }, 404));
    }
    if (originRejected(request, path, cookies, policy)) {
      return finishUnread(publicJson({ error: "FORBIDDEN" }, 403));
    }
    const contentType = request.headers.get("Content-Type");
    if (contentType !== null && !/^application\/json(?:\s*;|$)/i.test(contentType)) {
      return invalid();
    }
    const requestText = await readRequestText(request, maxBodyBytes);
    if (!requestText.ok) return invalid();
    let body: unknown;
    try {
      body = requestText.text === "" ? {} : JSON.parse(requestText.text);
    } catch {
      return invalid();
    }
    for (const cookie of cookies) {
      if (!cookie.protectedPaths.has(path)) continue;
      if (!isPlainObject(body)) return invalid();
      setOwn(
        body,
        cookie.binding.input,
        cookieValue(request.headers.get("Cookie"), cookie.cookieName) ?? null,
      );
    }

    let result: InvocationResult;
    try {
      result = await binding.invoker.invoke(path, body as never, {
        signal: request.signal,
        correlationId,
      });
    } catch {
      return finish(internalErrorResponse());
    }
    try {
      if (!result.ok) {
        const failure = publicFailure(result, policy);
        const cleared =
          failure.error === "UNAUTHORIZED"
            ? cookies.filter((cookie) => cookie.protectedPaths.has(path)).map(clearedCookie)
            : [];
        return finish(
          publicJson(
            { error: failure.error },
            failure.status,
            cleared.length === 0 ? {} : { cookies: cleared, noStore: true },
          ),
        );
      }

      const issuing = cookies.filter((cookie) => cookie.issuePaths.has(path));
      const clearing = cookies.filter((cookie) => cookie.clearPaths.has(path));
      if (issuing.length === 0 && clearing.length === 0)
        return finish(publicJson(result.value, 200));
      if (issuing.length > 0 && !isPlainObject(result.value)) {
        return finish(internalErrorResponse());
      }
      const issuedValue = result.value as Record<string, unknown>;
      const omitted = new Set<string>();
      const setCookies: string[] = clearing.map(clearedCookie);
      for (const cookie of issuing) {
        const issue = cookie.binding.issue.find((candidate) => candidate.path === path);
        if (issue === undefined) continue;
        const serialized = issuedCookie(
          cookie,
          issuedValue[issue.value],
          issuedValue[issue.expires],
        );
        if (serialized === undefined) return finish(internalErrorResponse());
        setCookies.push(serialized);
        omitted.add(issue.value);
        omitted.add(issue.expires);
      }
      const publicValue =
        issuing.length === 0
          ? result.value
          : Object.fromEntries(Object.entries(issuedValue).filter(([key]) => !omitted.has(key)));
      return finish(publicJson(publicValue, 200, { cookies: setCookies, noStore: true }));
    } catch {
      return finish(internalErrorResponse());
    }
  };
}

/** Render a direct route's value: a redirect when declared, otherwise its JSON body. */
function directResponse(route: CompiledDirectRoute, value: unknown): Response {
  if (route.redirect === undefined) return publicJson(value, route.status ?? 200);
  if (!isPlainObject(value)) return internalErrorResponse();
  const target = (value as Record<string, unknown>)[route.redirect];
  if (typeof target !== "string" || target === "") return internalErrorResponse();
  try {
    return new Response(null, {
      status: route.status ?? 302,
      headers: { Location: new URL(target).toString() },
    });
  } catch {
    return internalErrorResponse();
  }
}

export type { HttpResponseHeadersContext };
