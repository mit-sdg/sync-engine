import { describe, expect, test } from "vite-plus/test";
import { createEndpointDsl, syncMap } from "@sync-engine/sdk";
import type { RequestBoundaryActions } from "@sync-engine/sdk";
import { SyncConcept } from "@sync-engine/engine";

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
  test("defineEndpoint returns path and syncs", () => {
    const dsl = createEndpointDsl(makeBoundary());

    const endpoint = dsl.defineEndpoint("/auth/login", ({ Sync, Request, Respond, Actions }) => ({
      login: Sync((_vars) => ({
        when: Actions(Request({ username: "string" })),
        then: Actions(Respond({ token: "string" })),
      })),
    }));

    expect(endpoint.path).toBe("/auth/login");
    expect(endpoint.syncs).toBeDefined();
    expect(typeof endpoint.syncs.login).toBe("function");
  });

  test("Sync function produces when/then with correct structure", () => {
    const dsl = createEndpointDsl(makeBoundary());

    const endpoint = dsl.defineEndpoint("/test", ({ Sync, Request, Respond, Actions }) => ({
      main: Sync((_vars) => ({
        when: Actions(Request({ id: "string" })),
        then: Actions(Respond({ ok: true })),
      })),
    }));

    const requestSymbol = Symbol.for("test-request");
    const result = (endpoint.syncs.main as Function)({ __request: requestSymbol });

    expect(result).toHaveProperty("when");
    expect(result).toHaveProperty("then");
    expect(Array.isArray(result.when)).toBe(true);
    expect(Array.isArray(result.then)).toBe(true);
    expect(result.when.length).toBeGreaterThanOrEqual(1);
    expect(result.then.length).toBe(1);
  });

  test("Request helper with empty input works", () => {
    const dsl = createEndpointDsl(makeBoundary());

    const endpoint = dsl.defineEndpoint("/empty", ({ Sync, Request, Respond, Actions }) => ({
      main: Sync((_vars) => ({
        when: Actions(Request()),
        then: Actions(Respond({ ok: true })),
      })),
    }));

    const requestSymbol = Symbol.for("test-request");
    const result = (endpoint.syncs.main as Function)({ __request: requestSymbol });
    expect(result.when.length).toBeGreaterThanOrEqual(1);
  });

  test("multiple syncs in a single endpoint work", () => {
    const dsl = createEndpointDsl(makeBoundary());

    const endpoint = dsl.defineEndpoint("/crud", ({ Sync, Request, Respond, Actions }) => ({
      create: Sync((_vars) => ({
        when: Actions(Request({ name: "string" })),
        then: Actions(Respond({ id: "string" })),
      })),
      list: Sync((_vars) => ({
        when: Actions(Request({})),
        then: Actions(Respond({ items: [] as string[] })),
      })),
    }));

    expect(Object.keys(endpoint.syncs)).toEqual(["create", "list"]);
  });

  test("multiple Request patterns in single when work", () => {
    const dsl = createEndpointDsl(makeBoundary());

    const endpoint = dsl.defineEndpoint("/multi", ({ Sync, Request, Respond, Actions }) => ({
      combined: Sync((_vars) => ({
        when: Actions(Request({ type: "string" }), Request({ status: "string" })),
        then: Actions(Respond({ result: true })),
      })),
    }));

    const requestSymbol = Symbol.for("test-request");
    const result = (endpoint.syncs.combined as Function)({ __request: requestSymbol });
    expect(result.when.length).toBeGreaterThanOrEqual(3);
  });

  test("different endpoints with same boundary produce independent syncs", () => {
    const dsl = createEndpointDsl(makeBoundary());

    const login = dsl.defineEndpoint("/auth/login", ({ Sync, Request, Respond, Actions }) => ({
      login: Sync((_vars) => ({
        when: Actions(Request({ username: "string" })),
        then: Actions(Respond({ token: "string" })),
      })),
    }));

    const logout = dsl.defineEndpoint("/auth/logout", ({ Sync, Request, Respond, Actions }) => ({
      logout: Sync((_vars) => ({
        when: Actions(Request({})),
        then: Actions(Respond({ ok: true })),
      })),
    }));

    expect(login.syncs.login).not.toBe(logout.syncs.logout);
    expect(login.path).toBe("/auth/login");
    expect(logout.path).toBe("/auth/logout");
  });
});

describe("syncMap", () => {
  test("flattens syncs from endpoint definitions", () => {
    const dsl = createEndpointDsl(makeBoundary());

    const api = {
      auth: dsl.defineEndpoint("/auth/login", ({ Sync, Request, Respond, Actions }) => ({
        login: Sync((_vars) => ({
          when: Actions(Request({})),
          then: Actions(Respond({ token: "string" })),
        })),
      })),
      users: dsl.defineEndpoint("/users/list", ({ Sync, Request, Respond, Actions }) => ({
        list: Sync((_vars) => ({
          when: Actions(Request({})),
          then: Actions(Respond({ items: [] as string[] })),
        })),
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
        users: dsl.defineEndpoint("/admin/users/create", ({ Sync, Request, Respond, Actions }) => ({
          create: Sync((_vars) => ({
            when: Actions(Request({})),
            then: Actions(Respond({ ok: true })),
          })),
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

    const endpoint = dsl.defineEndpoint("/test", ({ Sync, Request, Respond, Actions }) => ({
      main: Sync((_vars) => ({
        when: Actions(Request({})),
        then: Actions(Respond({ ok: true })),
      })),
    }));

    const syncs = syncMap({ test: endpoint });
    expect(syncs["test.main"]).toBeDefined();
    expect(syncs["test.main"]).toBe(endpoint.syncs.main);
  });

  test("syncMap handles deep nesting with mixed endpoints and objects", () => {
    const dsl = createEndpointDsl(makeBoundary());

    const api = {
      api: {
        v1: {
          auth: dsl.defineEndpoint("/api/v1/auth/login", ({ Sync, Request, Respond, Actions }) => ({
            login: Sync((_vars) => ({
              when: Actions(Request({ email: "string" })),
              then: Actions(Respond({ token: "string" })),
            })),
            register: Sync((_vars) => ({
              when: Actions(Request({ email: "string", password: "string" })),
              then: Actions(Respond({ id: "string" })),
            })),
          })),
          todos: dsl.defineEndpoint("/api/v1/todos", ({ Sync, Request, Respond, Actions }) => ({
            create: Sync((_vars) => ({
              when: Actions(Request({ title: "string" })),
              then: Actions(Respond({ id: "string" })),
            })),
            list: Sync((_vars) => ({
              when: Actions(Request({})),
              then: Actions(Respond({ items: [] as unknown[] })),
            })),
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
