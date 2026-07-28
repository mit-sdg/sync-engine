import { describe, expect, test } from "vite-plus/test";
import { Logging, Reacting, vocabulary } from "@sync-engine/internal/reactions";
import type { Vars } from "@sync-engine/internal/reactions";
import {
  assemble,
  createHttpHandler,
  createInvoker,
  endpoint,
  fail,
  FrameworkErrorCode,
  receive,
  Requesting,
  respond,
} from "@sync-engine/internal/boundary";

function setup() {
  const composition = {
    Echo: endpoint("/echo", ({ message }: Vars) =>
      receive({ message }).then(respond({ echoed: message })),
    ),
    Err: endpoint("/err", ({ kind }: Vars) => receive({ kind }).then(fail({ code: kind }))),
  };
  const app = assemble({
    vocabulary: vocabulary({ concepts: {}, computations: {} }),
    composition,
  });
  const handler = createHttpHandler({ invoker: app.invoker, basePath: "/api" });

  return { handler };
}

describe("createHttpHandler", () => {
  test("refreshes standing reads before admitting each application ask", async () => {
    const reaction = new Reacting();
    reaction.logging = Logging.OFF;
    const boundary = new Requesting();
    const instrumented = reaction.instrumentConcept(boundary, "RequestBoundary");
    let refreshes = 0;
    const invoker = createInvoker({
      boundary,
      instrumented,
      contracts: { "/required": { required: ["value"] } },
      refresh: () => {
        refreshes += 1;
      },
    });

    await invoker.invoke("/required", {});

    expect(refreshes).toBe(1);
  });

  test("maps successful invocation to 200 JSON response", async () => {
    const { handler } = setup();
    const request = new Request("http://localhost/api/echo", {
      method: "POST",
      body: JSON.stringify({ message: "hello" }),
    });

    const response = await handler(request);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ echoed: "hello" });
  });

  test("resolves and projects a safe HTTP correlation identifier", async () => {
    let received: string | undefined;
    const handler = createHttpHandler({
      invoker: {
        async invoke(_path, _input, options) {
          received = options?.correlationId;
          return { ok: true, value: { ok: true } };
        },
      },
      correlation: {
        resolve: (request) => request.headers.get("X-Request-Id") ?? undefined,
        responseHeader: "X-Request-Id",
      },
    });
    const response = await handler(
      new Request("http://localhost/echo", {
        method: "POST",
        headers: { "X-Request-Id": "trace-42" },
        body: "{}",
      }),
    );

    expect(received).toBe("trace-42");
    expect(response.headers.get("X-Request-Id")).toBe("trace-42");
  });

  test("replaces an unsafe or faulting HTTP correlation identifier", async () => {
    let received: string | undefined;
    const handler = createHttpHandler({
      invoker: {
        async invoke(_path, _input, options) {
          received = options?.correlationId;
          return { ok: true, value: {} };
        },
      },
      correlation: {
        resolve: () => {
          throw new Error("untrusted resolver");
        },
        responseHeader: "X-Correlation-Id",
      },
    });
    const response = await handler(
      new Request("http://localhost/echo", { method: "POST", body: "{}" }),
    );

    expect(received).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get("X-Correlation-Id")).toBe(received);
  });

  test("maps domain error to 400 JSON response", async () => {
    const { handler } = setup();
    const request = new Request("http://localhost/api/err", {
      method: "POST",
      body: JSON.stringify({ kind: "BAD_INPUT" }),
    });

    const response = await handler(request);

    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: { code: "BAD_INPUT" } });
  });

  test("returns 405 for non-POST methods", async () => {
    const { handler } = setup();
    const request = new Request("http://localhost/api/echo", {
      method: "GET",
    });

    const response = await handler(request);

    expect(response.status).toBe(405);
  });

  test("returns 400 for invalid JSON body", async () => {
    const { handler } = setup();
    const request = new Request("http://localhost/api/echo", {
      method: "POST",
      body: "not json",
    });

    const response = await handler(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: FrameworkErrorCode.BAD_JSON,
      detail: "Invalid request body",
    });
  });

  test("strips basePath from URL", async () => {
    const { handler } = setup();
    const request = new Request("http://localhost/api/echo", {
      method: "POST",
      body: JSON.stringify({ message: "basepath-test" }),
    });

    const response = await handler(request);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ echoed: "basepath-test" });
  });

  test("returns 404 when path is empty after basePath strip", async () => {
    const reaction = new Reacting();
    reaction.logging = Logging.OFF;
    const boundary = new Requesting();
    const instrumented = reaction.instrumentConcept(boundary, "RequestBoundary");
    const invoker = createInvoker({ boundary, instrumented });
    const handler = createHttpHandler({ invoker, basePath: "/api" });

    const request = new Request("http://localhost/api", {
      method: "POST",
      body: "{}",
    });

    const response = await handler(request);

    expect(response.status).toBe(404);
  });

  test("rejects paths outside basePath without crossing segment boundaries", async () => {
    const { handler } = setup();

    const outside = await handler(
      new Request("http://localhost/echo", { method: "POST", body: '{"message":"outside"}' }),
    );
    const adjacent = await handler(
      new Request("http://localhost/apiary/echo", {
        method: "POST",
        body: '{"message":"adjacent"}',
      }),
    );

    expect(outside.status).toBe(404);
    expect(await outside.json()).toEqual({
      error: FrameworkErrorCode.NOT_FOUND,
      detail: "Unknown endpoint: /echo",
    });
    expect(adjacent.status).toBe(404);
    expect(await adjacent.json()).toEqual({
      error: FrameworkErrorCode.NOT_FOUND,
      detail: "Unknown endpoint: /apiary/echo",
    });
  });

  test("cancels an oversized streamed body even when Content-Length is understated", async () => {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1_048_577));
      },
      cancel() {
        canceled = true;
      },
    });
    const request = new Request("http://localhost/api/echo", {
      method: "POST",
      headers: { "Content-Length": "1" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const { handler } = setup();
    const response = await handler(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: FrameworkErrorCode.INVALID_INPUT,
      detail: "Request body exceeds the 1 MiB limit",
    });
    expect(canceled).toBe(true);
  });

  test("cancels a body rejected early by Content-Length", async () => {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true;
      },
    });
    const request = new Request("http://localhost/api/echo", {
      method: "POST",
      headers: { "Content-Length": "1048577" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const { handler } = setup();
    const response = await handler(request);

    expect(response.status).toBe(413);
    expect(canceled).toBe(true);
  });

  test("maps an unserializable invocation result to opaque INTERNAL_ERROR", async () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    const handler = createHttpHandler({
      invoker: { invoke: async () => ({ ok: true as const, value }) } as never,
    });

    const response = await handler(
      new Request("http://localhost/cyclic", { method: "POST", body: "{}" }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: FrameworkErrorCode.INTERNAL_ERROR });
  });

  test("maps an unexpected invoker rejection to opaque INTERNAL_ERROR", async () => {
    const handler = createHttpHandler({
      invoker: {
        invoke: async () => {
          throw new Error("private invocation failure");
        },
      },
    });

    const response = await handler(
      new Request("http://localhost/explode", { method: "POST", body: "{}" }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: FrameworkErrorCode.INTERNAL_ERROR });
  });

  test("omits private framework details from server errors", async () => {
    const handler = createHttpHandler({
      invoker: {
        invoke: async () => ({
          ok: false as const,
          error: {
            kind: "framework" as const,
            code: FrameworkErrorCode.TRANSPORT_ERROR,
            detail: "/private/service.ts: database unavailable at internal.example",
          },
        }),
      } as never,
    });

    const response = await handler(
      new Request("http://localhost/explode", { method: "POST", body: "{}" }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: FrameworkErrorCode.TRANSPORT_ERROR });
  });
});
