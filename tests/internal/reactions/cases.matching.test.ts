/** Focused engine tests covering matching, flow isolation, and firing consumption. */
import { describe, expect, test } from "vite-plus/test";
import {
  request,
  Frames,
  Logging,
  Reacting,
  type Vars,
  when,
} from "@sync-engine/internal/reactions";
import {
  CounterConcept,
  GateConcept,
  ListConcept,
  NotificationConcept,
  RecorderConcept,
} from "./mocks.ts";

/** Wire a Gate + Recorder pair to reactions that branch on output shape. */
function gateSetup() {
  const reacting = new Reacting();
  reacting.logging = Logging.OFF;
  const { Gate, Recorder } = reacting.instrument({
    Gate: new GateConcept(),
    Recorder: new RecorderConcept(),
  });

  // Mutually exclusive: only one of these can ever match a single check.
  const OnError = ({ error }: Vars) =>
    when(Gate.check, {}, { error }).then(request(Gate.record, { msg: error }));
  const OnQuestion = ({ question }: Vars) =>
    when(Gate.check, {}, { question }).then(request(Gate.record, { msg: question }));
  reacting.register({ OnError, OnQuestion });
  return { Gate, Recorder };
}

describe("engine: output pattern mutual-exclusivity", () => {
  test("a negative value matches only the `error` reaction", async () => {
    const { Gate } = gateSetup();
    await Gate.check({ value: -3 });
    expect(Gate.seen).toEqual(["negative:-3"]);
  });

  test("a non-negative value matches only the `question` reaction", async () => {
    const { Gate } = gateSetup();
    await Gate.check({ value: 7 });
    expect(Gate.seen).toEqual(["value:7"]);
  });
});

describe("engine: flow isolation", () => {
  test("independent invocations do not cross-match", async () => {
    const { Gate } = gateSetup();
    // Each check runs in its own flow; the two never combine.
    await Gate.check({ value: -1 });
    await Gate.check({ value: 2 });
    expect(Gate.seen.sort()).toEqual(["negative:-1", "value:2"]);
  });
});

describe("engine: consumption-based double-fire prevention", () => {
  test("a multi-`when` reaction consumes each record at most once", async () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Recorder, Counter } = reacting.instrument({
      Recorder: new RecorderConcept(),
      Counter: new CounterConcept(),
    });

    // Cascade: a simple tag produces its ":a" successor (same flow).
    const Cascade = ({ tag, next }: Vars) =>
      when(Recorder.record, { tag }, {})
        .where((frames: Frames) =>
          frames
            .filter(($) => !String($[tag]).includes(":"))
            .map((frame) => ({ ...frame, [next]: `${String(frame[tag])}:a` })),
        )
        .then(request(Recorder.record, { tag: next }));

    // Pair: matches the (base, base:a) pair exactly once and bumps a counter.
    const Pair = ({ tag1, tag2 }: Vars) =>
      when([
        [Recorder.record, { tag: tag1 }],
        [Recorder.record, { tag: tag2 }],
      ])
        .where((frames: Frames) =>
          frames
            .filter(($) => !String($[tag1]).includes(":"))
            .filter(($) => String($[tag2]) === `${String($[tag1])}:a`),
        )
        .then(request(Counter.increment, {}));
    reacting.register({ Cascade, Pair });

    await Recorder.record({ tag: "x" });

    expect(Recorder.order).toEqual(["x", "x:a"]);
    // Without consumption marks the pair could be re-consumed and over-count.
    expect(Counter.count).toBe(1);
  });
});

describe("engine: input field matching", () => {
  test("a listed input role requires the key to be present", async () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Recorder } = reacting.instrument({
      Recorder: new RecorderConcept(),
    });

    const OptionalFieldReaction = ({ tag, optional, next }: Vars) =>
      when(Recorder.record, { tag, optional }, {})
        .where((frames: Frames) =>
          frames
            .filter(($) => !String($[tag]).includes(":"))
            .map((frame) => ({
              ...frame,
              [next]: `optional:${String(frame[tag])}`,
            })),
        )
        .then(request(Recorder.record, { tag: next }));
    reacting.register({ OptionalFieldReaction });

    await Recorder.record({ tag: "required-only" });
    const blankInput = { tag: "blank", optional: "" };
    await Recorder.record(blankInput);
    expect(Recorder.order).toEqual(["required-only", "blank", "optional:blank"]);
  });

  test("an output pattern rejects an occurrence missing the named key", async () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Gate, Recorder } = reacting.instrument({
      Gate: new GateConcept(),
      Recorder: new RecorderConcept(),
    });

    const OutputRequiredReaction = ({ out }: Vars) =>
      when(Gate.record, {}, { out }).then(request(Recorder.record, { tag: "never" }));
    reacting.register({ OutputRequiredReaction });

    await Gate.record({ msg: "test" });
    expect(Recorder.order).toEqual([]);
  });

  test("matchThen resolves nested symbols in then input", async () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Recorder } = reacting.instrument({
      Recorder: new RecorderConcept(),
    });

    const NestedThenReaction = ({ tag, inner, next }: Vars) =>
      when(Recorder.record, { tag }, {})
        .where((frames: Frames) =>
          frames
            .filter(($) => !String($[tag]).includes(":"))
            .map((frame) => ({
              ...frame,
              [next]: `nested:${String(frame[tag])}`,
              [inner]: `inner-${String(frame[tag])}`,
            })),
        )
        .then(request(Recorder.record, { tag: next, extra: { inner } }));
    reacting.register({ NestedThenReaction });

    await Recorder.record({ tag: "outer" });
    expect(Recorder.order).toEqual(["outer", "nested:outer"]);
  });

  test("matchThen skips unbound optional symbols in then input", async () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Recorder } = reacting.instrument({
      Recorder: new RecorderConcept(),
    });

    const UnboundOptionalReaction = ({ present, next }: Vars) =>
      when(Recorder.record, { tag: present }, {})
        .where((frames: Frames) =>
          frames
            .filter(($) => !String($[present]).includes(":"))
            .map((frame) => ({
              ...frame,
              [next]: `unbound:${String(frame[present])}`,
            })),
        )
        .then(request(Recorder.record, { tag: next }));
    reacting.register({ UnboundOptionalReaction });

    await Recorder.record({ tag: "hello" });
    expect(Recorder.order).toEqual(["hello", "unbound:hello"]);
  });
});

describe("engine: deeply nested then resolution", () => {
  test("matchThen resolves symbols at depth 2 in then input", async () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Recorder } = reacting.instrument({
      Recorder: new RecorderConcept(),
    });

    reacting.register({
      DeepNest: ({ tag, inner }: Vars) =>
        when(Recorder.record, { tag }, {})
          .where((frames: Frames) =>
            frames
              .filter(($) => !String($[tag]).includes(":"))
              .map((frame) => ({
                ...frame,
                [inner]: `resolved-${String(frame[tag])}`,
              })),
          )
          .then(
            request(Recorder.record, {
              tag: "@:done",
              extra: { nested: { deep: inner } },
            }),
          ),
    });

    await Recorder.record({ tag: "hello" });
    expect(Recorder.order).toEqual(["hello", "@:done"]);
  });
});

describe("engine: symbol-keyed input pattern", () => {
  test("symbol-keyed input pattern key is ignored by when matching", async () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Recorder } = reacting.instrument({
      Recorder: new RecorderConcept(),
    });

    const symKey = Symbol("nonExistent");
    reacting.register({
      SymbolKeyPat: (_vars: Vars) =>
        when(
          Recorder.record,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { [symKey]: "impossible", tag: "expected" } as any,
          {},
        ).then(request(Recorder.record, { tag: "after-sym" })),
    });

    await Recorder.record({ tag: "expected" });
    expect(Recorder.order).toEqual(["expected", "after-sym"]);
  });
});

describe("engine: literal pattern values compare structurally", () => {
  test("a chained step fires when the prior step's input holds an array literal", async () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Notification, List } = reacting.instrument({
      Notification: new NotificationConcept(),
      List: new ListConcept(),
    });

    const OnAdd = ({ value }: Vars) =>
      when(List.add, {}, { value }).then(
        request(Notification.notify, { message: "first", tags: ["a", "b"] } as never),
        request(Notification.notify, { message: "second" }),
      );
    reacting.register({ OnAdd });

    await List.add({ value: 1 });
    expect((await Notification._getMessages({})).map((m) => m.message)).toEqual([
      "first",
      "second",
    ]);
  });

  test("an array literal in a trigger pattern matches an equal array, not just the same one", async () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Notification } = reacting.instrument({
      Notification: new NotificationConcept(),
    });

    const OnTagged = (_: Vars) =>
      when(Notification.notify, { tags: ["x", "y"] } as never, {}).then(
        request(Notification.notify, { message: "matched" }),
      );
    reacting.register({ OnTagged });

    await Notification.notify({ message: "probe", tags: ["x", "y"] } as never);
    const messages = (await Notification._getMessages({})).map((m) => m.message);
    expect(messages).toContain("matched");

    await Notification.notify({ message: "probe2", tags: ["x", "z"] } as never);
    const after = (await Notification._getMessages({})).filter((m) => m.message === "matched");
    expect(after).toHaveLength(1);
  });
});
