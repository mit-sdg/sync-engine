import { describe, expect, test } from "vite-plus/test";
import { assemble } from "@sync-engine/assembly";
import { vocabulary } from "@sync-engine/language";
import type { Vars } from "@sync-engine/language";
import type { Empty } from "@sync-engine/internal/reactions/types";
import { endpoint, FrameworkErrorCode, receive, respond } from "@sync-engine/boundary";
import type { ExecutionLimits, OperationalEvent } from "@sync-engine/boundary";

const limits: ExecutionLimits = {
  maxActiveRootFlows: 1,
  maxPendingRequests: 10,
  maxActionsPerFlow: 100,
  maxFiringsPerFlow: 100,
  maxRowsPerEvaluation: 100,
  maxRequestDurationMs: 1_000,
};

describe("operational events", () => {
  test("ordinary assembly emits correlated action and invocation settlement", async () => {
    class WorkingConcept {
      run(_: Empty) {
        return { value: "complete" };
      }
    }
    const words = vocabulary({ concepts: { Working: WorkingConcept }, computations: {} });
    const { Working } = words.concepts;
    const Work = endpoint("/work", ({ value }: Vars) =>
      receive().then(Working.run({}).responds({ value })).then(respond({ value })),
    );
    const events: OperationalEvent[] = [];
    const app = assemble({
      vocabulary: words,
      composition: { Work },
      observers: [
        () => {
          throw new Error("exporter unavailable");
        },
        (event) => events.push(event),
      ],
    });

    expect(await app.invoker.invoke("/work", {}, { correlationId: "trace-1" })).toEqual({
      ok: true,
      value: { value: "complete" },
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "action-settled",
        concept: "Working",
        action: "run",
        route: "/work",
        correlationId: "trace-1",
        result: "success",
        actionId: expect.any(String),
        flow: expect.any(String),
        durationMs: expect.any(Number),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "invocation-settled",
        route: "/work",
        correlationId: "trace-1",
        result: "success",
      }),
    );
  });

  test("emits interpreter, integrity, execution-limit, and drain events", async () => {
    class FailingConcept {
      static readonly queries = { _broken: "many" } as const;
      _broken(_: Empty): { value: string }[] {
        throw new Error("private failure");
      }
    }
    const words = vocabulary({ concepts: { Failing: FailingConcept }, computations: {} });
    const { Failing } = words.concepts;
    const Broken = endpoint("/broken", ({ value }: Vars) =>
      receive().where(Failing._broken({}).is({ value })).then(respond({ value })),
    );
    const Invalid = endpoint("/invalid", () => receive().then(respond({ value: "wrong" })), {
      validators: { output: () => ({ ok: false }) },
    });
    const events: OperationalEvent[] = [];
    const app = assemble({
      vocabulary: words,
      composition: { Broken, Invalid },
      executionLimits: limits,
      observers: [(event) => events.push(event)],
    });

    expect(await app.invoker.invoke("/broken", {})).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.INTERNAL_ERROR },
    });
    expect(await app.invoker.invoke("/invalid", {})).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.INTERNAL_ERROR },
    });
    await app.beginDrain();

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "interpreter-failed",
        route: "/broken",
        reaction: "Broken",
        stage: "where",
        errorClass: "Error",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "integrity-failed",
        route: "/invalid",
        kind: "invalid-output",
        errorClass: "ValidationFailure",
      }),
    );
    expect(events.filter(({ type }) => type === "drain-state")).toEqual([
      expect.objectContaining({ type: "drain-state", state: "draining" }),
      expect.objectContaining({ type: "drain-state", state: "idle" }),
    ]);
  });

  test("reports rejected overload without admitting a second root", async () => {
    let release = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    class SlowConcept {
      async run(_: Empty) {
        await waiting;
        return {};
      }
    }
    const words = vocabulary({ concepts: { Slow: SlowConcept }, computations: {} });
    const { Slow } = words.concepts;
    const SlowEndpoint = endpoint("/slow", () => receive().then(Slow.run({})));
    const events: OperationalEvent[] = [];
    const app = assemble({
      vocabulary: words,
      composition: { SlowEndpoint },
      executionLimits: limits,
      observers: [(event) => events.push(event)],
    });
    const first = app.invoker.invoke("/slow", {}, { timeoutMs: 10 });
    await Promise.resolve();

    expect(await app.invoker.invoke("/slow", {})).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.UNAVAILABLE },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "execution-limit-breached",
        route: "/slow",
        limit: "active-root-flows",
        accepted: false,
      }),
    );
    release();
    await first;
  });
});
