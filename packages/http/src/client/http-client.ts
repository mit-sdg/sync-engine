import { FrameworkErrorCode } from "@mit-sdg/sync-engine/boundary";
import {
  createClient,
  type Client,
  type ClientTransport,
  type ContractShape,
} from "@mit-sdg/sync-engine/client";

/** A header bag, or a (possibly async) function producing one per request. */
export type HeadersOption =
  | Record<string, string>
  | (() => Record<string, string> | Promise<Record<string, string>>);

/** Options for {@link createHttpTransport} and {@link createHttpClient}. */
export interface HttpClientOptions {
  /** Base URL every request is prefixed with, including an optional API segment. */
  baseUrl?: string;
  /** `fetch` implementation to use. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Extra headers merged into every request after `Content-Type`. */
  headers?: HeadersOption;
  /** Request credentials mode. Defaults to `include` for cookie-bearing policies. */
  credentials?: "include" | "omit" | "same-origin";
}

export const HttpClientErrorCode = {
  BAD_JSON: "BAD_JSON",
  BAD_STATUS: "BAD_STATUS",
  HEADER_RESOLUTION_FAILED: "HEADER_RESOLUTION_FAILED",
  NETWORK_ERROR: "NETWORK_ERROR",
} as const;

export type HttpClientError = {
  error: (typeof HttpClientErrorCode)[keyof typeof HttpClientErrorCode];
  detail?: string;
};

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

type HeaderResolution = { aborted: true } | { aborted: false; headers: Record<string, string> };

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function raceAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  onAbort: () => T,
): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.resolve(onAbort());
  return new Promise((resolve, reject) => {
    const abort = () => resolve(onAbort());
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function resolveHeaders(
  option: HeadersOption | undefined,
  signal: AbortSignal | undefined,
): Promise<HeaderResolution> {
  if (isAborted(signal)) return { aborted: true };
  if (typeof option !== "function") return { aborted: false, headers: option ?? {} };
  return raceAbort(
    Promise.resolve(option()).then((headers) => ({ aborted: false, headers })),
    signal,
    () => ({ aborted: true }),
  );
}

async function httpRequest(
  fetchImpl: typeof fetch,
  baseUrl: string,
  headersOption: HeadersOption | undefined,
  credentials: "include" | "omit" | "same-origin" | undefined,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown | HttpClientError> {
  let resolvedHeaders: HeaderResolution;
  try {
    resolvedHeaders = await resolveHeaders(headersOption, signal);
  } catch {
    return { error: HttpClientErrorCode.HEADER_RESOLUTION_FAILED };
  }
  if (resolvedHeaders.aborted || isAborted(signal)) {
    return { error: FrameworkErrorCode.ABORTED };
  }

  let response: Response;
  try {
    response = await fetchImpl(baseUrl + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...resolvedHeaders.headers },
      body: JSON.stringify(body ?? {}),
      credentials: credentials ?? "include",
      signal,
    });
  } catch {
    return {
      error: isAborted(signal) ? FrameworkErrorCode.ABORTED : HttpClientErrorCode.NETWORK_ERROR,
    };
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    if (isAborted(signal)) return { error: FrameworkErrorCode.ABORTED };
    return {
      error: HttpClientErrorCode.BAD_JSON,
      detail: `Failed to read response body from ${path} (status ${response.status}).`,
    };
  }
  let data: unknown;
  try {
    data = text === "" ? {} : JSON.parse(text);
  } catch {
    return {
      error: HttpClientErrorCode.BAD_JSON,
      detail: `Invalid JSON response from ${path} (status ${response.status}).`,
    };
  }

  if (!response.ok && (typeof data !== "object" || data === null || !("error" in data))) {
    return {
      error: HttpClientErrorCode.BAD_STATUS,
      detail: `Request to ${path} failed with status ${response.status}.`,
    };
  }
  return data;
}

/**
 * Creates a `fetch` transport for `createClient<Wire, HttpClientError>`, or use
 * {@link createHttpClient} for that composition.
 */
export function createHttpTransport(
  options: HttpClientOptions = {},
): ClientTransport<HttpClientError> {
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

/** Convenience composition of `createHttpTransport` and the generic core client. */
export function createHttpClient<C extends ContractShape>(
  options?: HttpClientOptions,
): Client<C, HttpClientError> {
  return createClient<C, HttpClientError>({ transport: createHttpTransport(options) });
}
