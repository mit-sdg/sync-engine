import { describe, expect, test } from "vite-plus/test";
import {
  literalEquals,
  matchArguments,
  unifyPattern,
} from "@sync-engine/internal/reactions/matching.ts";
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

  test("shares read equality for dates and does not guess at collection equality", () => {
    expect(literalEquals(new Date("2024-01-01"), new Date("2024-01-01"))).toBe(true);
    expect(literalEquals(new Map(), new Map())).toBe(false);
    expect(literalEquals(new Set(), new Set())).toBe(false);
  });
});
