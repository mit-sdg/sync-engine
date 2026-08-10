import { FrameworkErrorCode } from "@mit-sdg/sync-engine/boundary";
import {
  createClient,
  type Client,
  type ClientResponseValidator,
  type ClientTransport,
  type ContractShape,
} from "@mit-sdg/sync-engine/client";
import { type CappedTextRead, cancelReadable, raceAbort, readCappedUtf8Stream } from "../stream.ts";

export interface HttpRequestContext {
  readonly path: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly correlationId?: string;
}

/** A header bag, or a (possibly async) function producing one per request. */
export type HeadersOption =
  | Record<string, string>
  | ((context: HttpRequestContext) => Record<string, string> | PromiseLike<Record<string, string>>);

/** Options for {@link createHttpTransport} and {@link createHttpClient}. */
export interface HttpClientOptions {
  /** Base URL every request is prefixed with, including an optional API segment. */
  baseUrl?: string;
  /** `fetch` implementation to use. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Extra headers merged into every request after `Content-Type`. */
  headers?: HeadersOption;
  /** Request credentials mode. Defaults to `same-origin`. */
  credentials?: "include" | "omit" | "same-origin";
  /** Optional synchronous runtime check for each complete HTTP result. */
  validateResponse?: ClientResponseValidator;
  /** Maximum response-body bytes to buffer. Undefined leaves the response uncapped. */
  maxResponseBytes?: number;
}

export const HttpClientErrorCode = {
  BAD_JSON: "BAD_JSON",
  BAD_STATUS: "BAD_STATUS",
  HEADER_RESOLUTION_FAILED: "HEADER_RESOLUTION_FAILED",
  NETWORK_ERROR: "NETWORK_ERROR",
  RESPONSE_TOO_LARGE: "RESPONSE_TOO_LARGE",
} as const;

export type HttpClientError = {
  error: (typeof HttpClientErrorCode)[keyof typeof HttpClientErrorCode];
  detail?: string;
};

const FALLBACK_BASE_URL = "/api";
const MAX_TIMER_DELAY_MS = 2_147_483_647;

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

async function resolveHeaders(
  option: HeadersOption | undefined,
  context: HttpRequestContext,
): Promise<HeaderResolution> {
  const { signal } = context;
  if (isAborted(signal)) return { aborted: true };
  if (typeof option !== "function") return { aborted: false, headers: option ?? {} };
  return raceAbort(
    Promise.resolve(option(context)).then((headers) => ({ aborted: false, headers })),
    signal,
    () => ({ aborted: true }),
  );
}

function normalizeMaxResponseBytes(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error("createHttpTransport: maxResponseBytes must be a positive finite integer.");
  }
  return value;
}

async function readResponseBody(
  response: Response,
  maxBytes: number | undefined,
  signal: AbortSignal | undefined,
): Promise<CappedTextRead> {
  if (maxBytes === undefined) {
    return raceAbort(
      Promise.resolve(response.text()).then((text) => ({ ok: true as const, text })),
      signal,
      () => {
        cancelReadable(response.body, signal?.reason);
        return { aborted: true as const };
      },
    );
  }
  const declared = response.headers.get("Content-Length");
  const declaredBytes = declared !== null && /^\d+$/.test(declared) ? Number(declared) : undefined;
  return readCappedUtf8Stream(response.body, maxBytes, declaredBytes, signal);
}

interface RequestControl {
  readonly signal?: AbortSignal;
  timedOut(): boolean;
  dispose(): void;
}

function requestControl(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): RequestControl {
  if (timeoutMs === undefined) return { signal, timedOut: () => false, dispose() {} };
  const controller = new AbortController();
  let interruption: "aborted" | "timed-out" | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = () => {
    if (interruption !== undefined) return;
    interruption = "aborted";
    if (timer !== undefined) clearTimeout(timer);
    controller.abort(signal?.reason);
  };
  if (signal?.aborted) {
    abort();
  } else {
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => {
      if (interruption !== undefined) return;
      interruption = "timed-out";
      signal?.removeEventListener("abort", abort);
      controller.abort(new DOMException("Timed out", "TimeoutError"));
    }, timeoutMs);
  }
  return {
    signal: controller.signal,
    timedOut: () => interruption === "timed-out",
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    },
  };
}

function interruptedError(control: RequestControl) {
  return { error: control.timedOut() ? FrameworkErrorCode.TIMED_OUT : FrameworkErrorCode.ABORTED };
}

async function httpRequest(
  fetchImpl: typeof fetch,
  baseUrl: string,
  headersOption: HeadersOption | undefined,
  credentials: "include" | "omit" | "same-origin" | undefined,
  maxResponseBytes: number | undefined,
  request: Parameters<ClientTransport<HttpClientError>>[0],
): Promise<unknown | HttpClientError> {
  const { path, input: body, timeoutMs, correlationId } = request;
  if (
    timeoutMs !== undefined &&
    (!Number.isFinite(timeoutMs) ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      timeoutMs > MAX_TIMER_DELAY_MS)
  ) {
    return { error: FrameworkErrorCode.INVALID_INPUT };
  }
  const control = requestControl(request.signal, timeoutMs);
  const signal = control.signal;
  try {
    let resolvedHeaders: HeaderResolution;
    try {
      resolvedHeaders = await resolveHeaders(headersOption, {
        path,
        signal,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        ...(correlationId === undefined ? {} : { correlationId }),
      });
    } catch {
      return { error: HttpClientErrorCode.HEADER_RESOLUTION_FAILED };
    }
    if (resolvedHeaders.aborted || isAborted(signal)) return interruptedError(control);

    let response: Response;
    try {
      const pendingFetch = Promise.resolve(
        fetchImpl(baseUrl + path, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...resolvedHeaders.headers },
          body: JSON.stringify(body ?? {}),
          credentials: credentials ?? "same-origin",
          signal,
        }),
      );
      const fetched = await raceAbort<{ aborted: false; response: Response } | { aborted: true }>(
        pendingFetch.then((value) => ({ aborted: false as const, response: value })),
        signal,
        () => ({ aborted: true as const }),
      );
      if (fetched.aborted) {
        void pendingFetch.then(
          (lateResponse) => cancelReadable(lateResponse.body, signal?.reason),
          () => undefined,
        );
        return interruptedError(control);
      }
      response = fetched.response;
    } catch {
      return isAborted(signal)
        ? interruptedError(control)
        : { error: HttpClientErrorCode.NETWORK_ERROR };
    }
    if (isAborted(signal)) return interruptedError(control);

    let text: string;
    try {
      const bodyRead = await readResponseBody(response, maxResponseBytes, signal);
      if ("aborted" in bodyRead) return interruptedError(control);
      if (isAborted(signal)) return interruptedError(control);
      if (!bodyRead.ok) return { error: HttpClientErrorCode.RESPONSE_TOO_LARGE };
      text = bodyRead.text;
    } catch {
      if (isAborted(signal)) return interruptedError(control);
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
  } finally {
    control.dispose();
  }
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
  const maxResponseBytes = normalizeMaxResponseBytes(options.maxResponseBytes);
  return (request) =>
    httpRequest(fetchImpl, baseUrl, options.headers, credentials, maxResponseBytes, request);
}

/** Convenience composition of `createHttpTransport` and the generic core client. */
export function createHttpClient<C extends ContractShape>(
  options?: HttpClientOptions,
): Client<C, HttpClientError> {
  return createClient<C, HttpClientError>({
    transport: createHttpTransport(options),
    ...(options?.validateResponse === undefined
      ? {}
      : { validateResponse: options.validateResponse }),
  });
}
