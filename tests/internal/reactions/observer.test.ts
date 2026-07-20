import { describe, expect, test } from "vite-plus/test";
import { request, type LogEvent, Logging, Reacting, when } from "@sync-engine/internal/reactions";
import {
  ButtonConcept,
  CounterConcept,
  NotificationConcept,
  RecorderConcept,
  ThrowingConcept,
} from "./mocks.ts";

// @covers-action Reacting.addObserver
// @covers-action Reacting.emitObserverEvents
// @covers-concept LogEvent

/** Build a fresh engine with no reactions registered. */
function engine() {
  const reacting = new Reacting();
  reacting.logging = Logging.OFF;
  return { reacting };
}

/** Build an engine with one button-to-counter reaction. */
function engineWithReactions() {
  const reacting = new Reacting();
  reacting.logging = Logging.OFF;
  const { Button, Counter, Notification, Recorder } = reacting.instrument({
    Button: new ButtonConcept(),
    Counter: new CounterConcept(),
    Notification: new NotificationConcept(),
    Recorder: new RecorderConcept(),
  });

  reacting.register({
    ButtonIncrements: (_vars: Record<string, symbol>) =>
      when(Button.clicked, { kind: "inc" }, {}).then(request(Counter.increment, {})),
  });

  return { reacting, Button, Counter, Notification, Recorder };
}

describe("engine observer", () => {
  test("an observer event carries action identity, flow, input, output, and timing", async () => {
    const { reacting } = engine();
    const { Button } = reacting.instrument({ Button: new ButtonConcept() });

    const events: LogEvent[] = [];
    reacting.addObserver({
      onAction(ev: LogEvent) {
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

  test("observer receives the refusal's mapping when an action refuses", async () => {
    const { reacting } = engine();
    const { Throwing } = reacting.instrument({ Throwing: new ThrowingConcept() });

    const events: LogEvent[] = [];
    reacting.addObserver({
      onAction(ev: LogEvent) {
        events.push(ev);
      },
    });

    const result = await Throwing.explode({});

    expect(result).toEqual({ error: "KABOOM", detail: "kaboom" });

    expect(events.length).toBe(1);
    expect(events[0].concept).toBe("Throwing");
    expect(events[0].action).toBe("explode");
    expect(events[0].output).toEqual({ error: "KABOOM", detail: "kaboom" });
  });

  test("a throwing observer neither blocks another observer nor replaces the action result", async () => {
    const { reacting } = engine();
    const { Button } = reacting.instrument({ Button: new ButtonConcept() });

    let badCalled = false;
    let goodCalled = false;

    reacting.addObserver({
      onAction(_ev: LogEvent) {
        badCalled = true;
        throw new Error("observer explosion");
      },
    });

    reacting.addObserver({
      onAction(_ev: LogEvent) {
        goodCalled = true;
      },
    });

    const result = await Button.clicked({ kind: "test" });

    expect(result).toEqual({ kind: "test" });
    expect(badCalled).toBe(true);
    expect(goodCalled).toBe(true);
  });

  test("the unsubscribe function stops later observer events", async () => {
    const { reacting } = engine();
    const { Button } = reacting.instrument({ Button: new ButtonConcept() });

    const events: LogEvent[] = [];
    const unsubscribe = reacting.addObserver({
      onAction(ev: LogEvent) {
        events.push(ev);
      },
    });

    await Button.clicked({ kind: "first" });
    expect(events.length).toBe(1);

    unsubscribe();

    await Button.clicked({ kind: "second" });
    expect(events.length).toBe(1);
    expect(events[0].input).toEqual({ kind: "first" });
  });

  test("actions return and mutate normally when no observer is attached", async () => {
    const { reacting } = engine();
    const { Button } = reacting.instrument({ Button: new ButtonConcept() });

    const result = await Button.clicked({ kind: "quiet" });
    expect(result).toEqual({ kind: "quiet" });

    const { Counter } = reacting.instrument({ Counter: new CounterConcept() });
    await Counter.increment({});
    expect(Counter.count).toBe(1);
  });

  test("an action emits an observer event and a query emits none", async () => {
    const { reacting } = engine();
    const { Counter } = reacting.instrument({ Counter: new CounterConcept() });

    const events: LogEvent[] = [];
    reacting.addObserver({
      onAction(ev: LogEvent) {
        events.push(ev);
      },
    });

    await Counter.increment({});
    expect(events.length).toBe(1);

    const queryResult = await Counter._getCount({});
    expect(queryResult).toEqual([{ count: 1 }]);
    expect(events.length).toBe(1);
  });

  test("each registered observer receives the action event", async () => {
    const { reacting } = engine();
    const { Button } = reacting.instrument({ Button: new ButtonConcept() });

    const eventsA: LogEvent[] = [];
    const eventsB: LogEvent[] = [];
    const eventsC: LogEvent[] = [];

    reacting.addObserver({ onAction: (ev) => eventsA.push(ev) });
    reacting.addObserver({ onAction: (ev) => eventsB.push(ev) });
    reacting.addObserver({ onAction: (ev) => eventsC.push(ev) });

    await Button.clicked({ kind: "broadcast" });

    expect(eventsA.length).toBe(1);
    expect(eventsB.length).toBe(1);
    expect(eventsC.length).toBe(1);

    expect(eventsA[0].concept).toBe("Button");
    expect(eventsA[0].action).toBe("clicked");
    expect(eventsA[0].input).toEqual({ kind: "broadcast" });

    expect(eventsB[0].concept).toBe("Button");
    expect(eventsC[0].action).toBe("clicked");
  });

  test("a new subscription receives events after an earlier subscription ends", async () => {
    const { reacting } = engine();
    const { Button } = reacting.instrument({ Button: new ButtonConcept() });

    const events: LogEvent[] = [];
    const unsubscribe = reacting.addObserver({
      onAction(ev: LogEvent) {
        events.push(ev);
      },
    });

    await Button.clicked({ kind: "a" });
    expect(events.length).toBe(1);

    unsubscribe();
    await Button.clicked({ kind: "b" });
    expect(events.length).toBe(1);

    const unsubscribe2 = reacting.addObserver({
      onAction(ev: LogEvent) {
        events.push(ev);
      },
    });
    await Button.clicked({ kind: "c" });

    expect(events.length).toBe(2);
    expect(events[0].input).toEqual({ kind: "a" });
    expect(events[1].input).toEqual({ kind: "c" });

    unsubscribe2();
    await Button.clicked({ kind: "d" });
    expect(events.length).toBe(2);
  });

  test("an observer event carries a non-negative duration", async () => {
    const { reacting } = engine();
    const { Button } = reacting.instrument({ Button: new ButtonConcept() });

    const events: LogEvent[] = [];
    reacting.addObserver({
      onAction(ev: LogEvent) {
        events.push(ev);
      },
    });

    await Button.clicked({ kind: "timing" });

    expect(events.length).toBe(1);
    expect(typeof events[0].durationMs).toBe("number");
    expect(events[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  test("an observer receives both actions in a registered reaction chain", async () => {
    const { reacting, Button, Counter } = engineWithReactions();

    const events: LogEvent[] = [];
    reacting.addObserver({
      onAction(ev: LogEvent) {
        events.push(ev);
      },
    });

    await Button.clicked({ kind: "inc" });

    expect(Counter.count).toBe(1);

    expect(events.length).toBe(2);
    expect(events[0].concept).toBe("Counter");
    expect(events[0].action).toBe("increment");
    expect(events[1].concept).toBe("Button");
    expect(events[1].action).toBe("clicked");
  });

  test("repeated unsubscribe calls leave the subscription inactive", async () => {
    const { reacting } = engine();
    const { Button } = reacting.instrument({ Button: new ButtonConcept() });

    const events: LogEvent[] = [];
    const unsubscribe = reacting.addObserver({
      onAction(ev: LogEvent) {
        events.push(ev);
      },
    });

    await Button.clicked({ kind: "1" });
    expect(events.length).toBe(1);

    unsubscribe();
    unsubscribe();
    unsubscribe();

    await Button.clicked({ kind: "2" });
    expect(events.length).toBe(1);
  });
});
