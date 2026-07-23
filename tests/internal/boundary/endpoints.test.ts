import { describe, expect, test } from "vite-plus/test";
import {
  assemble,
  endpoint,
  fail,
  isEndpointDef,
  receive,
  respond,
} from "@sync-engine/internal/boundary";
import { declarationsOf, vocabulary } from "@sync-engine/internal/reactions";
import type { ActionPattern, Vars } from "@sync-engine/internal/reactions";

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
    expect(isEndpointDef(Login)).toBe(true);
    expect(isEndpointDef({ path: "/auth/login", reaction: Login.reaction })).toBe(false);
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

  test("respond carries the body and fail carries a domain error", () => {
    const Success = endpoint("/success", () => receive().then(respond({ ok: true, id: "abc" })));
    const Failure = endpoint("/failure", () => receive().then(fail({ code: "NOPE" })));

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

  test("receive has an empty output pattern", () => {
    const Ping = endpoint("/ping", () => receive().then(respond({ ok: true })));
    const pattern = declarationsOf(Ping.reaction({} as Vars))[0].when[0] as ActionPattern;
    expect(pattern.output).toEqual({});
  });

  test("fail carries a string without changing it", () => {
    const Failure = endpoint("/failure", () => receive().then(fail("NOPE")));
    const input = (
      declarationsOf(Failure.reaction({} as Vars))[0].then[0] as unknown as {
        action: { input: unknown };
      }
    ).action.input;
    expect(input).toMatchObject({ error: "NOPE" });
  });

  test("fail keeps non-plain error values intact", () => {
    const date = new Date("2024-01-01");
    const Failure = endpoint("/failure", () => receive().then(fail(date)));
    const input = (
      declarationsOf(Failure.reaction({} as Vars))[0].then[0] as unknown as {
        action: { input: unknown };
      }
    ).action.input as { error: unknown };
    expect(input.error).toBe(date);
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

  test("rejects a value that is not an absolute path", () => {
    expect(() => endpoint("relative", () => receive().then(respond({})))).toThrow(/is not a path/);
  });
});
