/**
 * # HTTP transport adapter
 *
 * Wraps the transport-agnostic {@link ./client.ts} core with HTTP-specific
 * behavior: `fetch`, `baseUrl`, headers, credentials, JSON parsing, and error
 * normalization. Use {@link createHttpClient} for the common case or
 * {@link createHttpTransport} to compose the transport with a custom client
 * setup.
 */

import { FrameworkErrorCode } from "../protocol/errors.ts";
import type { ContractShape } from "../protocol/contract-shape.ts";
import type { Client, ClientTransport } from "./client.ts";
import { createClient } from "./client.ts";

export type { ClientError } from "./client.ts";

/** A header bag, or a (possibly async) function producing one per request. */
export type HeadersOption =
  | Record<string, string>
  | (() => Record<string, string> | Promise<Record<string, string>>);

/** Options for {@link createHttpTransport} and {@link createHttpClient}. */
export interface HttpClientOptions {
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

const FALLBACK_BASE_URL = "/api";

function cleanBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === "") return undefined;
  if (trimmed === "/") return "";
  return trimmed.replace(/\/+$/, "");
}

function configuredBaseUrl(): string | undefined {
  try {
    return cleanBaseUrl(process.env.API_BASE_URL);
  } catch {
    return undefined;
  }
}

function resolveBaseUrl(baseUrl: string | undefined): string {
  return baseUrl === undefined
    ? (configuredBaseUrl() ?? FALLBACK_BASE_URL)
    : (cleanBaseUrl(baseUrl) ?? FALLBACK_BASE_URL);
}

/**
 * Builds the HTTP `fetch` invocation for a single client request. Never
 * throws: transport/parse failures become `{ error }` envelopes.
 */
async function httpRequest(
  fetchImpl: typeof fetch,
  baseUrl: string,
  headersOption: HeadersOption | undefined,
  credentials: "include" | "omit" | "same-origin" | undefined,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  let extraHeaders: Record<string, string> = {};
  try {
    extraHeaders =
      typeof headersOption === "function" ? await headersOption() : (headersOption ?? {});
  } catch {
    return { error: FrameworkErrorCode.HEADER_RESOLUTION_FAILED };
  }

  let response: Response;
  try {
    response = await fetchImpl(baseUrl + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify(body ?? {}),
      credentials: credentials ?? "include",
      signal,
    });
  } catch {
    return {
      error:
        signal?.aborted === true ? FrameworkErrorCode.ABORTED : FrameworkErrorCode.NETWORK_ERROR,
    };
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    return {
      error: FrameworkErrorCode.BAD_JSON,
      detail: `Failed to read response body from ${path} (status ${response.status}).`,
    };
  }
  let data: unknown;
  try {
    data = text === "" ? {} : JSON.parse(text);
  } catch {
    return {
      error: FrameworkErrorCode.BAD_JSON,
      detail: `Invalid JSON response from ${path} (status ${response.status}).`,
    };
  }

  if (!response.ok && (typeof data !== "object" || data === null || !("error" in data))) {
    return {
      error: FrameworkErrorCode.BAD_STATUS,
      detail: `Request to ${path} failed with status ${response.status}.`,
    };
  }
  return data;
}

/**


 * Creates an HTTP {@link ClientTransport} that uses `fetch` with the given
 * options. The returned transport can be passed directly to
 * {@link createClient}.
 */
export function createHttpTransport(options: HttpClientOptions = {}): ClientTransport {
  const baseUrl = resolveBaseUrl(options.baseUrl);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const credentials = options.credentials;
  return (request) =>
    httpRequest(
      fetchImpl,
      baseUrl,
      options.headers,
      credentials,
      request.path,
      request.input,
      request.signal,
    );
}

/**
 * Convenience that composes {@link createHttpTransport} with
 * {@link createClient}. Equivalent to:
 *
 * ```ts
 * createClient<C>({ transport: createHttpTransport(options) })
 * ```
 */
export function createHttpClient<C extends ContractShape>(options?: HttpClientOptions): Client<C> {
  return createClient<C>({ transport: createHttpTransport(options) });
}
