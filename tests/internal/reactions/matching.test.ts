import { describe, expect, test } from "vite-plus/test";
import { matchArguments, unifyPattern } from "@sync-engine/internal/reactions/matching.ts";
import type { ActionRecord } from "@sync-engine/internal/reactions/actions.ts";
import type { ActionPattern, InstrumentedAction } from "@sync-engine/internal/reactions/types.ts";

describe("reaction matching", () => {
  test("binds a fresh variable and tests an existing binding", () => {
    const item = Symbol("item");
    expect(unifyPattern({ item: "a" }, { item }, {})).toEqual({ [item]: "a" });
    expect(unifyPattern({ item: "b" }, { item }, { [item]: "a" })).toBeUndefined();
  });

  test("matches equal literal arrays structurally", () => {
    const concept = {};
    const action = (async () => ({})) as InstrumentedAction;
    action.concept = concept;
    const record: ActionRecord = {
      id: "one",
      action,
      concept,
      input: { roles: ["reader", "writer"] },
      output: {},
      outcome: { kind: "result", value: {} },
      flow: "flow",
    };
    const pattern: ActionPattern = {
      action,
      concept,
      input: { roles: ["reader", "writer"] },
      output: {},
      flow: Symbol("flow"),
    };
    expect(matchArguments(record, pattern, {}, Symbol("record"))).toBeDefined();
  });
});
