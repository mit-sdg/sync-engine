import { describe, expect, test, vi } from "vite-plus/test";
import { createClient } from "@sync-engine/internal/boundary";
import type { ClientTransport } from "@sync-engine/internal/boundary";

type TestApi = {
  "/auth/login": { input: { username: string; password: string }; output: { token: string } };
  "/users/list": { input: { page: number }; output: { users: string[] } };
  "/todos/create": { input: { title: string }; output: { id: string } };
  "/admin/users/roles/assign": { input: { userId: string; role: string }; output: { ok: boolean } };
  "/ping": { input: Record<string, never>; output: { ok: boolean } };
  "/auth/then": { input: { code: string }; output: { ok: boolean } };
};

function fakeTransport(response?: unknown): ClientTransport {
  return vi.fn(() => Promise.resolve(response ?? {})) as unknown as ClientTransport;
}

describe("createClient (transport-agnostic)", () => {
  test("a grouped path sends its full path and input to the transport", async () => {
    const transport = fakeTransport({ token: "abc123" });
    const client = createClient<TestApi>({ transport });

    const result = await client.auth.login({ username: "alice", password: "secret" });
    const typed: { token: string } | { error: string; detail?: string } = result;
    expect(typed).toEqual({ token: "abc123" });

    expect(transport).toHaveBeenCalledWith({
      path: "/auth/login",
      input: { username: "alice", password: "secret" },
    });
  });

  test("an indexed path sends its full path and input to the transport", async () => {
    const transport = fakeTransport({ token: "abc123" });
    const client = createClient<TestApi>({ transport });

    await client["/auth/login"]({ username: "alice", password: "secret" });

    expect(transport).toHaveBeenCalledWith({
      path: "/auth/login",
      input: { username: "alice", password: "secret" },
    });
  });

  test("empty endpoint input becomes {}", async () => {
    const transport = fakeTransport({ ok: true });
    const client = createClient<TestApi>({ transport });

    await client.ping();

    expect(transport).toHaveBeenCalledWith({
      path: "/ping",
      input: {},
    });
  });

  test("return payload is passed through", async () => {
    const transport = fakeTransport({ id: "42", title: "Hello" });
    const client = createClient<TestApi>({ transport });

    const result = await client.todos.create({ title: "Hello" });

    expect(result).toEqual({ id: "42", title: "Hello" });
  });

  test("a deeply grouped call sends every path segment", async () => {
    const transport = fakeTransport({ ok: true });
    const client = createClient<TestApi>({ transport });

    await client.admin.users.roles.assign({ userId: "1", role: "admin" });

    expect(transport).toHaveBeenCalledWith({
      path: "/admin/users/roles/assign",
      input: { userId: "1", role: "admin" },
    });
  });

  test("the first segment may group the remaining path under one key", async () => {
    const transport = fakeTransport({ ok: true });
    const client = createClient<TestApi>({ transport });

    await client.admin["users/roles/assign"]({ userId: "1", role: "admin" });

    expect(transport).toHaveBeenCalledWith({
      path: "/admin/users/roles/assign",
      input: { userId: "1", role: "admin" },
    });
  });

  test("then property access is ignored so proxy is not treated as a Promise", async () => {
    const transport = fakeTransport({ ok: true });
    const client = createClient<TestApi>({ transport });

    await client.auth.login({ username: "a", password: "b" });

    expect(transport).toHaveBeenCalledTimes(1);
    // Accessing .then should not trigger a transport call (proxy handles it)
    const value = (client as Record<string, unknown>)["then"];
    expect(value).toBeUndefined();
  });

  test("grouped paths can use then as a nested endpoint segment", async () => {
    const transport = fakeTransport({ ok: true });
    const client = createClient<TestApi>({ transport });

    await client.auth.then({ code: "continue" });

    expect(transport).toHaveBeenCalledWith({
      path: "/auth/then",
      input: { code: "continue" },
    });
  });

  test("transport errors propagate as-is", async () => {
    const transport: ClientTransport = vi.fn(() =>
      Promise.resolve({ error: "CUSTOM_ERROR", detail: "something went wrong" }),
    );
    const client = createClient<TestApi>({ transport });

    const result = await client.auth.login({ username: "a", password: "b" });

    expect(result).toEqual({ error: "CUSTOM_ERROR", detail: "something went wrong" });
  });

  test("no input argument sends {} to transport", async () => {
    const transport = fakeTransport({ ok: true });
    const client = createClient<TestApi>({ transport });

    await client.ping();

    expect(transport).toHaveBeenCalledWith({
      path: "/ping",
      input: {},
    });
  });

  test("transport that throws (not resolves with error) is caught and converted to error envelope", async () => {
    const client = createClient<TestApi>({
      transport: () => {
        throw new Error("boom");
      },
    });

    const result = await client.auth.login({ username: "a", password: "b" });

    expect(result).toEqual({
      error: "TRANSPORT_ERROR",
      detail: expect.stringContaining("boom"),
    });
  });
});
