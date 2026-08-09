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
  httpPolicy,
  type HttpCookiePolicy,
  type HttpPolicy,
  type HttpPublicErrorCategory,
} from "@mit-sdg/sync-engine-http/server";
import { httpWire } from "@mit-sdg/sync-engine-http/tooling";

class UnknownSession extends Error {}

class Sessioning {
  constructor(
    private readonly issued = "secret-session",
    private readonly expiry = new Date("2099-07-20T12:00:00.000Z"),
  ) {}

  start(_: Record<string, never>) {
    return { session: this.issued, expiresAt: this.expiry, user: "maya" };
  }

  rotate({ session }: { session: string }) {
    if (session !== "secret-session") throw new UnknownSession("unknown");
    return {
      replacement: "rotated-session",
      refreshExpiresAt: new Date("2099-07-21T12:00:00.000Z"),
      user: "maya",
    };
  }

  verify({ session }: { session: string }) {
    if (session !== "secret-session" && session !== "rotated-session") {
      throw new UnknownSession("unknown");
    }
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

rotate (session: Session) : return (replacement: Session, refreshExpiresAt: Time, user: Person)
  where session not in sessions
  then
    refuse UNKNOWN_SESSION "This session is not known."
  where session in sessions
  then
    replace session
    return replacement, refreshExpiresAt, and user

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

const loginIssue = { path: "/login", value: "session", expires: "expiresAt" } as const;
const rotationIssue = {
  path: "/rotate",
  value: "replacement",
  expires: "refreshExpiresAt",
} as const;

const defaultCookie: HttpCookiePolicy = {
  name: "session",
  input: "session",
  issue: [loginIssue, rotationIssue],
  clear: ["/logout"],
};

const defaultPolicy: HttpPolicy = {
  origin: "https://learning.test",
  publicErrors: { UNKNOWN_SESSION: "UNAUTHORIZED" },
  cookie: defaultCookie,
};

function setup(declaration: HttpPolicy = defaultPolicy, sessioning: Sessioning = new Sessioning()) {
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
  const Rotate = endpoint(
    "/rotate",
    ({ session, replacement, refreshExpiresAt, user }) =>
      receive({ session })
        .then(Sessions.rotate({ session }).responds({ replacement, refreshExpiresAt, user }))
        .then(respond({ replacement, refreshExpiresAt, user })),
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
    instances: { ...set.implementations(), Sessioning: sessioning },
    composition: { Login, Logout, Me, Rotate },
  });
  const gateway = createGateway({ application });
  const policy = httpPolicy(declaration);
  const fetch = createHttpHandler({ application, gateway, policy });
  return { application, fetch, gateway, policy };
}

interface PostOptions {
  cookie?: string;
  origin?: string | false;
  requestOrigin?: string;
}

function post(path: string, body: unknown = {}, options: PostOptions = {}): Request {
  const requestOrigin = options.requestOrigin ?? "https://learning.test";
  const origin = options.origin === undefined ? requestOrigin : options.origin;
  return new Request(`${requestOrigin}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(origin === false ? {} : { Origin: origin }),
      ...(options.cookie === undefined ? {} : { Cookie: options.cookie }),
    },
    body: JSON.stringify(body),
  });
}

describe("HTTP policy", () => {
  test("snapshots declarations and applies secure cookie defaults", () => {
    const issue = { path: "/login", value: "session", expires: "expiresAt" };
    const publicErrors: Record<string, HttpPublicErrorCategory> = {
      UNKNOWN_SESSION: "UNAUTHORIZED",
    };
    const declaration: HttpPolicy = {
      origin: "https://learning.test/",
      publicErrors,
      cookie: { name: "session", input: "session", issue },
    };

    const policy = httpPolicy(declaration);
    issue.path = "/changed";
    publicErrors.UNKNOWN_SESSION = "NOT_FOUND";

    expect(policy).toMatchObject({ origin: "https://learning.test" });
    expect(policy.publicErrors).toEqual({ UNKNOWN_SESSION: "UNAUTHORIZED" });
    expect(policy.cookie).toMatchObject({
      issue: { path: "/login", value: "session", expires: "expiresAt" },
      clear: [],
      sameSite: "Strict",
      path: "/",
      origins: ["https://learning.test"],
    });
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.cookie)).toBe(true);
    expect(Object.isFrozen(policy.cookie?.issue)).toBe(true);
    expect(Object.isFrozen(policy.cookie?.clear)).toBe(true);
    expect(Object.isFrozen(policy.cookie?.origins)).toBe(true);
  });

  test.each([
    [
      "repeated issue paths",
      { issue: [loginIssue, loginIssue] },
      /issuing endpoints must be distinct/,
    ],
    ["an issue/clear overlap", { issue: loginIssue, clear: ["/login"] }, /cannot issue and clear/],
    ["repeated clear paths", { clear: ["/logout", "/logout"] }, /must be distinct/],
  ])("rejects %s", (_case, override, expected) => {
    expect(() =>
      httpPolicy({
        origin: "https://learning.test",
        cookie: { ...defaultCookie, ...override },
      }),
    ).toThrow(expected);
  });

  test.each([
    ["reserved cookie prefix", { name: "__Host-session" }, /safe logical cookie name/],
    ["invalid input field", { input: "session-id" }, /is not a field/],
    ["relative issue route", { issue: { ...loginIssue, path: "login" } }, /path/],
    ["relative cookie path", { path: "api" }, /cookie path: path/],
    ["unsafe cookie path", { path: "/api;Domain=other.test" }, /unsafe cookie attribute/],
    ["unsupported SameSite", { sameSite: "Default" }, /sameSite/],
    ["unrelated domain", { domain: "other.test" }, /parent DNS hostname/],
  ])("rejects an %s", (_case, override, expected) => {
    expect(() =>
      httpPolicy({
        origin: "https://api.learning.test",
        cookie: { ...defaultCookie, ...override } as HttpCookiePolicy,
      }),
    ).toThrow(expected);
  });

  test("requires HTTPS for SameSite=None", () => {
    expect(() =>
      httpPolicy({
        origin: "http://learning.test",
        cookie: { ...defaultCookie, sameSite: "None" },
      }),
    ).toThrow("httpPolicy: SameSite=None requires an HTTPS policy origin.");
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
  ])("rejects a nonportable %s base path", (_case, basePath) => {
    expect(() => httpPolicy({ origin: "https://learning.test", basePath })).toThrow(
      /httpPolicy: basePath: path/,
    );
  });
});

describe("HTTP cookie policy", () => {
  test("issues a Secure host cookie and emits only the remaining public value", async () => {
    const { fetch } = setup();
    const response = await fetch(post("/login"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: "maya" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Set-Cookie")).toBe(
      "__Host-session=secret-session; HttpOnly; SameSite=Strict; Path=/; " +
        "Expires=Mon, 20 Jul 2099 12:00:00 GMT; Secure",
    );
  });

  test("requires a present exact default Origin", async () => {
    const { fetch } = setup();
    const missing = await fetch(post("/login", {}, { origin: false }));
    const mismatched = await fetch(post("/login", {}, { origin: "https://other.test" }));
    const allowed = await fetch(post("/login"));

    expect([missing.status, mismatched.status, allowed.status]).toEqual([403, 403, 200]);
    expect(await missing.json()).toEqual({ error: "FORBIDDEN" });
    expect(await mismatched.json()).toEqual({ error: "FORBIDDEN" });
  });

  test("supports an explicit frontend origin without implementing CORS", async () => {
    const policy: HttpPolicy = {
      ...defaultPolicy,
      cookie: { ...defaultCookie, origins: ["https://app.learning.test"] },
    };
    const { fetch } = setup(policy);
    const frontend = await fetch(post("/login", {}, { origin: "https://app.learning.test" }));
    const backend = await fetch(post("/login"));

    expect(frontend.status).toBe(200);
    expect(frontend.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(backend.status).toBe(403);
  });

  test("origins:false explicitly permits requests without Origin", async () => {
    const { fetch } = setup({
      ...defaultPolicy,
      cookie: { ...defaultCookie, origins: false },
    });

    expect((await fetch(post("/login", {}, { origin: false }))).status).toBe(200);
  });

  test("uses custom SameSite, path, and domain with a valid secure prefix", async () => {
    const { fetch } = setup({
      origin: "https://api.learning.test",
      publicErrors: defaultPolicy.publicErrors,
      cookie: {
        ...defaultCookie,
        sameSite: "None",
        path: "/api",
        domain: "learning.test",
      },
    });
    const response = await fetch(
      post("/login", {}, { requestOrigin: "https://api.learning.test" }),
    );

    expect(response.headers.get("Set-Cookie")).toBe(
      "__Secure-session=secret-session; HttpOnly; SameSite=None; Path=/api; " +
        "Domain=learning.test; Expires=Mon, 20 Jul 2099 12:00:00 GMT; Secure",
    );
  });

  test("handles multiple issue routes and projects every consumed field", async () => {
    const { application, fetch, gateway, policy } = setup();
    const rotated = await fetch(
      post("/rotate", { session: "body-token" }, { cookie: "__Host-session=secret-session" }),
    );
    expect(rotated.status).toBe(200);
    expect(await rotated.json()).toEqual({ user: "maya" });
    expect(rotated.headers.get("Set-Cookie")).toContain("__Host-session=rotated-session");

    const projected = httpWire({ policy, name: "LearningWireHttp" }).project(
      bindTransport({ application, gateway }),
    ).wire;
    for (const path of ["/login", "/rotate"]) {
      const endpoint = projected.endpoints.find((candidate) => candidate.path === path);
      expect(JSON.stringify(endpoint?.output)).not.toMatch(
        /"(?:session|expiresAt|replacement|refreshExpiresAt)"/,
      );
    }
    for (const path of ["/rotate", "/me", "/logout"]) {
      const endpoint = projected.endpoints.find((candidate) => candidate.path === path);
      expect(JSON.stringify(endpoint?.input)).not.toContain('"session"');
    }
    expect(projected.endpoints.flatMap(({ errors }) => errors)).toContain("UNAUTHORIZED");
  });

  test("overwrites protected body input and clears unauthorized and successful clear routes", async () => {
    const { fetch } = setup();
    const accepted = await fetch(
      post("/me", { session: "body-token" }, { cookie: "__Host-session=secret-session" }),
    );
    expect(await accepted.json()).toEqual({ user: "maya" });

    const unauthorized = await fetch(post("/me", { session: "secret-session" }));
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(unauthorized.headers.get("Set-Cookie")).toContain(
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Secure",
    );

    const cleared = await fetch(post("/logout", {}, { cookie: "__Host-session=secret-session" }));
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ ok: true });
    expect(cleared.headers.get("Cache-Control")).toBe("no-store");
    expect(cleared.headers.get("Set-Cookie")).toContain("Max-Age=0; Secure");
  });

  test.each([
    ["an empty token", "", new Date("2099-07-20T12:00:00.000Z")],
    ["an invalid expiry", "secret", new Date("invalid")],
    ["a past expiry", "secret", new Date("2000-01-01T00:00:00.000Z")],
    ["an unreasonable token", "x".repeat(4_097), new Date("2099-07-20T12:00:00.000Z")],
  ])("rejects %s from an issue response", async (_case, token, expiry) => {
    const { fetch } = setup(defaultPolicy, new Sessioning(token, expiry));
    const response = await fetch(post("/login"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "INTERNAL_ERROR" });
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  test.each([
    [
      "an unknown route",
      { ...defaultCookie, issue: { path: "/missing", value: "session", expires: "expiresAt" } },
      /unknown cookie endpoint path/,
    ],
    [
      "a missing issue output",
      { ...defaultCookie, issue: { path: "/login", value: "missing", expires: "expiresAt" } },
      /has no output "missing"/,
    ],
    ["an unused input", { ...defaultCookie, input: "credential" }, /no endpoint declares/],
  ])("rejects %s when binding the application", (_case, cookie, expected) => {
    expect(() => setup({ ...defaultPolicy, cookie })).toThrow(expected);
  });

  test("handlers and projections snapshot raw mutable policies", async () => {
    const { application, gateway } = setup();
    const publicErrors: Record<string, HttpPublicErrorCategory> = {
      UNKNOWN_SESSION: "UNAUTHORIZED",
    };
    const issue = { path: "/login", value: "session", expires: "expiresAt" };
    const cookie = {
      name: "session",
      input: "session",
      issue: [issue],
      clear: ["/logout"],
    };
    const mutable: HttpPolicy = {
      origin: "https://learning.test",
      publicErrors,
      cookie,
    };
    const projection = httpWire({ policy: mutable, name: "SnapshotWire" });
    const fetch = createHttpHandler({ application, gateway, policy: mutable });

    cookie.input = "changed";
    issue.path = "/changed";
    publicErrors.UNKNOWN_SESSION = "NOT_FOUND";

    const wire = projection.project(bindTransport({ application, gateway })).wire;
    const me = wire.endpoints.find(({ path }) => path === "/me");
    expect(JSON.stringify(me?.input)).not.toContain("session");
    expect(me?.errors).toContain("UNAUTHORIZED");
    expect(me?.errors).not.toContain("NOT_FOUND");
    const response = await fetch(post("/login"));
    expect(response.headers.get("Set-Cookie")).toContain("__Host-session=secret-session");
  });

  test("does not replace Set-Cookie with correlation", async () => {
    const { application, gateway, policy } = setup();
    const fetch = createHttpHandler({
      application,
      gateway,
      policy,
      correlation: { resolve: () => "trace-1", responseHeader: "Set-Cookie" },
    });

    expect((await fetch(post("/login"))).headers.get("Set-Cookie")).toContain(
      "__Host-session=secret-session",
    );
  });
});

describe("plain HTTP policy", () => {
  const plainPolicy = httpPolicy({
    origin: "https://learning.test",
    basePath: "/api",
    publicErrors: { UNKNOWN_SESSION: "UNAUTHORIZED" },
  });

  test("constructs without reading cookie projection facts", () => {
    const { application, gateway } = setup(plainPolicy);
    Object.defineProperty(application.publicInterface, "routes", {
      get() {
        throw new Error("wire projection facts were read");
      },
    });

    expect(() => createHttpHandler({ application, gateway, policy: plainPolicy })).not.toThrow();
  });

  test("preserves successes, public errors, base paths, and correlation", async () => {
    const { application, gateway } = setup(plainPolicy);
    const fetch = createHttpHandler({
      application,
      gateway,
      policy: plainPolicy,
      correlation: { resolve: () => "plain-42", responseHeader: "X-Request-Id" },
    });
    const accepted = await fetch(post("/api/me", { session: "secret-session" }, { origin: false }));
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ user: "maya" });
    expect(accepted.headers.get("X-Request-Id")).toBe("plain-42");

    const refused = await fetch(post("/api/me", { session: "private-session" }, { origin: false }));
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(refused.headers.get("Set-Cookie")).toBeNull();
  });

  test("rejects a handler paired with another application's gateway", () => {
    const first = setup(plainPolicy);
    const second = setup(plainPolicy);
    expect(() =>
      createHttpHandler({
        application: first.application,
        gateway: second.gateway,
        policy: plainPolicy,
      }),
    ).toThrow(/gateway must target the supplied application/);
  });

  test.each([
    ["non-ByteString Unicode", "trace-\u0100"],
    ["a lone surrogate", "trace-\ud800"],
    ["surrounding space", " trace-1 "],
  ])("replaces %s correlation with one observer-visible UUID", async (_case, resolved) => {
    const { application } = setup(plainPolicy);
    const events: OperationalEvent[] = [];
    const gateway = createGateway({ application, observers: [(event) => events.push(event)] });
    const fetch = createHttpHandler({
      application,
      gateway,
      policy: plainPolicy,
      correlation: { resolve: () => resolved, responseHeader: "X-Request-Id" },
    });
    const response = await fetch(post("/api/me", { session: "secret-session" }, { origin: false }));
    const responseId = response.headers.get("X-Request-Id");
    const settled = events.find((event) => event.type === "invocation-settled");

    expect(responseId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(settled?.correlationId).toBe(responseId);
  });

  test("rejects an invalid correlation response header at construction", () => {
    const { application, gateway } = setup(plainPolicy);
    expect(() =>
      createHttpHandler({
        application,
        gateway,
        policy: plainPolicy,
        correlation: { resolve: () => "trace-1", responseHeader: "invalid header" },
      }),
    ).toThrow(/responseHeader must be a valid header name/);
  });

  test("rejects unsafe methods, media types, paths, and oversized bodies", async () => {
    const { fetch } = setup(plainPolicy);
    const method = await fetch(new Request("https://learning.test/api/me"));
    const media = await fetch(
      new Request("https://learning.test/api/me", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "{}",
      }),
    );
    const path = await fetch(post("/outside/me", {}, { origin: false }));
    const body = await fetch(
      new Request("https://learning.test/api/me", {
        method: "POST",
        headers: { "Content-Length": "1048577" },
        body: "{}",
      }),
    );

    expect([method.status, media.status, body.status]).toEqual([400, 400, 400]);
    expect(path.status).toBe(404);
  });

  test("cancels an oversized stream and keeps malformed JSON opaque", async () => {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1_048_577));
      },
      cancel() {
        canceled = true;
      },
    });
    const streamed = new Request("https://learning.test/api/login", {
      method: "POST",
      headers: { "Content-Length": "1", "Content-Type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const malformed = new Request("https://learning.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const { fetch } = setup(plainPolicy);

    expect((await fetch(streamed)).status).toBe(400);
    expect(canceled).toBe(true);
    const malformedResponse = await fetch(malformed);
    expect(malformedResponse.status).toBe(400);
    expect(await malformedResponse.json()).toEqual({ error: "INVALID_REQUEST" });
  });
});
