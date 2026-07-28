import { describe, expect, test } from "vite-plus/test";
import { ActionConcept } from "@sync-engine/internal/reactions/runtime/actions.ts";
import { TriggerMatcher } from "@sync-engine/internal/reactions/runtime/trigger-matching.ts";
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
});
