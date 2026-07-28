import { describe, expect, test } from "vite-plus/test";
import { assemble, conceptSet, PublicError, registerConcept } from "@sync-engine/assembly";
import {
  createGateway,
  createHttpHandler,
  endpoint,
  httpFloor,
  productionHttpProfile,
  receive,
  respond,
} from "@sync-engine/boundary";
import { projectAssemblyHttpWire } from "@sync-engine/internal/boundary/http/http-floor";
import { projectProductionHttpWire } from "@sync-engine/internal/boundary/http/http-profile";
import { assemblyBehind } from "@sync-engine/internal/boundary/assembly/assembly-registry";
import { wireContracts } from "@sync-engine/internal/boundary/wire/wire-contracts";

class UnknownSession extends Error {}

class Sessioning {
  start(_: Record<string, never>) {
    return {
      session: "secret-session",
      expiresAt: new Date("2026-07-20T12:00:00.000Z"),
      user: "maya",
    };
  }

  verify({ session }: { session: string }) {
    if (session !== "secret-session") throw new UnknownSession("unknown");
    return { user: "maya" };
  }

  end(_: { session: string }) {
    return { ok: true };
  }
}

const sessioningSpec = `# Sessioning

## Purpose

Identify a caller.

## Principle

A session expires.

## Actions

\`\`\`actions
start () : return (session: Session, expiresAt: Time, user: Person)
  then
    add a new session
    return session, expiresAt, and user

verify (session: Session) : return (user: Person)
  where session not in sessions
  then
    refuse UNKNOWN_SESSION "This session is not known."
  where session in sessions
  then
    return user

end (session: Session) : return (ok: Flag)
  then
    delete session
    return ok
\`\`\`
`;

function setup() {
  const set = conceptSet({
    Sessioning: registerConcept({
      class: Sessioning,
      spec: sessioningSpec,
      refusals: { UNKNOWN_SESSION: UnknownSession },
      publicErrors: { UNKNOWN_SESSION: PublicError.UNAUTHORIZED },
    }),
  });
  const { Sessioning: Sessions } = set.concepts;
  const Login = endpoint("/login", ({ session, expiresAt, user }) =>
    receive({})
      .then(Sessions.start({}).responds({ session, expiresAt, user }))
      .then(respond({ session, expiresAt, user })),
  );
  const Me = endpoint(
    "/me",
    ({ session, user }) =>
      receive({ session })
        .then(Sessions.verify({ session }).responds({ user }))
        .then(respond({ user })),
    { input: { required: ["session"] } },
  );
  const Logout = endpoint(
    "/logout",
    ({ session }) =>
      receive({ session })
        .then(Sessions.end({ session }))
        .then(respond({ ok: true })),
    { input: { required: ["session"] } },
  );
  const application = assemble({
    vocabulary: set.vocabulary,
    composition: { Login, Logout, Me },
  });
  const gateway = createGateway({ application });
  const floor = httpFloor({
    origin: "http://learning.test",
    credential: {
      name: "session",
      input: "session",
      issue: { path: "/login", output: "session", expires: "expiresAt" },
      clear: ["/logout"],
    },
  });
  const fetch = createHttpHandler({ application, gateway, floor });
  return { application, fetch, floor, gateway };
}

function poisonPublicCategories(application: ReturnType<typeof setup>["application"]): void {
  const categories = assemblyBehind(application).publicErrors as Record<string, string>;
  Object.setPrototypeOf(categories, { INHERITED_CATEGORY: "FORBIDDEN" });
  Object.defineProperty(categories, "MALFORMED_CATEGORY", {
    value: "toString",
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

async function expectOpaqueRuntimeCodes(
  handlerFor: (gateway: {
    invoke: () => Promise<unknown>;
  }) => (request: Request) => Promise<Response>,
  url: string,
): Promise<void> {
  let code = "";
  const handler = handlerFor({
    invoke: async () => ({
      ok: false as const,
      error: { kind: "domain" as const, value: code, detail: "private refusal detail" },
    }),
  });
  for (const runtimeCode of [
    "toString",
    "constructor",
    "__proto__",
    "INHERITED_CATEGORY",
    "MALFORMED_CATEGORY",
  ]) {
    code = runtimeCode;
    const response = await handler(
      new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );
    expect(response.status, runtimeCode).toBe(500);
    expect(await response.json(), runtimeCode).toEqual({ error: "INTERNAL_ERROR" });
  }
}

describe("HTTP floor", () => {
  test("binds a cookie from the concept-owned expiry and hides consumed fields", async () => {
    const { fetch } = setup();
    const response = await fetch(
      new Request("http://learning.test/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: "maya" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Set-Cookie")).toBe(
      "session=secret-session; HttpOnly; SameSite=Strict; Path=/; " +
        "Expires=Mon, 20 Jul 2026 12:00:00 GMT",
    );
  });

  test("uses only the cookie on protected routes and clears unauthorized credentials", async () => {
    const { fetch } = setup();
    const accepted = await fetch(
      new Request("http://learning.test/me", {
        method: "POST",
        headers: { Cookie: "session=secret-session", "Content-Type": "application/json" },
        body: JSON.stringify({ session: "body-token" }),
      }),
    );
    expect(await accepted.json()).toEqual({ user: "maya" });

    const refused = await fetch(
      new Request("http://learning.test/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: "secret-session" }),
      }),
    );
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(refused.headers.get("Set-Cookie")).toContain("Expires=Thu, 01 Jan 1970");
  });

  test("enforces the declared origin and projects the browser wire", async () => {
    const { application, fetch, floor } = setup();
    const rejected = await fetch(
      new Request("http://learning.test/login", {
        method: "POST",
        headers: { Origin: "https://other.test", "Content-Type": "application/json" },
        body: "{}",
      }),
    );
    expect(rejected.status).toBe(403);

    const assembled = assemblyBehind(application);
    const raw = wireContracts(assembled.engine.exportReactions(), {
      contracts: assembled.contracts,
      inventories: assembled.engine.exportConcepts(),
    });
    const projected = projectAssemblyHttpWire(application, raw, floor);
    const login = projected.endpoints.find(({ path }) => path === "/login");
    const me = projected.endpoints.find(({ path }) => path === "/me");
    expect(JSON.stringify(login?.output)).not.toMatch(/session|expiresAt/);
    expect(JSON.stringify(me?.input)).not.toContain("session");
  });

  test("has no implicit /api alias and requires an explicit base path", async () => {
    const { application, fetch, floor, gateway } = setup();
    const implicit = await fetch(
      new Request("http://learning.test/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );
    expect(implicit.status).toBe(404);
    expect(await implicit.json()).toEqual({ error: "NOT_FOUND" });

    const explicitFloor = httpFloor({ ...floor, basePath: "/api" });
    const explicit = createHttpHandler({ application, gateway, floor: explicitFloor });
    const accepted = await explicit(
      new Request("http://learning.test/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );
    expect(accepted.status).toBe(200);
  });

  test("fails closed for prototype, inherited, and malformed floor categories", async () => {
    const { application, floor } = setup();
    poisonPublicCategories(application);
    await expectOpaqueRuntimeCodes(
      (gateway) => createHttpHandler({ application, floor, gateway: gateway as never }),
      "http://learning.test/me",
    );
  });

  test("cancels an oversized streamed body without trusting Content-Length", async () => {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1_048_577));
      },
      cancel() {
        canceled = true;
      },
    });
    const request = new Request("http://learning.test/login", {
      method: "POST",
      headers: { "Content-Length": "1", "Content-Type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const { fetch } = setup();
    const response = await fetch(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_REQUEST" });
    expect(canceled).toBe(true);
  });

  test("keeps malformed JSON opaque", async () => {
    const { fetch } = setup();
    const response = await fetch(
      new Request("http://learning.test/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_REQUEST" });
  });

  test("maps an unserializable floor result to opaque INTERNAL_ERROR", async () => {
    const { application, floor } = setup();
    const value: Record<string, unknown> = {};
    value.self = value;
    const fetch = createHttpHandler({
      application,
      floor,
      gateway: { invoke: async () => ({ ok: true as const, value }) } as never,
    });

    const response = await fetch(
      new Request("http://learning.test/cyclic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "INTERNAL_ERROR" });
  });

  test("maps an unexpected gateway rejection to opaque INTERNAL_ERROR", async () => {
    const { application, floor } = setup();
    const fetch = createHttpHandler({
      application,
      floor,
      gateway: {
        invoke: async () => {
          throw new Error("private floor failure");
        },
      },
    });

    const response = await fetch(
      new Request("http://learning.test/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "INTERNAL_ERROR" });
  });

  test.each([
    ["credential issue", "/login"],
    ["credential clear", "/logout"],
    ["ordinary success", "/me"],
  ])("contains hostile %s result access as opaque INTERNAL_ERROR", async (_case, path) => {
    const { application, floor } = setup();
    const result = {
      ok: true as const,
      get value(): unknown {
        throw new Error("hostile success value");
      },
    };
    const fetch = createHttpHandler({
      application,
      floor,
      gateway: { invoke: async () => result } as never,
      correlation: {
        resolve: () => "hostile-result",
        responseHeader: "X-Request-Id",
      },
    });

    const response = await fetch(
      new Request(`http://learning.test${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("X-Request-Id")).toBe("hostile-result");
    expect(await response.json()).toEqual({ error: "INTERNAL_ERROR" });
  });

  test.each([
    [
      "cookie encoding",
      {
        session: "\ud800",
        expiresAt: new Date("2026-07-20T12:00:00.000Z"),
        user: "maya",
      },
    ],
    [
      "public projection",
      new Proxy(
        {
          session: "secret-session",
          expiresAt: new Date("2026-07-20T12:00:00.000Z"),
          user: "maya",
        },
        {
          ownKeys() {
            throw new Error("hostile projection");
          },
        },
      ),
    ],
  ])("contains credential issue %s failures as opaque INTERNAL_ERROR", async (_case, value) => {
    const { application, floor } = setup();
    const fetch = createHttpHandler({
      application,
      floor,
      gateway: { invoke: async () => ({ ok: true as const, value }) } as never,
      correlation: {
        resolve: () => "hostile-issue",
        responseHeader: "X-Request-Id",
      },
    });

    const response = await fetch(
      new Request("http://learning.test/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("X-Request-Id")).toBe("hostile-issue");
    expect(await response.json()).toEqual({ error: "INTERNAL_ERROR" });
  });
});

describe("production HTTP profile", () => {
  test("projects unregistered and open domain errors exactly like runtime", () => {
    const projected = projectProductionHttpWire(
      {
        endpoints: [
          {
            path: "/dynamic",
            input: { kind: "json" },
            output: { kind: "json" },
            errors: ["INVALID_INPUT", "NOT_FOUND"],
            openError: true,
          },
        ],
        appWide: ["NOT_FOUND"],
      },
      {},
    );

    expect(projected).toMatchObject({
      endpoints: [
        {
          errors: ["INTERNAL_ERROR", "INVALID_REQUEST"],
          openError: false,
        },
      ],
      appWide: ["INTERNAL_ERROR"],
    });
  });

  test("keeps framework and registered domain INVALID_INPUT provenance distinct", () => {
    const base = {
      path: "/collision",
      input: { kind: "json" as const },
      output: { kind: "json" as const },
      errors: ["INVALID_INPUT"],
      openError: false,
    };
    const projected = projectProductionHttpWire(
      {
        endpoints: [
          { ...base, inputAdmissionError: true },
          { ...base, path: "/domain-only", inputAdmissionError: false },
        ],
        appWide: [],
      },
      { INVALID_INPUT: "CONFLICT" },
    );

    expect(projected.endpoints.map(({ errors }) => errors)).toEqual([
      ["CONFLICT", "INVALID_REQUEST"],
      ["CONFLICT"],
    ]);
  });

  test("preserves successes and projects registered categories behind a base path", async () => {
    const { application, gateway } = setup();
    const fetch = createHttpHandler({
      application,
      gateway,
      profile: productionHttpProfile({
        origin: "https://learning.test",
        basePath: "/api",
      }),
      correlation: {
        resolve: () => "profile-42",
        responseHeader: "X-Request-Id",
      },
    });

    const accepted = await fetch(
      new Request("https://learning.test/api/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: "secret-session" }),
      }),
    );
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ user: "maya" });
    expect(accepted.headers.get("X-Request-Id")).toBe("profile-42");

    const refused = await fetch(
      new Request("https://learning.test/api/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: "private-session" }),
      }),
    );
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(refused.headers.get("Set-Cookie")).toBeNull();
  });

  test("keeps private refusals and framework server failures opaque", async () => {
    const { application } = setup();
    const profile = productionHttpProfile({ origin: "https://learning.test" });
    const privateFetch = createHttpHandler({
      application,
      profile,
      gateway: {
        invoke: async () => ({
          ok: false as const,
          error: { kind: "domain" as const, value: "PRIVATE_REFUSAL" },
        }),
      },
    });
    const frameworkFetch = createHttpHandler({
      application,
      profile,
      gateway: {
        invoke: async () => ({
          ok: false as const,
          error: {
            kind: "framework" as const,
            code: "UNAVAILABLE" as const,
            detail: "private capacity detail",
          },
        }),
      },
    });
    const request = () =>
      new Request("https://learning.test/private", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });

    const privateResponse = await privateFetch(request());
    expect(privateResponse.status).toBe(500);
    expect(await privateResponse.json()).toEqual({ error: "INTERNAL_ERROR" });
    const frameworkResponse = await frameworkFetch(request());
    expect(frameworkResponse.status).toBe(500);
    expect(await frameworkResponse.json()).toEqual({ error: "INTERNAL_ERROR" });
  });

  test("fails closed for prototype, inherited, and malformed profile categories", async () => {
    const { application } = setup();
    poisonPublicCategories(application);
    const profile = productionHttpProfile({ origin: "https://learning.test" });
    await expectOpaqueRuntimeCodes(
      (gateway) => createHttpHandler({ application, profile, gateway: gateway as never }),
      "https://learning.test/me",
    );
  });

  test("keeps route identity across direct, gateway, profile, and floor calls", async () => {
    const { application, floor, gateway } = setup();
    const profile = createHttpHandler({
      application,
      gateway,
      profile: productionHttpProfile({ origin: "https://learning.test", basePath: "/api/" }),
    });
    const basedFloor = httpFloor({ ...floor, basePath: "/api/" });
    const floored = createHttpHandler({ application, gateway, floor: basedFloor });

    const directResult = await application.invoker.invoke(
      "/me" as never,
      {
        session: "secret-session",
      } as never,
    );
    const gatewayResult = await gateway.invoke(
      "/me" as never,
      {
        session: "secret-session",
      } as never,
    );
    const request = (origin: string, cookie = false) =>
      new Request(`${origin}/api/me`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: "session=secret-session" } : {}),
        },
        body: cookie ? "{}" : '{"session":"secret-session"}',
      });
    const profileResponse = await profile(request("https://learning.test"));
    const floorResponse = await floored(request("http://learning.test", true));

    expect(directResult).toEqual({ ok: true, value: { user: "maya" } });
    expect(gatewayResult).toEqual({ ok: true, value: { user: "maya" } });
    for (const response of [profileResponse, floorResponse]) {
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ user: "maya" });
    }
    expect(basedFloor.basePath).toBe("/api");
  });

  test.each([
    ["relative path", "api"],
    ["query", "/api?version=1"],
    ["fragment", "/api#v1"],
    ["scheme-relative origin", "//other.test/api"],
    ["space", "/bad path"],
    ["noncanonical Unicode", "/cafe\u0301"],
    ["dot segment", "/api/../v2"],
    ["encoded dot segment", "/api/%2e%2e/v2"],
    ["malformed percent encoding", "/api/%xx"],
    ["URL-normalized separator", "/api\\v2"],
  ])("rejects a nonportable %s base path on every HTTP policy", (_case, basePath) => {
    expect(() => productionHttpProfile({ origin: "https://learning.test", basePath })).toThrow(
      /productionHttpProfile: basePath: path/,
    );
    expect(() =>
      httpFloor({
        origin: "https://learning.test",
        basePath,
        credential: {
          name: "session",
          input: "session",
          issue: { path: "/login", output: "session", expires: "expiresAt" },
          clear: ["/logout"],
        },
      }),
    ).toThrow(/httpFloor: basePath: path/);
  });

  test("rejects unsafe methods, media types, paths, and oversized bodies", async () => {
    const { application, gateway } = setup();
    const fetch = createHttpHandler({
      application,
      gateway,
      profile: productionHttpProfile({
        origin: "https://learning.test",
        basePath: "/api",
      }),
    });
    const method = await fetch(new Request("https://learning.test/api/me"));
    const media = await fetch(
      new Request("https://learning.test/api/me", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "{}",
      }),
    );
    const path = await fetch(
      new Request("https://learning.test/outside/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );
    const body = await fetch(
      new Request("https://learning.test/api/me", {
        method: "POST",
        headers: { "Content-Length": "1048577" },
        body: "{}",
      }),
    );

    expect([method.status, media.status, body.status]).toEqual([400, 400, 400]);
    expect(await method.json()).toEqual({ error: "INVALID_REQUEST" });
    expect(await media.json()).toEqual({ error: "INVALID_REQUEST" });
    expect(await body.json()).toEqual({ error: "INVALID_REQUEST" });
    expect(path.status).toBe(404);
    expect(await path.json()).toEqual({ error: "NOT_FOUND" });
  });
});
