import { describe, expect, test } from "vite-plus/test";
import { assemble, conceptSet, PublicError, registerConcept } from "@sync-engine/assembly";
import {
  createGateway,
  createHttpHandler,
  endpoint,
  httpFloor,
  receive,
  respond,
} from "@sync-engine/boundary";
import { httpFloorReadBack } from "@sync-engine/tooling";
import { projectAssemblyHttpWire } from "@sync-engine/internal/boundary/http-floor";
import { assemblyBehind } from "@sync-engine/internal/boundary/assembly-registry";
import { wireContracts } from "@sync-engine/internal/boundary/wire";

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

function setup() {
  const set = conceptSet({
    Sessioning: registerConcept({
      class: Sessioning,
      spec: "# Sessioning\n\n## Purpose\n\nIdentify a caller.\n\n## Principle\n\nA session expires.",
      refusals: {
        UNKNOWN_SESSION: {
          error: UnknownSession,
          on: ["verify"],
          public: PublicError.UNAUTHORIZED,
        },
      },
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
  return { application, fetch, floor };
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
    expect(httpFloorReadBack(application, floor)).toBe(
      [
        "HTTP floor public origin: http://learning.test.",
        'Credential "session" binds cookie-only input "session" on 2 endpoints.',
        'A successful /login stores output "session" in the credential cookie and reads its expiry from "expiresAt".',
        "A successful /logout clears the credential cookie.",
      ].join("\n"),
    );
  });
});
