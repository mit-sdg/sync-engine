import { describe, expect, test } from "vite-plus/test";
import { act, type JournalEvent, Logging, SyncConcept, when } from "@sync-engine/engine";
import { FrameworkErrorCode } from "@sync-engine/sdk/error-codes.ts";
import {
  ButtonConcept,
  CounterConcept,
  NotificationConcept,
  RecorderConcept,
  ThrowingConcept,
} from "./mocks.ts";

// @covers-action SyncConcept.addObserver
// @covers-action SyncConcept.emitObserverEvents
// @covers-concept JournalEvent

/** Build a fresh engine with no syncs registered. */
function engine() {
  const Sync = new SyncConcept();
  Sync.logging = Logging.OFF;
  return { Sync };
}

/** Build an engine wired with the test concepts and basic syncs for chaining. */
function engineWithSyncs() {
  const Sync = new SyncConcept();
  Sync.logging = Logging.OFF;
  const { Button, Counter, Notification, Recorder } = Sync.instrument({
    Button: new ButtonConcept(),
    Counter: new CounterConcept(),
    Notification: new NotificationConcept(),
    Recorder: new RecorderConcept(),
  });

  // Simple sync: button click increments counter (uses proper $vars/actions pattern)
  Sync.register({
    ButtonIncrements: (_vars: Record<string, symbol>) =>
      when(Button.clicked, { kind: "inc" }, {}).then(act(Counter.increment, {})),
  });

  return { Sync, Button, Counter, Notification, Recorder };
}

describe("engine observer", () => {
  test("observer receives one event per action with correct fields", async () => {
    const { Sync } = engine();
    const { Button } = Sync.instrument({ Button: new ButtonConcept() });

    const events: JournalEvent[] = [];
    Sync.addObserver({
      onAction(ev: JournalEvent) {
        events.push(ev);
      },
    });

    await Button.clicked({ kind: "inc" });

    expect(events.length).toBe(1);

    const ev = events[0];
    expect(ev.concept).toBe("Button");
    expect(ev.action).toBe("clicked");
    expect(typeof ev.flow).toBe("string");
    expect(ev.flow.length).toBeGreaterThan(0);
    expect(ev.input).toEqual({ kind: "inc" });
    expect(ev.output).toEqual({ kind: "inc" });
    expect(ev.durationMs).toBeGreaterThanOrEqual(0);
    expect(ev.ts).toBeGreaterThan(0);
  });

  test("observer receives error output when action throws", async () => {
    const { Sync } = engine();
    const { Throwing } = Sync.instrument({ Throwing: new ThrowingConcept() });

    const events: JournalEvent[] = [];
    Sync.addObserver({
      onAction(ev: JournalEvent) {
        events.push(ev);
      },
    });

    const result = await Throwing.explode({});

    expect(result).toEqual({
      error: FrameworkErrorCode.UNKNOWN_ERROR,
      detail: "kaboom",
    });

    expect(events.length).toBe(1);
    expect(events[0].concept).toBe("Throwing");
    expect(events[0].action).toBe("explode");
    expect(events[0].output).toEqual({
      error: FrameworkErrorCode.UNKNOWN_ERROR,
      detail: "kaboom",
    });
  });

  test("a throwing observer does not break synchronize", async () => {
    const { Sync } = engine();
    const { Button } = Sync.instrument({ Button: new ButtonConcept() });

    let badCalled = false;
    let goodCalled = false;

    // This observer throws
    Sync.addObserver({
      onAction(_ev: JournalEvent) {
        badCalled = true;
        throw new Error("observer explosion");
      },
    });

    // This observer should still get called
    Sync.addObserver({
      onAction(_ev: JournalEvent) {
        goodCalled = true;
      },
    });

    // Action should still complete and return its output
    const result = await Button.clicked({ kind: "test" });

    expect(result).toEqual({ kind: "test" });
    expect(badCalled).toBe(true);
    expect(goodCalled).toBe(true);
  });

  test("addObserver returns a working unsubscribe function", async () => {
    const { Sync } = engine();
    const { Button } = Sync.instrument({ Button: new ButtonConcept() });

    const events: JournalEvent[] = [];
    const unsubscribe = Sync.addObserver({
      onAction(ev: JournalEvent) {
        events.push(ev);
      },
    });

    await Button.clicked({ kind: "first" });
    expect(events.length).toBe(1);

    // Unsubscribe
    unsubscribe();

    await Button.clicked({ kind: "second" });
    // Observer should not have received the second event
    expect(events.length).toBe(1);
    expect(events[0].input).toEqual({ kind: "first" });
  });

  test("no events emitted when no observer is attached (zero behaviour change)", async () => {
    const { Sync } = engine();
    const { Button } = Sync.instrument({ Button: new ButtonConcept() });

    // No observer attached — this should work without error
    const result = await Button.clicked({ kind: "quiet" });
    expect(result).toEqual({ kind: "quiet" });

    // Firing another action with syncs registered should also be fine
    const { Counter } = Sync.instrument({ Counter: new CounterConcept() });
    await Counter.increment({});
    // Nothing to assert — just verifying no crash
  });

  test("observer events are NOT emitted for queries (methods starting with _)", async () => {
    const { Sync } = engine();
    const { Counter } = Sync.instrument({ Counter: new CounterConcept() });

    const events: JournalEvent[] = [];
    Sync.addObserver({
      onAction(ev: JournalEvent) {
        events.push(ev);
      },
    });

    // Mutation — should emit
    await Counter.increment({});
    expect(events.length).toBe(1);

    // Query — should NOT emit
    const queryResult = await Counter._getCount({});
    expect(queryResult).toEqual([{ count: 1 }]);
    expect(events.length).toBe(1); // still 1, query didn't add
  });

  test("multiple observers all receive the same event", async () => {
    const { Sync } = engine();
    const { Button } = Sync.instrument({ Button: new ButtonConcept() });

    const eventsA: JournalEvent[] = [];
    const eventsB: JournalEvent[] = [];
    const eventsC: JournalEvent[] = [];

    Sync.addObserver({ onAction: (ev) => eventsA.push(ev) });
    Sync.addObserver({ onAction: (ev) => eventsB.push(ev) });
    Sync.addObserver({ onAction: (ev) => eventsC.push(ev) });

    await Button.clicked({ kind: "broadcast" });

    expect(eventsA.length).toBe(1);
    expect(eventsB.length).toBe(1);
    expect(eventsC.length).toBe(1);

    // All see the same event
    expect(eventsA[0].concept).toBe("Button");
    expect(eventsA[0].action).toBe("clicked");
    expect(eventsA[0].input).toEqual({ kind: "broadcast" });

    expect(eventsB[0].concept).toBe("Button");
    expect(eventsC[0].action).toBe("clicked");
  });

  test("subscribe/unsubscribe/resubscribe lifecycle works", async () => {
    const { Sync } = engine();
    const { Button } = Sync.instrument({ Button: new ButtonConcept() });

    const events: JournalEvent[] = [];
    const unsubscribe = Sync.addObserver({
      onAction(ev: JournalEvent) {
        events.push(ev);
      },
    });

    // Phase 1: subscribed
    await Button.clicked({ kind: "a" });
    expect(events.length).toBe(1);

    // Phase 2: unsubscribed
    unsubscribe();
    await Button.clicked({ kind: "b" });
    expect(events.length).toBe(1); // unchanged

    // Phase 3: re-subscribe
    const unsubscribe2 = Sync.addObserver({
      onAction(ev: JournalEvent) {
        events.push(ev);
      },
    });
    await Button.clicked({ kind: "c" });

    // Should have both old event + new event = 2
    expect(events.length).toBe(2);
    expect(events[0].input).toEqual({ kind: "a" });
    expect(events[1].input).toEqual({ kind: "c" });

    // Phase 4: unsubscribe again
    unsubscribe2();
    await Button.clicked({ kind: "d" });
    expect(events.length).toBe(2); // unchanged
  });

  test("observer receives durationMs >= 0 for fast actions", async () => {
    const { Sync } = engine();
    const { Button } = Sync.instrument({ Button: new ButtonConcept() });

    const events: JournalEvent[] = [];
    Sync.addObserver({
      onAction(ev: JournalEvent) {
        events.push(ev);
      },
    });

    await Button.clicked({ kind: "timing" });

    expect(events.length).toBe(1);
    expect(typeof events[0].durationMs).toBe("number");
    expect(events[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  test("observer still works alongside registered syncs (non-interference)", async () => {
    const { Sync, Button, Counter } = engineWithSyncs();

    const events: JournalEvent[] = [];
    Sync.addObserver({
      onAction(ev: JournalEvent) {
        events.push(ev);
      },
    });

    // clicked("inc") should trigger ButtonIncrements -> Counter.increment
    await Button.clicked({ kind: "inc" });

    // Sync fired: counter incremented
    expect(Counter.count).toBe(1);

    // Observer saw both actions.
    // Note: child then-actions complete before the parent synchronize returns,
    // so Counter.increment's event fires before Button.clicked's.
    expect(events.length).toBe(2);
    expect(events[0].concept).toBe("Counter");
    expect(events[0].action).toBe("increment");
    expect(events[1].concept).toBe("Button");
    expect(events[1].action).toBe("clicked");
  });

  test("double unsubscribe is safe (idempotent)", async () => {
    const { Sync } = engine();
    const { Button } = Sync.instrument({ Button: new ButtonConcept() });

    const events: JournalEvent[] = [];
    const unsubscribe = Sync.addObserver({
      onAction(ev: JournalEvent) {
        events.push(ev);
      },
    });

    await Button.clicked({ kind: "1" });
    expect(events.length).toBe(1);

    unsubscribe();
    unsubscribe(); // calling again should be safe
    unsubscribe(); // and again

    await Button.clicked({ kind: "2" });
    expect(events.length).toBe(1); // no new events
  });
});
