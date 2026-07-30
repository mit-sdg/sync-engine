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

  test("does not release an interleaved flow during same-flow reentrancy", async () => {
    const scheduler = new ActionScheduler();
    const concept = {};
    const order: string[] = [];
    const root = reserve(scheduler, concept, "first-flow", () => {
      order.push("root");
      return "root";
    });
    const other = reserve(scheduler, concept, "other-flow", () => {
      order.push("other");
      return "other";
    });
    const consequence = reserve(scheduler, concept, "first-flow", () => {
      order.push("consequence");
      return "consequence";
    });

    consequence.release();
    await root.result;
    expect(order).toEqual(["root"]);

    other.release();
    await expect(Promise.all([other.result, consequence.result])).resolves.toEqual([
      "other",
      "consequence",
    ]);
    expect(order).toEqual(["root", "other", "consequence"]);
  });

  test("breaks a cross-flow wait cycle without dropping an action", async () => {
    const scheduler = new ActionScheduler();
    const conceptA = {};
    const conceptB = {};
    const order: string[] = [];
    const aRoot = reserve(scheduler, conceptA, "a", () => {
      order.push("a.root");
      return "a.root";
    });
    const bRoot = reserve(scheduler, conceptB, "b", () => {
      order.push("b.root");
      return "b.root";
    });
    const bStep = reserve(scheduler, conceptB, "a", () => {
      order.push("b.step");
      return "b.step";
    });
    bStep.release();
    const aStep = reserve(scheduler, conceptA, "b", () => {
      order.push("a.step");
      return "a.step";
    });
    aStep.release();

    await bStep.result;
    aRoot.release();

    await expect(Promise.all([aRoot.result, bRoot.result, aStep.result])).resolves.toEqual([
      "a.root",
      "b.root",
      "a.step",
    ]);
    expect(order).toEqual(["b.root", "b.step", "a.root", "a.step"]);
  });

  test("releases a nested same-flow parent behind an interleaved flow", async () => {
    const scheduler = new ActionScheduler();
    const concept = {};
    const order: string[] = [];
    const root = reserve(scheduler, concept, "a", () => order.push("root"));
    const other = reserve(scheduler, concept, "b", () => order.push("other"));
    const parent = reserve(scheduler, concept, "a", () => order.push("parent"));
    const child = reserve(scheduler, concept, "a", () => order.push("child"));

    child.release();
    other.release();

    await expect(
      Promise.all([root.result, other.result, parent.result, child.result]),
    ).resolves.toEqual([1, 2, 3, 4]);
    expect(order).toEqual(["root", "other", "parent", "child"]);
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
