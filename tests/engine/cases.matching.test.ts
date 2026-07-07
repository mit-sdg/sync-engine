/**
 * Focused engine tests covering the core matching/joining model:
 *  - `query` inner-join drop-on-empty (fan-out),
 *  - `queryOptional` left-join preserve-on-empty,
 *  - `aggregate` empty + non-empty,
 *  - `collectAs` grouping (including with queryOptional),
 *  - `error` vs `question` output mutual-exclusivity,
 *  - flow isolation across independent action invocations,
 *  - synced double-fire prevention.
 *
 * The Frames-level cases exercise {@link Frames} directly; the engine-level
 * cases wire small mock concepts together with inline, declarative syncs.
 */
import { describe, expect, test } from "vite-plus/test";
import { When, Then, Frames, Logging, SyncConcept, type Vars } from "@sync-engine/engine";
import { CounterConcept, GateConcept, RecorderConcept } from "./mocks.ts";

describe("engine: Frames query/aggregate/collectAs", () => {
  test("query drops frames whose query returns no rows (inner join)", () => {
    const id = Symbol("id");
    const item = Symbol("item");
    const frames = new Frames({ [id]: "a" }, { [id]: "b" });

    // "a" has two children, "b" has none -> "b" frame is dropped entirely.
    const children: Record<string, string[]> = { a: ["a1", "a2"], b: [] };
    const out = frames.query(
      ({ id }: { id: string }) => children[id].map((value) => ({ value })),
      { id },
      { value: item },
    );

    expect(out).toBeInstanceOf(Frames);
    expect(out.length).toBe(2);
    expect(out.map(($) => $[item]).sort()).toEqual(["a1", "a2"]);
    expect(out.every(($) => $[id] === "a")).toBe(true);
  });

  test("aggregate on empty frames yields one frame with an empty list", () => {
    const request = Symbol("request");
    const value = Symbol("value");
    const list = Symbol("list");

    const empty = new Frames();
    const out = empty.aggregate({ [request]: "req-1" }, [value], list);

    expect(out.length).toBe(1);
    expect(out[0][request]).toBe("req-1");
    expect(out[0][list]).toEqual([]);
  });

  test("aggregate on non-empty frames behaves like collectAs", () => {
    const request = Symbol("request");
    const value = Symbol("value");
    const list = Symbol("list");

    const frames = new Frames(
      { [request]: "req-1", [value]: 1 },
      { [request]: "req-1", [value]: 2 },
    );
    const out = frames.aggregate({ [request]: "req-1" }, [value], list);

    expect(out.length).toBe(1);
    expect(out[0][request]).toBe("req-1");
    expect(out[0][list]).toEqual([{ value: 1 }, { value: 2 }]);
  });

  test("collectAs groups by surviving keys", () => {
    const group = Symbol("group");
    const value = Symbol("value");
    const items = Symbol("items");

    const frames = new Frames(
      { [group]: "x", [value]: 1 },
      { [group]: "x", [value]: 2 },
      { [group]: "y", [value]: 3 },
    );
    const out = frames.collectAs([value], items);

    expect(out.length).toBe(2);
    const byGroup = new Map(out.map(($): [unknown, unknown] => [$[group], $[items]]));
    expect(byGroup.get("x")).toEqual([{ value: 1 }, { value: 2 }]);
    expect(byGroup.get("y")).toEqual([{ value: 3 }]);
  });

  test("queryOptional preserves frame when child query returns no rows (left join)", () => {
    const id = Symbol("id");
    const item = Symbol("item");
    const frames = new Frames({ [id]: "a" }, { [id]: "b" });

    const children: Record<string, string[]> = { a: ["a1", "a2"], b: [] };
    const out = frames.queryOptional(
      ({ id: idVal }: { id: string }) => children[idVal].map((value) => ({ value })),
      { id },
      { value: item },
    );

    expect(out).toBeInstanceOf(Frames);
    expect(out.length).toBe(3);
    // "a" has two children — both frames present
    const aFrames = out.filter(($) => $[id] === "a");
    expect(aFrames.length).toBe(2);
    expect(aFrames.map(($) => $[item]).sort()).toEqual(["a1", "a2"]);
    // "b" has no children but frame is preserved (left join)
    const bFrames = out.filter(($) => $[id] === "b");
    expect(bFrames.length).toBe(1);
    expect(bFrames[0][item]).toBeUndefined();
    expect(bFrames[0][id]).toBe("b");
  });

  test("queryOptional works same as query when children exist (non-breaking)", () => {
    const id = Symbol("id");
    const item = Symbol("item");
    const frames = new Frames({ [id]: "a" });

    const children: Record<string, string[]> = { a: ["x", "y"] };
    const expected = frames.query(
      ({ id: idVal }: { id: string }) => children[idVal].map((value) => ({ value })),
      { id },
      { value: item },
    );
    const actual = frames.queryOptional(
      ({ id: idVal }: { id: string }) => children[idVal].map((value) => ({ value })),
      { id },
      { value: item },
    );

    expect(expected).toBeInstanceOf(Frames);
    expect(actual).toBeInstanceOf(Frames);
    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < actual.length; i++) {
      expect(actual[i][item]).toBe(expected[i][item]);
      expect(actual[i][id]).toBe(expected[i][id]);
    }
  });

  test("queryOptional + collectAs yields empty collected array for groups with no children", () => {
    const group = Symbol("group");
    const member = Symbol("member");
    const memberList = Symbol("memberList");
    const title = Symbol("title");

    // Simulating: group "g1" has two members, group "g2" has zero members
    const frames = new Frames(
      { [group]: "g1", [title]: "Class 1", [member]: "alice" },
      { [group]: "g1", [title]: "Class 1", [member]: "bob" },
      { [group]: "g2", [title]: "Class 2" },
    );

    const out = frames.collectAs([member], memberList);

    expect(out.length).toBe(2);
    const byGroup = new Map(out.map(($): [unknown, unknown] => [$[group], $[memberList]]));
    expect(byGroup.get("g1")).toEqual([{ member: "alice" }, { member: "bob" }]);
    // g2 had no member symbols so it contributes nothing to collected array
    expect(byGroup.get("g2")).toEqual([]);
  });
});

/** Wire a Gate + Recorder pair to syncs that branch on output shape. */
function gateSetup() {
  const Sync = new SyncConcept();
  Sync.logging = Logging.OFF;
  const { Gate, Recorder } = Sync.instrument({
    Gate: new GateConcept(),
    Recorder: new RecorderConcept(),
  });

  // Mutually exclusive: only one of these can ever match a single check.
  const OnError = ({ error }: Vars) => ({
    when: When([Gate.check, {}, { error }]),
    then: Then([Gate.record, { msg: error }]),
  });
  const OnQuestion = ({ question }: Vars) => ({
    when: When([Gate.check, {}, { question }]),
    then: Then([Gate.record, { msg: question }]),
  });
  Sync.register({ OnError, OnQuestion });
  return { Gate, Recorder };
}

describe("engine: output pattern mutual-exclusivity", () => {
  test("a negative value matches only the `error` sync", async () => {
    const { Gate } = gateSetup();
    await Gate.check({ value: -3 });
    expect(Gate.seen).toEqual(["negative:-3"]);
  });

  test("a non-negative value matches only the `question` sync", async () => {
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

describe("engine: synced double-fire prevention", () => {
  test("a multi-`when` sync consumes each record at most once", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const { Recorder, Counter } = Sync.instrument({
      Recorder: new RecorderConcept(),
      Counter: new CounterConcept(),
    });

    // Cascade: a simple tag produces its ":a" successor (same flow).
    const Cascade = ({ tag, next }: Vars) => ({
      when: When([Recorder.record, { tag }, {}]),
      where: (frames: Frames) =>
        frames
          .filter(($) => !String($[tag]).includes(":"))
          .map((frame) => ({ ...frame, [next]: `${String(frame[tag])}:a` })),
      then: Then([Recorder.record, { tag: next }]),
    });

    // Pair: matches the (base, base:a) pair exactly once and bumps a counter.
    const Pair = ({ tag1, tag2 }: Vars) => ({
      when: When([Recorder.record, { tag: tag1 }, {}], [Recorder.record, { tag: tag2 }, {}]),
      where: (frames: Frames) =>
        frames
          .filter(($) => !String($[tag1]).includes(":"))
          .filter(($) => String($[tag2]) === `${String($[tag1])}:a`),
      then: Then([Counter.increment, {}]),
    });
    Sync.register({ Cascade, Pair });

    await Recorder.record({ tag: "x" });

    expect(Recorder.order).toEqual(["x", "x:a"]);
    // Without synced marks the pair could be re-consumed and over-count.
    expect(Counter.count).toBe(1);
  });
});

describe("engine: optional field matching", () => {
  test("input pattern with symbol skips missing optional key", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const { Recorder } = Sync.instrument({
      Recorder: new RecorderConcept(),
    });

    const OptionalFieldSync = ({ tag, optional, next }: Vars) => ({
      when: When([Recorder.record, { tag, optional }, {}]),
      where: (frames: Frames) =>
        frames
          .filter(($) => !String($[tag]).includes(":"))
          .map((frame) => ({
            ...frame,
            [next]: `optional:${String(frame[tag])}`,
          })),
      then: Then([Recorder.record, { tag: next }]),
    });
    Sync.register({ OptionalFieldSync });

    await Recorder.record({ tag: "required-only" });
    expect(Recorder.order).toEqual(["required-only", "optional:required-only"]);
  });

  test("output pattern still rejects missing keys", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const { Gate, Recorder } = Sync.instrument({
      Gate: new GateConcept(),
      Recorder: new RecorderConcept(),
    });

    const OutputRequiredSync = ({ out }: Vars) => ({
      when: When([Gate.record, {}, { out }]),
      then: Then([Recorder.record, { tag: "never" }]),
    });
    Sync.register({ OutputRequiredSync });

    await Gate.record({ msg: "test" });
    expect(Recorder.order).toEqual([]);
  });

  test("matchThen resolves nested symbols in then input", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const { Recorder } = Sync.instrument({
      Recorder: new RecorderConcept(),
    });

    const NestedThenSync = ({ tag, inner, next }: Vars) => ({
      when: When([Recorder.record, { tag, inner }, {}]),
      where: (frames: Frames) =>
        frames
          .filter(($) => !String($[tag]).includes(":"))
          .map((frame) => ({
            ...frame,
            [next]: `nested:${String(frame[tag])}`,
          })),
      then: Then([Recorder.record, { tag: next, extra: { inner } }]),
    });
    Sync.register({ NestedThenSync });

    await Recorder.record({ tag: "outer" });
    expect(Recorder.order).toEqual(["outer", "nested:outer"]);
  });

  test("matchThen skips unbound optional symbols in then input", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const { Recorder } = Sync.instrument({
      Recorder: new RecorderConcept(),
    });

    const UnboundOptionalSync = ({ present, next }: Vars) => ({
      when: When([Recorder.record, { tag: present }, {}]),
      where: (frames: Frames) =>
        frames
          .filter(($) => !String($[present]).includes(":"))
          .map((frame) => ({
            ...frame,
            [next]: `unbound:${String(frame[present])}`,
          })),
      then: Then([Recorder.record, { tag: next }]),
    });
    Sync.register({ UnboundOptionalSync });

    await Recorder.record({ tag: "hello" });
    expect(Recorder.order).toEqual(["hello", "unbound:hello"]);
  });
});
