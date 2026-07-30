import { describe, expect, test } from "vite-plus/test";
import {
  literalEquals,
  matchArguments,
  matchChannel,
  unifyPattern,
} from "@sync-engine/internal/reactions/runtime/matching.ts";
import type { ActionRecord } from "@sync-engine/internal/reactions/runtime/actions.ts";
import type {
  ActionPattern,
  ChannelPattern,
  InstrumentedAction,
} from "@sync-engine/internal/reactions/types.ts";
import { oneOf } from "@sync-engine/internal/reads/matchers";
import { withLive } from "@sync-engine/internal/reads/ir.ts";

describe("reaction matching", () => {
  test("binds a fresh variable and tests an existing binding", () => {
    const item = Symbol("item");
    expect(unifyPattern({ item: "a" }, { item }, {})).toEqual({ [item]: "a" });
    expect(unifyPattern({ item: "b" }, { item }, { [item]: "a" })).toBeUndefined();
  });

  test("tests repeated plain values structurally while preserving opaque identity", () => {
    const value = Symbol("value");
    expect(
      unifyPattern({ value: { nested: ["same"] } }, { value }, { [value]: { nested: ["same"] } }),
    ).toBeDefined();
    expect(unifyPattern({ value: new Map() }, { value }, { [value]: new Map() })).toBeUndefined();
  });

  test("does not match inherited record fields or inherited frame bindings", () => {
    for (const name of ["constructor", "toString", "__proto__"]) {
      const variable = Symbol(name);
      expect(unifyPattern({}, { [name]: variable }, {})).toBeUndefined();

      const frame = unifyPattern({ value: name }, { value: { $var: name } }, {});
      expect(frame).toBeDefined();
      expect(Object.hasOwn(frame ?? {}, name)).toBe(true);
      expect(frame?.[name]).toBe(name);
    }
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

  test("matchArguments accepts a record with fault when posture is faulted", () => {
    const concept = {};
    const action = (async () => ({})) as InstrumentedAction;
    action.concept = concept;
    const record: ActionRecord = {
      id: "one",
      action,
      concept,
      input: { key: "value" },
      fault: { message: "boom" },
      flow: "flow",
    };
    const pattern: ActionPattern = {
      action,
      concept,
      input: { key: "value" },
      output: { message: "boom" },
      flow: Symbol("flow"),
      posture: "faulted",
    };
    expect(matchArguments(record, pattern, {}, Symbol("record"))).toBeDefined();
  });

  test("matchArguments rejects a record without fault when posture is faulted", () => {
    const concept = {};
    const action = (async () => ({})) as InstrumentedAction;
    action.concept = concept;
    const record: ActionRecord = {
      id: "one",
      action,
      concept,
      input: { key: "value" },
      output: {},
      outcome: { kind: "result", value: {} },
      flow: "flow",
    };
    const pattern: ActionPattern = {
      action,
      concept,
      input: { key: "value" },
      output: {},
      flow: Symbol("flow"),
      posture: "faulted",
    };
    expect(matchArguments(record, pattern, {}, Symbol("record"))).toBeUndefined();
  });

  test("matchChannel with returned channel rejects a record whose outcome is a refusal", () => {
    const concept = {};
    const record: ActionRecord = {
      id: "one",
      action: (async () => ({})) as InstrumentedAction,
      concept,
      input: {},
      flow: "flow",
      outcome: { kind: "error", error: {} },
    };
    const clause: ChannelPattern = {
      channel: "returned",
      pattern: {},
      except: [],
    };
    expect(matchChannel(record, clause, {}, Symbol("record"), new WeakMap())).toBeUndefined();
  });

  test("matchArguments throws when the pattern is missing output", () => {
    const concept = {};
    const action = (async () => ({})) as InstrumentedAction;
    action.concept = concept;
    const record: ActionRecord = {
      id: "one",
      action,
      concept,
      input: {},
      flow: "flow",
      outcome: { kind: "result", value: {} },
    };
    const pattern: ActionPattern = {
      action,
      concept,
      input: {},
      flow: Symbol("flow"),
    };
    expect(() => matchArguments(record, pattern, {}, Symbol("record"))).toThrow(
      "is missing output pattern",
    );
  });

  test("unifyPattern matches a value against oneOf candidates", () => {
    const matcher = oneOf("a", "b");
    expect(unifyPattern({ role: "a" }, { role: matcher }, {})).toBeDefined();
    expect(unifyPattern({ role: "c" }, { role: matcher }, {})).toBeUndefined();
  });

  test("oneOf candidates use structural equality", () => {
    expect(unifyPattern({ role: { kind: "a" } }, { role: oneOf({ kind: "a" }) }, {})).toBeDefined();
    expect(
      unifyPattern({ role: { kind: "a" } }, { role: { $oneOf: [{ kind: "a" }] } }, {}),
    ).toBeDefined();
  });

  test("unifyPattern matches a record value against a $is marker's live value", () => {
    const live = { id: 42 };
    const marked = withLive({ $is: "theAnswer" }, live);

    expect(unifyPattern({ role: { id: 42 } }, { role: marked }, {})).toBeDefined();
    expect(unifyPattern({ role: { id: 99 } }, { role: marked }, {})).toBeUndefined();
  });

  test("unifyPattern matches a record value against a $lit payload", () => {
    expect(unifyPattern({ role: "hello" }, { role: { $lit: "hello" } }, {})).toBeDefined();
    expect(unifyPattern({ role: "hello" }, { role: { $lit: "goodbye" } }, {})).toBeUndefined();
  });

  test("unifyPattern falls back to literalEquals for an unknown marker tag", () => {
    const value = { $former: { name: "test", in: {} } };
    expect(unifyPattern({ role: value }, { role: value }, {})).toBeDefined();
    expect(unifyPattern({ role: "other" }, { role: value }, {})).toBeUndefined();
  });
});
