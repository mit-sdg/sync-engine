import { describe, expect, test } from "vite-plus/test";
import type { LogEntry, LogSink } from "@sync-engine/assembly";
import { MemoryStore } from "@sync-engine/internal/reactions/runtime/log-store.ts";
import { each, earlier, former, reaction, vocabulary, when, where } from "@sync-engine/language";
import type { Empty, Vars } from "@sync-engine/internal/reactions/types";
import { flow } from "@sync-engine/internal/reactions/context";
import { ActionConcept, type ActionRecord } from "@sync-engine/internal/reactions/runtime/actions";
import { Reacting } from "@sync-engine/internal/reactions/runtime/reacting";
import { RuntimeLifecycle } from "@sync-engine/internal/boundary/invocation/lifecycle";
import {
  createGateway,
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
  test("rejects overload before entry", async () => {
    const { app, didStart, release } = slowApplication(limits({ maxActiveRootFlows: 1 }));
    const first = app.invoker.invoke("/work", {}, { timeoutMs: 20 });
    await didStart;

    expect(await app.invoker.invoke("/work", {})).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.UNAVAILABLE },
    });
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

  test("gateway admission limits are independent from the target", async () => {
    const { app, didStart, release } = slowApplication();
    const gateway = createGateway({
      application: app,
      executionLimits: limits({ maxActiveRootFlows: 1 }),
    });
    const accepted = gateway.invoke("/work", {});
    await didStart;

    expect(await gateway.invoke("/work", {})).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.UNAVAILABLE },
    });
    const direct = app.invoker.invoke("/work", {});
    release();

    await expect(accepted).resolves.toEqual({ ok: true, value: { value: "complete" } });
    await expect(direct).resolves.toEqual({ ok: true, value: { value: "complete" } });
    await gateway.whenIdle();
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

  test("direct query roots are fresh and rejected after drain", async () => {
    class CachedConcept {
      static readonly queries = { _value: "many" } as const;
      reads = 0;

      value = "first";

      _value(_: Empty) {
        this.reads += 1;
        return [{ value: this.value }];
      }
    }
    const words = vocabulary({ concepts: { Cached: CachedConcept }, computations: {} });
    const app = assemble({ vocabulary: words, composition: {} });

    expect(await app.concepts.Cached._value({})).toEqual([{ value: "first" }]);
    app.concepts.Cached.value = "second";
    expect(await app.concepts.Cached._value({})).toEqual([{ value: "second" }]);
    expect(app.concepts.Cached.reads).toBe(2);
    await app.beginDrain();
    await expect(app.concepts.Cached._value({})).rejects.toThrow(
      'Read "Cached._value" is unavailable',
    );
    expect(app.concepts.Cached.reads).toBe(2);
  });

  test("drain waits for a pending direct query and rejects another read", async () => {
    let started = () => {};
    let release = () => {};
    const didStart = new Promise<void>((resolve) => {
      started = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    class SlowReadConcept {
      static readonly queries = { _rows: "many" } as const;
      async _rows(_: Empty) {
        started();
        await waiting;
        return [{ value: "complete" }];
      }
    }
    const app = assemble({
      vocabulary: vocabulary({ concepts: { SlowRead: SlowReadConcept }, computations: {} }),
      composition: {},
      executionLimits: limits({ maxActiveRootFlows: 1 }),
    });
    const accepted = app.concepts.SlowRead._rows({});
    await didStart;
    let idle = false;
    const draining = app.beginDrain().then(() => {
      idle = true;
    });

    await expect(app.concepts.SlowRead._rows({})).rejects.toThrow("unavailable");
    expect(idle).toBe(false);
    release();
    await expect(accepted).resolves.toEqual([{ value: "complete" }]);
    await draining;
    expect(idle).toBe(true);
  });

  test("drain waits for Assembly.form and rejects a later form", async () => {
    let started = () => {};
    let release = () => {};
    const didStart = new Promise<void>((resolve) => {
      started = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    class SlowFormConcept {
      static readonly queries = { _rows: "many" } as const;
      async _rows(_: Empty) {
        started();
        await waiting;
        return [{ value: "complete" }];
      }
    }
    const words = vocabulary({ concepts: { SlowForm: SlowFormConcept }, computations: {} });
    const { SlowForm } = words.concepts;
    const values = former("slow values ()", (_input, { value }) =>
      each(SlowForm._rows({}).is({ value })).form({ value }),
    );
    const app = assemble({
      vocabulary: words,
      composition: { values },
      executionLimits: limits({ maxActiveRootFlows: 1 }),
    });
    const accepted = app.form(values({}));
    await didStart;
    let idle = false;
    const draining = app.beginDrain().then(() => {
      idle = true;
    });

    await expect(app.form(values({}))).rejects.toThrow("unavailable");
    expect(idle).toBe(false);
    release();
    await expect(accepted).resolves.toEqual([{ value: "complete" }]);
    await draining;
    expect(idle).toBe(true);
  });

  test("Assembly.form refreshes query caches between direct roots", async () => {
    class FreshFormConcept {
      static readonly queries = { _rows: "many" } as const;
      calls = 0;

      _rows(_: Empty) {
        this.calls += 1;
        return [{ value: this.calls }];
      }
    }
    const words = vocabulary({ concepts: { FreshForm: FreshFormConcept }, computations: {} });
    const { FreshForm } = words.concepts;
    const snapshot = former("fresh assembly snapshot ()", (_input, { value }) =>
      each(FreshForm._rows({}).is({ value })).form({ value }),
    );
    const app = assemble({ vocabulary: words, composition: { snapshot } });

    expect(await app.form(snapshot({}))).toEqual([{ value: 1 }]);
    expect(await app.form(snapshot({}))).toEqual([{ value: 2 }]);
    expect(app.concepts.FreshForm.calls).toBe(2);
  });

  test("queryCache none evaluates repeated reads independently", async () => {
    class ReadingConcept {
      static readonly queries = { _row: "one" } as const;
      calls = 0;

      _row(_: Empty) {
        return { value: ++this.calls };
      }
    }
    const build = (queryCache: "memoize" | "none") => {
      const words = vocabulary({ concepts: { Reading: ReadingConcept }, computations: {} });
      const { Reading } = words.concepts;
      const repeated = former("repeated reads ()", (_input, { first, second }) =>
        where(Reading._row({}).is({ value: first }), Reading._row({}).is({ value: second })).form({
          first,
          second,
        }),
      );
      return {
        app: assemble({ vocabulary: words, composition: { repeated }, queryCache }),
        repeated,
      };
    };

    const memoized = build("memoize");
    expect(await memoized.app.form(memoized.repeated({}))).toEqual({ first: 1, second: 1 });
    expect(memoized.app.concepts.Reading.calls).toBe(1);

    const uncached = build("none");
    expect(await uncached.app.form(uncached.repeated({}))).toEqual({ first: 1, second: 2 });
    expect(uncached.app.concepts.Reading.calls).toBe(2);
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

  test("rejects execution deadlines beyond the reliable platform timer range", async () => {
    expect(() => slowApplication(limits({ maxRequestDurationMs: 2_147_483_648 }))).toThrow(
      "reliable platform timer maximum",
    );
    const Answer = endpoint("/answer", () => receive().then(respond({ ok: true })));
    const app = assemble({
      vocabulary: vocabulary({ concepts: {}, computations: {} }),
      composition: { Answer },
    });

    expect(await app.invoker.invoke("/answer", {}, { timeoutMs: 2_147_483_648 })).toEqual({
      ok: false,
      error: {
        kind: "framework",
        code: FrameworkErrorCode.INVALID_INPUT,
        detail: "timeoutMs exceeds the reliable platform timer maximum of 2147483647 ms",
      },
    });
  });

  test("applies row limits to large direct reads and former cross-products incrementally", async () => {
    class MatrixConcept {
      static readonly queries = {
        _large: "many",
        _left: "many",
        _right: "many",
      } as const;
      rightReads = 0;

      _large(_: Empty) {
        return Array.from({ length: 100 }, (_, index) => ({ value: index }));
      }

      _left(_: Empty) {
        return Array.from({ length: 4 }, (_, index) => ({ left: index }));
      }

      _right(_: { left: number }) {
        this.rightReads += 1;
        return Array.from({ length: 4 }, (_, index) => ({ right: index }));
      }
    }
    const words = vocabulary({ concepts: { Matrix: MatrixConcept }, computations: {} });
    const { Matrix } = words.concepts;
    const matrix = former("matrix ()", (_input, { left, right }) =>
      each(Matrix._left({}).is({ left }))
        .where(Matrix._right({ left }).is({ right }))
        .form({ left, right }),
    );
    const app = assemble({
      vocabulary: words,
      composition: { matrix },
      executionLimits: limits({ maxRowsPerEvaluation: 5 }),
    });

    await expect(app.concepts.Matrix._large({})).rejects.toThrow("row limit");
    await expect(app.form(matrix({}))).rejects.toThrow("row limit");
    expect(app.concepts.Matrix.rightReads).toBe(2);
  });

  test("stops repeated earlier expansion at the first over-limit cross-product frame", async () => {
    class HistoryConcept {
      mark({ value }: { value: number }) {
        return { value };
      }
    }
    class LandingConcept {
      finish(_: Empty) {
        return {};
      }
    }
    class PairConcept {
      pairs: Array<{ left: number; right: number }> = [];

      record(pair: { left: number; right: number }) {
        this.pairs.push(pair);
        return {};
      }
    }
    const words = vocabulary({
      concepts: { History: HistoryConcept, Landing: LandingConcept, Pair: PairConcept },
      computations: {},
    });
    const { History, Landing, Pair } = words.concepts;
    const ExpandEarlier = reaction(({ left, right }: Vars) =>
      when(Landing.finish({}).responds())
        .where(
          earlier(History.mark, {}, { value: left }),
          earlier(History.mark, {}, { value: right }),
        )
        .then(Pair.record({ left, right })),
    );
    class CountingActions extends ActionConcept {
      matchingReads = 0;

      override _matchingRecord(record: ActionRecord): ActionRecord {
        this.matchingReads += 1;
        return super._matchingRecord(record);
      }
    }
    const store = new MemoryStore("keepAll");
    const actions = new CountingActions(store);
    const reacting = new Reacting(
      actions,
      new RuntimeLifecycle(limits({ maxRowsPerEvaluation: 4 })),
    );
    const concepts = reacting.instrument({
      History: new HistoryConcept(),
      Landing: new LandingConcept(),
      Pair: new PairConcept(),
    });
    reacting.register({ ExpandEarlier });
    const flowToken = "earlier-cross-product";
    const inFlow = <T extends object>(input: T): T => Object.assign(input, { [flow]: flowToken });
    for (const value of [1, 2, 3]) {
      await concepts.History.mark(inFlow({ value }));
    }
    actions.matchingReads = 0;

    await concepts.Landing.finish(inFlow({} as Empty));

    // Two landing checks plus three first-clause and five second-clause reads.
    // A post-materialization check would traverse all nine second-clause pairs (14 total).
    expect(actions.matchingReads).toBe(10);
    expect(concepts.Pair.pairs).toEqual([]);
    expect(store.integrityFailures).toContainEqual(
      expect.objectContaining({ kind: "execution-limit", limit: "rows", flow: flowToken }),
    );
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

  test("a consequence input former fault consumes action budget without an over-limit ask", async () => {
    class DoubledConcept {
      static readonly queries = { _rows: "optional" } as const;
      _rows(_: Empty) {
        return [{ value: "one" }, { value: "two" }];
      }
    }
    const words = vocabulary({ concepts: { Doubled: DoubledConcept }, computations: {} });
    const { Doubled } = words.concepts;
    const doubled = former("the doubled value", (_inputs, { value }) =>
      where(Doubled._rows({}).is({ value })).form({ value }),
    );
    const FaultingResponse = endpoint("/former-budget", () =>
      receive().then(respond({ value: doubled({}) })),
    );
    const app = assemble({
      vocabulary: words,
      composition: { FaultingResponse, doubled },
      executionLimits: limits({ maxActionsPerFlow: 1 }),
      retention: "keepAll",
    });

    expect(await app.invoker.invoke("/former-budget", {})).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.INTERNAL_ERROR },
    });
    const store = app.engine.Action.store as MemoryStore;
    expect(store.integrityFailures).toContainEqual(
      expect.objectContaining({ kind: "execution-limit", limit: "actions" }),
    );
    expect(store.actions.size).toBe(1);
    expect(app.engine.Action._getMatchingRecordCount()).toBe(0);
  });

  test("ordinary assembly keeps indexing while forwarding entries to an application sink", async () => {
    const entries: LogEntry[] = [];
    const sink: LogSink = { append: (entry) => entries.push(entry) };
    const Answer = endpoint("/answer", () => receive().then(respond({ ok: true })));
    const app = assemble({
      vocabulary: vocabulary({ concepts: {}, computations: {} }),
      composition: { Answer },
      logSink: sink,
      retention: "keepAll",
    });

    await app.invoker.invoke("/answer", {});
    expect(app.engine.Action.store.policy).toBe("keepAll");
    expect(app.engine.Action.store.actions.size).toBeGreaterThan(0);
    expect(entries.length).toBeGreaterThan(0);
  });
});
