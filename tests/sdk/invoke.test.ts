import { describe, expect, test } from "vite-plus/test";
import { Logging, SyncConcept } from "@sync-engine/engine";
import type { Vars } from "@sync-engine/engine";
import {
  createEndpointDsl,
  createInvoker,
  createLocalClient,
  FrameworkErrorCode,
  RequestBoundaryConcept,
  syncMap,
} from "@sync-engine/sdk";
import type { InvocationResult } from "@sync-engine/sdk";

type TestApi = {
  "/echo": { input: { message: string }; output: { echoed: string } };
  "/err": { input: { kind: string }; output: never; error: { code: string; detail?: string } };
};

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

  return { invoker };
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

  test("returns TIMED_OUT on aborted signal", async () => {
    const { invoker } = setup();
    const controller = new AbortController();
    controller.abort();

    const result = await invoker.invoke("/echo", { message: "test" } as never, {
      signal: controller.signal,
      timeoutMs: 5000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "framework") {
      expect(result.error.code).toBe(FrameworkErrorCode.TIMED_OUT);
    }
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
  test("provides typed proxy over invoker via group path", async () => {
    const { invoker } = setup();
    const client = createLocalClient<TestApi>({ invoker: invoker as never });

    const result = (await client.echo({ message: "hi" })) as unknown as InvocationResult<
      { echoed: string },
      never
    >;

    expect(result).toEqual({ ok: true, value: { echoed: "hi" } });
  });

  test("typed proxy index syntax works", async () => {
    const { invoker } = setup();
    const client = createLocalClient<TestApi>({ invoker: invoker as never });

    const result = (await client["/echo"]({ message: "indexed" })) as unknown as InvocationResult<
      { echoed: string },
      never
    >;

    expect(result).toEqual({ ok: true, value: { echoed: "indexed" } });
  });
});
