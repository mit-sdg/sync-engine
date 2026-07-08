import { describe, expect, test, vi } from "vite-plus/test";
import { createClient } from "@sync-engine/sdk";
import { FrameworkErrorCode } from "@sync-engine/sdk";

type TestApi = {
  "/auth/login": { input: { username: string; password: string }; output: { token: string } };
  "/users/list": { input: { page: number }; output: { users: string[] } };
  "/todos/create": { input: { title: string }; output: { id: string } };
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

describe("createClient", () => {
  test("sends POST with JSON body to grouped path", async () => {
    const fetch = mockFetch({ token: "abc123" });
    const client = createClient<TestApi>({ baseUrl: "http://localhost", fetch });

    const result = await (client as any).auth.login({ username: "alice", password: "secret" });

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
    const client = createClient<TestApi>({ baseUrl: "http://localhost", fetch });

    const result = await (client as any)["/auth/login"]({ username: "alice", password: "secret" });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ username: "alice", password: "secret" }),
      }),
    );
    expect(result).toEqual({ token: "abc123" });
  });

  test("sends empty object body when input is undefined", async () => {
    const fetch = mockFetch({ ok: true });
    type NoInputApi = { "/ping": { input: Record<string, never>; output: { ok: true } } };
    const client = createClient<NoInputApi>({ baseUrl: "http://localhost", fetch });

    await (client as any).ping();

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost/ping",
      expect.objectContaining({
        body: JSON.stringify({}),
      }),
    );
  });

  test("returns success payload from response", async () => {
    const fetch = mockFetch({ id: "42", title: "Hello" });
    const client = createClient<TestApi>({ baseUrl: "http://localhost", fetch });

    const result = await (client as any).todos.create({ title: "Hello" });

    expect(result).toEqual({ id: "42", title: "Hello" });
  });

  test("strips trailing slash from baseUrl", async () => {
    const fetch = mockFetch({ token: "x" });
    const client = createClient<TestApi>({ baseUrl: "http://localhost/", fetch });

    await (client as any).auth.login({ username: "a", password: "b" });

    expect(fetch).toHaveBeenCalledWith("http://localhost/auth/login", expect.any(Object));
  });

  test("defaults baseUrl to /api when not provided", async () => {
    const fetch = mockFetch({ token: "x" });
    const client = createClient<TestApi>({ fetch });

    await (client as any).auth.login({ username: "a", password: "b" });

    expect(fetch).toHaveBeenCalledWith("/api/auth/login", expect.any(Object));
  });

  test("uses API_BASE_URL env var when set", async () => {
    const fetch = mockFetch({ token: "x" });
    process.env.API_BASE_URL = "http://custom/api";
    const client = createClient<TestApi>({ fetch });

    await (client as any).auth.login({ username: "a", password: "b" });

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

    const client = createClient<TestApi>({ baseUrl: "http://localhost" });
    await (client as any).auth.login({ username: "a", password: "b" });

    expect(globalThis.fetch).toHaveBeenCalled();
    globalThis.fetch = originalFetch;
  });

  test("returns ClientError on network failure", async () => {
    const fetch: typeof globalThis.fetch = vi.fn(() =>
      Promise.reject(new Error("Connection refused")),
    ) as unknown as typeof fetch;
    const client = createClient<TestApi>({ baseUrl: "http://localhost", fetch });

    const result = await (client as any).auth.login({ username: "a", password: "b" });

    expect(result).toEqual({
      error: FrameworkErrorCode.NETWORK_ERROR,
      detail: expect.stringContaining("Connection refused"),
    });
  });

  test("returns ClientError on non-JSON response", async () => {
    const fetch = mockFetchText("plain text not json", 200, true);
    const client = createClient<TestApi>({ baseUrl: "http://localhost", fetch });

    const result = await (client as any).auth.login({ username: "a", password: "b" });

    expect(result).toEqual({
      error: FrameworkErrorCode.BAD_JSON,
      detail: expect.stringContaining("Invalid JSON"),
    });
  });

  test("returns ClientError on non-2xx without error body", async () => {
    const fetch = mockFetchText('{"status":"unauthorized"}', 401, false);
    const client = createClient<TestApi>({ baseUrl: "http://localhost", fetch });

    const result = await (client as any).auth.login({ username: "a", password: "b" });

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
    const client = createClient<TestApi>({ baseUrl: "http://localhost", fetch });

    const result = await (client as any).auth.login({ username: "a", password: "b" });

    expect(result).toEqual({ error: "INVALID_CREDENTIALS", detail: "bad password" });
  });

  test("passes through success payload with custom fields", async () => {
    const fetch = mockFetch({ users: ["alice", "bob"], total: 2 });
    const client = createClient<TestApi>({ baseUrl: "http://localhost", fetch });

    const result = await (client as any).users.list({ page: 1 });

    expect(result).toEqual({ users: ["alice", "bob"], total: 2 });
  });

  test("returns ClientError when header resolution function throws", async () => {
    const fetch: typeof globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const client = createClient<TestApi>({
      baseUrl: "http://localhost",
      fetch,
      headers: () => {
        throw new Error("token expired");
      },
    });

    const result = await (client as any).auth.login({ username: "a", password: "b" });

    expect(result).toEqual({
      error: FrameworkErrorCode.HEADER_RESOLUTION_FAILED,
      detail: expect.stringContaining("token expired"),
    });
  });

  test("merges custom headers into request", async () => {
    const fetch = mockFetch({ token: "x" });
    const client = createClient<TestApi>({
      baseUrl: "http://localhost",
      fetch,
      headers: { Authorization: "Bearer secret" },
    });

    await (client as any).auth.login({ username: "a", password: "b" });

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
    const client = createClient<TestApi>({
      baseUrl: "http://localhost",
      fetch,
      headers: async () => ({ "X-Trace": "trace-1" }),
    });

    await (client as any).auth.login({ username: "a", password: "b" });

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
    const client = createClient<TestApi>({ baseUrl: "http://localhost", fetch });

    await (client as any).auth.login({ username: "a", password: "b" });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost/auth/login",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  test("respects custom credentials option", async () => {
    const fetch = mockFetch({ token: "x" });
    const client = createClient<TestApi>({
      baseUrl: "http://localhost",
      fetch,
      credentials: "omit",
    });

    await (client as any).auth.login({ username: "a", password: "b" });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost/auth/login",
      expect.objectContaining({ credentials: "omit" }),
    );
  });

  test("deeply nested grouped path builds correct URL", async () => {
    const fetch = mockFetch({ ok: true });
    type DeepApi = {
      "/admin/users/roles/assign": {
        input: { userId: string; role: string };
        output: { ok: true };
      };
    };
    const client = createClient<DeepApi>({ baseUrl: "http://localhost", fetch });

    await (client as any).admin.users.roles.assign({ userId: "1", role: "admin" });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost/admin/users/roles/assign",
      expect.any(Object),
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
    const client = createClient<TestApi>({ baseUrl: "http://localhost", fetch });

    const result = await (client as any).auth.login({ username: "a", password: "b" });

    expect(result).toEqual({});
  });
});
