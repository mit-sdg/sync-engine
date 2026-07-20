import { describe, expect, test } from "vite-plus/test";
import { actionNameOf, request, Refuse, vocabulary } from "@sync-engine/internal/reactions";
import {
  assemble,
  createGateway,
  createHttpClient,
  createHttpHandler,
  createLocalClient,
  endpoint,
  FrameworkErrorCode,
  receive,
  respond,
} from "@sync-engine/internal/boundary";

class InvalidMessage extends Error {}

class AnsweringConcept {
  completed: string[] = [];

  echo({ message }: { message: string }) {
    if (typeof message !== "string") throw new InvalidMessage("Message must be text");
    return { message };
  }

  async slow({ message }: { message: string }) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    this.completed.push(message);
    return { message };
  }

  reject(_: Record<string, never>) {
    throw new Refuse(FrameworkErrorCode.NOT_FOUND);
  }

  explode(_: Record<string, never>) {
    throw new Error("concept unavailable");
  }
}

const appVocabulary = vocabulary({
  concepts: {
    Answering: {
      class: AnsweringConcept,
      refusals: { echo: { INVALID_MESSAGE: InvalidMessage } },
    },
  },
  computations: {},
});
const { Answering } = appVocabulary.concepts;

const Echo = endpoint("/echo", ({ message }) =>
  receive({ message }).then(
    request(Answering.echo, { message }, { message }),
    respond({ message }),
  ),
);

const Reject = endpoint("/reject", () =>
  receive({}).then(request(Answering.reject, {}), respond({ ok: true })),
);

const Slow = endpoint("/slow", ({ message }) =>
  receive({ message }).then(
    request(Answering.slow, { message }, { message }),
    respond({ message }),
  ),
);

const Explode = endpoint("/explode", () =>
  receive({}).then(request(Answering.explode, {}), respond({ ok: true })),
);

type TestApi = {
  "/echo": {
    input: { message: string };
    output: { message: string };
    error: { error: string };
  };
  "/reject": {
    input: Record<string, never>;
    output: { ok: true };
    error: { error: "NOT_FOUND" };
  };
  "/slow": {
    input: { message: string };
    output: { message: string };
    error: { error: string };
  };
  "/explode": {
    input: Record<string, never>;
    output: { ok: true };
    error: { error: "INTERNAL_ERROR" };
  };
};

function setup() {
  const application = assemble({
    vocabulary: appVocabulary,
    composition: { Echo, Reject, Explode, Slow },
  });
  const gateway = createGateway<TestApi>({ application });
  return { application, gateway };
}

describe("gateway application", () => {
  test("forwards an admitted request and keeps a separate log", async () => {
    const { application, gateway } = setup();

    const result = await gateway.invoke(
      "/echo",
      { message: "hello" },
      { correlationId: "trace-1" },
    );

    expect(result).toEqual({ ok: true, value: { message: "hello" } });
    expect(gateway.engine).not.toBe(application.engine);

    const gatewayRoot = [...gateway.engine.Action.actions.values()].find(
      (record) => record.input?.path === "/gateway/receive",
    );
    const applicationRoot = [...application.engine.Action.actions.values()].find(
      (record) => record.input?.path === "/echo",
    );
    expect(gatewayRoot?.input.correlationId).toBe("trace-1");
    expect(applicationRoot?.input.correlationId).toBe("trace-1");
  });

  test("refuses an unknown path before the application sees it", async () => {
    const { application, gateway } = setup();

    const result = await gateway.invoke("/missing" as never, {} as never);

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "framework",
        code: FrameworkErrorCode.NOT_FOUND,
        detail: "Unknown endpoint: /missing",
      },
    });
    expect(
      [...application.engine.Action.actions.values()].some(
        (record) => record.input?.path === "/missing",
      ),
    ).toBe(false);
    expect(
      [...gateway.engine.Action.actions.values()].some(
        (record) => actionNameOf(record.action) === "resolve" && record.outcome?.kind === "error",
      ),
    ).toBe(true);
  });

  test("does not forward a request whose signal is already aborted", async () => {
    const { application, gateway } = setup();
    const controller = new AbortController();
    controller.abort();

    expect(
      await gateway.invoke("/echo", { message: "late" }, { signal: controller.signal }),
    ).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.ABORTED },
    });
    expect(
      [...application.engine.Action.actions.values()].some(
        (record) => record.input?.path === "/echo",
      ),
    ).toBe(false);
  });

  test("a later abort does not roll back application work already forwarded", async () => {
    const { application, gateway } = setup();
    const controller = new AbortController();
    const pending = gateway.invoke(
      "/slow",
      { message: "committed" },
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 1);

    expect(await pending).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.ABORTED },
    });
    expect(application.concepts.Answering.completed).toEqual(["committed"]);
  });

  test("admits only object inputs carrying every required key", async () => {
    const { application, gateway } = setup();

    for (const input of [7, [], {}]) {
      expect(await gateway.invoke("/echo", input as never)).toEqual({
        ok: false,
        error: { kind: "framework", code: FrameworkErrorCode.INVALID_INPUT },
      });
    }
    expect(await gateway.invoke("/echo", { message: undefined } as never)).toEqual({
      ok: false,
      error: { kind: "domain", value: "INVALID_MESSAGE" },
    });

    const forwarded = [...application.engine.Action.actions.values()].filter(
      (record) => record.input?.path === "/echo",
    );
    expect(forwarded).toHaveLength(1);
  });

  test("leaves admitted value validation to the concept", async () => {
    const { application, gateway } = setup();

    expect(await gateway.invoke("/echo", { message: 7 } as never)).toEqual({
      ok: false,
      error: { kind: "domain", value: "INVALID_MESSAGE" },
    });
    expect(
      [...application.engine.Action.actions.values()].some(
        (record) => actionNameOf(record.action) === "echo" && record.outcome?.kind === "error",
      ),
    ).toBe(true);
  });

  test("carries application refusals and faults back through the gateway", async () => {
    const { gateway } = setup();

    expect(await gateway.invoke("/reject", {})).toEqual({
      ok: false,
      error: { kind: "domain", value: FrameworkErrorCode.NOT_FOUND },
    });
    expect(await gateway.invoke("/explode", {})).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.INTERNAL_ERROR },
    });
  });

  test("a local client exposes the same raw result shape as an HTTP client", async () => {
    const { gateway } = setup();
    const client = createLocalClient<TestApi>({ invoker: gateway });

    expect(await client.echo({ message: "local" })).toEqual({ message: "local" });
    expect(await client.reject()).toEqual({ error: FrameworkErrorCode.NOT_FOUND });
  });

  test("the HTTP handler and client preserve the same result shape", async () => {
    const { gateway } = setup();
    const handler = createHttpHandler({ gateway, basePath: "/api" });
    const fetch = ((input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) =>
      handler(new Request(input, init))) as typeof globalThis.fetch;
    const client = createHttpClient<TestApi>({ baseUrl: "http://gateway/api", fetch });

    expect(await client.echo({ message: "http" })).toEqual({ message: "http" });
    expect(await client.reject()).toEqual({ error: FrameworkErrorCode.NOT_FOUND });

    const applicationNotFound = await handler(
      new Request("http://gateway/api/reject", { method: "POST", body: "{}" }),
    );
    expect(applicationNotFound.status).toBe(400);
    expect(await applicationNotFound.json()).toEqual({
      error: FrameworkErrorCode.NOT_FOUND,
    });

    const missing = await handler(
      new Request("http://gateway/api/missing", { method: "POST", body: "{}" }),
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: FrameworkErrorCode.NOT_FOUND,
      detail: "Unknown endpoint: /missing",
    });
  });
});
