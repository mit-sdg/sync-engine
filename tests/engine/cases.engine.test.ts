import { describe, expect, test } from "vite-plus/test";
import { When, Then, type Frames, Logging, SyncConcept, type Vars } from "@sync-engine/engine";
import { FrameworkErrorCode } from "@sync-engine/sdk/error-codes.ts";
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
    const OnlyEven = ({ tag, value, evenTag }: Vars) => ({
      when: When([Recorder.record, { tag }, {}]),
      where: (frames: Frames) =>
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
      then: Then([Recorder.record, { tag: evenTag }]),
    });
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

  test("a throwing action does not abort downstream then actions in a chain", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const { Button, Recorder, Throwing } = Sync.instrument({
      Button: new ButtonConcept(),
      Recorder: new RecorderConcept(),
      Throwing: new ThrowingConcept(),
    });

    // Register a one-shot sync whose `then` fires two actions; the first throws.
    // Uses Button.clicked as the trigger (one-shot, no self-loop).
    Sync.register({
      ChainWithThrow: ({ kind }: Vars) => ({
        when: When([Button.clicked, { kind }, {}]),
        then: Then([Throwing.explode, {}], [Recorder.record, { tag: "after-throw" }]),
      }),
    });

    await Button.clicked({ kind: "test" });
    // If the engine didn't catch the throw from `explode` inside `then`,
    // the `then` chain would abort before running `record`. The recorder
    // should still have the "after-throw" entry.
    expect(Recorder.order).toContain("after-throw");
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
      StartWorkflow: ({ kind }: Vars) => ({
        when: When([Button.clicked, { kind }, {}]),
        then: Then([Throwing.safe, {}], [Throwing.explode, {}]),
      }),
      Response: ({ ok }: Vars) => ({
        when: When(
          [Button.clicked, { kind: "test" }, {}],
          [Throwing.safe, {}, { ok }],
          [Throwing.explode, {}, {}],
        ),
        then: Then([Recorder.record, { tag: "response" }]),
      }),
      ErrorResponse: ({ error }: Vars) => ({
        when: When([Throwing.explode, {}, { error }]),
        then: Then([Recorder.record, { tag: "error" }]),
      }),
    });

    await Button.clicked({ kind: "test" });

    expect(Throwing.hit).toBe(true);
    expect(Recorder.order).toContain("error");
    expect(Recorder.order).not.toContain("response");
  });
});
