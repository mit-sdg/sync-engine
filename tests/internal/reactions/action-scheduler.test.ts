import { describe, expect, test } from "vite-plus/test";
import { ActionScheduler } from "@sync-engine/internal/reactions/runtime/action-scheduler.ts";

function reserve<Result>(
  scheduler: ActionScheduler,
  concept: object,
  flow: string,
  body: () => Result,
) {
  return scheduler.reserve({ concept, flow, body, input: undefined });
}

describe("action scheduler", () => {
  test("keeps arrival order when later requested reactions finish first", async () => {
    const scheduler = new ActionScheduler();
    const concept = {};
    const order: string[] = [];
    const first = reserve(scheduler, concept, "first", () => {
      order.push("first");
      return "first";
    });
    const second = reserve(scheduler, concept, "second", () => {
      order.push("second");
      return "second";
    });

    second.release();
    expect(order).toEqual([]);
    first.release();

    await expect(Promise.all([first.result, second.result])).resolves.toEqual(["first", "second"]);
    expect(order).toEqual(["first", "second"]);
  });

  test("releases same-flow predecessors for reentrant consequences", async () => {
    const scheduler = new ActionScheduler();
    const concept = {};
    const order: string[] = [];
    const root = reserve(scheduler, concept, "flow", () => {
      order.push("root");
      return "root";
    });

    const consequence = reserve(scheduler, concept, "flow", () => {
      order.push("consequence");
      return "consequence";
    });
    expect(order).toEqual(["root"]);
    consequence.release();

    await expect(Promise.all([root.result, consequence.result])).resolves.toEqual([
      "root",
      "consequence",
    ]);
    expect(order).toEqual(["root", "consequence"]);
  });

  test("continues after successful and rejected predecessors", async () => {
    const scheduler = new ActionScheduler();
    const concept = {};
    const failure = new Error("failed");
    const order: string[] = [];
    const first = reserve(scheduler, concept, "one", () => {
      order.push("one");
      return 1;
    });
    const second = reserve(scheduler, concept, "two", () => {
      order.push("two");
      throw failure;
    });
    const third = reserve(scheduler, concept, "three", () => {
      order.push("three");
      return 3;
    });

    first.release();
    second.release();
    third.release();

    await expect(first.result).resolves.toBe(1);
    await expect(second.result).rejects.toBe(failure);
    await expect(third.result).resolves.toBe(3);
    expect(order).toEqual(["one", "two", "three"]);
  });

  test("releases each reservation exactly once", async () => {
    const scheduler = new ActionScheduler();
    let calls = 0;
    const reservation = reserve(scheduler, {}, "flow", () => ++calls);

    expect(reservation.release()).toBe(true);
    expect(reservation.release()).toBe(false);
    await expect(reservation.result).resolves.toBe(1);
    expect(calls).toBe(1);
  });

  test("starts a body once across release and predecessor settlement", async () => {
    const scheduler = new ActionScheduler();
    const concept = {};
    const gate = Promise.withResolvers<void>();
    let starts = 0;
    const predecessor = reserve(scheduler, concept, "predecessor", () => gate.promise);
    const reservation = reserve(scheduler, concept, "next", () => ++starts);

    predecessor.release();
    reservation.release();
    expect(starts).toBe(0);
    gate.resolve();

    await predecessor.result;
    await expect(reservation.result).resolves.toBe(1);
    reservation.release();
    expect(starts).toBe(1);
  });

  test("cleans up the final concept line after rejection", async () => {
    const scheduler = new ActionScheduler();
    const concept = {};
    const failure = new Error("failed");
    const reservation = reserve(scheduler, concept, "flow", () => Promise.reject(failure));

    expect(scheduler.isIdle(concept)).toBe(false);
    reservation.release();
    await expect(reservation.result).rejects.toBe(failure);
    await Promise.resolve();
    expect(scheduler.isIdle(concept)).toBe(true);
  });
});
