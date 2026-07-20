import { describe, expect, test } from "vite-plus/test";
import { Logging, Reacting, vocabulary } from "@sync-engine/internal/reactions";
import type { Vars } from "@sync-engine/internal/reactions";
import {
  assemble,
  createHttpHandler,
  createInvoker,
  endpoint,
  fail,
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
});
