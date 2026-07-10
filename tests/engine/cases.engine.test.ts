import { describe, expect, test } from "vite-plus/test";
import {
  act,
  actionNodeId,
  type Frames,
  Logging,
  SyncConcept,
  type Vars,
  when,
} from "@sync-engine/engine";
import { FrameworkErrorCode } from "@sync-engine/sdk";
import {
  ButtonConcept,
  CounterConcept,
  ListConcept,
  NotificationConcept,
  RecorderConcept,
  ThrowingConcept,
} from "./mocks.ts";
import { makeSyncs } from "./syncs.ts";

/** Build a fresh, instrumented set of concepts wired to the test syncs. */
function setup() {
  const Sync = new SyncConcept();
  Sync.logging = Logging.OFF;
  const { Button, Counter, Notification, List, Recorder } = Sync.instrument({
    Button: new ButtonConcept(),
    Counter: new CounterConcept(),
    Notification: new NotificationConcept(),
    List: new ListConcept(),
    Recorder: new RecorderConcept(),
  });
  Sync.register(makeSyncs(Button, Counter, Notification, List, Recorder));
  return { Sync, Button, Counter, Notification, List, Recorder };
}

describe("engine: edge cases", () => {
  test("same-class concept instances keep separate instrumented wrappers", async () => {
    class NamedConcept {
      constructor(public readonly name: string) {}

      ping(_: Record<PropertyKey, never>) {
        return { name: this.name };
      }

      _who(_: Record<PropertyKey, never>): { name: string }[] {
        return [{ name: this.name }];
      }
    }

    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const Alpha = Sync.instrumentConcept(new NamedConcept("alpha"));
    const Beta = Sync.instrumentConcept(new NamedConcept("beta"));

    expect(Alpha.ping).toBe(Alpha.ping);
    expect(Beta.ping).toBe(Beta.ping);
    expect(Alpha.ping).not.toBe(Beta.ping);
    expect(Alpha._who).toBe(Alpha._who);
    expect(Beta._who).toBe(Beta._who);
    expect(Alpha._who).not.toBe(Beta._who);
    expect(await Beta.ping({})).toEqual({ name: "beta" });
    expect(await Beta._who({})).toEqual([{ name: "beta" }]);
  });

  test("where frames filter prevents extra then actions", async () => {
    const { Button, Notification } = setup();
    await Button.clicked({ kind: "inc" });
    await Button.clicked({ kind: "inc" });
    expect(Notification.messages.length).toBe(0);
    await Button.clicked({ kind: "inc" });
    expect(Notification.messages.length).toBe(1);
  });

  test("multiple flows do not cross-match when clauses", async () => {
    const { Button, Notification } = setup();
    await Button.clicked({ kind: "inc" });
    await Button.clicked({ kind: "inc" });
    await Button.clicked({ kind: "inc" });
    expect(Notification.messages.length).toBe(1);
  });

  test("frames query fanout composes with subsequent where filters", async () => {
    const { Sync, Button, List, Recorder } = setup();
    List.add({ value: 1 });
    List.add({ value: 2 });
    List.add({ value: 3 });

    // Extra sync that only records even values produced by FanoutOverList.
    const OnlyEven = ({ tag, value, evenTag }: Vars) =>
      when(Recorder.record, { tag }, {})
        .where((frames: Frames) =>
          frames
            .filter(($) => String($[tag]).startsWith("v:"))
            .map((frame) => {
              const num = Number(String(frame[tag]).split(":")[1] ?? "NaN");
              return { ...frame, [value]: num } as typeof frame;
            })
            .filter(($) => Number($[value]) % 2 === 0)
            .map((frame) => ({
              ...frame,
              [evenTag]: `even:${String(frame[value])}`,
            })),
        )
        .then(act(Recorder.record, { tag: evenTag }));
    Sync.register({ OnlyEven });

    await Button.clicked({ kind: "fanout" });
    expect(Recorder.order.filter((t) => t.startsWith("v:")).length).toBe(3);
    expect(Recorder.order.filter((t) => t.startsWith("even:")).length).toBe(1);
  });

  test("a throwing action is caught and normalized to error output", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const { Throwing } = Sync.instrument({
      Throwing: new ThrowingConcept(),
    });
    const result = await Throwing.explode({});
    expect(result).toEqual({
      error: FrameworkErrorCode.UNKNOWN_ERROR,
      detail: "kaboom",
    });
    expect(Throwing.hit).toBe(true);
  });

  test("a throwing action stops downstream pipeline actions", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const { Button, Recorder, Throwing } = Sync.instrument({
      Button: new ButtonConcept(),
      Recorder: new RecorderConcept(),
      Throwing: new ThrowingConcept(),
    });

    // Uses Button.clicked as the trigger (one-shot, no self-loop).
    Sync.register({
      ChainWithThrow: ({ kind }: Vars) =>
        when(Button.clicked, { kind }, {}).then(
          act(Throwing.explode, {}),
          act(Recorder.record, { tag: "after-throw" }),
        ),
    });

    await Button.clicked({ kind: "test" });
    expect(Recorder.order).not.toContain("after-throw");
  });

  test("empty output pattern rejects error outputs in multi-step when clauses", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const { Button, Recorder, Throwing } = Sync.instrument({
      Button: new ButtonConcept(),
      Recorder: new RecorderConcept(),
      Throwing: new ThrowingConcept(),
    });

    Sync.register({
      StartWorkflow: ({ kind }: Vars) =>
        when(Button.clicked, { kind }, {}).then(act(Throwing.safe, {}), act(Throwing.explode, {})),
      Response: ({ ok }: Vars) =>
        when([
          [Button.clicked, { kind: "test" }],
          [Throwing.safe, {}, { ok }],
          [Throwing.explode, {}],
        ]).then(act(Recorder.record, { tag: "response" })),
      ErrorResponse: ({ error }: Vars) =>
        when(Throwing.explode, {}, { error }).then(act(Recorder.record, { tag: "error" })),
    });

    await Button.clicked({ kind: "test" });

    expect(Throwing.hit).toBe(true);
    expect(Recorder.order).toContain("error");
    expect(Recorder.order).not.toContain("response");
  });

  test("clearObservers removes all observers", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const { Button } = Sync.instrument({ Button: new ButtonConcept() });

    let c1 = 0;
    let c2 = 0;
    let c3 = 0;
    Sync.addObserver({
      onAction() {
        c1++;
      },
    });
    Sync.addObserver({
      onAction() {
        c2++;
      },
    });
    Sync.addObserver({
      onAction() {
        c3++;
      },
    });

    await Button.clicked({ kind: "first" });
    expect(c1).toBe(1);
    expect(c2).toBe(1);
    expect(c3).toBe(1);

    Sync.clearObservers();

    await Button.clicked({ kind: "second" });
    expect(c1).toBe(1);
    expect(c2).toBe(1);
    expect(c3).toBe(1);
  });

  test("invalidateCaches clears query cache for one concept", async () => {
    class CachingConcept {
      calls = 0;
      _data(_: Record<PropertyKey, never>) {
        this.calls++;
        return [{ value: this.calls }];
      }
    }

    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const raw = new CachingConcept();
    const { C } = Sync.instrument({ C: raw });

    const r1 = await C._data({});
    expect(r1).toEqual([{ value: 1 }]);

    const r2 = await C._data({});
    expect(r2).toEqual([{ value: 1 }]);

    // Public callers normally retain the instrumented concept, not the raw instance.
    Sync.invalidateCaches(C);
    const r3 = await C._data({});
    expect(r3).toEqual([{ value: 2 }]);

    const r4 = await C._data({});
    expect(r4).toEqual([{ value: 2 }]);
  });

  test("invalidateAllCaches clears all concept caches", async () => {
    class CachingA {
      calls = 0;
      _query(_: Record<PropertyKey, never>) {
        this.calls++;
        return [{ v: this.calls }];
      }
    }
    class CachingB {
      calls = 0;
      _query(_: Record<PropertyKey, never>) {
        this.calls++;
        return [{ v: this.calls }];
      }
    }

    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const { A, B } = Sync.instrument({ A: new CachingA(), B: new CachingB() });

    const a1 = await A._query({});
    const b1 = await B._query({});
    expect(a1).toEqual([{ v: 1 }]);
    expect(b1).toEqual([{ v: 1 }]);

    const a2 = await A._query({});
    const b2 = await B._query({});
    expect(a2).toEqual([{ v: 1 }]);
    expect(b2).toEqual([{ v: 1 }]);

    Sync.invalidateAllCaches();

    const a3 = await A._query({});
    const b3 = await B._query({});
    expect(a3).toEqual([{ v: 2 }]);
    expect(b3).toEqual([{ v: 2 }]);
  });

  test("where() gate that throws does not break the engine", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const { Button, Recorder } = Sync.instrument({
      Button: new ButtonConcept(),
      Recorder: new RecorderConcept(),
    });

    Sync.register({
      BadWhere: (_vars: Vars) =>
        when(Button.clicked, { kind: "trigger" }, {})
          .where(() => {
            throw new Error("where-explosion");
          })
          .then(act(Recorder.record, { tag: "bad" })),
      GoodSync: (_vars: Vars) =>
        when(Button.clicked, { kind: "trigger" }, {}).then(act(Recorder.record, { tag: "good" })),
    });

    await Button.clicked({ kind: "trigger" });
    expect(Recorder.order).not.toContain("bad");
    expect(Recorder.order).toContain("good");
  });

  test("sync re-registration removes old sync from action index", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const { Button, Recorder } = Sync.instrument({
      Button: new ButtonConcept(),
      Recorder: new RecorderConcept(),
    });

    Sync.register({
      ReRegister: (_vars: Vars) =>
        when(Button.clicked, { kind: "re-reg" }, {}).then(act(Recorder.record, { tag: "old" })),
    });
    await Button.clicked({ kind: "re-reg" });
    expect(Recorder.order).toContain("old");

    Sync.register({
      ReRegister: (_vars: Vars) =>
        when(Button.clicked, { kind: "re-reg" }, {}).then(act(Recorder.record, { tag: "new" })),
    });
    await Button.clicked({ kind: "re-reg" });

    expect(Recorder.order.filter((t) => t === "old")).toHaveLength(1);
    expect(Recorder.order).toContain("new");
  });

  test("actionNodeId produces correct Concept.action format", () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const { Button, Recorder } = Sync.instrument({
      Button: new ButtonConcept(),
      Recorder: new RecorderConcept(),
    });

    const bp = {
      action: Button.clicked,
      concept: (Button.clicked as unknown as Record<string, unknown>).concept as object,
      input: {},
      flow: Symbol("flow"),
    };
    expect(actionNodeId(bp)).toBe("Button.clicked");

    const rp = {
      action: Recorder.record,
      concept: (Recorder.record as unknown as Record<string, unknown>).concept as object,
      input: { tag: "x" },
      flow: Symbol("flow"),
    };
    expect(actionNodeId(rp)).toBe("Recorder.record");
  });
});
