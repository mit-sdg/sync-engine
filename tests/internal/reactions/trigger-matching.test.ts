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
});
