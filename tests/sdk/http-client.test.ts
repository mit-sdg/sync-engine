import { describe, expect, test, vi } from "vite-plus/test";
import { createHttpClient, createHttpTransport } from "@sync-engine/sdk";
import type { Client } from "@sync-engine/sdk";
import { FrameworkErrorCode } from "@sync-engine/sdk";

type TestApi = {
  "/auth/login": { input: { username: string; password: string }; output: { token: string } };
  "/ping": { input: Record<string, never>; output: { ok: boolean } };
};

function mockFetch(body: Record<string, unknown>): typeof fetch {
  const response = {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  };
  return vi.fn(() => Promise.resolve(response as unknown as Response)) as unknown as typeof fetch;
}

function mockFetchText(text: string, status = 200, ok = true): typeof fetch {
  const response = {
    ok,
    status,
    text: () => Promise.resolve(text),
    json: () => {
      try {
        return Promise.resolve(JSON.parse(text));
      } catch {
        return Promise.reject(new Error("Invalid JSON"));
      }
    },
  };
  return vi.fn(() => Promise.resolve(response as unknown as Response)) as unknown as typeof fetch;
}

function makeClient(
  fetch: typeof globalThis.fetch,
  opts?: Record<string, unknown>,
): Client<TestApi> {
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

  test("returns success payload from response", async () => {
    const fetch = mockFetch({ token: "abc123" });
    const client = makeClient(fetch);

    const result = await client.auth.login({ username: "alice", password: "secret" });

    expect(result).toEqual({ token: "abc123" });
  });

  test("strips trailing slash from baseUrl", async () => {
    const fetch = mockFetch({ token: "x" });
    const client = createHttpClient<TestApi>({ baseUrl: "http://localhost/", fetch });

    await client.auth.login({ username: "a", password: "b" });

    expect(fetch).toHaveBeenCalledWith("http://localhost/auth/login", expect.any(Object));
  });

  test("defaults baseUrl to /api when not provided", async () => {
    const fetch = mockFetch({ token: "x" });
    const client = createHttpClient<TestApi>({ fetch });

    await client.auth.login({ username: "a", password: "b" });

    expect(fetch).toHaveBeenCalledWith("/api/auth/login", expect.any(Object));
  });

  test("uses API_BASE_URL env var when set", async () => {
    const fetch = mockFetch({ token: "x" });
    process.env.API_BASE_URL = "http://custom/api";
    const client = createHttpClient<TestApi>({ fetch });

    await client.auth.login({ username: "a", password: "b" });

    expect(fetch).toHaveBeenCalledWith("http://custom/api/auth/login", expect.any(Object));
    delete process.env.API_BASE_URL;
  });

  test("uses globalThis.fetch when no fetch option provided", async () => {
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

  test("returns ClientError on network failure", async () => {
    const fetch: typeof globalThis.fetch = vi.fn(() =>
      Promise.reject(new Error("Connection refused")),
    ) as unknown as typeof fetch;
    const client = makeClient(fetch);

    const result = await client.auth.login({ username: "a", password: "b" });

    expect(result).toEqual({
      error: FrameworkErrorCode.NETWORK_ERROR,
      detail: expect.stringContaining("Connection refused"),
    });
  });

  test("returns ClientError on non-JSON response", async () => {
    const fetch = mockFetchText("plain text not json", 200, true);
    const client = makeClient(fetch);

    const result = await client.auth.login({ username: "a", password: "b" });

    expect(result).toEqual({
      error: FrameworkErrorCode.BAD_JSON,
      detail: expect.stringContaining("Invalid JSON"),
    });
  });

  test("returns ClientError on non-2xx without error body", async () => {
    const fetch = mockFetchText('{"status":"unauthorized"}', 401, false);
    const client = makeClient(fetch);

    const result = await client.auth.login({ username: "a", password: "b" });

    expect(result).toEqual({
      error: FrameworkErrorCode.BAD_STATUS,
      detail: expect.stringContaining("401"),
    });
  });

  test("passes through backend error envelope on non-2xx", async () => {
    const fetch = mockFetchText(
      JSON.stringify({ error: "INVALID_CREDENTIALS", detail: "bad password" }),
      401,
      false,
    );
    const client = makeClient(fetch);

    const result = await client.auth.login({ username: "a", password: "b" });

    expect(result).toEqual({ error: "INVALID_CREDENTIALS", detail: "bad password" });
  });

  test("returns ClientError when header resolution function throws", async () => {
    const fetch: typeof globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const client = createHttpClient<TestApi>({
      baseUrl: "http://localhost",
      fetch,
      headers: () => {
        throw new Error("token expired");
      },
    });

    const result = await client.auth.login({ username: "a", password: "b" });

    expect(result).toEqual({
      error: FrameworkErrorCode.HEADER_RESOLUTION_FAILED,
      detail: expect.stringContaining("token expired"),
    });
  });

  test("merges custom headers into request", async () => {
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

  test("supports async header function", async () => {
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

  test("sends credentials: include by default", async () => {
    const fetch = mockFetch({ token: "x" });
    const client = makeClient(fetch);

    await client.auth.login({ username: "a", password: "b" });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost/auth/login",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  test("respects custom credentials option", async () => {
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

  test("handles empty response body as empty object", async () => {
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
});

describe("createHttpTransport", () => {
  test("transport function can be used with createClient directly", async () => {
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
