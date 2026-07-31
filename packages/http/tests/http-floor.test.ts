import { describe, expect, test } from "vite-plus/test";
import { assemble, conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";
import {
  bindTransport,
  createGateway,
  endpoint,
  receive,
  respond,
  type OperationalEvent,
} from "@mit-sdg/sync-engine/boundary";
import {
  createHttpHandler,
  httpFloor,
  productionHttpProfile,
  type HttpFloor,
  type HttpPublicErrorCategory,
  type ProductionHttpProfile,
} from "@mit-sdg/sync-engine-http/server";
import { httpWire } from "@mit-sdg/sync-engine-http/tooling";

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
    publicErrors: { UNKNOWN_SESSION: "UNAUTHORIZED" },
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

describe("HTTP floor", () => {
  test("rejects one endpoint configured to issue and clear credentials", () => {
    const { floor } = setup();
    expect(() =>
      httpFloor({
        ...floor,
        credential: { ...floor.credential, clear: [floor.credential.issue.path] },
      }),
    ).toThrowError(new Error('httpFloor: "/login" cannot issue and clear credentials.'));
  });

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

  test("does not replace an existing response header with correlation", async () => {
    const { application, floor, gateway } = setup();
    const fetch = createHttpHandler({
      application,
      floor,
      gateway,
      correlation: { resolve: () => "trace-1", responseHeader: "Set-Cookie" },
    });
    const response = await fetch(
      new Request("http://learning.test/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );

    expect(response.headers.get("Set-Cookie")).toContain("session=secret-session");
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
    const { application, fetch, floor, gateway } = setup();
    const rejected = await fetch(
      new Request("http://learning.test/login", {
        method: "POST",
        headers: { Origin: "https://other.test", "Content-Type": "application/json" },
        body: "{}",
      }),
    );
    expect(rejected.status).toBe(403);

    const projected = httpWire({ policy: floor, name: "LearningWireHttp" }).project(
      bindTransport({ application, gateway }),
    ).wire;
    const login = projected.endpoints.find(({ path }) => path === "/login");
    const me = projected.endpoints.find(({ path }) => path === "/me");
    expect(JSON.stringify(login?.output)).not.toMatch(/session|expiresAt/);
    expect(JSON.stringify(me?.input)).not.toContain("session");
  });

  test("snapshots raw mutable policies when handlers and projectors are constructed", async () => {
    const { application, floor, gateway } = setup();
    const binding = bindTransport({ application, gateway });
    const mutableProfile: ProductionHttpProfile = {
      origin: floor.origin,
      publicErrors: { UNKNOWN_SESSION: "UNAUTHORIZED" },
    };
    const profileProjection = httpWire({
      policy: mutableProfile,
      name: "ProfileWire",
    });
    (mutableProfile.publicErrors as Record<string, HttpPublicErrorCategory>).UNKNOWN_SESSION =
      "NOT_FOUND";

    const profileWire = profileProjection.project(binding).wire;
    const me = profileWire.endpoints.find(({ path }) => path === "/me");
    expect(me?.errors).toContain("UNAUTHORIZED");
    expect(me?.errors).not.toContain("NOT_FOUND");

    const mutableFloor: HttpFloor = {
      origin: floor.origin,
      publicErrors: { ...floor.publicErrors },
      credential: {
        ...floor.credential,
        issue: { ...floor.credential.issue },
        clear: [...floor.credential.clear],
      },
    };
    const floorProjection = httpWire({ policy: mutableFloor, name: "FloorWire" });
    const fetch = createHttpHandler({ application, gateway, floor: mutableFloor });
    (mutableFloor.credential as { input: string }).input = "changed";

    const floorWire = floorProjection.project(binding).wire;
    const protectedEndpoint = floorWire.endpoints.find(({ path }) => path === "/me");
    expect(JSON.stringify(protectedEndpoint?.input)).not.toContain("session");
    const response = await fetch(
      new Request("http://learning.test/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );
    expect(response.headers.get("Set-Cookie")).toContain("session=secret-session");
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
});

describe("production HTTP profile", () => {
  test("constructs a plain profile handler without reading wire projection facts", () => {
    const { application, gateway } = setup();
    Object.defineProperty(application.publicInterface, "routes", {
      get() {
        throw new Error("wire projection facts were read");
      },
    });
    const profile = productionHttpProfile({ origin: "https://learning.test" });

    expect(() => createHttpHandler({ application, gateway, profile })).not.toThrow();
  });

  test("preserves successes and projects registered categories behind a base path", async () => {
    const { application, gateway } = setup();
    const fetch = createHttpHandler({
      application,
      gateway,
      profile: productionHttpProfile({
        origin: "https://learning.test",
        basePath: "/api",
        publicErrors: { UNKNOWN_SESSION: "UNAUTHORIZED" },
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

  test.each(["profile", "floor"])(
    "rejects a %s handler paired with another app's gateway",
    (kind) => {
      const first = setup();
      const second = setup();
      expect(() =>
        kind === "profile"
          ? createHttpHandler({
              application: first.application,
              gateway: second.gateway,
              profile: productionHttpProfile({ origin: "https://learning.test" }),
            })
          : createHttpHandler({
              application: first.application,
              gateway: second.gateway,
              floor: first.floor,
            }),
      ).toThrow(/gateway must target the supplied application/);
    },
  );

  test("rejects a gateway target split across two assembled applications", () => {
    const first = setup();
    const second = setup();
    expect(() =>
      createGateway({
        application: {
          invoker: second.application.invoker,
          publicInterface: first.application.publicInterface,
        },
      }),
    ).toThrow(/publicInterface must belong to its invoker/);
  });

  test.each([
    ["non-ByteString Unicode", "trace-\u0100"],
    ["a lone surrogate", "trace-\ud800"],
  ])("replaces %s correlation with a header-safe UUID", async (_case, resolved) => {
    const { application, gateway } = setup();
    const fetch = createHttpHandler({
      application,
      gateway,
      profile: productionHttpProfile({ origin: "https://learning.test" }),
      correlation: { resolve: () => resolved, responseHeader: "X-Request-Id" },
    });

    const response = await fetch(
      new Request("https://learning.test/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: "secret-session" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Request-Id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test("rejects an invalid correlation response header at construction", () => {
    const { application, gateway } = setup();
    expect(() =>
      createHttpHandler({
        application,
        gateway,
        profile: productionHttpProfile({ origin: "https://learning.test" }),
        correlation: { resolve: () => "trace-1", responseHeader: "invalid header" },
      }),
    ).toThrow(/responseHeader must be a valid header name/);
  });

  test("replaces surrounding-space correlation so observers and headers share one identifier", async () => {
    const { application } = setup();
    const events: OperationalEvent[] = [];
    const gateway = createGateway({ application, observers: [(event) => events.push(event)] });
    const fetch = createHttpHandler({
      application,
      gateway,
      profile: productionHttpProfile({ origin: "https://learning.test" }),
      correlation: { resolve: () => " trace-1 ", responseHeader: "X-Request-Id" },
    });

    const response = await fetch(
      new Request("https://learning.test/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: "secret-session" }),
      }),
    );
    const responseId = response.headers.get("X-Request-Id");
    const settled = events.find((event) => event.type === "invocation-settled");

    expect(response.status).toBe(200);
    expect(responseId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(settled?.correlationId).toBe(responseId);
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
