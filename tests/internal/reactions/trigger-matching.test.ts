import { describe, expect, test } from "vite-plus/test";
import { ActionConcept } from "@sync-engine/internal/reactions/runtime/actions.ts";
import { TriggerMatcher } from "@sync-engine/internal/reactions/runtime/matching.ts";
import type {
  ExecutableReaction,
  InstrumentedAction,
} from "@sync-engine/internal/reactions/types.ts";

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

  test("decides on the input the full match reads, not on later marks of the stored one", () => {
    const actions = new ActionConcept();
    const concept = {};
    const action = (async () => ({})) as InstrumentedAction;
    action.concept = concept;
    const input = actions._beginMatchingInput({
      id: "ask",
      flow: "flow",
      input: { order: { name: "a" } },
    });
    actions.invoke({ id: "ask", action, concept, input, flow: "flow" });
    actions.invoked({ id: "ask", output: {}, outcome: { kind: "result", value: {} } });
    Object.defineProperty(input.order as object, "seen", { value: true, enumerable: false });
    const reaction: ExecutableReaction = {
      name: "Observe",
      when: [
        { concept, action, input: { order: { name: "a" } }, output: {}, flow: Symbol("flow") },
      ],
      then: [],
    };
    const matcher = new TriggerMatcher(
      actions,
      { hasConsumed: () => false },
      (candidate) => candidate,
    );

    expect(matcher.match(actions._getById("ask")!, reaction)[0]).toHaveLength(1);
  });

  test("decides a join on the copied input, not on later marks of the stored one", () => {
    const actions = new ActionConcept();
    const concept = {};
    const action = (async () => ({})) as InstrumentedAction;
    action.concept = concept;
    const inputs: Record<string, Record<string, unknown>> = {};
    for (const item of ["one", "two"]) {
      const input = actions._beginMatchingInput({
        id: item,
        flow: "flow",
        input: { order: { name: item } },
      });
      inputs[item] = input;
      actions.invoke({ id: item, action, concept, input, flow: "flow" });
      actions.invoked({ id: item, output: {}, outcome: { kind: "result", value: {} } });
    }
    Object.defineProperty(inputs.one.order as object, "seen", { value: true, enumerable: false });
    const flow = Symbol("flow");
    const reaction: ExecutableReaction = {
      name: "Join",
      when: [
        { concept, action, input: { order: { name: "one" } }, output: {}, flow },
        { concept, action, input: { order: { name: "two" } }, output: {}, flow },
      ],
      then: [],
    };
    const matcher = new TriggerMatcher(
      actions,
      { hasConsumed: () => false },
      (candidate) => candidate,
    );

    expect(matcher.match(actions._getById("two")!, reaction)[0]).toHaveLength(1);
  });

  test("reads a stored input once per match, the test and the match sharing one copy", () => {
    const actions = new ActionConcept();
    const concept = {};
    const action = (async () => ({})) as InstrumentedAction;
    action.concept = concept;
    const input = actions._beginMatchingInput({
      id: "ask",
      flow: "flow",
      input: { order: { name: "a" } },
    });
    actions.invoke({ id: "ask", action, concept, input, flow: "flow" });
    actions.invoked({ id: "ask", output: {}, outcome: { kind: "result", value: {} } });
    let reads = 0;
    Object.defineProperty(input.order as object, "name", {
      get: () => {
        reads += 1;
        return "a";
      },
      enumerable: true,
    });
    const reaction: ExecutableReaction = {
      name: "Observe",
      when: [
        { concept, action, input: { order: { name: "a" } }, output: {}, flow: Symbol("flow") },
      ],
      then: [],
    };
    const matcher = new TriggerMatcher(
      actions,
      { hasConsumed: () => false },
      (candidate) => candidate,
    );

    expect(matcher.match(actions._getById("ask")!, reaction)[0]).toHaveLength(1);
    expect(reads).toBe(1);
  });
});
