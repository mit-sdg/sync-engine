import { describe, expect, test } from "vite-plus/test";
import { endpoint, receive, respond } from "@sync-engine/boundary";
import { vocabulary } from "@sync-engine/advanced";
import type { Vars } from "@sync-engine/internal/reactions/types";
import { assemble } from "@sync-engine/internal/boundary/assembly/assemble";
import { declarationsOf } from "@sync-engine/internal/reactions/authoring/partitions";
import type { ActionPattern } from "@sync-engine/internal/reactions/types";

const emptyVocabulary = vocabulary({ concepts: {}, computations: {} });

describe("endpoint", () => {
  test("keeps one path, one reaction, and an optional input contract", () => {
    const Login = endpoint(
      "/auth/login",
      ({ username }: Vars) => receive({ username }).then(respond({ token: "ok" })),
      { input: { required: ["username"] } },
    );

    expect(Login.path).toBe("/auth/login");
    expect(Login.input).toEqual({ required: ["username"] });
  });

  test("the reaction produces ordinary when/then data", () => {
    const Echo = endpoint("/echo", ({ message }: Vars) =>
      receive({ message }).then(respond({ echoed: message })),
    );

    const declaration = declarationsOf(Echo.reaction({} as Vars))[0];
    expect(declaration.when).toHaveLength(1);
    expect(declaration.then).toHaveLength(1);
    expect((declaration.when[0] as ActionPattern).input).toHaveProperty("message");
  });

  test("assembly pins the endpoint path onto its receive pattern", () => {
    const Search = endpoint("/search", ({ query }: Vars) =>
      receive({ query }).then(respond({ results: [] })),
    );
    const app = assemble({ vocabulary: emptyVocabulary, composition: { Search } });

    const reaction = app.engine.exportReactions().reactions.find(({ name }) => name === "Search");
    expect(reaction?.when[0]).toMatchObject({
      kind: "action",
      concept: "RequestBoundary",
      action: "request",
      input: { path: "/search" },
    });
  });

  test("rejects an authored receive path when the endpoint is registered", () => {
    const Colliding = endpoint("/declared", ({ path }: Vars) =>
      receive({ path }).then(respond({ ok: true })),
    );

    expect(() => assemble({ vocabulary: emptyVocabulary, composition: { Colliding } })).toThrow(
      'receive(...) cannot author the boundary-owned "path" field.',
    );
  });

  test("respond carries success bodies and domain errors", () => {
    const Success = endpoint("/success", () => receive().then(respond({ ok: true, id: "abc" })));
    const Failure = endpoint("/failure", () =>
      receive().then(respond({ error: { code: "NOPE" } })),
    );

    const successInput = (
      declarationsOf(Success.reaction({} as Vars))[0].then[0] as unknown as {
        action: { input: unknown };
      }
    ).action.input;
    const failureInput = (
      declarationsOf(Failure.reaction({} as Vars))[0].then[0] as unknown as {
        action: { input: unknown };
      }
    ).action.input;
    expect(successInput).toMatchObject({ ok: true, id: "abc" });
    expect(failureInput).toMatchObject({ error: { code: "NOPE" } });
  });

  test("separate endpoint exports remain separate composition reactions", () => {
    const Create = endpoint("/items", ({ name }: Vars) =>
      receive({ name }).then(respond({ id: "created" })),
    );
    const List = endpoint("/items", () => receive({}).then(respond({ items: [] })));
    const app = assemble({ vocabulary: emptyVocabulary, composition: { Create, List } });

    expect(app.engine.exportReactions().reactions.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["Create", "List"]),
    );
  });

  test("receive accepts an empty input", () => {
    const Ping = endpoint("/ping", () => receive().then(respond({ ok: true })));
    expect(declarationsOf(Ping.reaction({} as Vars))[0].when).toHaveLength(1);
  });

  test("receive keeps every authored input field", () => {
    const Filter = endpoint("/filter", ({ type, status }: Vars) =>
      receive({ type, status }).then(respond({ ok: true })),
    );
    const pattern = declarationsOf(Filter.reaction({} as Vars))[0].when[0] as ActionPattern;
    expect(pattern.input).toHaveProperty("type");
    expect(pattern.input).toHaveProperty("status");
  });

  test("reserves the response correlation field for the boundary", () => {
    expect(() => respond({ requestId: "author value" })).toThrow(
      'respond(...) cannot author the boundary-owned "requestId" field.',
    );
  });

  test("reserves framework classification for the boundary", () => {
    expect(() => respond({ error: "DOMAIN", errorKind: "framework" })).toThrow(
      'respond(...) cannot author the boundary-owned "errorKind" field.',
    );
  });

  test("receive has an empty output pattern", () => {
    const Ping = endpoint("/ping", () => receive().then(respond({ ok: true })));
    const pattern = declarationsOf(Ping.reaction({} as Vars))[0].when[0] as ActionPattern;
    expect(pattern.output).toEqual({});
  });

  test("different paths own independent reaction functions", () => {
    const Login = endpoint("/login", () => receive().then(respond({ token: "ok" })));
    const Logout = endpoint("/logout", () => receive().then(respond({ ok: true })));
    expect(Login.reaction).not.toBe(Logout.reaction);
  });

  test("nested composition supplies the reaction's dotted name", () => {
    const Create = endpoint("/admin/users", () => receive().then(respond({ ok: true })));
    const app = assemble({
      vocabulary: emptyVocabulary,
      composition: { admin: { users: { Create } } },
    });
    expect(app.engine.exportReactions().reactions.map(({ name }) => name)).toContain(
      "admin.users.Create",
    );
  });

  test("untagged composition values do not become reactions", () => {
    const app = assemble({
      vocabulary: emptyVocabulary,
      composition: { helper: "plain", count: 2 },
    });
    expect(app.engine.exportReactions().reactions.map(({ name }) => name)).not.toEqual(
      expect.arrayContaining(["helper", "count"]),
    );
  });

  test("nullish composition leaves are ignored", () => {
    const app = assemble({
      vocabulary: emptyVocabulary,
      composition: { absent: null, missing: undefined },
    });
    expect(app.engine.exportReactions().reactions.map(({ name }) => name)).not.toEqual(
      expect.arrayContaining(["absent", "missing"]),
    );
  });

  test("deeply nested endpoints all register", () => {
    const Login = endpoint("/v1/login", () => receive().then(respond({ token: "ok" })));
    const List = endpoint("/v1/items", () => receive().then(respond({ items: [] })));
    const app = assemble({
      vocabulary: emptyVocabulary,
      composition: { api: { v1: { auth: { Login }, items: { List } } } },
    });
    expect(app.engine.exportReactions().reactions.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["api.v1.auth.Login", "api.v1.items.List"]),
    );
  });

  test("input defaults remain part of the endpoint definition", () => {
    const Note = endpoint("/notes", () => receive().then(respond({ ok: true })), {
      input: { required: ["note"], defaults: { note: null } },
    });
    expect(Note.input).toEqual({ required: ["note"], defaults: { note: null } });
  });

  test("assembly rejects nonportable endpoint defaults", () => {
    const Dated = endpoint("/dated", () => receive().then(respond({ ok: true })), {
      input: { defaults: { at: new Date(0) } },
    });

    expect(() => assemble({ vocabulary: emptyVocabulary, composition: { Dated } })).toThrow(
      "input defaults for /dated must be canonical JSON-portable",
    );
  });

  test("public routes receive a canonical deep copy of endpoint defaults", () => {
    const defaults = { settings: { z: 2, a: 1 } };
    const Configured = endpoint("/configured", () => receive().then(respond({ ok: true })), {
      input: { defaults },
    });
    const app = assemble({ vocabulary: emptyVocabulary, composition: { Configured } });

    defaults.settings.a = 9;
    expect(app.publicInterface.routes["/configured"]?.defaults).toEqual({
      settings: { a: 1, z: 2 },
    });
    expect(
      Object.keys((app.publicInterface.routes["/configured"]?.defaults?.settings ?? {}) as object),
    ).toEqual(["a", "z"]);
    expect(app.publicInterface.routes["/configured"]).not.toBe(app.contracts["/configured"]);
  });

  test("receive and respond share one correlation binding", () => {
    const Echo = endpoint("/echo", () => receive().then(respond({ ok: true })));
    const declaration = declarationsOf(Echo.reaction({} as Vars))[0];
    const requestId = (declaration.when[0] as ActionPattern).input.requestId;
    const responseInput = (
      declaration.then[0] as unknown as { action: { input: Record<string, unknown> } }
    ).action.input;
    expect(responseInput.requestId).toBe(requestId);
  });

  test("an endpoint reaction may state sibling answer paths", () => {
    const Echo = endpoint("/echo", () =>
      receive().then(
        respond({ first: true }).named("first"),
        respond({ second: true }).named("second"),
      ),
    );
    expect(declarationsOf(Echo.reaction({} as Vars))).toHaveLength(2);
  });

  test("supports the root and URL-stable percent-encoded path data", () => {
    expect(endpoint("/", () => receive().then(respond({}))).path).toBe("/");
    expect(endpoint("/caf%C3%A9/%23", () => receive().then(respond({}))).path).toBe(
      "/caf%C3%A9/%23",
    );
  });

  test.each([
    ["relative path", "relative"],
    ["query", "/items?limit=1"],
    ["fragment", "/items#section"],
    ["scheme-relative origin", "//other.test/items"],
    ["space", "/has space"],
    ["noncanonical Unicode", "/cafe\u0301"],
    ["dot segment", "/a/../items"],
    ["encoded dot segment", "/a/%2e%2e/items"],
    ["malformed percent encoding", "/bad%escape"],
    ["URL-normalized separator", "/a\\items"],
  ])("rejects a nonportable %s", (_case, path) => {
    expect(() => endpoint(path, () => receive().then(respond({})))).toThrow(
      /endpoint\(\.\.\.\): path/,
    );
  });
});
