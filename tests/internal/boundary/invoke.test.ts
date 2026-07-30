import { describe, expect, test } from "vite-plus/test";
import { createLocalClient } from "@sync-engine/client";
import { vocabulary } from "@sync-engine/language";
import type { Vars } from "@sync-engine/internal/reactions/types";
import { actionNameOf } from "@sync-engine/internal/reactions/concepts/introspect";
import { createInvoker, Requesting } from "@sync-engine/internal/boundary/invocation/invoke";
import { Reacting } from "@sync-engine/internal/reactions/runtime/reacting";
import { endpoint, FrameworkErrorCode, receive, respond } from "@sync-engine/boundary";
import type { InvocationResult } from "@sync-engine/boundary";
import { assemble, fail } from "@sync-engine/internal/boundary/assembly/assemble";

type TestApi = {
  "/echo": { input: { message: string }; output: { echoed: string } };
  "/err": {
    input: { kind: string };
    output: never;
    error: { error: { code: string; detail?: string } };
  };
};

class CompletingConcept {
  complete(_: Record<string, never>) {
    return {};
  }
}

function setup() {
  const words = vocabulary({ concepts: { Completing: CompletingConcept }, computations: {} });
  const { Completing } = words.concepts;
  const composition = {
    Echo: endpoint("/echo", ({ message }: Vars) =>
      receive({ message }).then(respond({ echoed: message })),
    ),
    Err: endpoint("/err", ({ kind }: Vars) => receive({ kind }).then(fail({ code: kind }))),
    Unanswered: endpoint("/unanswered", () => receive({}).then(Completing.complete({}))),
  };
  const app = assemble({
    vocabulary: words,
    composition,
  });
  return { invoker: app.invoker, reaction: app.engine };
}

describe("createInvoker", () => {
  test("refreshes standing reads before admitting each application ask", async () => {
    const refreshes: string[] = [];
    const requesting = new Requesting();
    const reaction = new Reacting();
    const invoker = createInvoker({
      boundary: requesting,
      instrumented: reaction.instrumentConcept(requesting, "RequestBoundary"),
      contracts: { "/required": { required: ["value"] } },
      refresh: () => refreshes.push("refreshed"),
    });

    await invoker.invoke("/required", {});

    expect(refreshes).toEqual(["refreshed"]);
  });

  test("invokes endpoint and returns success with echoed value", async () => {
    const { invoker } = setup();

    const result = (await invoker.invoke("/echo", {
      message: "hello",
    } as never)) as InvocationResult<{ echoed: string }, never>;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ echoed: "hello" });
    }
  });

  test("caller input cannot override the path dispatched by the direct invoker", async () => {
    const { invoker, reaction } = setup();

    expect(
      await invoker.invoke("/echo", { message: "hello", path: "/undeclared" } as never),
    ).toEqual({ ok: true, value: { echoed: "hello" } });
    expect(
      [...reaction.Action.actions.values()].some(
        (record) =>
          actionNameOf(record.action) === "request" && record.input.path === "/undeclared",
      ),
    ).toBe(false);
  });

  test("returns domain error from fail()", async () => {
    const { invoker } = setup();

    const result = (await invoker.invoke("/err", { kind: "INVALID" } as never)) as InvocationResult<
      never,
      { code: string }
    >;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("domain");
      if (result.error.kind === "domain") {
        expect(result.error.value).toEqual({ code: "INVALID" });
      }
    }
  });

  test("an authored domain value cannot forge framework classification", async () => {
    const Forge = endpoint("/forge", () =>
      receive().then(fail({ error: "DOMAIN", errorKind: "framework" })),
    );
    const app = assemble({
      vocabulary: vocabulary({ concepts: {}, computations: {} }),
      composition: { Forge },
    });

    expect(await app.invoker.invoke("/forge", {})).toEqual({
      ok: false,
      error: {
        kind: "domain",
        value: { error: "DOMAIN", errorKind: "framework" },
      },
    });
  });

  test("returns ABORTED on an already-aborted signal", async () => {
    const { invoker, reaction } = setup();
    const controller = new AbortController();
    controller.abort();

    const result = await invoker.invoke("/echo", { message: "test" } as never, {
      signal: controller.signal,
      timeoutMs: 5000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "framework") {
      expect(result.error.code).toBe(FrameworkErrorCode.ABORTED);
    }
    expect(
      [...reaction.Action.actions.values()].some((record) => record.input?.path === "/echo"),
    ).toBe(false);
  });

  test("a timeout leaves the recorded boundary request unanswered", async () => {
    const { invoker, reaction } = setup();

    const result = await invoker.invoke("/unanswered" as never, {} as never, { timeoutMs: 5 });

    expect(result).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.TIMED_OUT },
    });
    const records = [...reaction.Action.actions.values()];
    const request = records.find(
      (record) => actionNameOf(record.action) === "request" && record.input?.path === "/unanswered",
    );
    expect(request?.outcome?.kind).toBe("result");
    expect(
      records.some(
        (record) =>
          actionNameOf(record.action) === "respond" &&
          record.input?.requestId === request?.input?.requestId,
      ),
    ).toBe(false);
  });

  test("an abort after the boundary request leaves it unanswered", async () => {
    const { invoker, reaction } = setup();
    const controller = new AbortController();
    const pending = invoker.invoke("/unanswered" as never, {} as never, {
      signal: controller.signal,
      timeoutMs: 5_000,
    });
    setTimeout(() => controller.abort(), 1);

    expect(await pending).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.ABORTED },
    });
    const records = [...reaction.Action.actions.values()];
    const request = records.find(
      (record) => actionNameOf(record.action) === "request" && record.input?.path === "/unanswered",
    );
    expect(request?.outcome?.kind).toBe("result");
    expect(
      records.some(
        (record) =>
          actionNameOf(record.action) === "respond" &&
          record.input?.requestId === request?.input?.requestId,
      ),
    ).toBe(false);
  });

  test("two concurrent requests receive independent responses", async () => {
    const { invoker } = setup();

    const [r1, r2] = (await Promise.all([
      invoker.invoke("/echo", { message: "first" } as never),
      invoker.invoke("/echo", { message: "second" } as never),
    ])) as [
      InvocationResult<{ echoed: string }, never>,
      InvocationResult<{ echoed: string }, never>,
    ];

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.value.echoed).toBe("first");
      expect(r2.value.echoed).toBe("second");
    }
  });

  test("keeps an accepted answer when dispatch remains blocked", async () => {
    const boundary = new Requesting();
    const controller = new AbortController();
    let answer = () => {};
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const invoker = createInvoker({
      boundary,
      instrumented: {
        request: (async (args: Record<string, unknown>) => {
          boundary.respond({ requestId: args.requestId, value: "accepted" });
          answer();
          await new Promise(() => {});
        }) as never,
        respond: (() => {}) as never,
      },
    });
    const invocation = invoker.invoke("/blocked" as never, {} as never, {
      signal: controller.signal,
      timeoutMs: 5_000,
    });

    await answered;
    controller.abort();

    expect(await invocation).toEqual({ ok: true, value: { value: "accepted" } });
  });

  test("keeps an accepted answer when dispatch subsequently rejects", async () => {
    const boundary = new Requesting();
    const invoker = createInvoker({
      boundary,
      instrumented: {
        request: ((args: Record<string, unknown>) => {
          boundary.respond({ requestId: args.requestId, value: "accepted" });
          throw new Error("late dispatch failure");
        }) as never,
        respond: (() => {}) as never,
      },
    });

    expect(await invoker.invoke("/late-failure" as never, {} as never)).toEqual({
      ok: true,
      value: { value: "accepted" },
    });
  });

  test("does not register or dispatch a request whose payload cannot be formed", async () => {
    let registrations = 0;
    let dispatches = 0;
    const invoker = createInvoker({
      boundary: {
        register() {
          registrations++;
          return new Promise(() => {});
        },
        cancel() {},
      } as unknown as Requesting,
      instrumented: {
        request: (() => {
          dispatches++;
        }) as never,
        respond: (() => {}) as never,
      },
    });
    const input = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("cannot enumerate input");
        },
      },
    );

    expect(await invoker.invoke("/broken" as never, input as never)).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.TRANSPORT_ERROR, detail: undefined },
    });
    expect(registrations).toBe(0);
    expect(dispatches).toBe(0);
  });

  test("does not forward work when payload formation aborts the signal", async () => {
    const controller = new AbortController();
    let registrations = 0;
    let dispatches = 0;
    const invoker = createInvoker({
      boundary: {
        register() {
          registrations++;
          return new Promise(() => {});
        },
        cancel() {},
      } as unknown as Requesting,
      instrumented: {
        request: (() => {
          dispatches++;
        }) as never,
        respond: (() => {}) as never,
      },
    });
    const input = {
      get value() {
        controller.abort();
        return "ignored";
      },
    };

    expect(
      await invoker.invoke("/aborted" as never, input as never, { signal: controller.signal }),
    ).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.ABORTED, detail: undefined },
    });
    expect(registrations).toBe(0);
    expect(dispatches).toBe(0);
  });
});

describe("createLocalClient", () => {
  test("provides the raw client result over an invoker via group path", async () => {
    const { invoker } = setup();
    const client = createLocalClient<TestApi>({ invoker: invoker as never });

    const result = await client.echo({ message: "hi" });

    expect(result).toEqual({ echoed: "hi" });
  });

  test("the local client accepts a full-path index call", async () => {
    const { invoker } = setup();
    const client = createLocalClient<TestApi>({ invoker: invoker as never });

    const result = await client["/echo"]({ message: "indexed" });

    expect(result).toEqual({ echoed: "indexed" });
  });

  test("turns an invoker domain value into the wire error envelope", async () => {
    const { invoker } = setup();
    const client = createLocalClient<TestApi>({ invoker: invoker as never });

    expect(await client.err({ kind: "INVALID" })).toEqual({ error: { code: "INVALID" } });
  });

  test("passes per-call abort signals to local invocation", async () => {
    const { invoker } = setup();
    const client = createLocalClient<TestApi>({ invoker: invoker as never });
    const controller = new AbortController();
    controller.abort();

    expect(await client.echo({ message: "ignored" }, { signal: controller.signal })).toEqual({
      error: FrameworkErrorCode.ABORTED,
    });
  });

  test("forwards timeout and correlation through local invocation", async () => {
    let observed: unknown;
    const invoker = {
      invoke(path: string, input: unknown, options: unknown) {
        observed = { path, input, options };
        return Promise.resolve({ ok: true, value: { echoed: "tracked" } });
      },
    };
    const client = createLocalClient<TestApi>({ invoker: invoker as never });

    await expect(
      client.echo({ message: "tracked" }, { timeoutMs: 250, correlationId: "trace-local" }),
    ).resolves.toEqual({ echoed: "tracked" });
    expect(observed).toEqual({
      path: "/echo",
      input: { message: "tracked" },
      options: { signal: undefined, timeoutMs: 250, correlationId: "trace-local" },
    });
  });
});

describe("createInvoker non-DOMException with aborted signal", () => {
  test("returns ABORTED when response rejects with non-DOMException and signal is aborted", async () => {
    const controller = new AbortController();

    const boundary = {
      register(_requestId: string, _timeoutMs: number, _signal?: AbortSignal) {
        controller.abort(new Error("custom"));
        return Promise.reject(new Error("transport error"));
      },
      cancel() {},
    };

    const mockRequest = async () => {};
    const mockRespond = () => {};

    const invoker = createInvoker({
      boundary: boundary as unknown as Requesting,
      instrumented: {
        request: mockRequest as never,
        respond: mockRespond as never,
      },
      contracts: {},
    });

    const result = await invoker.invoke("/test", {} as never, { signal: controller.signal });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "framework") {
      expect(result.error.code).toBe(FrameworkErrorCode.ABORTED);
    }
  });
});

describe("Requesting", () => {
  test("rejects a duplicate live request id without replacing the first waiter", async () => {
    const boundary = new Requesting();
    const first = boundary.register("same-id", 5_000);

    expect(() => boundary.register("same-id", 5_000)).toThrow(
      "Request same-id is already pending.",
    );
    boundary.respond({ requestId: "same-id", value: "first" });
    expect(await first).toEqual({ value: "first" });
  });

  test("register attaches an abort listener to a live signal", async () => {
    const boundary = new Requesting();
    const controller = new AbortController();

    const signalPromise = boundary.register("test-id", 5000, controller.signal);

    let settled = false;
    signalPromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);

    boundary.cancel("test-id");
  });

  test("register rejects immediately when signal is already aborted", async () => {
    const boundary = new Requesting();
    const controller = new AbortController();
    controller.abort("early abort");

    try {
      await boundary.register("test-id", 5000, controller.signal);
      expect("unreachable").toBe(false);
    } catch (err) {
      expect(err).toBe("early abort");
    }
  });

  test("register rejects when a live signal aborts and disposes the pending entry", async () => {
    const boundary = new Requesting();
    const controller = new AbortController();

    const promise = boundary.register("test-id", 5000, controller.signal);
    controller.abort("cancelled");

    try {
      await promise;
      expect("unreachable").toBe(false);
    } catch (err) {
      expect(err).toBe("cancelled");
    }
  });
});

describe("createInvoker non-DOMException without aborted signal", () => {
  test("returns TRANSPORT_ERROR when response rejects with non-DOMException", async () => {
    const boundary = {
      register(_requestId: string, _timeoutMs: number, _signal?: AbortSignal) {
        return Promise.reject(new Error("transport error"));
      },
      cancel() {},
    };

    const mockRequest = async () => {};
    const mockRespond = () => {};

    const invoker = createInvoker({
      boundary: boundary as unknown as Requesting,
      instrumented: {
        request: mockRequest as never,
        respond: mockRespond as never,
      },
      contracts: {},
    });

    const result = await invoker.invoke("/test", {} as never);

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "framework") {
      expect(result.error.code).toBe(FrameworkErrorCode.TRANSPORT_ERROR);
    }
  });
});
