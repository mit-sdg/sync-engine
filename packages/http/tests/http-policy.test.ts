import { describe, expect, test } from "vite-plus/test";
import { assemble, conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";
import {
  bindTransport,
  createGateway,
  endpoint,
  receive,
  respond,
} from "@mit-sdg/sync-engine/boundary";
import {
  httpPolicy,
  HttpPolicyBrand,
  type HttpCookieBinding,
  type HttpPolicyInit,
} from "@mit-sdg/sync-engine-http/policy";
import { createHttpHandler } from "@mit-sdg/sync-engine-http/handler";
import { httpWire } from "@mit-sdg/sync-engine-http/tooling";

class UnknownSession extends Error {}
class Denied extends Error {}

class Sessioning {
  start(_: Record<string, never>) {
    return {
      session: "secret-session",
      token: "secret-token",
      expiresAt: new Date("2099-07-20T12:00:00.000Z"),
      user: "maya",
    };
  }

  verify({ session }: { session: string }) {
    if (session === "denied") throw new Denied("denied");
    if (session !== "secret-session" && session !== "secret-token") {
      throw new UnknownSession("unknown");
    }
    return { user: "maya" };
  }

  end(_: { session: string }) {
    return { ended: true };
  }
}

const sessioningSpec = `# Sessioning

## Purpose

Identify a caller.

## Principle

A session expires.

## Types

\`\`\`types
external Person
  The identity associated with a session.
\`\`\`

## State

\`\`\`state
a set of Sessions with
  a session Session
  a token Session
  an expiration Time
  a user Person
\`\`\`

## Actions

\`\`\`actions
start() : return (session: Session, token: Session, expiresAt: Time, user: Person)
  where true
  then
    add a new session
    return session, token, expiresAt, user

verify(session: Session) : return (user: Person)
  where session is denied
  then
    refuse DENIED "This session lacks permission."
  where session not in sessions
  then
    refuse UNKNOWN_SESSION "This session is not known."
  where session is known
  then
    return user

end(session: Session) : return (ended: Flag)
  where true
  then
    delete session
    return ended
\`\`\`

## Queries

\`\`\`queries
\`\`\`
`;

function applicationWith(extra: Record<string, unknown> = {}) {
  const set = conceptSet({
    Sessioning: registerConcept({
      class: Sessioning,
      spec: sessioningSpec,
      refusals: { UNKNOWN_SESSION: UnknownSession, DENIED: Denied },
    }),
  });
  const Sessions = set.concepts.Sessioning;
  const issue = (path: string) =>
    endpoint(path, ({ session, token, expiresAt, user }) =>
      receive({})
        .then(Sessions.start({}).responds({ session, token, expiresAt, user }))
        .then(respond({ session, token, expiresAt, user })),
    );
  const Login = issue("/login");
  const Register = issue("/register");
  const Rotate = endpoint(
    "/rotate",
    ({ session, token, expiresAt, user }) =>
      receive({ session })
        .then(Sessions.start({}).responds({ session, token, expiresAt, user }))
        .then(respond({ session, token, expiresAt, user })),
    { input: { required: ["session"] } },
  );
  const Me = endpoint(
    "/me",
    ({ session, user }) =>
      receive({ session })
        .then(Sessions.verify({ session }).responds({ user }))
        .then(respond({ user })),
    { input: { required: ["session"] } },
  );
  const Token = endpoint(
    "/token",
    ({ token, user }) =>
      receive({ token })
        .then(Sessions.verify({ session: token }).responds({ user }))
        .then(respond({ user })),
    { input: { required: ["token"] } },
  );
  const Logout = endpoint(
    "/logout",
    ({ session }) =>
      receive({ session })
        .then(Sessions.end({ session }))
        .then(respond({ ended: true })),
    { input: { required: ["session"] } },
  );
  return assemble({
    conceptSet: set,
    composition: { Login, Logout, Me, Register, Rotate, Token, ...extra },
  });
}

const sessionCookie: HttpCookieBinding = {
  name: "session",
  input: "session",
  issue: [
    { path: "/login", value: "session", expires: "expiresAt" },
    { path: "/register", value: "session", expires: "expiresAt" },
    { path: "/rotate", value: "session", expires: "expiresAt" },
  ],
  clear: ["/logout"],
};

function sessionPolicy(overrides: Partial<HttpPolicyInit> = {}) {
  return httpPolicy({
    publicOrigin: "https://api.test",
    publicErrors: { UNKNOWN_SESSION: "UNAUTHORIZED", DENIED: "FORBIDDEN" },
    cookies: { session: sessionCookie },
    ...overrides,
  });
}

function setup(policy = sessionPolicy()) {
  const application = applicationWith();
  const gateway = createGateway({ application });
  return {
    application,
    gateway,
    handler: createHttpHandler({ application, gateway, policy }),
    policy,
  };
}

function post(
  path: string,
  options: { body?: unknown; cookie?: string; origin?: string; contentType?: string } = {},
) {
  return new Request(`https://api.test${path}`, {
    method: "POST",
    headers: {
      ...(options.contentType === null
        ? {}
        : { "Content-Type": options.contentType ?? "application/json" }),
      ...(options.cookie === undefined ? {} : { Cookie: options.cookie }),
      ...(options.origin === undefined ? {} : { Origin: options.origin }),
    },
    body: JSON.stringify(options.body ?? {}),
  });
}

describe("httpPolicy", () => {
  test("normalizes and deeply freezes one branded snapshot", () => {
    const init = {
      publicOrigin: "https://api.test/",
      basePath: "/api/",
      browser: { origins: ["https://app.test/"] },
      publicErrors: { PRIVATE: "NOT_FOUND" as const },
    };
    const policy = httpPolicy(init);
    init.browser.origins[0] = "https://changed.test";

    expect(policy.publicOrigin).toBe("https://api.test");
    expect(policy.basePath).toBe("/api");
    expect(policy.browser?.origins).toEqual(["https://app.test"]);
    expect(policy[HttpPolicyBrand]).toBe(true);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.browser?.origins)).toBe(true);
  });

  test("supports a policy-free plain JSON handler and wire", async () => {
    const application = applicationWith();
    const gateway = createGateway({ application });
    const handler = createHttpHandler({ application, gateway });
    const response = await handler(post("/me", { body: { session: "secret-session" } }));
    const projected = httpWire({ name: "PlainHttp" }).project(
      bindTransport({ application, gateway }),
    ).wire;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: "maya" });
    expect(JSON.stringify(projected.endpoints.find(({ path }) => path === "/me")?.input)).toContain(
      "session",
    );
  });

  test("rejects raw policy objects at handler and wire boundaries", () => {
    const application = applicationWith();
    const gateway = createGateway({ application });
    const raw = {} as never;
    expect(() => createHttpHandler({ application, gateway, policy: raw })).toThrow(
      "createHttpHandler: policy must be created by httpPolicy().",
    );
    expect(() => httpWire({ name: "Raw", policy: raw })).toThrow(
      "httpWire: policy must be created by httpPolicy().",
    );
  });

  test.each(["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"])(
    "accepts loopback cookie origin %s",
    (publicOrigin) => expect(() => sessionPolicy({ publicOrigin })).not.toThrow(),
  );

  test("requires a secure or loopback public origin for cookies", () => {
    expect(() => sessionPolicy({ publicOrigin: "http://api.test" })).toThrow(
      /publicOrigin must use HTTPS or a loopback host/,
    );
    expect(() => httpPolicy({ cookies: { session: sessionCookie } })).toThrow(
      /publicOrigin is required for cookies/,
    );
  });

  test("requires publicOrigin for credentialed browser access", () => {
    expect(() =>
      httpPolicy({ browser: { origins: ["https://app.test"], credentials: true } }),
    ).toThrow(/publicOrigin is required for credentialed browser access/);
  });

  test("rejects inert browser cookie bindings", () => {
    expect(() => sessionPolicy({ browser: { origins: ["https://app.test"] } })).toThrow(
      /browser.credentials to be true/,
    );
  });

  test("derives SameSite and prefixes while retaining the advanced escape hatch", () => {
    const strict = sessionPolicy();
    const crossSite = sessionPolicy({
      browser: { origins: ["https://app.test"], credentials: true },
    });
    const strengthened = sessionPolicy({
      browser: { origins: ["https://app.test"], credentials: true },
      cookies: { session: { ...sessionCookie, sameSite: "Strict" } },
    });

    expect(strict.cookies?.session.sameSite).toBe("Strict");
    expect(crossSite.cookies?.session.sameSite).toBe("None");
    expect(strengthened.cookies?.session.sameSite).toBe("Strict");
    expect(() =>
      sessionPolicy({ cookies: { session: { ...sessionCookie, sameSite: "Strict" } } }),
    ).toThrow(/field sameSite requires a browser policy/);
  });

  test("rejects every unsafe cookie and origin combination", () => {
    expect(() =>
      sessionPolicy({
        browser: { origins: ["https://app.test"], credentials: true },
        requestOrigins: false,
      }),
    ).toThrow(/requestOrigins cannot be false/);
    expect(() =>
      sessionPolicy({
        browser: { origins: ["https://app.test/path"], credentials: true },
      }),
    ).toThrow(/must contain only an HTTP or HTTPS origin/);
    expect(() =>
      sessionPolicy({
        browser: { origins: ["https://app.test"], credentials: true },
        requestOrigins: { allowed: ["https://api.test"] },
      }),
    ).toThrow(/must include browser origin/);
    expect(() =>
      sessionPolicy({
        cookies: {
          session: { ...sessionCookie, name: "__Host-session", domain: "example.test" },
        },
      }),
    ).toThrow(/__Host- prefix with an incompatible domain or path/);
  });

  test("validates limits, headers, duplicate bindings, and endpoint declarations", () => {
    expect(() => httpPolicy({ limits: { requestBodyBytes: 0 } })).toThrow(/positive safe integer/);
    expect(() =>
      httpPolicy({ browser: { origins: ["https://app.test"], allowedHeaders: ["bad header"] } }),
    ).toThrow(/valid header name/);
    expect(() =>
      sessionPolicy({
        cookies: {
          first: sessionCookie,
          second: { ...sessionCookie, name: "other" },
        },
      }),
    ).toThrow(/duplicate cookie input/);
    expect(() =>
      sessionPolicy({
        cookies: { session: { ...sessionCookie, clear: ["/logout", "/logout"] } },
      }),
    ).toThrow(/clear endpoints must be distinct/);
    expect(() =>
      sessionPolicy({
        cookies: { session: { ...sessionCookie, clear: ["/login"] } },
      }),
    ).toThrow(/cannot issue and clear/);
  });
});

describe("application-bound policy validation", () => {
  test("rejects unknown paths and missing issue outputs at handler construction", () => {
    const application = applicationWith();
    const gateway = createGateway({ application });
    expect(() =>
      createHttpHandler({
        application,
        gateway,
        policy: sessionPolicy({
          cookies: { session: { ...sessionCookie, clear: ["/unknown"] } },
        }),
      }),
    ).toThrow(/cookie "session" names unknown endpoint "\/unknown"/);
    expect(() =>
      createHttpHandler({
        application,
        gateway,
        policy: sessionPolicy({
          cookies: {
            session: {
              ...sessionCookie,
              issue: [{ path: "/login", value: "missing", expires: "expiresAt" }],
            },
          },
        }),
      }),
    ).toThrow(/issue endpoint "\/login" has no output "missing"/);
  });

  test("rejects optional credential inputs and overlapping protection", () => {
    const set = conceptSet({
      Sessioning: registerConcept({
        class: Sessioning,
        spec: sessioningSpec,
        refusals: { UNKNOWN_SESSION: UnknownSession, DENIED: Denied },
      }),
    });
    const Sessions = set.concepts.Sessioning;
    const Optional = endpoint(
      "/optional",
      ({ session, user }) =>
        receive({ session })
          .then(Sessions.verify({ session }).responds({ user }))
          .then(respond({ user })),
      { input: { defaults: { session: "secret-session" } } },
    );
    const Overlap = endpoint(
      "/overlap",
      ({ session, token, user }) =>
        receive({ session, token })
          .then(Sessions.verify({ session }).responds({ user }))
          .then(respond({ user })),
      { input: { required: ["session", "token"] } },
    );
    const application = applicationWith({ Optional, Overlap });
    const gateway = createGateway({ application });
    expect(() => createHttpHandler({ application, gateway, policy: sessionPolicy() })).toThrow(
      /endpoint "\/optional" mentions cookie "session" input "session" without requiring it/,
    );

    const withoutOptional = applicationWith({ Overlap });
    const secondGateway = createGateway({ application: withoutOptional });
    expect(() =>
      createHttpHandler({
        application: withoutOptional,
        gateway: secondGateway,
        policy: sessionPolicy({
          cookies: {
            session: sessionCookie,
            token: {
              name: "token",
              input: "token",
              issue: [{ path: "/login", value: "token", expires: "expiresAt" }],
              clear: [],
            },
          },
        }),
      }),
    ).toThrow(/endpoint "\/overlap" is protected by cookies "session" and "token"/);
  });

  test("handler and projection reject the same invalid assembly-policy pairing", () => {
    const application = applicationWith();
    const gateway = createGateway({ application });
    const policy = sessionPolicy({
      cookies: { session: { ...sessionCookie, clear: ["/missing"] } },
    });
    const binding = bindTransport({ application, gateway });
    expect(() => createHttpHandler({ application, gateway, policy })).toThrow(/\/missing/);
    expect(() => httpWire({ name: "Parity", policy }).project(binding)).toThrow(/\/missing/);
  });
});

describe("HTTP handler", () => {
  test("issues from every declared route, rotates, projects private fields, and clears", async () => {
    const { handler } = setup();
    for (const path of ["/login", "/register"]) {
      const response = await handler(post(path));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ token: "secret-token", user: "maya" });
      expect(response.headers.get("Set-Cookie")).toContain(
        "__Host-session=secret-session; HttpOnly; SameSite=Strict; Path=/; Secure",
      );
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    const rotated = await handler(post("/rotate", { cookie: "__Host-session=secret-session" }));
    expect(rotated.status).toBe(200);
    expect(await rotated.json()).toEqual({ token: "secret-token", user: "maya" });

    const ended = await handler(post("/logout", { cookie: "__Host-session=secret-session" }));
    expect(ended.status).toBe(200);
    expect(ended.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(ended.headers.get("Cache-Control")).toBe("no-store");
  });

  test("overwrites body credentials, injects null, and clears only unauthorized failures", async () => {
    const { handler } = setup();
    const accepted = await handler(
      post("/me", {
        body: { session: "body-session" },
        cookie: "__Host-session=secret-session",
      }),
    );
    expect(await accepted.json()).toEqual({ user: "maya" });

    const absent = await handler(post("/me", { body: { session: "secret-session" } }));
    expect(absent.status).toBe(401);
    expect(absent.headers.get("Set-Cookie")).toContain("Max-Age=0");

    const forbidden = await handler(post("/me", { cookie: "__Host-session=denied" }));
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get("Set-Cookie")).toBeNull();
  });

  test("clears only the binding responsible for an unauthorized path", async () => {
    const { handler } = setup(
      sessionPolicy({
        cookies: {
          session: sessionCookie,
          token: {
            name: "token",
            input: "token",
            issue: [{ path: "/login", value: "token", expires: "expiresAt" }],
            clear: [],
          },
        },
      }),
    );
    const response = await handler(post("/token"));
    expect(response.status).toBe(401);
    expect(response.headers.get("Set-Cookie")).toContain("__Host-token=");
    expect(response.headers.get("Set-Cookie")).not.toContain("__Host-session=");
  });

  test("treats malformed, duplicate, and oversized cookies as absent", async () => {
    const { handler } = setup();
    for (const cookie of [
      "__Host-session=%xx",
      "__Host-session=secret-session; __Host-session=secret-session",
      `__Host-session=${"x".repeat(17_000)}`,
    ]) {
      const response = await handler(post("/me", { cookie }));
      expect(response.status).toBe(401);
    }
  });

  test("checks origins on protected, issuing, and clearing paths but permits absent Origin", async () => {
    const { handler } = setup();
    for (const path of ["/login", "/me", "/logout"]) {
      const response = await handler(post(path, { origin: "https://evil.test" }));
      expect(response.status).toBe(403);
    }
    expect((await handler(post("/login"))).status).toBe(200);
  });

  test("can require Origin for browser-only deployments", async () => {
    const { handler } = setup(
      sessionPolicy({ requestOrigins: { allowed: ["https://api.test"], requireOrigin: true } }),
    );
    expect((await handler(post("/login"))).status).toBe(403);
    expect((await handler(post("/login", { origin: "https://api.test" }))).status).toBe(200);
  });

  test("serves credentialed preflight and applies CORS to successes and errors", async () => {
    const policy = sessionPolicy({
      browser: {
        origins: ["https://app.test"],
        credentials: true,
        allowedHeaders: ["X-Trace"],
        exposedHeaders: ["X-Request-Id"],
        maxAgeSeconds: 600,
      },
    });
    const { application, gateway, handler } = setup(policy);
    const preflight = await handler(
      new Request("https://api.test/login", {
        method: "OPTIONS",
        headers: {
          Origin: "https://app.test",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type, x-trace",
        },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("https://app.test");
    expect(preflight.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    expect(preflight.headers.get("Access-Control-Max-Age")).toBe("600");
    expect(preflight.headers.get("Vary")).toContain("Access-Control-Request-Headers");

    const issued = await handler(post("/login", { origin: "https://app.test" }));
    expect(issued.headers.get("Set-Cookie")).toContain("SameSite=None");
    expect(issued.headers.get("Set-Cookie")).toContain("Secure");

    for (const request of [
      post("/login", { origin: "https://app.test" }),
      post("/me", { origin: "https://app.test" }),
      post("/me", { origin: "https://app.test", cookie: "__Host-session=denied" }),
      post("/missing", { origin: "https://app.test" }),
      new Request("https://api.test/login", {
        method: "GET",
        headers: { Origin: "https://app.test" },
      }),
    ]) {
      const response = await handler(request);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.test");
      expect(response.headers.get("Vary")).toContain("Origin");
    }

    const internal = createHttpHandler({
      application,
      gateway,
      policy,
      responseHeaders() {
        throw new Error("private");
      },
    });
    const failed = await internal(post("/login", { origin: "https://app.test" }));
    expect(failed.status).toBe(500);
    expect(failed.headers.get("Access-Control-Allow-Origin")).toBe("https://app.test");
  });

  test("rejects disallowed preflight origins, methods, and headers", async () => {
    const policy = httpPolicy({ browser: { origins: ["https://app.test"] } });
    const application = applicationWith();
    const gateway = createGateway({ application });
    const handler = createHttpHandler({ application, gateway, policy });
    const preflight = (origin: string, method: string, headers = "content-type") =>
      handler(
        new Request("https://api.test/login", {
          method: "OPTIONS",
          headers: {
            Origin: origin,
            "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": headers,
          },
        }),
      );
    expect((await preflight("https://evil.test", "POST")).status).toBe(403);
    expect((await preflight("https://app.test", "GET")).status).toBe(403);
    expect((await preflight("https://app.test", "POST", "authorization")).status).toBe(403);
  });

  test("rejects malformed JSON and cancels an oversized streamed body", async () => {
    const application = applicationWith();
    const gateway = createGateway({ application });
    const handler = createHttpHandler({ application, gateway });
    const malformed = await handler(
      new Request("https://api.test/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      }),
    );
    expect(malformed.status).toBe(400);

    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1_048_577));
      },
      cancel() {
        canceled = true;
      },
    });
    const oversized = await handler(
      new Request("https://api.test/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stream,
        duplex: "half",
      } as RequestInit & { duplex: "half" }),
    );
    expect(oversized.status).toBe(400);
    expect(canceled).toBe(true);
  });

  test("enforces JSON POST and the configured body limit", async () => {
    const application = applicationWith();
    const gateway = createGateway({ application });
    const handler = createHttpHandler({
      application,
      gateway,
      policy: httpPolicy({ limits: { requestBodyBytes: 1 } }),
    });
    expect((await handler(new Request("https://api.test/login"))).status).toBe(400);
    expect((await handler(post("/login", { contentType: "text/plain" }))).status).toBe(400);
    expect((await handler(post("/login"))).status).toBe(400);
  });

  test("drops response hook attempts to replace security headers and contains hook failures", async () => {
    const application = applicationWith();
    const gateway = createGateway({ application });
    const policy = sessionPolicy({
      browser: { origins: ["https://app.test"], credentials: true },
    });
    const handler = createHttpHandler({
      application,
      gateway,
      policy,
      responseHeaders: {
        "Access-Control-Allow-Origin": "https://evil.test",
        "Cache-Control": "public",
        "Set-Cookie": "stolen=yes",
        "X-Version": "1",
      },
    });
    const response = await handler(post("/login", { origin: "https://app.test" }));
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.test");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Set-Cookie")).toContain("__Host-session=");
    expect(response.headers.get("X-Version")).toBe("1");

    expect(() =>
      createHttpHandler({
        application,
        gateway,
        correlation: { resolve: () => "trace", responseHeader: "Set-Cookie" },
      }),
    ).toThrow(/responseHeader is reserved by HTTP policy/);

    const failing = createHttpHandler({
      application,
      gateway,
      responseHeaders() {
        throw new Error("private");
      },
    });
    const failed = await failing(post("/login"));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "INTERNAL_ERROR" });
  });
});

describe("HTTP wire projection", () => {
  test("omits every protected input and issued field while preserving public errors", () => {
    const { application, gateway, policy } = setup();
    const wire = httpWire({ name: "SessionHttp", policy }).project(
      bindTransport({ application, gateway }),
    ).wire;
    for (const path of ["/login", "/register", "/rotate"]) {
      const endpoint = wire.endpoints.find((candidate) => candidate.path === path);
      expect(JSON.stringify(endpoint?.output)).not.toContain("session");
      expect(JSON.stringify(endpoint?.output)).not.toContain("expiresAt");
    }
    expect(JSON.stringify(wire.endpoints.find(({ path }) => path === "/me")?.input)).not.toContain(
      "session",
    );
    expect(wire.endpoints.find(({ path }) => path === "/me")?.errors).toContain("UNAUTHORIZED");
  });

  test("projects multiple disjoint bindings", () => {
    const application = applicationWith();
    const gateway = createGateway({ application });
    const policy = sessionPolicy({
      cookies: {
        session: sessionCookie,
        token: {
          name: "token",
          input: "token",
          issue: [{ path: "/login", value: "token", expires: "expiresAt" }],
          clear: [],
        },
      },
    });
    const wire = httpWire({ name: "TwoCookies", policy }).project(
      bindTransport({ application, gateway }),
    ).wire;
    expect(JSON.stringify(wire.endpoints.find(({ path }) => path === "/me")?.input)).not.toContain(
      "session",
    );
    expect(
      JSON.stringify(wire.endpoints.find(({ path }) => path === "/token")?.input),
    ).not.toContain("token");
  });
});
