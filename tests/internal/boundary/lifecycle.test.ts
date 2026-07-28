import { describe, expect, test } from "vite-plus/test";
import { MemoryStore } from "@sync-engine/assembly";
import { vocabulary } from "@sync-engine/language";
import type { Vars } from "@sync-engine/language";
import type { Empty } from "@sync-engine/internal/reactions/types";
import {
  createGateway,
  createHttpHandler,
  endpoint,
  FrameworkErrorCode,
  receive,
  respond,
} from "@sync-engine/boundary";
import type { ExecutionLimits } from "@sync-engine/boundary";
import { assemble } from "@sync-engine/internal/boundary/assembly/assemble";

const limits = (overrides: Partial<ExecutionLimits> = {}): ExecutionLimits => ({
  maxActiveRootFlows: 4,
  maxPendingRequests: 4,
  maxActionsPerFlow: 100,
  maxFiringsPerFlow: 100,
  maxRowsPerEvaluation: 1_000,
  maxRequestDurationMs: 1_000,
  ...overrides,
});

function slowApplication(executionLimits = limits()) {
  let started = () => {};
  let release = () => {};
  const didStart = new Promise<void>((resolve) => {
    started = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  class WorkingConcept {
    async run(_: Empty) {
      started();
      await wait;
      return { value: "complete" };
    }
  }
  const words = vocabulary({ concepts: { Working: WorkingConcept }, computations: {} });
  const { Working } = words.concepts;
  const Work = endpoint("/work", ({ value }: Vars) =>
    receive().then(Working.run({}).responds({ value })).then(respond({ value })),
  );
  const app = assemble({ vocabulary: words, composition: { Work }, executionLimits });
  return { app, didStart, release };
}

describe("assembly execution lifecycle", () => {
  test("rejects overload before entry and maps it to HTTP 503", async () => {
    const { app, didStart, release } = slowApplication(limits({ maxActiveRootFlows: 1 }));
    const first = app.invoker.invoke("/work", {}, { timeoutMs: 20 });
    await didStart;

    expect(await app.invoker.invoke("/work", {})).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.UNAVAILABLE },
    });
    const response = await createHttpHandler({ invoker: app.invoker })(
      new Request("http://localhost/work", { method: "POST", body: "{}" }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: FrameworkErrorCode.UNAVAILABLE });

    expect(await first).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.TIMED_OUT },
    });
    expect(await app.invoker.invoke("/work", {})).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.UNAVAILABLE },
    });
    release();
    await app.whenIdle();
  });

  test("drain rejects new work and waits for real flow settlement after caller abort", async () => {
    const { app, didStart, release } = slowApplication();
    const gateway = createGateway({ application: app });
    const controller = new AbortController();
    const accepted = gateway.invoke("/work", {}, { signal: controller.signal });
    await didStart;

    let idle = false;
    const draining = gateway.beginDrain().then(() => {
      idle = true;
    });
    expect(await gateway.invoke("/work", {})).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.UNAVAILABLE },
    });

    controller.abort();
    expect(await accepted).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.ABORTED },
    });
    await Promise.resolve();
    expect(idle).toBe(false);

    release();
    await draining;
    expect(idle).toBe(true);
    expect(await app.invoker.invoke("/work", {})).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.UNAVAILABLE },
    });
  });

  test("gateway drain preserves a root accepted immediately before draining", async () => {
    const { app, didStart, release } = slowApplication();
    const gateway = createGateway({ application: app });
    const accepted = gateway.invoke("/work", {});
    const draining = gateway.beginDrain();

    await didStart;
    expect(await gateway.invoke("/work", {})).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.UNAVAILABLE },
    });
    release();

    await expect(accepted).resolves.toEqual({ ok: true, value: { value: "complete" } });
    await expect(draining).resolves.toBeUndefined();
  });

  test("direct concept roots participate in limits, idle observation, and drain", async () => {
    const { app, didStart, release } = slowApplication(limits({ maxActiveRootFlows: 1 }));
    const accepted = app.concepts.Working.run({});
    await didStart;

    expect(await app.concepts.Working.run({})).toEqual({ error: FrameworkErrorCode.UNAVAILABLE });
    let idle = false;
    const observing = app.whenIdle().then(() => {
      idle = true;
    });
    const draining = app.beginDrain();
    await Promise.resolve();
    expect(idle).toBe(false);
    expect(await app.concepts.Working.run({})).toEqual({ error: FrameworkErrorCode.UNAVAILABLE });

    release();
    await expect(accepted).resolves.toEqual({ value: "complete" });
    await observing;
    await draining;
    expect(idle).toBe(true);
  });

  test("a rejected direct root does not invalidate query caches", async () => {
    class CachedConcept {
      static readonly queries = { _value: "many" } as const;
      reads = 0;

      change(_: Empty) {
        return {};
      }

      _value(_: Empty) {
        this.reads += 1;
        return [{ value: "same" }];
      }
    }
    const words = vocabulary({ concepts: { Cached: CachedConcept }, computations: {} });
    const app = assemble({ vocabulary: words, composition: {} });

    expect(await app.concepts.Cached._value({})).toEqual([{ value: "same" }]);
    expect(await app.concepts.Cached._value({})).toEqual([{ value: "same" }]);
    expect(app.concepts.Cached.reads).toBe(1);
    await app.beginDrain();
    expect(await app.concepts.Cached.change({})).toEqual({
      error: FrameworkErrorCode.UNAVAILABLE,
    });
    expect(await app.concepts.Cached._value({})).toEqual([{ value: "same" }]);
    expect(app.concepts.Cached.reads).toBe(1);
  });

  test("pending-request limits remain in force after uncovered work becomes idle", async () => {
    class CompletingConcept {
      complete(_: Empty) {
        return {};
      }
    }
    const words = vocabulary({ concepts: { Completing: CompletingConcept }, computations: {} });
    const { Completing } = words.concepts;
    const Uncovered = endpoint("/uncovered", () => receive().then(Completing.complete({})));
    const Answer = endpoint("/answer", () => receive().then(respond({ ok: true })));
    const app = assemble({
      vocabulary: words,
      composition: { Answer, Uncovered },
      executionLimits: limits({ maxPendingRequests: 1 }),
    });
    const uncovered = app.invoker.invoke("/uncovered", {}, { timeoutMs: 20 });
    await app.whenIdle();

    expect(await app.invoker.invoke("/answer", {})).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.UNAVAILABLE },
    });
    await uncovered;
    expect(await app.invoker.invoke("/answer", {})).toEqual({ ok: true, value: { ok: true } });
  });

  test("validates execution profiles and caller deadlines before recording work", async () => {
    expect(() => slowApplication(limits({ maxActionsPerFlow: Number.POSITIVE_INFINITY }))).toThrow(
      "executionLimits.maxActionsPerFlow must be a positive finite integer",
    );
    const { app } = slowApplication(limits({ maxRequestDurationMs: 50 }));

    expect(await app.invoker.invoke("/work", {}, { timeoutMs: 51 })).toEqual({
      ok: false,
      error: {
        kind: "framework",
        code: FrameworkErrorCode.INVALID_INPUT,
        detail: "timeoutMs exceeds the configured 50 ms maximum",
      },
    });
    expect(app.engine.Action.actions.size).toBe(0);
  });

  test("accepted action, firing, and row budget breaches use interpreter failure settlement", async () => {
    class BudgetConcept {
      static readonly queries = { _rows: "many" } as const;
      step(_: Empty) {
        return { value: "ok" };
      }
      _rows(_: Empty) {
        return [{ value: "one" }, { value: "two" }];
      }
    }
    const words = vocabulary({ concepts: { Budget: BudgetConcept }, computations: {} });
    const { Budget } = words.concepts;
    const ActionBudget = endpoint("/action-budget", () => receive().then(respond({ ok: true })));
    const FiringBudget = endpoint("/firing-budget", ({ value }: Vars) =>
      receive().then(Budget.step({}).responds({ value })).then(respond({ value })),
    );
    const RowBudget = endpoint("/row-budget", ({ value }: Vars) =>
      receive().where(Budget._rows({}).is({ value })).then(respond({ value })),
    );
    const cases = [
      {
        endpoint: ActionBudget,
        path: "/action-budget",
        profile: limits({ maxActionsPerFlow: 1 }),
        limit: "actions",
      },
      {
        endpoint: FiringBudget,
        path: "/firing-budget",
        profile: limits({ maxFiringsPerFlow: 1 }),
        limit: "firings",
      },
      {
        endpoint: RowBudget,
        path: "/row-budget",
        profile: limits({ maxRowsPerEvaluation: 1 }),
        limit: "rows",
      },
    ] as const;

    for (const entry of cases) {
      const app = assemble({
        vocabulary: words,
        composition: { Endpoint: entry.endpoint },
        executionLimits: entry.profile,
        retention: "keepAll",
      });
      expect(await app.invoker.invoke(entry.path, {})).toEqual({
        ok: false,
        error: { kind: "framework", code: FrameworkErrorCode.INTERNAL_ERROR },
      });
      expect((app.engine.Action.store as MemoryStore).integrityFailures).toContainEqual(
        expect.objectContaining({ kind: "execution-limit", limit: entry.limit }),
      );
    }
  });

  test("ordinary assembly accepts an application-owned log store", async () => {
    const store = new MemoryStore("keepAll");
    const Answer = endpoint("/answer", () => receive().then(respond({ ok: true })));
    const app = assemble({
      vocabulary: vocabulary({ concepts: {}, computations: {} }),
      composition: { Answer },
      logStore: store,
    });

    await app.invoker.invoke("/answer", {});
    expect(app.engine.Action.store).toBe(store);
    expect(store.actions.size).toBeGreaterThan(0);
    expect(() =>
      assemble({
        vocabulary: vocabulary({ concepts: {}, computations: {} }),
        composition: {},
        logStore: store,
        retention: "keepAll",
      }),
    ).toThrow("logStore and retention cannot both be supplied");
  });
});
