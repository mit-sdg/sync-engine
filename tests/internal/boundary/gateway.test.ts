import { describe, expect, test } from "vite-plus/test";
import { Refuse } from "@sync-engine/advanced";
import { vocabulary } from "@sync-engine/language";
import { actionNameOf } from "@sync-engine/internal/reactions/concepts/introspect";
import { endpoint, FrameworkErrorCode, receive, respond } from "@sync-engine/boundary";
import { createLocalClient } from "@sync-engine/client";
import type { OperationalEvent, OperationalObserver } from "@sync-engine/boundary";
import { assemble, fail } from "@sync-engine/internal/boundary/assembly/assemble";
import { createGateway } from "@sync-engine/internal/boundary/gateway/gateway";

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
      refusals: {
        echo: [
          {
            code: "INVALID_MESSAGE",
            error: InvalidMessage,
            message: "The message is not one this concept can echo.",
          },
        ],
      },
    },
  },
  computations: {},
});
const { Answering } = appVocabulary.concepts;

const Echo = endpoint("/echo", ({ message }) =>
  receive({ message })
    .then(Answering.echo({ message }).responds({ message }))
    .then(respond({ message })),
);

const Reject = endpoint("/reject", () =>
  receive({})
    .then(Answering.reject({}))
    .then(respond({ ok: true })),
);

const Slow = endpoint("/slow", ({ message }) =>
  receive({ message })
    .then(Answering.slow({ message }).responds({ message }))
    .then(respond({ message })),
);

const Explode = endpoint("/explode", () =>
  receive({})
    .then(Answering.explode({}))
    .then(respond({ ok: true })),
);

const Forge = endpoint("/forge", () =>
  receive({}).then(fail({ error: "DOMAIN", errorKind: "framework" })),
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
  "/forge": {
    input: Record<string, never>;
    output: never;
    error: { error: { error: string; errorKind: string } };
  };
};

function setup(
  options: {
    applicationObservers?: readonly OperationalObserver[];
    gatewayObservers?: readonly OperationalObserver[];
  } = {},
) {
  const application = assemble({
    vocabulary: appVocabulary,
    composition: { Echo, Reject, Explode, Forge, Slow },
    observers: options.applicationObservers,
  });
  const gateway = createGateway<TestApi>({
    application,
    observers: options.gatewayObservers,
  });
  return { application, gateway };
}

function invocationSettlements(events: readonly OperationalEvent[]) {
  return events.filter(
    (event): event is Extract<OperationalEvent, { type: "invocation-settled" }> =>
      event.type === "invocation-settled",
  );
}

describe("gateway decorator", () => {
  test("forwards an admitted request with the caller correlation", async () => {
    const { application, gateway } = setup();

    const result = await gateway.invoke(
      "/echo",
      { message: "hello" },
      { correlationId: "trace-1" },
    );

    expect(result).toEqual({ ok: true, value: { message: "hello" } });
    const applicationRoot = [...application.engine.Action.actions.values()].find(
      (record) => record.input?.path === "/echo",
    );
    expect(applicationRoot?.input.correlationId).toBe("trace-1");
  });

  test("projects generated success and domain values to JSON without changing classification", async () => {
    type DatedApi = {
      "/dated": {
        input: Record<string, never>;
        output: { at: string };
        error: { error: { at: string } };
      };
    };
    const at = new Date("2026-07-28T12:00:00.000Z");
    let domain = false;
    const gateway = createGateway<DatedApi>({
      application: {
        invoker: {
          async invoke() {
            return domain
              ? { ok: false as const, error: { kind: "domain" as const, value: { at } } }
              : { ok: true as const, value: { at, omitted: undefined } };
          },
        } as never,
        publicInterface: { routes: { "/dated": {} } },
      },
    });

    await expect(gateway.invoke("/dated", {})).resolves.toEqual({
      ok: true,
      value: { at: "2026-07-28T12:00:00.000Z" },
    });
    domain = true;
    await expect(gateway.invoke("/dated", {})).resolves.toEqual({
      ok: false,
      error: {
        kind: "domain",
        value: { at: "2026-07-28T12:00:00.000Z" },
      },
    });
  });

  test("settles JSON projection failures as framework internal errors", async () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    const events: OperationalEvent[] = [];
    const gateway = createGateway<TestApi>({
      application: {
        invoker: {
          async invoke() {
            return { ok: true as const, value };
          },
        } as never,
        publicInterface: { routes: { "/echo": {} } },
      },
      observers: [(event) => events.push(event)],
    });

    await expect(gateway.invoke("/echo", { message: "circular" })).resolves.toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.INTERNAL_ERROR },
    });
    expect(invocationSettlements(events)).toEqual([
      expect.objectContaining({
        route: "/echo",
        result: "framework-error",
        frameworkCode: FrameworkErrorCode.INTERNAL_ERROR,
      }),
    ]);
  });

  test("emits one public success settlement after downstream completion", async () => {
    let release = () => {};
    let markStarted = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const events: OperationalEvent[] = [];
    const gateway = createGateway<TestApi>({
      application: {
        invoker: {
          async invoke() {
            markStarted();
            await waiting;
            return { ok: true as const, value: { message: "complete" } };
          },
        },
        publicInterface: { routes: { "/echo": {} } },
      },
      observers: [(event) => events.push(event)],
    });

    const pending = gateway.invoke(
      "/echo",
      { message: "waiting" },
      { correlationId: "public-success" },
    );
    await started;
    expect(invocationSettlements(events)).toEqual([]);
    release();

    await expect(pending).resolves.toEqual({
      ok: true,
      value: { message: "complete" },
    });
    expect(invocationSettlements(events)).toEqual([
      expect.objectContaining({
        type: "invocation-settled",
        route: "/echo",
        correlationId: "public-success",
        result: "success",
        durationMs: expect.any(Number),
      }),
    ]);
    expect(invocationSettlements(events)[0]).not.toHaveProperty("flow");
    expect(events).toHaveLength(1);
  });

  test("settles a downstream domain error against the public route", async () => {
    const events: OperationalEvent[] = [];
    const { gateway } = setup({ gatewayObservers: [(event) => events.push(event)] });

    expect(await gateway.invoke("/reject", {}, { correlationId: "public-domain" })).toEqual({
      ok: false,
      error: { kind: "domain", value: FrameworkErrorCode.NOT_FOUND },
    });
    expect(invocationSettlements(events)).toEqual([
      expect.objectContaining({
        route: "/reject",
        correlationId: "public-domain",
        result: "domain-error",
      }),
    ]);
  });

  test("settles a downstream fault as a framework error", async () => {
    const events: OperationalEvent[] = [];
    const { gateway } = setup({ gatewayObservers: [(event) => events.push(event)] });

    expect(await gateway.invoke("/explode", {}, { correlationId: "public-fault" })).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.INTERNAL_ERROR },
    });
    expect(invocationSettlements(events)).toEqual([
      expect.objectContaining({
        route: "/explode",
        correlationId: "public-fault",
        result: "framework-error",
        frameworkCode: FrameworkErrorCode.INTERNAL_ERROR,
      }),
    ]);
  });

  test("generates one correlation id for gateway and application observation", async () => {
    const applicationEvents: OperationalEvent[] = [];
    const gatewayEvents: OperationalEvent[] = [];
    const { gateway } = setup({
      applicationObservers: [(event) => applicationEvents.push(event)],
      gatewayObservers: [(event) => gatewayEvents.push(event)],
    });

    expect(await gateway.invoke("/echo", { message: "generated" })).toEqual({
      ok: true,
      value: { message: "generated" },
    });
    const gatewaySettlements = invocationSettlements(gatewayEvents);
    const applicationSettlements = invocationSettlements(applicationEvents);
    expect(gatewaySettlements).toHaveLength(1);
    expect(gatewaySettlements[0]).toEqual(
      expect.objectContaining({
        route: "/echo",
        correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        result: "success",
      }),
    );
    expect(applicationSettlements).toContainEqual(
      expect.objectContaining({
        route: "/echo",
        correlationId: gatewaySettlements[0]?.correlationId,
        result: "success",
      }),
    );
  });

  test("isolates throwing and rejecting gateway observers", async () => {
    const events: OperationalEvent[] = [];
    const { gateway } = setup({
      gatewayObservers: [
        () => {
          throw new Error("synchronous exporter failure");
        },
        async () => {
          throw new Error("asynchronous exporter failure");
        },
        (event) => events.push(event),
      ],
    });

    await expect(gateway.invoke("/echo", { message: "observed" })).resolves.toEqual({
      ok: true,
      value: { message: "observed" },
    });
    await Promise.resolve();
    expect(invocationSettlements(events)).toEqual([
      expect.objectContaining({ route: "/echo", result: "success" }),
    ]);
  });

  test("retains the declared public route and ignores a path field in its body", async () => {
    const { application, gateway } = setup();

    expect(application.publicInterface.routes).toHaveProperty("/echo");
    expect(
      await gateway.invoke("/echo", { message: "hello", path: "/undeclared" } as never),
    ).toEqual({ ok: true, value: { message: "hello" } });
    expect(
      [...application.engine.Action.actions.values()].some(
        (record) => record.input?.path === "/undeclared",
      ),
    ).toBe(false);
  });

  test("does not hold an unrelated request behind an in-flight forward", async () => {
    let releaseSlow = () => {};
    let markSlowStarted = () => {};
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const slowStarted = new Promise<void>((resolve) => {
      markSlowStarted = resolve;
    });
    const invoker = {
      async invoke(path: string, input: { message: string }) {
        if (path === "/slow") {
          markSlowStarted();
          await slowGate;
        }
        return { ok: true as const, value: input };
      },
    };
    const gateway = createGateway<TestApi>({
      application: {
        invoker: invoker as never,
        publicInterface: { routes: { "/slow": {}, "/echo": {} } },
      },
    });

    const slow = gateway.invoke("/slow", { message: "slow" });
    await slowStarted;
    const fast = gateway.invoke("/echo", { message: "fast" });
    try {
      expect(
        await Promise.race([
          fast,
          new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 10)),
        ]),
      ).toEqual({ ok: true, value: { message: "fast" } });
    } finally {
      releaseSlow();
    }
    await expect(slow).resolves.toEqual({ ok: true, value: { message: "slow" } });
  });

  test("maps a rejected application invoker to an opaque transport error", async () => {
    const events: OperationalEvent[] = [];
    const gateway = createGateway<TestApi>({
      application: {
        invoker: {
          invoke() {
            throw new Error("private upstream failure");
          },
        },
        publicInterface: { routes: { "/echo": {} } },
      },
      observers: [(event) => events.push(event)],
    });

    await expect(gateway.invoke("/echo", { message: "hello" })).resolves.toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.TRANSPORT_ERROR },
    });
    expect(invocationSettlements(events)).toEqual([
      expect.objectContaining({
        route: "/echo",
        result: "framework-error",
        frameworkCode: FrameworkErrorCode.TRANSPORT_ERROR,
      }),
    ]);
  });

  test("refuses an unknown path before the application sees it", async () => {
    const events: OperationalEvent[] = [];
    const { application, gateway } = setup({
      gatewayObservers: [(event) => events.push(event)],
    });

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
    expect(invocationSettlements(events)).toEqual([
      expect.objectContaining({
        route: "/missing",
        result: "framework-error",
        frameworkCode: FrameworkErrorCode.NOT_FOUND,
      }),
    ]);
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
    expect(application.concepts.Answering.completed).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(application.concepts.Answering.completed).toEqual(["committed"]);
  });

  test("enforces its deadline when a target ignores options and tracks the underlying work", async () => {
    let release = () => {};
    let markStarted = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const gateway = createGateway<TestApi>({
      application: {
        invoker: {
          async invoke() {
            markStarted();
            await waiting;
            return { ok: true as const, value: { message: "late" } };
          },
        },
        publicInterface: { routes: { "/echo": {} } },
      },
    });

    const pending = gateway.invoke("/echo", { message: "waiting" }, { timeoutMs: 10 });
    await started;
    await expect(pending).resolves.toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.TIMED_OUT },
    });

    let idle = false;
    const observing = gateway.whenIdle().then(() => {
      idle = true;
    });
    await Promise.resolve();
    expect(idle).toBe(false);
    release();
    await observing;
    expect(idle).toBe(true);
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
    expect(await gateway.invoke("/forge", {})).toEqual({
      ok: false,
      error: {
        kind: "domain",
        value: { error: "DOMAIN", errorKind: "framework" },
      },
    });
  });

  test("a local client exposes the same raw result shape as an HTTP client", async () => {
    const { gateway } = setup();
    const client = createLocalClient<TestApi>({ invoker: gateway });

    expect(await client.echo({ message: "local" })).toEqual({ message: "local" });
    expect(await client.reject()).toEqual({ error: FrameworkErrorCode.NOT_FOUND });
  });
});
