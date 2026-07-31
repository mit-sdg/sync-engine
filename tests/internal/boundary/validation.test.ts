import { describe, expect, test } from "vite-plus/test";
import type { LogEntry, LogSink, RawFaultReport } from "@sync-engine/assembly";
import { MemoryStore } from "@sync-engine/internal/reactions/runtime/log-store.ts";
import { createLocalClient } from "@sync-engine/client";
import { vocabulary } from "@sync-engine/language";
import type { Vars } from "@sync-engine/internal/reactions/types";
import { actionNameOf } from "@sync-engine/internal/reactions/concepts/introspect";
import {
  createGateway,
  endpoint,
  FrameworkErrorCode,
  receive,
  respond,
} from "@sync-engine/boundary";
import { assemble, fail } from "@sync-engine/internal/boundary/assembly/assemble";

type CheckedContract = {
  "/checked": {
    input: { payload: { message: string } };
    output: { echoed: string };
  };
  "/invalid-output": { input: Record<string, never>; output: { count: number } };
};

const checkedInput = (value: unknown) => {
  const payload = (value as { payload?: unknown } | null)?.payload;
  const message = (payload as { message?: unknown } | null)?.message;
  return typeof message === "string"
    ? ({ ok: true } as const)
    : ({ ok: false, detail: "payload.message must be a string" } as const);
};

const checkedOutput = (value: unknown) =>
  typeof (value as { echoed?: unknown } | null)?.echoed === "string"
    ? ({ ok: true } as const)
    : ({ ok: false } as const);

function setup() {
  const Checked = endpoint(
    "/checked",
    ({ payload }: Vars) => receive({ payload }).then(respond({ echoed: "accepted" })),
    { validators: { input: checkedInput, output: checkedOutput } },
  );
  const InvalidOutput = endpoint(
    "/invalid-output",
    () => receive({}).then(respond({ count: "not-a-number" })),
    {
      validators: {
        output: (value) =>
          typeof (value as { count?: unknown }).count === "number" ? { ok: true } : { ok: false },
      },
    },
  );
  const DomainFailure = endpoint("/domain-failure", () => receive({}).then(fail("EXPECTED")), {
    validators: {
      output: () => ({ ok: false }),
      domainError: (value) => (value === "EXPECTED" ? { ok: true } : { ok: false }),
    },
  });
  const InvalidDomainFailure = endpoint(
    "/invalid-domain-failure",
    () => receive({}).then(fail("WRONG")),
    {
      validators: { domainError: (value) => (value === "EXPECTED" ? { ok: true } : { ok: false }) },
    },
  );
  const app = assemble({
    vocabulary: vocabulary({ concepts: {}, computations: {} }),
    composition: { Checked, DomainFailure, InvalidDomainFailure, InvalidOutput },
  });
  return { app, gateway: createGateway({ application: app }) };
}

describe("endpoint runtime validators", () => {
  test("input validation runs before the application boundary ask", async () => {
    const { app } = setup();

    expect(await app.invoker.invoke("/checked", { payload: { message: 7 } } as never)).toEqual({
      ok: false,
      error: {
        kind: "framework",
        code: FrameworkErrorCode.INVALID_INPUT,
        detail: "payload.message must be a string",
      },
    });
    expect(
      [...app.engine.Action.actions.values()].some(
        (record) => actionNameOf(record.action) === "request",
      ),
    ).toBe(false);
  });

  test("input validation has the same result through local and gateway calls", async () => {
    const { app, gateway } = setup();
    const local = createLocalClient<CheckedContract>({ invoker: app.invoker as never });

    expect(await local.checked({ payload: { message: 7 } } as never)).toEqual({
      error: FrameworkErrorCode.INVALID_INPUT,
      detail: "payload.message must be a string",
    });
    expect(await gateway.invoke("/checked", { payload: null } as never)).toEqual({
      ok: false,
      error: {
        kind: "framework",
        code: FrameworkErrorCode.INVALID_INPUT,
        detail: "payload.message must be a string",
      },
    });
  });

  test("an input-validator fault carries a caller-supplied correlation id", async () => {
    const reports: RawFaultReport[] = [];
    const validatorFault = new Error("input validator secret");
    const FaultingInput = endpoint("/faulting-input", () => receive({}).then(respond({})), {
      validators: {
        input: () => {
          throw validatorFault;
        },
      },
    });
    const app = assemble({
      vocabulary: vocabulary({ concepts: {}, computations: {} }),
      composition: { FaultingInput },
      rawFaultReporter: (report) => reports.push(report),
    });

    await expect(
      app.invoker.invoke("/faulting-input", {}, { correlationId: "trace-input" }),
    ).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({
        kind: "framework",
        code: FrameworkErrorCode.INVALID_INPUT,
      }),
    });
    expect(reports).toEqual([
      expect.objectContaining({
        kind: "endpoint-validator",
        error: validatorFault,
        route: "/faulting-input",
        phase: "input",
        correlationId: "trace-input",
      }),
    ]);
    expect(reports[0]).not.toHaveProperty("flow");
  });

  test("invalid successful output records integrity evidence and fails opaquely", async () => {
    const { app, gateway } = setup();
    const local = createLocalClient<CheckedContract>({ invoker: app.invoker as never });

    expect(await app.invoker.invoke("/invalid-output", {})).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.INTERNAL_ERROR },
    });
    expect(await local["/invalid-output"]({})).toEqual({
      error: FrameworkErrorCode.INTERNAL_ERROR,
    });
    expect(await gateway.invoke("/invalid-output", {})).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.INTERNAL_ERROR },
    });

    const store = app.engine.Action.store as MemoryStore;
    expect(store.integrityFailures).toHaveLength(3);
    expect(store.integrityFailures[0]).toEqual(
      expect.objectContaining({
        kind: "invalid-output",
        route: "/invalid-output",
        errorClass: "ValidationFailure",
      }),
    );
  });

  test("domain failures use their own validator", async () => {
    const { app } = setup();

    expect(await app.invoker.invoke("/domain-failure", {})).toEqual({
      ok: false,
      error: { kind: "domain", value: "EXPECTED" },
    });
    expect((app.engine.Action.store as MemoryStore).integrityFailures).toEqual([]);

    expect(await app.invoker.invoke("/invalid-domain-failure", {})).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.INTERNAL_ERROR },
    });
    expect((app.engine.Action.store as MemoryStore).integrityFailures).toEqual([
      expect.objectContaining({
        kind: "invalid-domain-error",
        route: "/invalid-domain-failure",
        errorClass: "ValidationFailure",
      }),
    ]);
  });

  test("validator faults fail closed without exposing exception text", async () => {
    const reports: RawFaultReport[] = [];
    const validatorFault = new Error("validator secret");
    const Faulting = endpoint("/faulting", () => receive({}).then(respond({ value: "secret" })), {
      validators: {
        output: () => {
          throw validatorFault;
        },
      },
    });
    const app = assemble({
      vocabulary: vocabulary({ concepts: {}, computations: {} }),
      composition: { Faulting },
      rawFaultReporter: (report) => reports.push(report),
    });

    const result = await app.invoker.invoke("/faulting", {}, { correlationId: "trace-output" });
    expect(result).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.INTERNAL_ERROR },
    });
    expect(JSON.stringify(result)).not.toContain("validator secret");
    expect((app.engine.Action.store as MemoryStore).integrityFailures[0]?.errorClass).toBe(
      "ValidatorFault",
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      kind: "endpoint-validator",
      error: validatorFault,
      route: "/faulting",
      phase: "output",
      flow: expect.any(String),
      correlationId: "trace-output",
    });
  });

  test("a domain-error validator fault retains flow correlation context", async () => {
    const reports: RawFaultReport[] = [];
    const validatorFault = new Error("domain validator secret");
    const FaultingDomain = endpoint("/faulting-domain", () => receive({}).then(fail("NOPE")), {
      validators: {
        domainError: () => {
          throw validatorFault;
        },
      },
    });
    const app = assemble({
      vocabulary: vocabulary({ concepts: {}, computations: {} }),
      composition: { FaultingDomain },
      rawFaultReporter: (report) => reports.push(report),
    });

    await expect(
      app.invoker.invoke("/faulting-domain", {}, { correlationId: "trace-domain" }),
    ).resolves.toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.INTERNAL_ERROR },
    });
    expect(reports).toEqual([
      expect.objectContaining({
        kind: "endpoint-validator",
        error: validatorFault,
        route: "/faulting-domain",
        phase: "domain-error",
        flow: expect.any(String),
        correlationId: "trace-domain",
      }),
    ]);
  });

  test("rejects an accidentally asynchronous validator without leaking a rejection", async () => {
    const Async = endpoint("/async-validator", () => receive({}).then(respond({ ok: true })), {
      validators: {
        output: (() => {
          const failure = Promise.reject(new Error("async validator secret"));
          return { then: failure.then.bind(failure) };
        }) as never,
      },
    });
    const app = assemble({
      vocabulary: vocabulary({ concepts: {}, computations: {} }),
      composition: { Async },
    });

    await expect(app.invoker.invoke("/async-validator", {})).resolves.toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.INTERNAL_ERROR },
    });
    expect((app.engine.Action.store as MemoryStore).integrityFailures[0]?.errorClass).toBe(
      "ValidationFailure",
    );
  });

  test("a store failure while recording invalid output cannot strand the caller", async () => {
    class ThrowingIntegritySink implements LogSink {
      append(entry: LogEntry): undefined {
        if (entry.kind === "integrity-failure") throw new Error("store unavailable");
      }
    }
    const Invalid = endpoint("/invalid", () => receive({}).then(respond({ count: "wrong" })), {
      validators: { output: () => ({ ok: false }) },
    });
    const app = assemble({
      vocabulary: vocabulary({ concepts: {}, computations: {} }),
      composition: { Invalid },
      logSink: new ThrowingIntegritySink(),
      retention: "keepAll",
    });

    await expect(app.invoker.invoke("/invalid", {}, { timeoutMs: 10 })).resolves.toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.INTERNAL_ERROR },
    });
  });

  test("invalid and duplicate validator attachments are definition errors", () => {
    expect(() =>
      endpoint("/invalid", () => receive({}).then(respond({})), {
        validators: { input: true } as never,
      }),
    ).toThrow('input validator for "/invalid" must be a function');

    const A = endpoint("/duplicate", () => receive({}).then(respond({})), {
      validators: { input: () => ({ ok: true }) },
    });
    const B = endpoint("/duplicate", () => receive({}).then(respond({})), {
      validators: { input: () => ({ ok: true }) },
    });
    expect(() =>
      assemble({
        vocabulary: vocabulary({ concepts: {}, computations: {} }),
        composition: { A, B },
      }),
    ).toThrow("duplicate input validator for /duplicate");

    const C = endpoint("/duplicate-domain", () => receive({}).then(fail("A")), {
      validators: { domainError: () => ({ ok: true }) },
    });
    const D = endpoint("/duplicate-domain", () => receive({}).then(fail("B")), {
      validators: { domainError: () => ({ ok: true }) },
    });
    expect(() =>
      assemble({
        vocabulary: vocabulary({ concepts: {}, computations: {} }),
        composition: { C, D },
      }),
    ).toThrow("duplicate domainError validator for /duplicate-domain");
  });
});
