import { describe, expect, test } from "vite-plus/test";
import {
  DESCEND,
  mapValueTree,
  mapValueTreeAsync,
  walkValueTree,
} from "@sync-engine/internal/reads/value-tree";

describe("value-tree walkers", () => {
  test("maps pre-order, replaces whole nodes, and rebuilds containers", () => {
    const source = { keep: [1, { replace: true }], date: new Date(0) };
    const seen: unknown[] = [];
    const mapped = mapValueTree(source, (node) => {
      seen.push(node);
      return typeof node === "object" && node !== null && "replace" in node ? "replaced" : DESCEND;
    }) as typeof source;

    expect(mapped).toEqual({ keep: [1, "replaced"], date: source.date });
    expect(mapped).not.toBe(source);
    expect(mapped.keep).not.toBe(source.keep);
    expect(seen).not.toContain(true);
  });

  test("awaits async array visits in mapping order", async () => {
    const events: string[] = [];
    await mapValueTreeAsync([1, 2], async (node) => {
      if (typeof node !== "number") return DESCEND;
      events.push(`start:${node}`);
      await new Promise((resolve) => setTimeout(resolve, node === 1 ? 5 : 0));
      events.push(`end:${node}`);
      return node * 10;
    });
    expect(events).toEqual(["start:1", "end:1", "start:2", "end:2"]);
  });

  test("preserves an own __proto__ field without mutating the result prototype", () => {
    const source = JSON.parse('{"__proto__":{"polluted":true}}') as object;
    const mapped = mapValueTree(source, () => DESCEND) as Record<string, unknown>;
    expect(Object.hasOwn(mapped, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(mapped)).toBe(Object.prototype);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  test("maps plain objects asynchronously in entry order", async () => {
    const source = { x: 1, y: 2 };
    const orders: string[] = [];
    const mapped = (await mapValueTreeAsync(source, async (node) => {
      if (typeof node !== "number") return DESCEND;
      orders.push(`visit:${node}`);
      return node * 10;
    })) as Record<string, number>;
    expect(mapped).toEqual({ x: 10, y: 20 });
    expect(orders).toEqual(["visit:1", "visit:2"]);
  });

  test("walk skips descendants when the visitor returns false", () => {
    const seen: unknown[] = [];
    const skipped = { hidden: 1 };
    walkValueTree({ skipped, shown: 2 }, (node) => {
      seen.push(node);
      if (node === skipped) return false;
    });
    expect(seen).toContain(skipped);
    expect(seen).toContain(2);
    expect(seen).not.toContain(1);
  });
});
