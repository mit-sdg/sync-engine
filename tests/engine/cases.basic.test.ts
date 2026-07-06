import { describe, expect, test } from "bun:test";
import { Frames, Logging, SyncConcept } from "@sync-engine/engine";
import {
  ButtonConcept,
  CounterConcept,
  ListConcept,
  NotificationConcept,
  RecorderConcept,
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
  return { Button, Counter, Notification, List, Recorder };
}

describe("engine: basic synchronizations", () => {
  test("button click increments counter once", async () => {
    const { Button, Counter } = setup();
    await Button.clicked({ kind: "inc" });
    expect(Counter.count).toBe(1);
  });

  test("notify when count reaches 3", async () => {
    const { Button, Notification } = setup();
    await Button.clicked({ kind: "inc" });
    await Button.clicked({ kind: "inc" });
    await Button.clicked({ kind: "inc" });
    expect(Notification.messages).toEqual(["reached 3"]);
  });

  test("fanout over list via query", async () => {
    const { Button, List, Recorder } = setup();
    List.add({ value: 1 });
    List.add({ value: 2 });
    List.add({ value: 3 });
    await Button.clicked({ kind: "fanout" });
    expect(Recorder.order.length).toBe(3);
  });

  test("fanout over list via async query", async () => {
    const { Button, List, Recorder } = setup();
    List.add({ value: 1 });
    List.add({ value: 2 });
    List.add({ value: 3 });
    await Button.clicked({ kind: "fanout-async" });
    expect(Recorder.order.length).toBe(3);
  });

  test("prevent double fire by synced marks across when actions", async () => {
    const { Recorder } = setup();
    await Recorder.record({ tag: "x" });
    // ChainRecordA appends ":a", PreventDoubleFire then appends ":done".
    expect(Recorder.order.join(",")).toBe("x,x:a,x:done");
  });

  describe("Frames helpers", () => {
    const SymA = Symbol("a");
    const SymB = Symbol("b");

    test("bind: assigns a literal value to every frame", () => {
      const frames = new Frames({ [SymA]: 1 }, { [SymA]: 2 });
      const result = frames.bind(SymB, 42);
      expect(result.length).toBe(2);
      expect(result[0][SymB]).toBe(42);
      expect(result[1][SymB]).toBe(42);
      // Original bindings preserved
      expect(result[0][SymA]).toBe(1);
      expect(result[1][SymA]).toBe(2);
    });

    test("bind: computes value per frame via function", () => {
      const frames = new Frames({ [SymA]: 1 }, { [SymA]: 2 });
      const result = frames.bind(
        SymB,
        (f: Record<symbol, unknown>) => (f[SymA] as number) * 10,
      );
      expect(result[0][SymB]).toBe(10);
      expect(result[1][SymB]).toBe(20);
    });

    test("guard: filters frames by predicate", () => {
      const frames = new Frames({ [SymA]: 1 }, { [SymA]: 2 }, { [SymA]: 3 });
      const result = frames.guard((f) => (f[SymA] as number) > 1);
      expect(result.length).toBe(2);
      expect(result[0][SymA]).toBe(2);
      expect(result[1][SymA]).toBe(3);
    });

    test("guard: type-narrowing works with frames", () => {
      const frames = new Frames<Record<symbol, unknown>>(
        { [SymA]: "hello" },
        { [SymA]: 42 },
      );
      const result = frames.guard(
        (f): f is Record<symbol, unknown> & { [SymA]: string } =>
          typeof f[SymA] === "string",
      );
      expect(result.length).toBe(1);
    });

    test("enrich: merges async result keys into each frame", async () => {
      const frames = new Frames({ [SymA]: 1 }, { [SymA]: 2 });
      const result = await frames.enrich(async (f) => ({
        doubled: (f[SymA] as number) * 2,
      }));
      expect(result.length).toBe(2);
      const DoubledSym = Symbol.for("doubled");
      expect(result[0][DoubledSym]).toBe(2);
      expect(result[1][DoubledSym]).toBe(4);
      // Original bindings preserved
      expect(result[0][SymA]).toBe(1);
    });

    test("enrich: runs fn for each frame in parallel", async () => {
      const order: number[] = [];
      const frames = new Frames({ [SymA]: 1 }, { [SymA]: 2 }, { [SymA]: 3 });
      const result = await frames.enrich(async (f) => {
        const ms = (3 - (f[SymA] as number)) * 10; // first frame waits longest
        await new Promise((r) => setTimeout(r, ms));
        order.push(f[SymA] as number);
        return { processed: true };
      });
      expect(result.length).toBe(3);
      // Parallel execution means last frame (shortest wait) finishes first
      expect(order).toEqual([3, 2, 1]);
    });

    test("innerJoin: delegates to query (inner-join semantics)", () => {
      // Create frames and a mock query function
      const frames = new Frames({ [SymA]: 1 }, { [SymA]: 2 });
      const result = frames.innerJoin(
        (input: { value: unknown }) => {
          const v = input.value as number;
          return v === 1 ? [{ extra: "yes" }] : [];
        },
        { value: SymA },
        { extra: SymB },
      );
      // innerJoin returns Frames synchronously for sync queryFn
      if (result instanceof Promise) throw new Error("expected sync");
      expect(result.length).toBe(1);
      expect(result[0][SymB]).toBe("yes");
    });

    test("leftJoin: preserves frames with no matches", () => {
      const frames = new Frames({ [SymA]: 1 }, { [SymA]: 2 });
      const result = frames.leftJoin(
        (input: { value: unknown }) => {
          const v = input.value as number;
          return v === 1 ? [{ extra: "yes" }] : [];
        },
        { value: SymA },
        { extra: SymB },
      );
      if (result instanceof Promise) throw new Error("expected sync");
      expect(result.length).toBe(2);
      // Frame with match has binding
      expect(result[0][SymB]).toBe("yes");
      // Frame without match is preserved with undefined binding
      expect(result[1][SymB]).toBeUndefined();
    });

    test("collectOne: gathers values into a single-frame array", () => {
      const frames = new Frames({ [SymA]: 10 }, { [SymA]: 20 }, { [SymA]: 30 });
      const result = frames.collectOne(SymB, SymA);
      expect(result.length).toBe(1);
      expect(result[0][SymB]).toEqual([10, 20, 30]);
    });

    test("collectOne: skips frames with missing key", () => {
      const frames = new Frames(
        { [SymA]: 10 },
        { [SymB]: "other" },
        { [SymA]: 30 },
      );
      const result = frames.collectOne(Symbol("collected"), SymA);
      expect(result.length).toBe(1);
      for (const frame of result) {
        const keys = Object.getOwnPropertySymbols(frame);
        expect(keys.length).toBe(1);
        // The collected array should have two values (skipping the middle frame)
        expect((frame as Record<symbol, unknown>)[keys[0]]).toEqual([10, 30]);
      }
    });

    test("collectOne: empty frames yields single frame with empty array", () => {
      const frames = new Frames<Record<symbol, unknown>>();
      const result = frames.collectOne(SymB, SymA);
      expect(result.length).toBe(1);
      expect(result[0][SymB]).toEqual([]);
    });
  });
});
