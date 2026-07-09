import { describe, expect, test } from "vite-plus/test";
import { createCliClient, createCliTransport } from "@sync-engine/sdk/cli-client";
import type { Client } from "@sync-engine/sdk";
import { FrameworkErrorCode } from "@sync-engine/sdk";

type TestApi = {
  "/auth/login": { input: { username: string; password: string }; output: { token: string } };
  "/ping": { input: Record<string, never>; output: { ok: boolean } };
  "/echo": { input: { message: string }; output: { message: string } };
};

const ECHO_SCRIPT = `process.stdin.on('data',(d)=>{const r=JSON.parse(d);process.stdout.write(JSON.stringify(r))})`;

function makeClient(script: string, args: string[] = []): Client<TestApi> {
  return createCliClient<TestApi>({
    command: "node",
    args: [...args, "-e", script],
  });
}

describe("createCliClient", () => {
  test("writes { path, input } JSON to stdin and parses stdout", async () => {
    const client = makeClient(ECHO_SCRIPT);

    const result = await client.auth.login({ username: "alice", password: "secret" });

    expect(result).toEqual({
      path: "/auth/login",
      input: { username: "alice", password: "secret" },
    });
  });

  test("supports empty input", async () => {
    const client = makeClient(ECHO_SCRIPT);

    const result = await client.ping();

    expect(result).toEqual({ path: "/ping", input: {} });
  });

  test("supports indexed path style", async () => {
    const client = makeClient(ECHO_SCRIPT);

    const result = await client["/auth/login"]({ username: "alice", password: "secret" });

    expect(result).toEqual({
      path: "/auth/login",
      input: { username: "alice", password: "secret" },
    });
  });

  test("returns BAD_JSON for invalid stdout", async () => {
    const client = makeClient(`process.stdout.write("not json")`);

    const result = await client.auth.login({ username: "a", password: "b" });

    expect(result).toEqual({
      error: FrameworkErrorCode.BAD_JSON,
      detail: expect.stringContaining("Invalid JSON"),
    });
  });

  test("returns COMMAND_FAILED for non-zero exit with stderr detail", async () => {
    const client = makeClient(`process.stderr.write("fatal error");process.exit(3)`);

    const result = await client.auth.login({ username: "a", password: "b" });

    expect(result).toEqual({
      error: FrameworkErrorCode.COMMAND_FAILED,
      detail: expect.stringContaining("exited with code 3"),
    });
    expect(result).toEqual(
      expect.objectContaining({
        detail: expect.stringContaining("fatal error"),
      }),
    );
  });

  test("returns COMMAND_TIMED_OUT when timeout is exceeded", async () => {
    const client = createCliClient<TestApi>({
      command: "node",
      args: ["-e", `setTimeout(() => process.exit(0), 5000)`],
      timeoutMs: 100,
    });

    const result = await client.auth.login({ username: "a", password: "b" });

    expect(result).toEqual({
      error: FrameworkErrorCode.COMMAND_TIMED_OUT,
      detail: expect.stringContaining("timed out"),
    });
  });

  test("returns PROCESS_ERROR for spawn failures", async () => {
    const client = createCliClient<TestApi>({
      command: "/nonexistent/command/xyz",
    });

    const result = await client.auth.login({ username: "a", password: "b" });

    expect(result).toEqual({
      error: FrameworkErrorCode.PROCESS_ERROR,
      detail: expect.stringContaining("failed to start"),
    });
  });

  test("returns PROCESS_ERROR for spawn failures even with timeout", async () => {
    const client = createCliClient<TestApi>({
      command: "/nonexistent/command/xyz",
      timeoutMs: 100,
    });

    const result = await client.auth.login({ username: "a", password: "b" });

    expect(result).toEqual({
      error: FrameworkErrorCode.PROCESS_ERROR,
      detail: expect.stringContaining("failed to start"),
    });
  });

  test("returns empty object for empty stdout", async () => {
    const client = createCliClient<TestApi>({
      command: "node",
      args: ["-e", ""],
    });

    const result = await client.auth.login({ username: "a", password: "b" });

    expect(result).toEqual({});
  });
});

describe("createCliTransport", () => {
  test("transport function can be used with createClient directly", async () => {
    const { createClient } = await import("@sync-engine/sdk");
    const transport = createCliTransport({
      command: "node",
      args: ["-e", ECHO_SCRIPT],
    });
    const client = createClient<TestApi>({ transport });

    const result = await client.auth.login({ username: "alice", password: "secret" });

    expect(result).toEqual({
      path: "/auth/login",
      input: { username: "alice", password: "secret" },
    });
  });
});
