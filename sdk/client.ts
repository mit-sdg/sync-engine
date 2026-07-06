/**
 * # Type-safe client (Eden Treaty style)
 *
 * {@link createClient} returns a Proxy-based client whose **types are fully
 * inferred from a contract type parameter**. This module is entirely generic and
 * app-agnostic: it is never edited when endpoints are added or changed. The
 * concrete binding to an app contract happens at the call site, e.g.
 * `createClient<EdumenApi>()`.
 *
 * Two equivalent calling styles are supported, both terminating in a single
 * `POST {baseUrl}{path}` request:
 *
 * ```ts
 * const api = createClient<EdumenApi>();
 *
 * // grouped — property access mirrors the path segments
 * await api.auth.login({ username, password });
 * await api.students.create({ session, name, surname });
 *
 * // indexed — the full path as a single key
 * await api["/auth/login"]({ username, password });
 * ```
 *
 * ## Error handling
 *
 * Every method resolves to the endpoint's success payload **or** an `{ error }`
 * envelope, and **never throws**. Backend-shaped errors (invalid session, not
 * found, ...) arrive as `{ error }` unchanged; transport failures (network down,
 * non-JSON body, non-2xx without an error body) are normalized into the same
 * `{ error }` shape. Callers discriminate with `"error" in result`.
 */

import { FrameworkErrorCode } from "./error-codes.ts";

/** The error shape the client normalizes transport failures into. */
export type ClientError = { error: string; detail?: string };

/**
 * The structural shape any contract type must satisfy: a record mapping each
 * path to its `{ input; output }` pair. {@link createClient} is generic over a
 * concrete contract assignable to this.
 */
export type ContractShape = Record<string, { input: unknown; output: unknown }>;

/** A header bag, or a (possibly async) function producing one per request. */
export type HeadersOption =
  | Record<string, string>
  | (() => Record<string, string> | Promise<Record<string, string>>);

/** Options for {@link createClient}. All fields are optional. */
export interface ClientOptions {
  /**
   * Base URL every request is prefixed with, including the `/api` segment.
   * Defaults to `API_BASE_URL`, then `/api`.
   */
  baseUrl?: string;
  /**
   * `fetch` implementation to use. Defaults to the global `fetch`. Useful for
   * injecting a mock or a server-side polyfill.
   */
  fetch?: typeof fetch;
  /**
   * Extra headers merged into every request (after `Content-Type`). Provide a
   * function to compute them per call, e.g. to attach a rotating auth token.
   */
  headers?: HeadersOption;
  /**
   * Request credentials mode. Defaults to `"include"` so cookies (including
   * HttpOnly session cookies) are sent automatically. Override with `"omit"`
   * or `"same-origin"` if needed.
   */
  credentials?: "include" | "omit" | "same-origin";
}

/**
 * A terminal endpoint method: takes the path's typed input and resolves to its
 * success payload or a {@link ClientError}.
 */
export type Endpoint<C extends ContractShape, P extends keyof C> = (
  input: C[P]["input"],
) => Promise<C[P]["output"] | ClientError>;

// Path-string surgery used to build the grouped view from the flat contract.
type Group<P extends string> = P extends `/${infer G}/${string}` ? G : never;
type Method<P extends string> = P extends `/${string}/${infer M}` ? M : never;

/** The indexed surface: `client["/auth/login"](input)`. */
export type IndexedClient<C extends ContractShape> = {
  [P in keyof C & string]: Endpoint<C, P>;
};

/** The grouped surface: `client.auth.login(input)`. */
export type GroupedClient<C extends ContractShape> = {
  [G in Group<keyof C & string>]: {
    [P in keyof C & string as Group<P> extends G ? Method<P> : never]: Endpoint<
      C,
      P
    >;
  };
};

/**
 * The full client type for a contract `C`. Both calling styles coexist because
 * the contract paths (`/group/method`) cleanly split into a flat index and a
 * two-level grouping.
 */
export type Client<C extends ContractShape> = IndexedClient<C> &
  GroupedClient<C>;

const FALLBACK_BASE_URL = "/api";

function cleanBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

function configuredBaseUrl(): string | undefined {
  try {
    return cleanBaseUrl(process.env.API_BASE_URL);
  } catch {
    return undefined;
  }
}

function resolveBaseUrl(baseUrl: string | undefined): string {
  return (
    cleanBaseUrl(baseUrl) ??
    configuredBaseUrl() ??
    FALLBACK_BASE_URL
  ).replace(/\/$/, "");
}

/**
 * Builds the request path from accumulated proxy segments. A single segment
 * that already looks like a full path (`/auth/login`, used by the indexed
 * style) is taken verbatim; otherwise segments are joined (`["auth","login"]`
 * → `/auth/login`, the grouped style).
 */
function buildPath(segments: string[]): string {
  if (segments.length === 1 && segments[0].startsWith("/")) return segments[0];
  return `/${segments.join("/")}`;
}

/**
 * Performs the actual POST and normalizes the outcome into a `Result`-shaped
 * value. Never throws: transport/parse failures become `{ error }`.
 */
async function request(
  fetchImpl: typeof fetch,
  baseUrl: string,
  headersOption: HeadersOption | undefined,
  credentials: "include" | "omit" | "same-origin" | undefined,
  path: string,
  body: unknown,
): Promise<unknown> {
  let extraHeaders: Record<string, string> = {};
  try {
    extraHeaders =
      typeof headersOption === "function"
        ? await headersOption()
        : (headersOption ?? {});
  } catch (e) {
    return {
      error: FrameworkErrorCode.HEADER_RESOLUTION_FAILED,
      detail: describe(e),
    };
  }

  let response: Response;
  try {
    response = await fetchImpl(baseUrl + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify(body ?? {}),
      credentials: credentials ?? "include",
    });
  } catch (e) {
    return {
      error: FrameworkErrorCode.NETWORK_ERROR,
      detail: `Network request to ${path} failed: ${describe(e)}`,
    };
  }

  const text = await response.text().catch(() => "");
  let data: unknown;
  try {
    data = text === "" ? {} : JSON.parse(text);
  } catch {
    return {
      error: FrameworkErrorCode.BAD_JSON,
      detail: `Invalid JSON response from ${path} (status ${response.status}).`,
    };
  }

  // Pass the body through when it is already a usable object (success payload
  // or the backend's own `{ error }` envelope). Only synthesize an error when a
  // non-2xx response carried nothing actionable.
  if (
    !response.ok &&
    (typeof data !== "object" || data === null || !("error" in data))
  ) {
    return {
      error: FrameworkErrorCode.BAD_STATUS,
      detail: `Request to ${path} failed with status ${response.status}.`,
    };
  }
  return data;
}

/** Renders an unknown thrown value as a short string for error envelopes. */
function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Creates a recursive, callable Proxy that accumulates path segments on
 * property access and issues the request when finally invoked. The target is a
 * function so the proxy is itself callable (supporting the terminal call) while
 * still trapping `get` for further segment accumulation.
 */
function makeProxy(
  segments: string[],
  call: (path: string, body: unknown) => Promise<unknown>,
): unknown {
  const fn = (body: unknown) => call(buildPath(segments), body);
  return new Proxy(fn, {
    get(_target, prop) {
      // Symbols and promise-detection keys must not extend the path, otherwise
      // an intermediate proxy could be mistaken for a thenable and awaited.
      if (typeof prop !== "string" || prop === "then") return undefined;
      return makeProxy([...segments, prop], call);
    },
    apply(_target, _thisArg, args) {
      return call(buildPath(segments), args[0]);
    },
  });
}

/**
 * Creates a typed API client for a contract `C`. The returned value supports
 * both the grouped (`client.auth.login(...)`) and indexed
 * (`client["/auth/login"](...)`) styles, each fully inferred from `C`.
 *
 * Callers pass their app contract type explicitly, e.g.
 * `createClient<EdumenApi>()`.
 */
export function createClient<C extends ContractShape>(
  options: ClientOptions = {},
): Client<C> {
  const baseUrl = resolveBaseUrl(options.baseUrl);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const credentials = options.credentials;
  const call = (path: string, body: unknown) =>
    request(fetchImpl, baseUrl, options.headers, credentials, path, body);
  return makeProxy([], call) as Client<C>;
}
