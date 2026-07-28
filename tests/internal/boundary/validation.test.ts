import { describe, expect, test } from "vite-plus/test";
import { MemoryStore } from "@sync-engine/assembly";
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
    validators: { output: () => ({ ok: false }) },
  });
  const app = assemble({
    vocabulary: vocabulary({ concepts: {}, computations: {} }),
    composition: { Checked, DomainFailure, InvalidOutput },
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

  test("domain failures bypass successful-output validation", async () => {
    const { app } = setup();

    expect(await app.invoker.invoke("/domain-failure", {})).toEqual({
      ok: false,
      error: { kind: "domain", value: "EXPECTED" },
    });
    expect((app.engine.Action.store as MemoryStore).integrityFailures).toEqual([]);
  });

  test("validator faults fail closed without exposing exception text", async () => {
    const Faulting = endpoint("/faulting", () => receive({}).then(respond({ value: "secret" })), {
      validators: {
        output: () => {
          throw new Error("validator secret");
        },
      },
    });
    const app = assemble({
      vocabulary: vocabulary({ concepts: {}, computations: {} }),
      composition: { Faulting },
    });

    const result = await app.invoker.invoke("/faulting", {});
    expect(result).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.INTERNAL_ERROR },
    });
    expect(JSON.stringify(result)).not.toContain("validator secret");
    expect((app.engine.Action.store as MemoryStore).integrityFailures[0]?.errorClass).toBe(
      "ValidatorFault",
    );
  });

  test("a store failure while recording invalid output cannot strand the caller", async () => {
    class ThrowingIntegrityStore extends MemoryStore {
      override append(entry: Parameters<MemoryStore["append"]>[0]): void {
        if (entry.kind === "integrity-failure") throw new Error("store unavailable");
        super.append(entry);
      }
    }
    const Invalid = endpoint("/invalid", () => receive({}).then(respond({ count: "wrong" })), {
      validators: { output: () => ({ ok: false }) },
    });
    const app = assemble({
      vocabulary: vocabulary({ concepts: {}, computations: {} }),
      composition: { Invalid },
      logStore: new ThrowingIntegrityStore("keepAll"),
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
  });
});
