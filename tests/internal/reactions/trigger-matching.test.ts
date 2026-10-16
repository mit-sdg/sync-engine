import { describe, expect, test } from "vite-plus/test";
import { vocabulary } from "@sync-engine/advanced";
import { earlier, when } from "@sync-engine/language";
import type { Vars } from "@sync-engine/internal/reactions/types";
import { ActionConcept } from "@sync-engine/internal/reactions/runtime/actions.ts";
import { TriggerMatcher } from "@sync-engine/internal/reactions/runtime/matching.ts";
import type {
  ExecutableReaction,
  InstrumentedAction,
} from "@sync-engine/internal/reactions/types.ts";
import { quietReacting } from "../../utils/reacting.ts";

class ShopConcept {
  async place(_: { order?: { name: string } }) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return {};
  }
}
class NudgeConcept {
  nudge({ kind }: { kind: string }) {
    return { kind };
  }
}
/** Marks the order it is given with a key the record copy would not carry. */
class TagConcept {
  held: object[] = [];
  tag({ order }: { order: object }) {
    Object.defineProperty(order, "seen", { value: true, enumerable: false });
    this.held.push(order);
    return {};
  }
}
class RecorderConcept {
  tags: string[] = [];
  record({ tag }: { tag: string }) {
    this.tags.push(tag);
    return { tag };
  }
}
class DoneConcept {
  done(_: Record<string, never>) {
    return {};
  }
}
const refs = vocabulary({
  concepts: {
    Shop: ShopConcept,
    Nudge: NudgeConcept,
    Tag: TagConcept,
    Recorder: RecorderConcept,
    Done: DoneConcept,
  },
}).concepts;

function marking() {
  const reacting = quietReacting();
  const tag = new TagConcept();
  const recorder = new RecorderConcept();
  const concepts = reacting.instrument({
    Shop: new ShopConcept(),
    Nudge: new NudgeConcept(),
    Tag: tag,
    Recorder: recorder,
    Done: new DoneConcept(),
  });
  return { reacting, concepts, tag, recorder };
}

describe("trigger matcher", () => {
  test("matches the landed occurrence and applies the consumption guard", () => {
    const actions = new ActionConcept();
    const concept = {};
    const action = (async () => ({})) as InstrumentedAction;
    action.concept = concept;
    actions.invoke({
      id: "ask",
      action,
      concept,
      input: { item: "one" },
      flow: "flow",
    });
    actions.invoked({
      id: "ask",
      output: { saved: true },
      outcome: { kind: "result", value: { saved: true } },
    });
    const reaction: ExecutableReaction = {
      name: "Observe",
      when: [
        {
          concept,
          action,
          input: { item: "one" },
          output: { saved: true },
          flow: Symbol("flow"),
        },
      ],
      then: [],
    };
    let consumed = false;
    const matcher = new TriggerMatcher(
      actions,
      { hasConsumed: () => consumed },
      (candidate) => candidate,
    );
    const landed = actions._getById("ask");
    expect(landed).toBeDefined();

    expect(matcher.match(landed!, reaction)[0]).toHaveLength(1);
    consumed = true;
    expect(matcher.match(landed!, reaction)[0]).toHaveLength(0);
  });

  test("stops a trigger cross-product before adding an over-limit frame", () => {
    const actions = new ActionConcept();
    const concept = {};
    const action = (async () => ({})) as InstrumentedAction;
    action.concept = concept;
    for (const item of ["one", "two", "three"]) {
      actions.invoke({ id: item, action, concept, input: { item }, flow: "flow" });
      actions.invoked({
        id: item,
        output: {},
        outcome: { kind: "result", value: {} },
      });
    }
    const left = Symbol("left");
    const right = Symbol("right");
    const flow = Symbol("flow");
    const reaction: ExecutableReaction = {
      name: "Pairs",
      when: [
        { concept, action, input: { item: left }, output: {}, flow },
        { concept, action, input: { item: right }, output: {}, flow },
      ],
      then: [],
    };
    const observed: number[] = [];
    const matcher = new TriggerMatcher(
      actions,
      { hasConsumed: () => false },
      (candidate) => candidate,
      (_flow, count) => {
        observed.push(count);
        if (count > 4) throw new Error("row limit");
      },
    );

    expect(() => matcher.match(actions._getById("three")!, reaction)).toThrow("row limit");
    expect(observed.at(-1)).toBe(5);
  });

  test("copies a record only for the clauses its stored form can match", () => {
    const actions = new ActionConcept();
    const concept = {};
    const action = (async () => ({})) as InstrumentedAction;
    action.concept = concept;
    let reads = 0;
    const value = {
      get saved() {
        reads += 1;
        return true;
      },
    };
    actions._beginMatchingInput({ id: "ask", flow: "flow", input: { item: "one" } });
    actions.invoke({ id: "ask", action, concept, input: { item: "one" }, flow: "flow" });
    actions.invoked({ id: "ask", output: value, outcome: { kind: "result", value } });
    reads = 0;
    const observe = (item: string): ExecutableReaction => ({
      name: `Observe ${item}`,
      when: [{ concept, action, input: { item }, output: { saved: true }, flow: Symbol("flow") }],
      then: [],
    });
    const matcher = new TriggerMatcher(
      actions,
      { hasConsumed: () => false },
      (candidate) => candidate,
    );
    const landed = actions._getById("ask")!;

    expect(matcher.match(landed, observe("two"))[0]).toHaveLength(0);
    expect(reads).toBe(0);
    expect(matcher.match(landed, observe("one"))[0]).toHaveLength(1);
    expect(reads).toBe(1);
  });

  test("binds one copy of a value two joined records share", () => {
    const actions = new ActionConcept();
    const concept = {};
    const action = (async () => ({})) as InstrumentedAction;
    action.concept = concept;
    const shared = { tags: ["a"] };
    let skippedReads = 0;
    for (const item of ["one", "skip", "two"]) {
      actions._beginMatchingInput({ id: item, flow: "flow", input: { item } });
      actions.invoke({ id: item, action, concept, input: { item }, flow: "flow" });
      const value =
        item === "skip"
          ? {
              get box() {
                skippedReads += 1;
                return shared;
              },
            }
          : { box: shared };
      actions.invoked({ id: item, output: value, outcome: { kind: "result", value } });
    }
    skippedReads = 0;
    const left = Symbol("left");
    const right = Symbol("right");
    const flow = Symbol("flow");
    const reaction: ExecutableReaction = {
      name: "Join",
      when: [
        { concept, action, input: { item: "one" }, output: { box: left }, flow },
        { concept, action, input: { item: "two" }, output: { box: right }, flow },
      ],
      then: [],
    };
    const matcher = new TriggerMatcher(
      actions,
      { hasConsumed: () => false },
      (candidate) => candidate,
    );

    const [frames] = matcher.match(actions._getById("two")!, reaction);
    expect(frames).toHaveLength(1);
    expect(frames[0][left]).toEqual(shared);
    expect(frames[0][left]).not.toBe(shared);
    expect(frames[0][left]).toBe(frames[0][right]);
    expect(skippedReads).toBe(0);
  });

  test("a single trigger still matches a record whose input an action marked through earlier", async () => {
    const { reacting, concepts, tag, recorder } = marking();
    reacting.register({
      Ask: (_: Vars) => when(refs.Shop.place({})).then(refs.Nudge.nudge({ kind: "go" })),
      Placed: (_: Vars) =>
        when(refs.Shop.place({ order: { name: "a" } }).responds()).then(
          refs.Recorder.record({ tag: "placed a" }),
        ),
    });
    reacting.registerReactions([
      {
        name: "Mark",
        when: [
          {
            kind: "action",
            concept: "Nudge",
            action: "nudge",
            posture: "returned",
            input: { kind: "go" },
            output: {},
          },
        ],
        where: [
          {
            op: "earlier",
            when: {
              kind: "action",
              concept: "Shop",
              action: "place",
              posture: "requested",
              input: { order: { $var: "order" } },
              output: {},
            },
          },
        ],
        then: [
          { kind: "request", concept: "Tag", action: "tag", input: { order: { $var: "order" } } },
        ],
      },
    ] as never);

    await concepts.Shop.place({ order: { name: "a" } });
    expect(tag.held).toHaveLength(1);
    expect(recorder.tags).toEqual(["placed a"]);
  });

  test("a join still matches a record whose input an action marked through earlier", async () => {
    const { reacting, concepts, tag, recorder } = marking();
    reacting.register({
      Ask: ({ order }: Vars) =>
        when(refs.Shop.place({ order }).responds()).then(refs.Nudge.nudge({ kind: "go" })),
      Mark: ({ order }: Vars) =>
        when(refs.Nudge.nudge({ kind: "go" }).responds())
          .where(earlier(refs.Shop.place, { order }))
          .then(refs.Tag.tag({ order })),
      Finish: (_: Vars) => when(refs.Tag.tag({}).responds()).then(refs.Done.done({})),
    });
    reacting.registerReactions([
      {
        name: "Join",
        when: [
          {
            kind: "action",
            concept: "Shop",
            action: "place",
            posture: "returned",
            input: { order: { name: "a" } },
            output: {},
          },
          {
            kind: "action",
            concept: "Done",
            action: "done",
            posture: "returned",
            input: {},
            output: {},
          },
        ],
        where: [],
        then: [
          { kind: "request", concept: "Recorder", action: "record", input: { tag: "joined" } },
        ],
      },
    ] as never);

    await concepts.Shop.place({ order: { name: "a" } });
    expect(tag.held).toHaveLength(1);
    expect(recorder.tags).toEqual(["joined"]);
  });
});
