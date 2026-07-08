import { describe, expect, test } from "vite-plus/test";
import { createEndpointDsl, syncMap } from "@sync-engine/sdk";
import type { RequestBoundaryActions } from "@sync-engine/sdk";
import { SyncConcept } from "@sync-engine/engine";
import type { Vars } from "@sync-engine/engine";

class BoundaryConcept {
  request(_input: unknown) {
    return {};
  }
  respond(_body: unknown) {
    return {};
  }
}

function makeBoundary(): RequestBoundaryActions {
  const sync = new SyncConcept();
  const instrumented = sync.instrumentConcept(new BoundaryConcept());
  return instrumented as unknown as RequestBoundaryActions;
}

describe("createEndpointDsl", () => {
  test("endpoint returns path and syncs", () => {
    const dsl = createEndpointDsl(makeBoundary());

    const ep = dsl.endpoint("/auth/login", ({ request, respond }) => ({
      login: ({ username }: Vars) => request({ username }).then(respond({ token: "ok" })),
    }));

    expect(ep.path).toBe("/auth/login");
    expect(ep.syncs).toBeDefined();
    expect(typeof ep.syncs.login).toBe("function");
  });

  test("sync function produces when/then with correct structure", () => {
    const dsl = createEndpointDsl(makeBoundary());

    const ep = dsl.endpoint("/test", ({ request, respond }) => ({
      main: ({ id }: Vars) => request({ id }).then(respond({ ok: true })),
    }));

    const requestSymbol = Symbol.for("test-request");
    const result = (ep.syncs.main as Function)({ __request: requestSymbol });

    expect(result).toHaveProperty("when");
    expect(result).toHaveProperty("then");
    expect(Array.isArray(result.when)).toBe(true);
    expect(Array.isArray(result.then)).toBe(true);
    expect(result.when.length).toBeGreaterThanOrEqual(1);
  });

  test("request helper with empty input works", () => {
    const dsl = createEndpointDsl(makeBoundary());

    const ep = dsl.endpoint("/empty", ({ request, respond }) => ({
      main: (_vars: Vars) => request().then(respond({ ok: true })),
    }));

    const requestSymbol = Symbol.for("test-request");
    const result = (ep.syncs.main as Function)({ __request: requestSymbol });
    expect(result.when.length).toBeGreaterThanOrEqual(1);
  });

  test("multiple syncs in a single endpoint work", () => {
    const dsl = createEndpointDsl(makeBoundary());

    const ep = dsl.endpoint("/crud", ({ request, respond }) => ({
      create: ({ name }: Vars) => request({ name }).then(respond({ id: "ok" })),
      list: (_vars: Vars) => request({}).then(respond({ items: [] })),
    }));

    expect(Object.keys(ep.syncs)).toEqual(["create", "list"]);
  });

  test("request supports multiple input fields", () => {
    const dsl = createEndpointDsl(makeBoundary());

    const ep = dsl.endpoint("/multi", ({ request, respond }) => ({
      combined: ({ type, status }: Vars) =>
        request({ type, status }).then(respond({ result: true })),
    }));

    const requestSymbol = Symbol.for("test-request");
    const result = (ep.syncs.combined as Function)({ __request: requestSymbol });
    expect(result.when.length).toBeGreaterThanOrEqual(1);
  });

  test("different endpoints with same boundary produce independent syncs", () => {
    const dsl = createEndpointDsl(makeBoundary());

    const login = dsl.endpoint("/auth/login", ({ request, respond }) => ({
      login: ({ username }: Vars) => request({ username }).then(respond({ token: "ok" })),
    }));

    const logout = dsl.endpoint("/auth/logout", ({ request, respond }) => ({
      logout: (_vars: Vars) => request().then(respond({ ok: true })),
    }));

    expect(login.syncs.login).not.toBe(logout.syncs.logout);
    expect(login.path).toBe("/auth/login");
    expect(logout.path).toBe("/auth/logout");
  });

  test("fail helper wraps plain values in error envelope", () => {
    const dsl = createEndpointDsl(makeBoundary());

    const ep = dsl.endpoint("/bad", ({ request, fail }) => ({
      main: (_vars: Vars) => request().then(fail({ error: "oops" })),
    }));

    const requestSymbol = Symbol.for("test-request");
    const result = (ep.syncs.main as Function)({ __request: requestSymbol });
    expect(Array.isArray(result.then)).toBe(true);
  });

  test("fail helper with non-mapping value wraps it", () => {
    const dsl = createEndpointDsl(makeBoundary());

    const ep = dsl.endpoint("/err", ({ request, fail }) => ({
      main: (_vars: Vars) => request().then(fail("bad input")),
    }));

    const requestSymbol = Symbol.for("test-request");
    const result = (ep.syncs.main as Function)({ __request: requestSymbol });
    expect(result.then.length).toBe(1);
  });
});

describe("syncMap", () => {
  test("flattens syncs from endpoint definitions", () => {
    const dsl = createEndpointDsl(makeBoundary());

    const api = {
      auth: dsl.endpoint("/auth/login", ({ request, respond }) => ({
        login: (_vars: Vars) => request().then(respond({ token: "ok" })),
      })),
      users: dsl.endpoint("/users/list", ({ request, respond }) => ({
        list: (_vars: Vars) => request().then(respond({ items: [] })),
      })),
    };

    const syncs = syncMap(api);
    expect(syncs["auth.login"]).toBeDefined();
    expect(syncs["users.list"]).toBeDefined();
    expect(typeof syncs["auth.login"]).toBe("function");
    expect(typeof syncs["users.list"]).toBe("function");
  });

  test("syncMap handles nested plain objects", () => {
    const dsl = createEndpointDsl(makeBoundary());

    const api = {
      admin: {
        users: dsl.endpoint("/admin/users/create", ({ request, respond }) => ({
          create: (_vars: Vars) => request().then(respond({ ok: true })),
        })),
      },
    };

    const syncs = syncMap(api);
    expect(syncs["admin.users.create"]).toBeDefined();
    expect(typeof syncs["admin.users.create"]).toBe("function");
  });

  test("syncMap returns empty object for non-endpoint values", () => {
    const result = syncMap({ foo: "bar", num: 42 });
    expect(result).toEqual({});
  });

  test("syncMap handles null and undefined values gracefully", () => {
    const result = syncMap({ a: null, b: undefined, c: { nested: null } });
    expect(result).toEqual({});
  });

  test("syncMap preserves sync function identity", () => {
    const dsl = createEndpointDsl(makeBoundary());

    const ep = dsl.endpoint("/test", ({ request, respond }) => ({
      main: (_vars: Vars) => request().then(respond({ ok: true })),
    }));

    const syncs = syncMap({ test: ep });
    expect(syncs["test.main"]).toBeDefined();
    expect(syncs["test.main"]).toBe(ep.syncs.main);
  });

  test("syncMap handles deep nesting with mixed endpoints and objects", () => {
    const dsl = createEndpointDsl(makeBoundary());

    const api = {
      api: {
        v1: {
          auth: dsl.endpoint("/api/v1/auth/login", ({ request, respond }) => ({
            login: ({ email }: Vars) => request({ email }).then(respond({ token: "ok" })),
            register: ({ email, password }: Vars) =>
              request({ email, password }).then(respond({ id: "ok" })),
          })),
          todos: dsl.endpoint("/api/v1/todos", ({ request, respond }) => ({
            create: ({ title }: Vars) => request({ title }).then(respond({ id: "ok" })),
            list: (_vars: Vars) => request({}).then(respond({ items: [] })),
          })),
        },
      },
    };

    const syncs = syncMap(api);
    expect(Object.keys(syncs)).toHaveLength(4);
    expect(syncs["api.v1.auth.login"]).toBeDefined();
    expect(syncs["api.v1.auth.register"]).toBeDefined();
    expect(syncs["api.v1.todos.create"]).toBeDefined();
    expect(syncs["api.v1.todos.list"]).toBeDefined();
  });
});
