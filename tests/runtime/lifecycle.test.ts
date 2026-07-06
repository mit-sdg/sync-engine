import { describe, expect, test } from "vite-plus/test";
import { Lifecycle, type Stoppable } from "@sync-engine/runtime/lifecycle.ts";

describe("Lifecycle", () => {
  test("stops resources in reverse registration order", async () => {
    const order: number[] = [];
    const lifecycle = new Lifecycle();
    for (const n of [1, 2, 3]) {
      lifecycle.add({ stop: () => void order.push(n) });
    }

    await lifecycle.stopAll();

    expect(order).toEqual([3, 2, 1]);
  });

  test("awaits async stops", async () => {
    const order: string[] = [];
    const lifecycle = new Lifecycle();
    lifecycle.add({
      stop: async () => {
        await new Promise((r) => setTimeout(r, 5));
        order.push("slow");
      },
    });
    lifecycle.add({ stop: () => void order.push("fast") });

    await lifecycle.stopAll();

    // "fast" added last → stopped first; "slow" awaited before stopAll resolves.
    expect(order).toEqual(["fast", "slow"]);
  });

  test("stops all even when one throws, then rethrows the failure", async () => {
    const stopped: string[] = [];
    const lifecycle = new Lifecycle();
    lifecycle.add({ stop: () => void stopped.push("a") });
    lifecycle.add({
      stop: () => {
        throw new Error("boom");
      },
    });
    lifecycle.add({ stop: () => void stopped.push("c") });

    await expect(lifecycle.stopAll()).rejects.toThrow("boom");
    // Both non-throwing resources still ran.
    expect(stopped).toEqual(["c", "a"]);
  });

  test("addTimer clears the interval on stop", async () => {
    let ticks = 0;
    const lifecycle = new Lifecycle();
    const timer = setInterval(() => {
      ticks += 1;
    }, 1);
    lifecycle.addTimer(timer);

    await lifecycle.stopAll();
    const after = ticks;
    await new Promise((r) => setTimeout(r, 20));

    expect(ticks).toBe(after);
  });

  test("stopAll is idempotent — second call stops nothing", async () => {
    let count = 0;
    const lifecycle = new Lifecycle();
    const stoppable: Stoppable = {
      stop: () => {
        count += 1;
      },
    };
    lifecycle.add(stoppable);

    await lifecycle.stopAll();
    await lifecycle.stopAll();

    expect(count).toBe(1);
  });
});
