import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { httpFloor, productionHttpProfile } from "@mit-sdg/sync-engine/boundary";
import { buildProductionHttp } from "../src/edge.ts";
import { runScenario } from "../src/scenario.ts";
import { SessioningConcept } from "../src/concepts/sessioning/sessioning.ts";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

function post(path: string, body: unknown, options: { cookie?: string; requestId?: string } = {}) {
  return new Request(`https://production-http.test/api${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.cookie === undefined ? {} : { Cookie: options.cookie }),
      ...(options.requestId === undefined ? {} : { "X-Request-Id": options.requestId }),
    },
    body: JSON.stringify(body),
  });
}

describe("production HTTP application", () => {
  test("issues, binds, rejects, and clears the cookie credential", async () => {
    const { floorHandler } = buildProductionHttp({
      Sessioning: new SessioningConcept(() => new Date("2026-07-20T12:00:00.000Z")),
    });
    const started = await floorHandler(
      post("/sessions/start", { user: "Maya" }, { requestId: "request-42" }),
    );
    expect(started.status).toBe(200);
    expect(await started.json()).toEqual({ user: "Maya" });
    expect(started.headers.get("Cache-Control")).toBe("no-store");
    expect(started.headers.get("X-Request-Id")).toBe("request-42");
    const setCookie = started.headers.get("Set-Cookie");
    expect(setCookie).toBe(
      "__Host-session=session-maya; HttpOnly; SameSite=Strict; Path=/; " +
        "Expires=Mon, 20 Jul 2026 12:30:00 GMT; Secure",
    );
    const cookie = setCookie?.split(";", 1)[0];
    if (cookie === undefined) throw new Error("Expected the issued credential cookie.");

    const protectedResponse = await floorHandler(
      post("/sessions/current", { session: "body-credential" }, { cookie }),
    );
    expect(protectedResponse.status).toBe(200);
    expect(await protectedResponse.json()).toEqual({ user: "Maya" });

    const unauthorized = await floorHandler(post("/sessions/current", { session: "session-maya" }));
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(unauthorized.headers.get("Set-Cookie")).toContain(
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0",
    );

    const ended = await floorHandler(post("/sessions/end", {}, { cookie }));
    expect(ended.status).toBe(200);
    expect(await ended.json()).toEqual({ ended: true });
    expect(ended.headers.get("Cache-Control")).toBe("no-store");
    expect(ended.headers.get("Set-Cookie")).toContain(
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0",
    );
  });

  test("rejects, clears, and deletes an expired cookie credential", async () => {
    let now = new Date("2026-07-20T12:00:00.000Z");
    const { floorHandler } = buildProductionHttp({
      Sessioning: new SessioningConcept(() => now),
    });
    const started = await floorHandler(post("/sessions/start", { user: "Maya" }));
    const cookie = started.headers.get("Set-Cookie")?.split(";", 1)[0];
    if (cookie === undefined) throw new Error("Expected the issued credential cookie.");

    now = new Date("2026-07-20T12:30:00.000Z");
    const expired = await floorHandler(post("/sessions/current", {}, { cookie }));
    expect(expired.status).toBe(401);
    expect(await expired.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(expired.headers.get("Set-Cookie")).toContain(
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0",
    );

    now = new Date("2026-07-20T12:29:00.000Z");
    const deleted = await floorHandler(post("/sessions/current", {}, { cookie }));
    expect(deleted.status).toBe(401);
    expect(await deleted.json()).toEqual({ error: "UNAUTHORIZED" });
  });

  test("uses the credential-free profile and maps a registered conflict", async () => {
    const { profileHandler } = buildProductionHttp();
    const claimed = await profileHandler(post("/names/claim", { name: "atlas" }));
    expect(claimed.status).toBe(200);
    expect(await claimed.json()).toEqual({ name: "atlas" });

    const duplicate = await profileHandler(post("/names/claim", { name: "atlas" }));
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: "CONFLICT" });
    expect(duplicate.headers.get("Set-Cookie")).toBeNull();
  });

  test("rejects non-HTTPS public origins in production", () => {
    process.env.NODE_ENV = "production";
    expect(() => productionHttpProfile({ origin: "http://production-http.test" })).toThrow(
      "productionHttpProfile: production requires an HTTPS public origin.",
    );
    expect(() =>
      httpFloor({
        origin: "http://production-http.test",
        credential: {
          name: "session",
          input: "session",
          issue: { path: "/sessions/start", output: "session", expires: "expiresAt" },
          clear: ["/sessions/end"],
        },
      }),
    ).toThrow("httpFloor: production requires an HTTPS public origin for secure cookies.");
  });

  test("pins a projected HTTP wire that hides credentials and exposes categories", async () => {
    const wire = await readFile(new URL("../generated/wire.ts", import.meta.url), "utf8");
    const projected = wire.slice(wire.indexOf("ProductionHttpWireHttp"));
    expect(projected).not.toContain('"session":');
    expect(projected).not.toContain('"expiresAt":');
    expect(projected).toContain('"UNAUTHORIZED"');
    expect(projected).toContain('"CONFLICT"');
    expect(projected).not.toContain('"UNKNOWN_SESSION"');
    expect(projected).not.toContain('"NAME_TAKEN"');
  });

  test("runs the checked scenario through both HTTP policy forms", async () => {
    await expect(runScenario()).resolves.toEqual({
      started: { user: "Maya" },
      current: { user: "Maya" },
      claimed: { name: "atlas" },
      duplicate: { error: "CONFLICT" },
      ended: { ended: true },
    });
  });
});
