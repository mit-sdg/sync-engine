import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { applicationManifest } from "@mit-sdg/sync-engine/tooling";
import { createHttpHandler } from "@mit-sdg/sync-engine-http/handler";
import { createMessageBoard } from "../src/application.ts";
import { createMessageBoardClient } from "../src/client.ts";
import { AuthenticatingConcept } from "../src/concepts/authenticating/authenticating.ts";
import { SessioningConcept } from "../src/concepts/sessioning/sessioning.ts";
import { messageBoardCorrelation, messageBoardPolicy } from "../src/edge.ts";
import { listenerOptionsFromEnvironment, validateHttpOrigin } from "../src/host-config.ts";

const hosts: ChildProcess[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.kill();
});

async function availablePort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  if (address === null || typeof address === "string") throw new Error("Could not select a port.");
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function startHost(
  port: number,
  source = "host.ts",
  readyMessage = "Message board listening",
): Promise<ChildProcess> {
  const host = spawn(
    process.platform === "win32" ? "bun.exe" : "bun",
    [fileURLToPath(new URL(`../src/${source}`, import.meta.url))],
    {
      cwd: fileURLToPath(new URL("../../..", import.meta.url)),
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  hosts.push(host);
  await new Promise<void>((resolve, reject) => {
    host.once("error", reject);
    host.once("exit", (code) =>
      reject(new Error(`Host exited before listening (${String(code)}).`)),
    );
    host.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes(readyMessage)) resolve();
    });
  });
  return host;
}

function networkCookieFetch(origin: string) {
  let cookie: string | undefined;
  let lastSetCookie: string | null = null;
  const fetchWithCookies = async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("Origin", origin);
    if (cookie !== undefined) headers.set("Cookie", cookie);
    const response = await fetch(input, { ...init, headers });
    lastSetCookie = response.headers.get("Set-Cookie");
    if (lastSetCookie?.includes("Max-Age=0")) cookie = undefined;
    else if (lastSetCookie !== null) cookie = lastSetCookie.split(";", 1)[0];
    return response;
  };
  return {
    fetch: fetchWithCookies,
    cookie: () => cookie,
    lastSetCookie: () => lastSetCookie,
  };
}

function post(path: string, body: unknown, cookie?: string) {
  return new Request(`http://localhost:3000/api${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie === undefined ? {} : { Cookie: cookie }),
    },
    body: JSON.stringify(body),
  });
}

describe("message board application", () => {
  test("serves a plain POST/JSON API without frontend assets or cookie policy", async () => {
    const port = await availablePort();
    await startHost(port, "api-host.ts", "Message board API listening");
    const origin = `http://127.0.0.1:${port}`;

    const registration = await fetch(`${origin}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "api-user", password: "correct horse" }),
    });
    expect(registration.status).toBe(200);
    expect(await registration.json()).toEqual({
      username: "api-user",
      session: expect.any(String),
      expiresAt: expect.any(String),
    });
    expect(registration.headers.get("Set-Cookie")).toBeNull();

    const root = await fetch(`${origin}/`);
    expect(root.status).toBe(400);
    expect(await root.json()).toEqual({ error: "INVALID_REQUEST" });
  });

  test("serves the browser and completes the typed network session lifecycle", async () => {
    const port = await availablePort();
    await startHost(port);
    const origin = `http://127.0.0.1:${port}`;
    const page = await fetch(`${origin}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("content as external identities");
    const script = await fetch(`${origin}/app.js`);
    expect(script.status).toBe(200);
    expect(script.headers.get("Content-Type")).toContain("text/javascript");

    const jar = networkCookieFetch(origin);
    const client = createMessageBoardClient({
      baseUrl: `${origin}/api`,
      fetch: jar.fetch as typeof fetch,
    });
    await expect(client.board.list({})).resolves.toEqual({ error: "UNAUTHORIZED" });
    expect(jar.lastSetCookie()).toContain("Max-Age=0");

    await expect(
      client.auth.register({ username: "ari", password: "correct horse" }),
    ).resolves.toEqual({ username: "ari" });
    expect(jar.cookie()).toMatch(/^__Host-message-board-session=/);
    await expect(client.auth.current({})).resolves.toEqual({ username: "ari" });

    await expect(client.auth["sign-out"]({})).resolves.toEqual({ signedOut: true });
    await expect(
      client.auth["sign-in"]({ username: "ari", password: "correct horse" }),
    ).resolves.toEqual({ username: "ari" });

    const posted = await client.board.post({ content: "A small complete app" });
    if ("error" in posted) throw new Error(`Could not publish: ${posted.error}`);
    const commented = await client.board.comment({
      target: posted.post,
      content: "external-content-reference",
    });
    expect(commented).toHaveProperty("comment");
    await expect(client.board.list({})).resolves.toEqual({
      board: {
        posts: [
          {
            post: posted.post,
            author: "ari",
            content: "A small complete app",
            comments: [
              {
                comment: "comment" in commented ? commented.comment : "unreachable",
                author: "ari",
                content: "external-content-reference",
              },
            ],
          },
        ],
      },
    });

    const comment = "comment" in commented ? commented.comment : "unreachable";
    await expect(client.board["retract-comment"]({ comment })).resolves.toEqual({ comment });
    await expect(client.board.list({})).resolves.toEqual({
      board: {
        posts: [
          { post: posted.post, author: "ari", content: "A small complete app", comments: [] },
        ],
      },
    });
    await expect(client.board["retract-comment"]({ comment })).resolves.toEqual({
      error: "NOT_FOUND",
    });

    await expect(client.auth["sign-out"]({})).resolves.toEqual({ signedOut: true });
    expect(jar.cookie()).toBeUndefined();
    expect(jar.lastSetCookie()).toContain("Max-Age=0");
    await expect(client.board.list({})).resolves.toEqual({ error: "UNAUTHORIZED" });
  });

  test("only the comment author may retract it", async () => {
    const port = await availablePort();
    await startHost(port);
    const origin = `http://127.0.0.1:${port}`;
    const author = createMessageBoardClient({
      baseUrl: `${origin}/api`,
      fetch: networkCookieFetch(origin).fetch as typeof fetch,
    });
    const other = createMessageBoardClient({
      baseUrl: `${origin}/api`,
      fetch: networkCookieFetch(origin).fetch as typeof fetch,
    });
    await author.auth.register({ username: "ari", password: "correct horse" });
    await other.auth.register({ username: "bob", password: "correct horse" });

    const posted = await author.board.post({ content: "A small complete app" });
    if ("error" in posted) throw new Error(`Could not publish: ${posted.error}`);
    const commented = await author.board.comment({ target: posted.post, content: "reply-42" });
    if ("error" in commented) throw new Error(`Could not comment: ${commented.error}`);

    await expect(other.board["retract-comment"]({ comment: commented.comment })).resolves.toEqual({
      error: "FORBIDDEN",
    });
    await expect(author.board["retract-comment"]({ comment: commented.comment })).resolves.toEqual({
      comment: commented.comment,
    });
  });

  test("the handler overwrites session claims and rejects author claims", async () => {
    const authenticating = new AuthenticatingConcept(() => "salt");
    const sessioning = new SessioningConcept(
      () => new Date("2099-07-20T12:00:00.000Z"),
      () => "real-session",
    );
    const { application, gateway } = createMessageBoard({
      Authenticating: authenticating,
      Sessioning: sessioning,
    });
    const handler = createHttpHandler({
      application,
      gateway,
      policy: messageBoardPolicy,
      correlation: messageBoardCorrelation,
    });
    await handler(post("/auth/register", { username: "ari", password: "correct horse" }));
    const signedIn = await handler(
      post("/auth/sign-in", { username: "ari", password: "correct horse" }),
    );
    const cookie = signedIn.headers.get("Set-Cookie")?.split(";", 1)[0];
    if (cookie === undefined) throw new Error("Expected a session cookie.");
    expect(await signedIn.json()).toEqual({ username: "ari" });

    const spoofedSession = await handler(
      post("/board/post", { session: "invented", content: "accepted" }, cookie),
    );
    expect(spoofedSession.status).toBe(200);
    const spoofedAuthor = await handler(
      post("/board/post", { content: "rejected", author: "admin" }, cookie),
    );
    expect(spoofedAuthor.status).toBe(400);
    expect(await spoofedAuthor.json()).toEqual({ error: "INVALID_REQUEST" });
  });

  test("rejects invalid listener and origin environment configuration early", () => {
    expect(() => listenerOptionsFromEnvironment({ HOST: "", PORT: "3000" })).toThrow(/HOST/);
    expect(() => listenerOptionsFromEnvironment({ HOST: "localhost", PORT: "3.5" })).toThrow(
      /PORT/,
    );
    expect(() => listenerOptionsFromEnvironment({ HOST: "localhost", PORT: "65536" })).toThrow(
      /PORT/,
    );
    expect(() => validateHttpOrigin("https://user@example.test", "PUBLIC_ORIGIN")).toThrow(
      /PUBLIC_ORIGIN/,
    );
    expect(() => validateHttpOrigin("https://example.test/path", "PUBLIC_ORIGIN")).toThrow(
      /PUBLIC_ORIGIN/,
    );
  });

  test("validates every endpoint and pins the credential-free projected wire", async () => {
    const { application } = createMessageBoard();
    expect(
      applicationManifest(application).endpoints.every(
        ({ validators }) => validators.input && validators.output,
      ),
    ).toBe(true);
    const wire = await readFile(new URL("../generated/wire.ts", import.meta.url), "utf8");
    const projected = wire.slice(wire.indexOf("MessageBoardWireHttp"));
    expect(projected).not.toContain('"session":');
    expect(projected).not.toContain('"expiresAt":');
    expect(projected).toContain('"UNAUTHORIZED"');
    expect(projected).not.toContain('"UNKNOWN_SESSION"');
  });
});
