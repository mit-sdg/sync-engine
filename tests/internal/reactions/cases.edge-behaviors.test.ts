/**
 * Regression coverage for edge behavior in the reaction engine.
 */

import { describe, expect, test } from "vite-plus/test";
import { Logging } from "@sync-engine/assembly";
import { reaction, vocabulary, when } from "@sync-engine/language";
import type { StepNode, Vars } from "@sync-engine/internal/reactions/types";
import { actionNameOf } from "@sync-engine/internal/reactions/concepts/introspect";
import { ActionConcept } from "@sync-engine/internal/reactions/runtime/actions";
import {
  type LogEntry,
  type LogSink,
  MemoryStore,
} from "@sync-engine/internal/reactions/runtime/log-store";
import { Reacting } from "@sync-engine/internal/reactions/runtime/reacting";
import { bindInputMapping } from "@sync-engine/internal/reads/frames.ts";
import { flow } from "@sync-engine/internal/reactions/context.ts";
import { ButtonConcept, ListConcept, mockRefs, RecorderConcept, ThrowingConcept } from "./mocks.ts";

// ── One evaluation per trigger record ─────────────────────────────────────

describe("one evaluation per trigger record", () => {
  test("does not reconsider a requested guard after the action body", async () => {
    class StatefulConcept {
      ready = false;
      start(_: Record<string, never>) {
        this.ready = true;
        return {};
      }
      _ready(_: Record<string, never>) {
        return this.ready ? [{}] : [];
      }
    }
    const refs = vocabulary({ concepts: { Stateful: StatefulConcept } }).concepts;
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Stateful, Recorder } = reacting.instrument({
      Stateful: new StatefulConcept(),
      Recorder: new RecorderConcept(),
    });
    reacting.register({
      BeforeBody: reaction((_vars: Vars) =>
        when(refs.Stateful.start({}))
          .where(refs.Stateful._ready({}).is({}))
          .then(mockRefs.Recorder.record({ tag: "unexpected" })),
      ),
    });

    await Stateful.start({});

    expect(Recorder.order).toEqual([]);
  });

  test("a later action does not reevaluate an earlier trigger in the same flow", async () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Button, Recorder } = reacting.instrument({
      Button: new ButtonConcept(),
      List: new ListConcept(),
      Recorder: new RecorderConcept(),
    });

    reacting.register({
      // This watcher evaluates after each List.add. The condition fails after
      // add(1) and succeeds after add(2). The second action must not cause the
      // first trigger record to be evaluated again against newer state.
      WatchForTwo: reaction(({ trigger }: Vars) =>
        when(mockRefs.List.add({ value: trigger }).responds())
          .where(mockRefs.List._items({}).is({ value: 2 }))
          .then(mockRefs.Recorder.record({ tag: 2 } as never)),
      ),
      AddTwice: reaction((_vars: Vars) =>
        when(mockRefs.Button.clicked({ kind: "twice" }).responds())
          .then(mockRefs.List.add({ value: 1 }))
          .then(mockRefs.List.add({ value: 2 })),
      ),
    });

    await Button.clicked({ kind: "twice" });
    expect(Recorder.order).toEqual([2]);
  });

  test("does not dispatch a prepared join consumed by recursive reaction processing", async () => {
    class EventConcept {
      first(_: Record<string, never>) {
        return {};
      }
      trigger({ kind }: { kind: string }) {
        return { kind };
      }
    }
    class SinkConcept {
      hits = 0;
      note(_: Record<string, never>) {
        this.hits++;
        return {};
      }
    }
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Event, Sink } = reacting.instrument({
      Event: new EventConcept(),
      Sink: new SinkConcept(),
    });
    reacting.registerReactions([
      {
        name: "SpawnNested",
        when: [
          {
            kind: "action",
            concept: "Event",
            action: "trigger",
            posture: "returned",
            input: { kind: "outer" },
            output: {},
          },
        ],
        where: [],
        then: [{ kind: "request", concept: "Event", action: "trigger", input: { kind: "nested" } }],
      },
      {
        name: "Join",
        when: [
          {
            kind: "action",
            concept: "Event",
            action: "first",
            posture: "returned",
            input: {},
            output: {},
          },
          {
            kind: "action",
            concept: "Event",
            action: "trigger",
            posture: "returned",
            input: { kind: "outer" },
            output: {},
          },
        ],
        where: [],
        then: [{ kind: "request", concept: "Sink", action: "note", input: {} }],
      },
    ]);

    await Event.first({ [flow]: "shared" } as never);
    await Event.trigger({ kind: "outer", [flow]: "shared" } as never);

    expect(Sink.hits).toBe(1);
    expect(reacting.Action.store.firingsByReaction("Join")).toHaveLength(1);
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
    const { StepMarker: StepMarkerRef } = vocabulary({
      concepts: { StepMarker },
    }).concepts;

    const { Button } = reacting.instrument({
      Button: new ButtonConcept(),
      StepMarker: new StepMarker(),
    });

    // Two independent reactions on the same trigger — each is its own reaction with
    // its own firing, both consuming the same when-record under their own
    // names, with no shared trace to overwrite.
    reacting.register({
      OverwriteA: reaction((_vars: Vars) =>
        when(mockRefs.Button.clicked({ kind: "race-test" }).responds()).then(StepMarkerRef.a({})),
      ),
      OverwriteB: reaction((_vars: Vars) =>
        when(mockRefs.Button.clicked({ kind: "race-test" }).responds()).then(StepMarkerRef.b({})),
      ),
    });

    await Button.clicked({ kind: "race-test" });

    const actions = [...reacting.Action.actions.values()];
    const whenAction = actions.find((a) => a.action === Button.clicked);

    const first = reacting.Action.store.firingsByReaction("OverwriteA");
    const second = reacting.Action.store.firingsByReaction("OverwriteB");
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

    const { Button, Recorder } = reacting.instrument({
      Button: new ButtonConcept(),
      Recorder: new RecorderConcept(),
      Throwing: new ThrowingConcept(),
    });

    // Sibling reactions on the same trigger: one records, one refuses. The good
    // sibling's firing and consumption remain independent of the other.
    reacting.register({
      GoodBranch: reaction((_vars: Vars) =>
        when(mockRefs.Button.clicked({ kind: "par-mixed" }).responds()).then(
          mockRefs.Recorder.record({ tag: "good-branch" }),
        ),
      ),
      BadBranch: reaction((_vars: Vars) =>
        when(mockRefs.Button.clicked({ kind: "par-mixed" }).responds()).then(
          mockRefs.Throwing.explode({}),
        ),
      ),
    });

    await Button.clicked({ kind: "par-mixed" });

    expect(Recorder.order).toContain("good-branch");

    const actions = [...reacting.Action.actions.values()];
    const whenAction = actions.find((a) => a.input?.kind === "par-mixed");
    const firings = reacting.Action.store.firingsByReaction("GoodBranch");
    expect(firings.length).toBe(1);
    expect(firings[0]?.consumed).toContain(whenAction?.id);
  });
});

describe("multi-step firing marks", () => {
  test("a rejected second ask preserves the first ask and firing", async () => {
    class RejectSecondAsk implements LogSink {
      append(entry: LogEntry): undefined {
        if (entry.kind === "invocation" && entry.record.input.tag === "second") {
          throw new Error("second ask append failed");
        }
      }
    }
    const store = new MemoryStore("keepAll", new RejectSecondAsk());
    const reacting = new Reacting(new ActionConcept(store));
    reacting.logging = Logging.OFF;
    const { Button, Recorder } = reacting.instrument({
      Button: new ButtonConcept(),
      Recorder: new RecorderConcept(),
    });
    reacting.register({
      PreserveEarlierAsk: (_vars: Vars) => {
        const first = mockRefs.Recorder.record({ tag: "first" }) as StepNode;
        first.transform = (frames) => frames;
        return when(mockRefs.Button.clicked({ kind: "mark-preservation" }).responds())
          .then(first as never)
          .then(mockRefs.Recorder.record({ tag: "second" }));
      },
    });

    await Button.clicked({ kind: "mark-preservation" });

    expect(Recorder.order).toEqual(["first"]);
    const records = [...store.actions.values()];
    const trigger = records.find((record) => record.input.kind === "mark-preservation");
    const firstAsk = records.find((record) => record.input.tag === "first");
    if (trigger === undefined || firstAsk === undefined) throw new Error("expected recorded asks");
    expect(firstAsk.by).toBe("PreserveEarlierAsk");
    expect(store.firingsByReaction("PreserveEarlierAsk")).toEqual([
      expect.objectContaining({ consumed: [trigger.id], produced: [firstAsk.id] }),
    ]);
    expect(store.hasConsumed(trigger.id, "PreserveEarlierAsk")).toBe(true);
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
    const { Inspector: InspectorRef } = vocabulary({
      concepts: { Inspector: InspectorConcept },
    }).concepts;

    const { Inspector } = reacting.instrument({
      Button: new ButtonConcept(),
      Inspector: new InspectorConcept(),
    });

    expect(() =>
      reacting.register({
        MissingBinding: reaction((_vars: Vars) =>
          when(mockRefs.Button.clicked({ kind: "test" }).responds()).then(
            InspectorRef.inspect({ kind: Symbol("nonexistent") }),
          ),
        ),
      }),
    ).toThrow("before it is bound");
    expect(Inspector.received).toBeNull();
  });
});

// ── Invocation records are exposed before output and outcome ─────────────

describe("invocation records are exposed before output and outcome", () => {
  test("exposes a record before output or outcome is appended", () => {
    const reacting = new Reacting();
    const log = reacting.Action;

    const record = {
      id: "test-action",
      action: {} as any,
      concept: {},
      input: { test: true },
      flow: "test-flow",
    };
    log.invoke(record);
    const { id } = record;

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
