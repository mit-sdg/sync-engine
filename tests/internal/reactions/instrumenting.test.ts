import { describe, expect, test } from "vite-plus/test";
import { ActionConcept } from "@sync-engine/internal/reactions/runtime/actions.ts";
import {
  instrumentConcept,
  type InstrumentationState,
} from "@sync-engine/internal/reactions/runtime/instrumenting.ts";
import { actionId, flow } from "@sync-engine/internal/reactions/context.ts";
import { ActionScheduler } from "@sync-engine/internal/reactions/runtime/action-scheduler.ts";

describe("concept instrumentation", () => {
  test("memoizes action wrappers and records one returned occurrence", async () => {
    class Counter {
      value = 0;
      increment(_input: Record<string, never>) {
        this.value += 1;
        return { value: this.value };
      }
    }
    const actions = new ActionConcept();
    const state: InstrumentationState = {
      actions,
      boundActionsByConcept: new WeakMap(),
      queryCaches: new WeakMap(),
      scheduler: new ActionScheduler(),
      rawConceptsByInstrumented: new WeakMap(),
      concepts: new Set(),
      registerConcept: () => {},
      react: async () => {},
      settle: () => {},
      emit: () => {},
    };
    const counter = instrumentConcept(state, new Counter());
    expect(counter.increment).toBe(counter.increment);
    await counter.increment({});
    expect([...actions.actions.values()][0]?.outcome).toMatchObject({ kind: "result" });
  });

  test("invalid engine metadata names the action and the received value kind", async () => {
    class Counter {
      increment(_input: Record<string, never>) {
        return { value: 1 };
      }
    }
    const actions = new ActionConcept();
    const state: InstrumentationState = {
      actions,
      boundActionsByConcept: new WeakMap(),
      queryCaches: new WeakMap(),
      scheduler: new ActionScheduler(),
      rawConceptsByInstrumented: new WeakMap(),
      concepts: new Set(),
      registerConcept: () => {},
      react: async () => {},
      settle: () => {},
      emit: () => {},
    };
    const counter = instrumentConcept(state, new Counter(), "Counter");
    const increment = counter.increment as unknown as (
      input: Record<PropertyKey, unknown>,
    ) => Promise<unknown>;

    await expect(increment({ [flow]: 7 })).rejects.toThrow(
      'Action "Counter.increment": expected the flow token to be a string; received number.',
    );
    await expect(increment({ [actionId]: {} })).rejects.toThrow(
      'Action "Counter.increment": expected actionId to be a string; received object.',
    );
  });

  test("returned matching retains the input snapshot recorded with the ask", async () => {
    class OpaqueDate extends Date {
      override getTime(): number {
        throw new Error("opaque date must not be coerced");
      }
    }

    class Mutating {
      seen?: string;

      change(input: {
        nested: { value: string };
        when: Date;
        whenAlias: Date;
        opaque: Map<string, string>;
        opaqueDate: OpaqueDate;
      }) {
        this.seen = input.nested.value;
        input.nested.value = "changed-by-action";
        input.when.setUTCFullYear(2040);
        return {};
      }
    }
    const actions = new ActionConcept();
    const requested = Promise.withResolvers<void>();
    const matchedInputs: Record<string, unknown>[] = [];
    let reactions = 0;
    const state: InstrumentationState = {
      actions,
      boundActionsByConcept: new WeakMap(),
      queryCaches: new WeakMap(),
      scheduler: new ActionScheduler(),
      rawConceptsByInstrumented: new WeakMap(),
      concepts: new Set(),
      registerConcept: () => {},
      react: async (record) => {
        matchedInputs.push(actions._matchingRecord(record).input);
        if (reactions++ === 0) await requested.promise;
      },
      settle: () => {},
      emit: () => {},
    };
    const raw = new Mutating();
    const concept = instrumentConcept(state, raw);
    const opaque = new Map([["key", "original"]]);
    const when = new Date("2025-01-01T00:00:00.000Z");
    const opaqueDate = new OpaqueDate("2026-01-01T00:00:00.000Z");
    const input = {
      nested: { value: "original" },
      when,
      whenAlias: when,
      opaque,
      opaqueDate,
    };

    const result = concept.change(input);
    input.nested.value = "changed-by-caller";
    requested.resolve();
    await result;

    expect(raw.seen).toBe("changed-by-caller");
    expect(matchedInputs).toHaveLength(2);
    expect(matchedInputs[0]).toBe(matchedInputs[1]);
    expect(matchedInputs[1]).toMatchObject({ nested: { value: "original" } });
    expect((matchedInputs[1]!.when as Date).toISOString()).toBe("2025-01-01T00:00:00.000Z");
    expect(matchedInputs[1]!.when).toBe(matchedInputs[1]!.whenAlias);
    expect(matchedInputs[1]!.when).not.toBe(when);
    expect(matchedInputs[1]?.opaque).toBe(opaque);
    expect(matchedInputs[1]?.opaqueDate).toBe(opaqueDate);
    expect([...actions.actions.values()][0]?.input).toEqual({
      nested: { value: "original" },
      opaque: {},
      opaqueDate: "[unreadable]",
      when: "2025-01-01T00:00:00.000Z",
      whenAlias: "[circular]",
    });
  });
});
