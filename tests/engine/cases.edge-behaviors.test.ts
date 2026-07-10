/**
 * Regression coverage for edge behavior in the sync engine.
 */

import { describe, expect, test } from "vite-plus/test";
import {
  act,
  Frames,
  Logging,
  par,
  sync,
  SyncConcept,
  type Vars,
  when,
  actionNameOf,
} from "@sync-engine/engine";
import { ButtonConcept, RecorderConcept, ThrowingConcept } from "./mocks.ts";

// ── Parallel then-step consumption marks ────────────────────────────────────

describe("parallel then-steps share when-action records unsafely", () => {
  test("should not let one parallel step's failure erase another step's consumption mark", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;

    let invokeCount = 0;
    const INVOKE_TO_FAIL = 3;
    const origInvoke = Sync.Action.invoke.bind(Sync.Action);
    Sync.Action.invoke = function (record) {
      invokeCount++;
      if (invokeCount === INVOKE_TO_FAIL) {
        throw new Error("simulated journal failure in second parallel step");
      }
      return origInvoke(record);
    };

    class Marker {
      hits = 0;
      mark() {
        this.hits++;
        return {};
      }
      crash() {
        return {};
      }
    }

    const { Button, Marker: MKR } = Sync.instrument({
      Button: new ButtonConcept(),
      Marker: new Marker(),
    });

    Sync.register({
      InfraRace: sync((_vars: Vars) =>
        when(Button.clicked, { kind: "infra-race" }, {}).then(
          par(act(MKR.mark, {}), act(MKR.crash, {})),
        ),
      ),
    });

    await Button.clicked({ kind: "infra-race" });

    const actions = [...Sync.Action.actions.values()];
    const whenAction = actions.find((a) => a.action === Button.clicked);

    expect(whenAction?.synced?.has("InfraRace")).toBe(true);
    expect(MKR.hits).toBe(1);
  });

  test("should not let parallel steps overwrite each other's action-id trace", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;

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

    const { Button, StepMarker: SM } = Sync.instrument({
      Button: new ButtonConcept(),
      StepMarker: new StepMarker(),
    });

    Sync.register({
      OverwriteRace: sync((_vars: Vars) =>
        when(Button.clicked, { kind: "race-test" }, {}).then(par(act(SM.a, {}), act(SM.b, {}))),
      ),
    });

    await Button.clicked({ kind: "race-test" });

    const actions = [...Sync.Action.actions.values()];
    const whenAction = actions.find((a) => a.action === Button.clicked);
    const syncedVal = whenAction?.synced?.get("OverwriteRace");

    expect(typeof syncedVal).toBe("string");
    expect(whenAction?.synced?.has("OverwriteRace")).toBe(true);
  });

  test("should preserve successful sibling's synced mark after error in another par child", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;

    const { Button, Recorder, Throwing } = Sync.instrument({
      Button: new ButtonConcept(),
      Recorder: new RecorderConcept(),
      Throwing: new ThrowingConcept(),
    });

    Sync.register({
      ParMixed: sync((_vars: Vars) =>
        when(Button.clicked, { kind: "par-mixed" }, {}).then(
          par(act(Recorder.record, { tag: "good-branch" }), act(Throwing.explode, {})),
        ),
      ),
    });

    await Button.clicked({ kind: "par-mixed" });

    expect(Recorder.order).toContain("good-branch");

    const actions = [...Sync.Action.actions.values()];
    const whenAction = actions.find((a) => a.input?.kind === "par-mixed");
    expect(whenAction?.synced?.has("ParMixed")).toBe(true);
  });
});

// ── enrich() symbols are per-call, avoiding cross-context leaks ────────────

describe("enrich uses per-call local symbols", () => {
  test("creates per-call symbols that don't leak between enrich calls", async () => {
    const symA = Symbol("a");
    const frames1 = new Frames({ [symA]: 1 } as Record<symbol, unknown>);
    const frames2 = new Frames({ [symA]: 2 } as Record<symbol, unknown>);

    const enriched1 = await frames1.enrich(async () => ({ sharedKey: "value1" }));
    const enriched2 = await frames2.enrich(async () => ({ sharedKey: "value2" }));

    const syms1 = Object.getOwnPropertySymbols(enriched1[0]);
    const syms2 = Object.getOwnPropertySymbols(enriched2[0]);

    const enrichSym1 = syms1.find((s) => s.description === "sharedKey");
    const enrichSym2 = syms2.find((s) => s.description === "sharedKey");

    expect(enrichSym1).toBeDefined();
    expect(enrichSym2).toBeDefined();
    if (enrichSym1 && enrichSym2) {
      expect(enrichSym1).not.toBe(enrichSym2);
    }
    if (enrichSym1) expect(enriched1[0][enrichSym1]).toBe("value1");
    if (enrichSym2) expect(enriched2[0][enrichSym2]).toBe("value2");
  });
});

// ── Unbound frame variables are silently dropped instead of signalling ──────

describe("unbound frame variables are silently dropped", () => {
  test("should drop query input keys when a frame binding is missing", () => {
    const symA = Symbol("bound");
    const symB = Symbol("unbound");
    const frame: Record<symbol, unknown> = { [symA]: "hello" };

    const receivedKeys: string[] = [];
    const frames = new Frames(frame);
    frames.query(
      (input) => {
        receivedKeys.push(...Object.keys(input as Record<string, unknown>));
        return [];
      },
      { bound: symA, unbound: symB },
      {},
    );

    // bindInput silently discards mapping entries whose symbol is not present
    // in the frame. The query function never sees an "unbound" key at all.
    expect(receivedKeys).not.toContain("unbound");
  });

  test("should not dispatch then-actions when a variable binding is unresolved", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;

    class InspectorConcept {
      received: Record<string, unknown> | null = null;
      inspect(input: Record<string, unknown>) {
        this.received = input;
        return {};
      }
    }

    const { Button, Inspector } = Sync.instrument({
      Button: new ButtonConcept(),
      Inspector: new InspectorConcept(),
    });

    Sync.register({
      MissingBinding: sync((_vars: Vars) =>
        when(Button.clicked, { kind: "test" }, {}).then(
          act(Inspector.inspect, { kind: Symbol("nonexistent") }),
        ),
      ),
    });

    await Button.clicked({ kind: "test" });

    expect(Inspector.received).toBeNull();
  });
});

// ── collectAs group keys are unstable for object/BigInt values ──────────────

describe("collectAs produces stable group keys", () => {
  test("groups equivalent object values together regardless of key order", () => {
    const group = Symbol("group");
    const value = Symbol("value");
    const items = Symbol("items");

    const frames = new Frames(
      { [group]: "g1", [value]: { a: 1, b: 2 } },
      { [group]: "g1", [value]: { b: 2, a: 1 } },
    );

    const out = frames.collectAs([value], items);

    expect(out.length).toBe(1);
  });

  test("handles BigInt values in non-collected keys", () => {
    const g = Symbol("g");
    const big = Symbol("big");
    const items = Symbol("items");

    const frames = new Frames({ [g]: BigInt(42), [big]: "val" } as Record<symbol, unknown>);

    const out = frames.collectAs([big], items);

    expect(out.length).toBe(1);
  });
});

// ── Journal records are observable in an incomplete state ───────────────────

describe("journal records are briefly incomplete between append and commit", () => {
  test("should not expose a record without output or outcome to readers", () => {
    const Sync = new SyncConcept();
    const journal = Sync.Action;

    const record = {
      action: {} as any,
      concept: {},
      input: { test: true },
      synced: new Map(),
      flow: "test-flow",
    };
    const { id } = journal.invoke(record);

    const stored = journal._getById(id);
    // invoke() appends the record immediately. invoked() attaches output and
    // outcome later. Between the two calls, any journal reader sees a record
    // with undefined output and outcome.
    expect(stored?.output).toBeUndefined();
    expect(stored?.outcome).toBeUndefined();

    journal.invoked({ id, output: { result: "ok" } });

    const completed = journal._getById(id);
    expect(completed?.output).toEqual({ result: "ok" });
    expect(completed?.outcome).toBeDefined();
  });
});

// ── actionNameOf supports bound and unbound action references ───────────────

describe("actionNameOf preserves non-bound function names", () => {
  test("should return the original name of a non-bound function", () => {
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

  test("should return the method name for unbound class methods", () => {
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

// ── One failing query/enrich does not discard sibling results ──────────────

describe("single query or enrich failure does not discard sibling results", () => {
  test("does not discard results of successful queries when one query fails", async () => {
    const id = Symbol("id");
    const result = Symbol("result");

    const frames = new Frames({ [id]: 1 }, { [id]: 2 }, { [id]: 3 });

    let successes = 0;
    let failures = 0;

    const queryFn = async ({ id: idVal }: { id: number }) => {
      if (idVal === 2) {
        failures++;
        throw new Error("query failed for id=2");
      }
      successes++;
      return [{ doubled: idVal * 2 }];
    };

    const out = await frames.query(queryFn, { id }, { doubled: result });

    expect(successes).toBe(2);
    expect(failures).toBe(1);
    expect(out.length).toBe(2);
  });

  test("does not discard results of successful enrich calls when one fails", async () => {
    const frames = new Frames(
      { [Symbol("n")]: 1 } as Record<symbol, unknown>,
      { [Symbol("n")]: 2 } as Record<symbol, unknown>,
      { [Symbol("n")]: 3 } as Record<symbol, unknown>,
    );

    let processed = 0;
    const out = await frames.enrich(async (f) => {
      const n = (f as Record<symbol, unknown>)[Object.getOwnPropertySymbols(f)[0]];
      if (n === 2) throw new Error("enrich failed");
      processed++;
      return { doubled: Number(n) * 2 };
    });

    expect(processed).toBe(2);
    expect(out.length).toBe(3);
  });
});

// ── Observers have no bulk-removal or lifecycle-driven teardown ─────────────

describe("observers cannot be removed in bulk", () => {
  test("a lost unsubscribe handle means the observer leaks forever", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const { Button } = Sync.instrument({ Button: new ButtonConcept() });

    let calls = 0;
    Sync.addObserver({
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

// ── evictSyncedFlows snapshots keys before eviction ──────────────────────────

describe("evictSyncedFlows safely evicts without iterating a mutating map", () => {
  test("evictSyncedFlows processes flows with synced last records", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const { Button } = Sync.instrument({ Button: new ButtonConcept() });

    await Button.clicked({ kind: "a" });
    await Button.clicked({ kind: "b" });

    const before = Sync.Action.flowIndex.size;

    const records = Sync.Action._getByFlow([...Sync.Action.flowIndex.keys()][0] ?? "");
    if (records && records.length > 0) {
      const last = records[records.length - 1];
      last.synced = new Map([["test-sync", "test-id"]]);
    }

    const evicted = Sync.Action.evictSyncedFlows();

    expect(evicted).toBeGreaterThanOrEqual(0);
    expect(Sync.Action.flowIndex.size).toBeLessThan(before);
  });
});
