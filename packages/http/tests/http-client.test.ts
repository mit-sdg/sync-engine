import { describe, expect, test, vi } from "vite-plus/test";
import { FrameworkErrorCode } from "@sync-engine/boundary";
import {
  createHttpClient,
  createHttpTransport,
  HttpClientErrorCode,
} from "@mit-sdg/sync-engine-http/client";
import type { Client } from "@sync-engine/client";
import type { HttpClientError } from "@mit-sdg/sync-engine-http/client";

type TestApi = {
  "/auth/login": { input: { username: string; password: string }; output: { token: string } };
  "/ping": { input: Record<string, never>; output: { ok: boolean } };
};

function mockFetch(body: Record<string, unknown>): typeof fetch {
  const response = {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  };
  return vi.fn(() => Promise.resolve(response as unknown as Response)) as unknown as typeof fetch;
}

function mockFetchText(text: string, status = 200, ok = true): typeof fetch {
  const response = {
    ok,
    status,
    text: () => Promise.resolve(text),
  };
  return vi.fn(() => Promise.resolve(response as unknown as Response)) as unknown as typeof fetch;
}

function makeClient(
  fetch: typeof globalThis.fetch,
  opts?: Record<string, unknown>,
): Client<TestApi, HttpClientError> {
  return createHttpClient<TestApi>({ baseUrl: "http://localhost", fetch, ...opts });
}

describe("createHttpClient", () => {
  test("sends POST with JSON body to grouped path", async () => {
    const fetch = mockFetch({ token: "abc123" });
    const client = makeClient(fetch);

    const result = await client.auth.login({ username: "alice", password: "secret" });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ username: "alice", password: "secret" }),
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
    expect(result).toEqual({ token: "abc123" });
  });

  test("sends POST with JSON body to indexed path", async () => {
    const fetch = mockFetch({ token: "abc123" });
    const client = makeClient(fetch);

    const result = await client["/auth/login"]({ username: "alice", password: "secret" });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ username: "alice", password: "secret" }),
      }),
    );
    expect(result).toEqual({ token: "abc123" });
  });

  test("sends empty object body when input is empty", async () => {
    const fetch = mockFetch({ ok: true });
    const client = makeClient(fetch);

    await client.ping();

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost/ping",
      expect.objectContaining({
        body: JSON.stringify({}),
      }),
    );
  });

  test("a successful JSON response becomes the client result", async () => {
    const fetch = mockFetch({ token: "abc123" });
    const client = makeClient(fetch);

    const result = await client.auth.login({ username: "alice", password: "secret" });

    expect(result).toEqual({ token: "abc123" });
  });

  test("a trailing baseUrl slash does not duplicate the path separator", async () => {
    const fetch = mockFetch({ token: "x" });
    const client = createHttpClient<TestApi>({ baseUrl: "http://localhost/", fetch });

    await client.auth.login({ username: "a", password: "b" });

    expect(fetch).toHaveBeenCalledWith("http://localhost/auth/login", expect.any(Object));
  });

  test("an explicit root baseUrl does not fall back to /api", async () => {
    const fetch = mockFetch({ token: "x" });
    const client = createHttpClient<TestApi>({ baseUrl: "/", fetch });

    await client.auth.login({ username: "a", password: "b" });

    expect(fetch).toHaveBeenCalledWith("/auth/login", expect.any(Object));
  });

  test("an omitted baseUrl sends requests beneath /api", async () => {
    const fetch = mockFetch({ token: "x" });
    const client = createHttpClient<TestApi>({ fetch });

    await client.auth.login({ username: "a", password: "b" });

    expect(fetch).toHaveBeenCalledWith("/api/auth/login", expect.any(Object));
  });

  test("API_BASE_URL supplies an omitted baseUrl", async () => {
    const fetch = mockFetch({ token: "x" });
    process.env.API_BASE_URL = "http://custom/api";
    const client = createHttpClient<TestApi>({ fetch });

    await client.auth.login({ username: "a", password: "b" });

    expect(fetch).toHaveBeenCalledWith("http://custom/api/auth/login", expect.any(Object));
    delete process.env.API_BASE_URL;
  });

  test("an omitted fetch option calls globalThis.fetch", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ token: "x" })),
      }),
    ) as unknown as typeof fetch;

    const client = createHttpClient<TestApi>({ baseUrl: "http://localhost" });
    await client.auth.login({ username: "a", password: "b" });

    expect(globalThis.fetch).toHaveBeenCalled();
    globalThis.fetch = originalFetch;
  });

  test("a rejected fetch returns NETWORK_ERROR", async () => {
    const fetch: typeof globalThis.fetch = vi.fn(() =>
      Promise.reject(new Error("Connection refused")),
    ) as unknown as typeof fetch;
    const client = makeClient(fetch);

    const result = await client.auth.login({ username: "a", password: "b" });

    expect(result).toEqual({ error: HttpClientErrorCode.NETWORK_ERROR });
  });

  test("an aborted call passes its signal to fetch and returns ABORTED", async () => {
    const controller = new AbortController();
    const fetch: typeof globalThis.fetch = vi.fn((_input, init) => {
      expect(init?.signal).toBe(controller.signal);
      controller.abort();
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    }) as unknown as typeof fetch;
    const client = makeClient(fetch);

    const result = await client.auth.login(
      { username: "a", password: "b" },
      { signal: controller.signal },
    );

    expect(result).toEqual({ error: FrameworkErrorCode.ABORTED });
  });

  test("abort settles while async headers are pending and does not call fetch", async () => {
    const controller = new AbortController();
    const fetch = mockFetch({ token: "should-not-arrive" });
    let headersStarted!: () => void;
    let releaseHeaders!: (headers: Record<string, string>) => void;
    const started = new Promise<void>((resolve) => {
      headersStarted = resolve;
    });
    const client = createHttpClient<TestApi>({
      baseUrl: "http://localhost",
      fetch,
      headers: () => {
        headersStarted();
        return new Promise((resolve) => {
          releaseHeaders = resolve;
        });
      },
    });

    const pending = client.auth.login(
      { username: "a", password: "b" },
      { signal: controller.signal },
    );
    await started;
    controller.abort();
    let promptResult: Awaited<typeof pending> | "still-pending";
    try {
      promptResult = await Promise.race([
        pending,
        new Promise<"still-pending">((resolve) => setTimeout(() => resolve("still-pending"), 20)),
      ]);
    } finally {
      releaseHeaders({ Authorization: "Bearer late" });
    }

    expect(promptResult).toEqual({ error: FrameworkErrorCode.ABORTED });
    await expect(pending).resolves.toEqual({ error: FrameworkErrorCode.ABORTED });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("an abort while reading the response body returns ABORTED", async () => {
    const controller = new AbortController();
    const fetch: typeof globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => {
          controller.abort();
          return Promise.reject(new DOMException("Aborted", "AbortError"));
        },
      } as Response),
    ) as unknown as typeof fetch;
    const client = makeClient(fetch);

    const result = await client.auth.login(
      { username: "a", password: "b" },
      { signal: controller.signal },
    );

    expect(result).toEqual({ error: FrameworkErrorCode.ABORTED });
  });

  test("a non-JSON success response returns BAD_JSON", async () => {
    const fetch = mockFetchText("plain text not json", 200, true);
    const client = makeClient(fetch);

    const result = await client.auth.login({ username: "a", password: "b" });

    expect(result).toEqual({
      error: HttpClientErrorCode.BAD_JSON,
      detail: expect.stringContaining("Invalid JSON"),
    });
  });

  test("a non-2xx body without an error envelope returns BAD_STATUS", async () => {
    const fetch = mockFetchText('{"status":"unauthorized"}', 401, false);
    const client = makeClient(fetch);

    const result = await client.auth.login({ username: "a", password: "b" });

    expect(result).toEqual({
      error: HttpClientErrorCode.BAD_STATUS,
      detail: expect.stringContaining("401"),
    });
  });

  test("a non-2xx error envelope becomes the client result", async () => {
    const fetch = mockFetchText(
      JSON.stringify({ error: "INVALID_CREDENTIALS", detail: "bad password" }),
      401,
      false,
    );
    const client = makeClient(fetch);

    const result = await client.auth.login({ username: "a", password: "b" });

    expect(result).toEqual({ error: "INVALID_CREDENTIALS", detail: "bad password" });
  });

  test("a throwing header provider returns HEADER_RESOLUTION_FAILED", async () => {
    const fetch: typeof globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const client = createHttpClient<TestApi>({
      baseUrl: "http://localhost",
      fetch,
      headers: () => {
        throw new Error("token expired");
      },
    });

    const result = await client.auth.login({ username: "a", password: "b" });

    expect(result).toEqual({ error: HttpClientErrorCode.HEADER_RESOLUTION_FAILED });
  });

  test("object headers are merged with the JSON content type", async () => {
    const fetch = mockFetch({ token: "x" });
    const client = createHttpClient<TestApi>({
      baseUrl: "http://localhost",
      fetch,
      headers: { Authorization: "Bearer secret" },
    });

    await client.auth.login({ username: "a", password: "b" });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost/auth/login",
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer secret",
        },
      }),
    );
  });

  test("an async header provider supplies request headers", async () => {
    const fetch = mockFetch({ token: "x" });
    const client = createHttpClient<TestApi>({
      baseUrl: "http://localhost",
      fetch,
      headers: async () => ({ "X-Trace": "trace-1" }),
    });

    await client.auth.login({ username: "a", password: "b" });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost/auth/login",
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
          "X-Trace": "trace-1",
        },
      }),
    );
  });

  test("a PromiseLike header provider supplies request headers", async () => {
    const fetch = mockFetch({ token: "x" });
    const client = createHttpClient<TestApi>({
      baseUrl: "http://localhost",
      fetch,
      headers: () => {
        const headers = Promise.resolve({ "X-Trace": "trace-thenable" });
        return { then: headers.then.bind(headers) };
      },
    });

    await client.auth.login({ username: "a", password: "b" });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost/auth/login",
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
          "X-Trace": "trace-thenable",
        },
      }),
    );
  });

  test("forwards response validation through the HTTP client convenience", async () => {
    const fetch = mockFetch({ token: "x" });
    const client = createHttpClient<TestApi>({
      baseUrl: "http://localhost",
      fetch,
      validateResponse: (value, { path }) =>
        path === "/auth/login" && (value as { token?: unknown }).token === "x"
          ? { ok: true }
          : { ok: false },
    });

    await expect(client.auth.login({ username: "a", password: "b" })).resolves.toEqual({
      token: "x",
    });
  });

  test("requests use same-origin credentials by default", async () => {
    const fetch = mockFetch({ token: "x" });
    const client = makeClient(fetch);

    await client.auth.login({ username: "a", password: "b" });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost/auth/login",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  test("a credentials option replaces the same-origin default", async () => {
    const fetch = mockFetch({ token: "x" });
    const client = createHttpClient<TestApi>({
      baseUrl: "http://localhost",
      fetch,
      credentials: "omit",
    });

    await client.auth.login({ username: "a", password: "b" });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost/auth/login",
      expect.objectContaining({ credentials: "omit" }),
    );
  });

  test("an empty success body returns an empty object", async () => {
    const fetch: typeof globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(""),
      }),
    ) as unknown as typeof fetch;
    const client = makeClient(fetch);

    const result = await client.auth.login({ username: "a", password: "b" });

    expect(result).toEqual({});
  });

  test("a rejected response body read returns BAD_JSON", async () => {
    const fetch: typeof globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.reject(new Error("Read error")),
      }),
    ) as unknown as typeof fetch;
    const client = makeClient(fetch);

    const result = await client.auth.login({ username: "a", password: "b" });

    expect(result).toEqual({
      error: HttpClientErrorCode.BAD_JSON,
      detail: expect.stringContaining("Failed to read"),
    });
  });

  test("passes correlation and timeout context to the header provider", async () => {
    const fetch = mockFetch({ token: "x" });
    const contexts: unknown[] = [];
    const client = createHttpClient<TestApi>({
      baseUrl: "http://localhost",
      fetch,
      headers: (context) => {
        contexts.push(context);
        return { "X-Correlation-Id": context.correlationId ?? "missing" };
      },
    });

    await client.auth.login(
      { username: "a", password: "b" },
      { timeoutMs: 250, correlationId: "trace-http" },
    );

    expect(contexts).toEqual([
      expect.objectContaining({
        path: "/auth/login",
        timeoutMs: 250,
        correlationId: "trace-http",
        signal: expect.any(AbortSignal),
      }),
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost/auth/login",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Correlation-Id": "trace-http" }),
      }),
    );
  });

  test("applies a transport-local timeout", async () => {
    const fetch = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    ) as unknown as typeof globalThis.fetch;
    const client = makeClient(fetch);

    await expect(
      client.auth.login({ username: "a", password: "b" }, { timeoutMs: 5 }),
    ).resolves.toEqual({ error: FrameworkErrorCode.TIMED_OUT });
  });

  test("accepts the reliable timer maximum and rejects the first value above it", async () => {
    const fetch = mockFetch({ token: "x" });
    const client = makeClient(fetch);

    await expect(
      client.auth.login({ username: "a", password: "b" }, { timeoutMs: 2_147_483_647 }),
    ).resolves.toEqual({ token: "x" });
    await expect(
      client.auth.login({ username: "a", password: "b" }, { timeoutMs: 2_147_483_648 }),
    ).resolves.toEqual({ error: FrameworkErrorCode.INVALID_INPUT });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["caller abort", "abort", FrameworkErrorCode.ABORTED],
    ["timeout", "timeout", FrameworkErrorCode.TIMED_OUT],
  ] as const)(
    "settles promptly for %s when fetch ignores interruption and later rejects",
    async (_name, first, error) => {
      const controller = new AbortController();
      let fetchStarted!: () => void;
      let rejectFetch!: () => void;
      const started = new Promise<void>((resolve) => {
        fetchStarted = resolve;
      });
      const fetch = vi.fn(
        () =>
          new Promise<Response>((_resolve, reject) => {
            rejectFetch = () => reject(new Error("Delayed custom fetch rejection"));
            fetchStarted();
          }),
      ) as unknown as typeof globalThis.fetch;
      const client = makeClient(fetch);

      const pending = client.auth.login(
        { username: "a", password: "b" },
        { signal: controller.signal, timeoutMs: 5 },
      );
      await started;
      if (first === "abort") controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (first === "timeout") controller.abort();

      await expect(pending).resolves.toEqual({ error });
      rejectFetch();
      await new Promise((resolve) => setImmediate(resolve));
    },
  );

  test.each([
    ["caller abort", "abort", FrameworkErrorCode.ABORTED],
    ["timeout", "timeout", FrameworkErrorCode.TIMED_OUT],
  ] as const)(
    "settles promptly for %s and cancels a late response",
    async (_name, first, error) => {
      const controller = new AbortController();
      let canceled = false;
      let fetchStarted!: () => void;
      let resolveFetch!: (response: Response) => void;
      const started = new Promise<void>((resolve) => {
        fetchStarted = resolve;
      });
      const fetch = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
            fetchStarted();
          }),
      ) as unknown as typeof globalThis.fetch;
      const client = makeClient(fetch);

      const pending = client.auth.login(
        { username: "a", password: "b" },
        { signal: controller.signal, timeoutMs: 5 },
      );
      await started;
      if (first === "abort") controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (first === "timeout") controller.abort();

      await expect(pending).resolves.toEqual({ error });
      const stream = new ReadableStream<Uint8Array>({
        cancel() {
          canceled = true;
        },
      });
      // Resolve the ignored Fetch after the caller has already settled.
      const lateResponse = new Response(stream);
      expect(canceled).toBe(false);
      resolveFetch(lateResponse);
      await new Promise((resolve) => setImmediate(resolve));
      expect(canceled).toBe(true);
    },
  );

  test.each([
    ["uncapped", undefined],
    ["capped", 8],
  ] as const)("times out while an %s response body ignores cancellation", async (_name, cap) => {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true;
      },
    });
    const fetch = vi.fn(() =>
      Promise.resolve(new Response(stream)),
    ) as unknown as typeof globalThis.fetch;
    const client = makeClient(fetch, cap === undefined ? {} : { maxResponseBytes: cap });

    await expect(
      client.auth.login({ username: "a", password: "b" }, { timeoutMs: 5 }),
    ).resolves.toEqual({ error: FrameworkErrorCode.TIMED_OUT });
    if (cap !== undefined) expect(canceled).toBe(true);
  });

  test("bounds streamed response bodies by bytes and cancels oversized streams", async () => {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"token":"too-large"}'));
      },
      cancel() {
        canceled = true;
      },
    });
    const fetch = vi.fn(() =>
      Promise.resolve(new Response(stream)),
    ) as unknown as typeof globalThis.fetch;
    const client = makeClient(fetch, { maxResponseBytes: 8 });

    await expect(client.auth.login({ username: "a", password: "b" })).resolves.toEqual({
      error: HttpClientErrorCode.RESPONSE_TOO_LARGE,
    });
    expect(canceled).toBe(true);
  });

  test("rejects an oversized Content-Length and invalid response limits", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(new Response('{"token":"x"}', { headers: { "Content-Length": "100" } })),
    ) as unknown as typeof globalThis.fetch;
    const client = makeClient(fetch, { maxResponseBytes: 10 });

    await expect(client.auth.login({ username: "a", password: "b" })).resolves.toEqual({
      error: HttpClientErrorCode.RESPONSE_TOO_LARGE,
    });
    expect(() => makeClient(fetch, { maxResponseBytes: 0 })).toThrow(
      "maxResponseBytes must be a positive finite integer",
    );
  });

  test("does not wait for cancellation of oversized response bodies", async () => {
    function oversizedResponse(contentLength?: string): Response {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"token":"too-large"}'));
        },
        cancel() {
          return new Promise<void>(() => undefined);
        },
      });
      return new Response(stream, {
        headers: contentLength === undefined ? undefined : { "Content-Length": contentLength },
      });
    }

    for (const response of [oversizedResponse(), oversizedResponse("100")]) {
      const fetch = vi.fn(() => Promise.resolve(response)) as unknown as typeof globalThis.fetch;
      const client = makeClient(fetch, { maxResponseBytes: 8 });
      await expect(
        client.auth.login({ username: "a", password: "b" }, { timeoutMs: 20 }),
      ).resolves.toEqual({ error: HttpClientErrorCode.RESPONSE_TOO_LARGE });
    }
  });
});

describe("createHttpTransport", () => {
  test("the transport posts a direct path and returns its JSON result", async () => {
    const fetch = mockFetch({ token: "abc123" });
    const transport = createHttpTransport({ baseUrl: "http://localhost", fetch });

    const result = await transport({
      path: "/auth/login",
      input: { username: "alice", password: "secret" },
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ username: "alice", password: "secret" }),
      }),
    );
    expect(result).toEqual({ token: "abc123" });
  });
});
