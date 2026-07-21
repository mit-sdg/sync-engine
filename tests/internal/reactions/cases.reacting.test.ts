import { describe, expect, test } from "vite-plus/test";
import {
  request,
  actionNodeId,
  type Frames,
  Logging,
  Reacting,
  type Vars,
  when,
} from "@sync-engine/internal/reactions";
import { FrameworkErrorCode } from "@sync-engine/boundary";
import {
  ButtonConcept,
  CounterConcept,
  CrashingConcept,
  ListConcept,
  NotificationConcept,
  RecorderConcept,
  ThrowingConcept,
} from "./mocks.ts";
import { makeReactions, registerReactionComputations } from "./reactions.ts";

/** Build a fresh, instrumented set of concepts wired to the test reactions. */
function setup() {
  const reacting = new Reacting();
  reacting.logging = Logging.OFF;
  registerReactionComputations(reacting);
  const { Button, Counter, Notification, List, Recorder } = reacting.instrument({
    Button: new ButtonConcept(),
    Counter: new CounterConcept(),
    Notification: new NotificationConcept(),
    List: new ListConcept(),
    Recorder: new RecorderConcept(),
  });
  reacting.register(makeReactions(Button, Counter, Notification, List, Recorder));
  return { reacting, Button, Counter, Notification, List, Recorder };
}

describe("engine: instrumentation, faults, caches, and registration", () => {
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

    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const Alpha = reacting.instrumentConcept(new NamedConcept("alpha"));
    const Beta = reacting.instrumentConcept(new NamedConcept("beta"));

    expect(Alpha.ping).toBe(Alpha.ping);
    expect(Beta.ping).toBe(Beta.ping);
    expect(Alpha.ping).not.toBe(Beta.ping);
    expect(Alpha._who).toBe(Alpha._who);
    expect(Beta._who).toBe(Beta._who);
    expect(Alpha._who).not.toBe(Beta._who);
    expect(await Beta.ping({})).toEqual({ name: "beta" });
    expect(await Beta._who({})).toEqual([{ name: "beta" }]);
  });

  test("a where callback can drop every frame and suppress its consequence", async () => {
    const { Button, Notification } = setup();
    await Button.clicked({ kind: "inc" });
    await Button.clicked({ kind: "inc" });
    expect(Notification.messages.length).toBe(0);
    await Button.clicked({ kind: "inc" });
    expect(Notification.messages.length).toBe(1);
  });

  test("separate root invocations do not combine their trigger records", async () => {
    const { Button, Notification } = setup();
    await Button.clicked({ kind: "inc" });
    await Button.clicked({ kind: "inc" });
    await Button.clicked({ kind: "inc" });
    expect(Notification.messages.length).toBe(1);
  });

  test("a fanned-out frame set can be filtered before requesting consequences", async () => {
    const { reacting, Button, List, Recorder } = setup();
    List.add({ value: 1 });
    List.add({ value: 2 });
    List.add({ value: 3 });

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
        .then(request(Recorder.record, { tag: evenTag }));
    reacting.register({ OnlyEven });

    await Button.clicked({ kind: "fanout" });
    expect(Recorder.order.filter((t) => t.startsWith("v:")).length).toBe(3);
    expect(Recorder.order.filter((t) => t.startsWith("even:")).length).toBe(1);
  });

  test("an empty-object success is a result with an empty value, not a third kind", async () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Counter } = reacting.instrument({ Counter: new CounterConcept() });

    await Counter.increment({});

    const records = [...reacting.Action.actions.values()];
    expect(records).toHaveLength(1);
    expect(records[0]?.outcome).toEqual({ kind: "result", value: {} });
  });

  test("a thrown Refuse is caught and returned as the refusal's mapping", async () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Throwing } = reacting.instrument({
      Throwing: new ThrowingConcept(),
    });
    const result = await Throwing.explode({});
    expect(result).toEqual({ error: "KABOOM", detail: "kaboom" });
    expect(Throwing.hit).toBe(true);
  });

  test("a thrown non-Refuse is a fault: the ask stays pending, the throw propagates", async () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Crashing } = reacting.instrument({
      Crashing: new CrashingConcept(),
    });
    await expect(Crashing.crash({})).rejects.toThrow("kaboom");
    expect(Crashing.hit).toBe(true);

    const [record] = [...reacting.Action.actions.values()];
    expect(record?.outcome).toBeUndefined();
    expect(record?.fault).toEqual({
      error: FrameworkErrorCode.UNKNOWN_ERROR,
    });
    expect(reacting.Action._getFaulted()).toHaveLength(1);
    expect(reacting.Action._getPending()).toHaveLength(1);
  });

  test("a faulted consequence prevents later actions in its pipeline", async () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Button, Recorder, Throwing } = reacting.instrument({
      Button: new ButtonConcept(),
      Recorder: new RecorderConcept(),
      Throwing: new ThrowingConcept(),
    });

    reacting.register({
      ChainWithThrow: ({ kind }: Vars) =>
        when(Button.clicked, { kind }, {})
          .then(request(Throwing.explode, {}))
          .then(request(Recorder.record, { tag: "after-throw" })),
    });

    await Button.clicked({ kind: "test" });
    expect(Recorder.order).not.toContain("after-throw");
  });

  test("empty output pattern rejects error outputs in multi-step when clauses", async () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Button, Recorder, Throwing } = reacting.instrument({
      Button: new ButtonConcept(),
      Recorder: new RecorderConcept(),
      Throwing: new ThrowingConcept(),
    });

    reacting.register({
      StartWorkflow: ({ kind }: Vars) =>
        when(Button.clicked, { kind }, {})
          .then(request(Throwing.safe, {}))
          .then(request(Throwing.explode, {})),
      Response: ({ ok }: Vars) =>
        when([
          [Button.clicked, { kind: "test" }],
          [Throwing.safe, {}, { ok }],
          [Throwing.explode, {}],
        ]).then(request(Recorder.record, { tag: "response" })),
      ErrorResponse: ({ error }: Vars) =>
        when(Throwing.explode, {}, { error }).then(request(Recorder.record, { tag: "error" })),
    });

    await Button.clicked({ kind: "test" });

    expect(Throwing.hit).toBe(true);
    expect(Recorder.order).toContain("error");
    expect(Recorder.order).not.toContain("response");
  });

  test("clearObservers prevents every observer from receiving later events", async () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Button } = reacting.instrument({ Button: new ButtonConcept() });

    let c1 = 0;
    let c2 = 0;
    let c3 = 0;
    reacting.addObserver({
      onAction() {
        c1++;
      },
    });
    reacting.addObserver({
      onAction() {
        c2++;
      },
    });
    reacting.addObserver({
      onAction() {
        c3++;
      },
    });

    await Button.clicked({ kind: "first" });
    expect(c1).toBe(1);
    expect(c2).toBe(1);
    expect(c3).toBe(1);

    reacting.clearObservers();

    await Button.clicked({ kind: "second" });
    expect(c1).toBe(1);
    expect(c2).toBe(1);
    expect(c3).toBe(1);
  });

  test("invalidateCaches refreshes one concept's memoized query", async () => {
    class CachingConcept {
      calls = 0;
      _data(_: Record<PropertyKey, never>) {
        this.calls++;
        return [{ value: this.calls }];
      }
    }

    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const raw = new CachingConcept();
    const { C } = reacting.instrument({ C: raw });

    const r1 = await C._data({});
    expect(r1).toEqual([{ value: 1 }]);

    const r2 = await C._data({});
    expect(r2).toEqual([{ value: 1 }]);

    reacting.invalidateCaches(C);
    const r3 = await C._data({});
    expect(r3).toEqual([{ value: 2 }]);

    const r4 = await C._data({});
    expect(r4).toEqual([{ value: 2 }]);
  });

  test("invalidateAllCaches refreshes memoized queries for every concept", async () => {
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

    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { A, B } = reacting.instrument({ A: new CachingA(), B: new CachingB() });

    const a1 = await A._query({});
    const b1 = await B._query({});
    expect(a1).toEqual([{ v: 1 }]);
    expect(b1).toEqual([{ v: 1 }]);

    const a2 = await A._query({});
    const b2 = await B._query({});
    expect(a2).toEqual([{ v: 1 }]);
    expect(b2).toEqual([{ v: 1 }]);

    reacting.invalidateAllCaches();

    const a3 = await A._query({});
    const b3 = await B._query({});
    expect(a3).toEqual([{ v: 2 }]);
    expect(b3).toEqual([{ v: 2 }]);
  });

  test("a throwing where callback skips its reaction without blocking a sibling", async () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Button, Recorder } = reacting.instrument({
      Button: new ButtonConcept(),
      Recorder: new RecorderConcept(),
    });

    reacting.register({
      BadWhere: (_vars: Vars) =>
        when(Button.clicked, { kind: "trigger" }, {})
          .where(() => {
            throw new Error("where-explosion");
          })
          .then(request(Recorder.record, { tag: "bad" })),
      GoodReaction: (_vars: Vars) =>
        when(Button.clicked, { kind: "trigger" }, {}).then(
          request(Recorder.record, { tag: "good" }),
        ),
    });

    await Button.clicked({ kind: "trigger" });
    expect(Recorder.order).not.toContain("bad");
    expect(Recorder.order).toContain("good");
  });

  test("reaction re-registration removes the prior definition from the action index", async () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Button, Recorder } = reacting.instrument({
      Button: new ButtonConcept(),
      Recorder: new RecorderConcept(),
    });

    reacting.register({
      ReRegister: (_vars: Vars) =>
        when(Button.clicked, { kind: "re-reg" }, {}).then(request(Recorder.record, { tag: "old" })),
    });
    await Button.clicked({ kind: "re-reg" });
    expect(Recorder.order).toContain("old");

    reacting.register({
      ReRegister: (_vars: Vars) =>
        when(Button.clicked, { kind: "re-reg" }, {}).then(request(Recorder.record, { tag: "new" })),
    });
    await Button.clicked({ kind: "re-reg" });

    expect(Recorder.order.filter((t) => t === "old")).toHaveLength(1);
    expect(Recorder.order).toContain("new");
  });

  test("actionNodeId joins the concept and action names with a dot", () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Button, Recorder } = reacting.instrument({
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
