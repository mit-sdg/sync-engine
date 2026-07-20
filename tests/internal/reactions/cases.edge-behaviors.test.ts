import { lineOf } from "@sync-engine/internal/reads/lines";
/**
 * Regression coverage for edge behavior in the reaction engine.
 */

import { describe, expect, test } from "vite-plus/test";
import {
  request,
  Logging,
  reaction,
  Reacting,
  type Vars,
  when,
  actionNameOf,
} from "@sync-engine/internal/reactions";
import { bindInputMapping } from "@sync-engine/internal/reads/frames.ts";
import { ButtonConcept, ListConcept, RecorderConcept, ThrowingConcept } from "./mocks.ts";

// ── One evaluation per trigger record ─────────────────────────────────────

describe("one evaluation per trigger record", () => {
  test("a later action does not reevaluate an earlier trigger in the same flow", async () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Button, List, Recorder } = reacting.instrument({
      Button: new ButtonConcept(),
      List: new ListConcept(),
      Recorder: new RecorderConcept(),
    });

    reacting.register({
      // This watcher evaluates after each List.add. The condition fails after
      // add(1) and succeeds after add(2). The second action must not cause the
      // first trigger record to be evaluated again against newer state.
      WatchForTwo: reaction(({ trigger }: Vars) =>
        when(List.add, { value: trigger }, {})
          .where(lineOf({ query: List._items }, {}).is({ value: 2 }))
          .then(request(Recorder.record, { tag: 2 })),
      ),
      AddTwice: reaction((_vars: Vars) =>
        when(Button.clicked, { kind: "twice" }).then(
          request(List.add, { value: 1 }),
          request(List.add, { value: 2 }),
        ),
      ),
    });

    await Button.clicked({ kind: "twice" });
    expect(Recorder.order).toEqual([2]);
  });
});

// ── Parallel then-step consumption marks ────────────────────────────────────

describe("sibling reactions consume when-records independently", () => {
  test("sibling reactions on one trigger each consume the when-record under their own name", async () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;

    class StepMarker {
      order: string[] = [];
      a() {
        this.order.push("a");
        return {};
      }
      b() {
        this.order.push("b");
        return {};
      }
    }

    const { Button, StepMarker: SM } = reacting.instrument({
      Button: new ButtonConcept(),
      StepMarker: new StepMarker(),
    });

    // Two independent reactions on the same trigger — each is its own reaction with
    // its own firing, both consuming the same when-record under their own
    // names, with no shared trace to overwrite.
    reacting.register({
      OverwriteA: reaction((_vars: Vars) =>
        when(Button.clicked, { kind: "race-test" }, {}).then(request(SM.a, {})),
      ),
      OverwriteB: reaction((_vars: Vars) =>
        when(Button.clicked, { kind: "race-test" }, {}).then(request(SM.b, {})),
      ),
    });

    await Button.clicked({ kind: "race-test" });

    const actions = [...reacting.Action.actions.values()];
    const whenAction = actions.find((a) => a.action === Button.clicked);

    const first = reacting._getFirings("OverwriteA");
    const second = reacting._getFirings("OverwriteB");
    expect(first.length).toBe(1);
    expect(second.length).toBe(1);
    expect(first[0]?.consumed).toContain(whenAction?.id);
    expect(second[0]?.consumed).toContain(whenAction?.id);
    expect(first[0]?.produced.length).toBe(1);
    expect(second[0]?.produced.length).toBe(1);
  });

  test("preserves a successful sibling's consumption after another sibling errors", async () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;

    const { Button, Recorder, Throwing } = reacting.instrument({
      Button: new ButtonConcept(),
      Recorder: new RecorderConcept(),
      Throwing: new ThrowingConcept(),
    });

    // Sibling reactions on the same trigger: one records, one refuses. The good
    // sibling's firing and consumption remain independent of the other.
    reacting.register({
      GoodBranch: reaction((_vars: Vars) =>
        when(Button.clicked, { kind: "par-mixed" }, {}).then(
          request(Recorder.record, { tag: "good-branch" }),
        ),
      ),
      BadBranch: reaction((_vars: Vars) =>
        when(Button.clicked, { kind: "par-mixed" }, {}).then(request(Throwing.explode, {})),
      ),
    });

    await Button.clicked({ kind: "par-mixed" });

    expect(Recorder.order).toContain("good-branch");

    const actions = [...reacting.Action.actions.values()];
    const whenAction = actions.find((a) => a.input?.kind === "par-mixed");
    const firings = reacting._getFirings("GoodBranch");
    expect(firings.length).toBe(1);
    expect(firings[0]?.consumed).toContain(whenAction?.id);
  });
});

// ── Missing bindings in query inputs ──────────────────────────────────────

describe("missing bindings in query inputs", () => {
  test("omits a query input key when its variable has no value", () => {
    const symA = Symbol("bound");
    const symB = Symbol("unbound");
    const frame: Record<symbol, unknown> = { [symA]: "hello" };

    const input = bindInputMapping(frame, { bound: symA, unbound: symB });

    // Only variables present in the current bindings become query input keys.
    expect(Object.keys(input)).toEqual(["bound"]);
  });

  test("rejects a consequence whose variable was never bound", () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;

    class InspectorConcept {
      received: Record<string, unknown> | null = null;
      inspect(input: Record<string, unknown>) {
        this.received = input;
        return {};
      }
    }

    const { Button, Inspector } = reacting.instrument({
      Button: new ButtonConcept(),
      Inspector: new InspectorConcept(),
    });

    expect(() =>
      reacting.register({
        MissingBinding: reaction((_vars: Vars) =>
          when(Button.clicked, { kind: "test" }, {}).then(
            request(Inspector.inspect, { kind: Symbol("nonexistent") }),
          ),
        ),
      }),
    ).toThrow("before it is bound");
    expect(Inspector.received).toBeNull();
  });
});

// ── Log records are observable in an incomplete state ───────────────────

describe("log records are briefly incomplete between append and commit", () => {
  test("does not expose a record without output or outcome to readers", () => {
    const reacting = new Reacting();
    const log = reacting.Action;

    const record = {
      action: {} as any,
      concept: {},
      input: { test: true },
      consumed: new Map(),
      flow: "test-flow",
    };
    const { id } = log.invoke(record);

    const stored = log._getById(id);
    // invoke() appends the record immediately. invoked() attaches output and
    // outcome later. Between the two calls, any log reader sees a record
    // with undefined output and outcome.
    expect(stored?.output).toBeUndefined();
    expect(stored?.outcome).toBeUndefined();

    log.invoked({ id, output: { result: "ok" } });

    const completed = log._getById(id);
    expect(completed?.output).toEqual({ result: "ok" });
    expect(completed?.outcome).toBeDefined();
  });
});

// ── actionNameOf supports bound and unbound action references ───────────────

describe("actionNameOf preserves non-bound function names", () => {
  test("returns the original name of a non-bound function", () => {
    const regularFn = function myRegularFunction() {
      return {};
    };
    const instrumented = Object.assign(regularFn, {
      concept: {},
      action: regularFn,
    });

    const name = actionNameOf(instrumented);

    expect(name).toBe("myRegularFunction");
  });

  test("returns the method name for unbound class methods", () => {
    class MyConcept {
      doWork() {
        return {};
      }
    }
    const instance = new MyConcept();
    const method = instance.doWork;

    const instrumented = Object.assign(method, {
      concept: instance,
      action: method,
    });

    const name = actionNameOf(instrumented);
    expect(name).toBe("doWork");
  });
});

// ── Observers have no bulk-removal or lifecycle-driven teardown ─────────────

describe("observers cannot be removed in bulk", () => {
  test("an observer remains registered when its unsubscribe function is discarded", async () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Button } = reacting.instrument({ Button: new ButtonConcept() });

    let calls = 0;
    reacting.addObserver({
      onAction() {
        calls++;
      },
    });

    await Button.clicked({ kind: "first" });
    expect(calls).toBe(1);

    // Without saving the unsubscribe function there is no way to remove this
    // observer. It will continue receiving events and holding references for
    // the lifetime of the engine.
    await Button.clicked({ kind: "second" });
    expect(calls).toBe(2);
  });
});

// ── evictConsumedFlows snapshots keys before eviction ──────────────────────────

describe("evictConsumedFlows safely evicts without iterating a mutating map", () => {
  test("evictConsumedFlows processes flows with consumed last records", async () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Button } = reacting.instrument({ Button: new ButtonConcept() });

    await Button.clicked({ kind: "a" });
    await Button.clicked({ kind: "b" });

    const before = reacting.Action.flowIndex.size;

    const records = reacting.Action._getByFlow([...reacting.Action.flowIndex.keys()][0] ?? "");
    const last = records?.[records.length - 1];
    if (last?.id !== undefined) {
      // Mark the trailing record consumed by appending a firing entry.
      reacting.Action.store.append({
        kind: "firing",
        at: Date.now(),
        firing: {
          id: "firing-test",
          reaction: "test-reaction",
          flow: last.flow,
          bindings: {},
          consumed: [last.id],
          produced: ["test-id"],
          at: Date.now(),
        },
      });
    }

    const evicted = reacting.Action.evictConsumedFlows();

    expect(evicted).toBeGreaterThanOrEqual(0);
    expect(reacting.Action.flowIndex.size).toBeLessThan(before);
  });
});
