import { describe, expect, test } from "vite-plus/test";
import { Logging, SyncConcept } from "@sync-engine/engine";
import type { Vars } from "@sync-engine/engine";
import {
  createEndpointDsl,
  createHttpHandler,
  createInvoker,
  RequestBoundaryConcept,
  syncMap,
} from "@sync-engine/sdk";

function setup() {
  const sync = new SyncConcept();
  sync.logging = Logging.OFF;

  const boundary = new RequestBoundaryConcept();
  const instrumented = sync.instrumentConcept(boundary);
  const dsl = createEndpointDsl(instrumented);

  const api = {
    echo: dsl.endpoint("/echo", ({ request, respond }) => ({
      Echo: ({ message }: Vars) => request({ message }).then(respond({ echoed: message })),
    })),
    err: dsl.endpoint("/err", ({ request, fail }) => ({
      Err: ({ kind }: Vars) => request({ kind }).then(fail({ code: kind })),
    })),
  };

  sync.register(syncMap(api));
  const invoker = createInvoker({ boundary, instrumented });
  const handler = createHttpHandler({ invoker, basePath: "/api" });

  return { handler };
}

describe("createHttpHandler", () => {
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

  test("maps domain error to 400 JSON response", async () => {
    const { handler } = setup();
    const request = new Request("http://localhost/api/err", {
      method: "POST",
      body: JSON.stringify({ kind: "BAD_INPUT" }),
    });

    const response = await handler(request);

    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ code: "BAD_INPUT" });
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
    const sync = new SyncConcept();
    sync.logging = Logging.OFF;
    const boundary = new RequestBoundaryConcept();
    const instrumented = sync.instrumentConcept(boundary);
    const invoker = createInvoker({ boundary, instrumented });
    const handler = createHttpHandler({ invoker, basePath: "/api" });

    const request = new Request("http://localhost/api", {
      method: "POST",
      body: "{}",
    });

    const response = await handler(request);

    expect(response.status).toBe(404);
  });
});
