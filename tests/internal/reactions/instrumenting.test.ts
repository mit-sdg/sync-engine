import { describe, expect, test } from "vite-plus/test";
import { ActionConcept } from "@sync-engine/internal/reactions/actions.ts";
import {
  instrumentConcept,
  type InstrumentationState,
} from "@sync-engine/internal/reactions/instrumenting.ts";
import { actionId, flow } from "@sync-engine/internal/reactions/matching.ts";

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
      actionLines: new WeakMap(),
      rawConceptsByInstrumented: new WeakMap(),
      concepts: new Set(),
      conceptsByName: new Map(),
      react: async () => {},
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
      actionLines: new WeakMap(),
      rawConceptsByInstrumented: new WeakMap(),
      concepts: new Set(),
      conceptsByName: new Map(),
      react: async () => {},
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
});
