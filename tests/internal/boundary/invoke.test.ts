import { describe, expect, test } from "vite-plus/test";
import { actionNameOf, vocabulary } from "@sync-engine/internal/reactions";
import type { Vars } from "@sync-engine/internal/reactions";
import {
  assemble,
  createLocalClient,
  endpoint,
  fail,
  FrameworkErrorCode,
  receive,
  respond,
} from "@sync-engine/internal/boundary";
import type { InvocationResult } from "@sync-engine/internal/boundary";

type TestApi = {
  "/echo": { input: { message: string }; output: { echoed: string } };
  "/err": {
    input: { kind: string };
    output: never;
    error: { error: { code: string; detail?: string } };
  };
};

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
  return { invoker: app.invoker, reaction: app.engine };
}

describe("createInvoker", () => {
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
});
