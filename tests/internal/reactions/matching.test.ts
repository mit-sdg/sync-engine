import { describe, expect, test } from "vite-plus/test";
import {
  matchArguments,
  matchChannel,
  unifyPattern,
} from "@sync-engine/internal/reactions/runtime/matching.ts";
import type { ActionRecord } from "@sync-engine/internal/reactions/runtime/actions.ts";
import type {
  ActionTriggerPattern,
  ChannelPattern,
  InstrumentedAction,
} from "@sync-engine/internal/reactions/types.ts";
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
    const pattern: ActionTriggerPattern = {
      action,
      concept,
      input: { roles: ["reader", "writer"] },
      output: {},
      flow: Symbol("flow"),
    };
    expect(matchArguments(record, pattern, {}, Symbol("record"))).toBeDefined();
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
    const pattern: ActionTriggerPattern = {
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
    const pattern: ActionTriggerPattern = {
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

  test("serialized $oneOf candidates use structural equality", () => {
    expect(
      unifyPattern({ role: { kind: "a" } }, { role: { $oneOf: [{ kind: "a" }] } }, {}),
    ).toBeDefined();
    expect(
      unifyPattern({ role: { kind: "b" } }, { role: { $oneOf: [{ kind: "a" }] } }, {}),
    ).toBeUndefined();
  });

  test("unifyPattern matches a record value against a $is marker's live value", () => {
    const live = { id: 42 };
    const marked = withLive({ $is: "theAnswer" }, live);

    expect(unifyPattern({ role: { id: 42 } }, { role: marked }, {})).toBeDefined();
    expect(unifyPattern({ role: { id: 99 } }, { role: marked }, {})).toBeUndefined();
  });

  test("unifyPattern matches a record value against a $lit payload", () => {
    expect(
      unifyPattern({ role: { $var: "hello" } }, { role: { $lit: { $var: "hello" } } }, {}),
    ).toBeDefined();
    expect(
      unifyPattern({ role: { $var: "hello" } }, { role: { $lit: { $var: "goodbye" } } }, {}),
    ).toBeUndefined();
  });

  test("unifyPattern treats an unknown marker tag as literal data", () => {
    const value = { $former: { name: "test", in: {} } };
    expect(unifyPattern({ role: value }, { role: value }, {})).toBeDefined();
    expect(unifyPattern({ role: "other" }, { role: value }, {})).toBeUndefined();
  });
});
