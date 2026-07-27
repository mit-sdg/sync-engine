import { describe, expect, test } from "vite-plus/test";
import { memoizeQuery, queryCacheKey } from "@sync-engine/internal/reactions/query-cache.ts";

describe("query cache", () => {
  test("keys equivalent plain mappings independently of property order", () => {
    expect(queryCacheKey([{ left: 1, right: 2 }])).toBe(queryCacheKey([{ right: 2, left: 1 }]));
  });

  test("keys cyclic values without recursing forever", () => {
    const value: Record<string, unknown> = { name: "cycle" };
    value.self = value;

    expect(() => queryCacheKey([value])).not.toThrow();
  });

  test("does not conflate collection values", () => {
    expect(queryCacheKey([new Map([["left", 1]])])).not.toBe(
      queryCacheKey([new Map([["right", 1]])]),
    );
    expect(queryCacheKey([new Set(["left"])])).not.toBe(queryCacheKey([new Set(["right"])]));
  });

  test("memoizes equal inputs, keeps identity values separate, and invalidates", () => {
    let calls = 0;
    const query = memoizeQuery((input: { value: number; token?: symbol }) => {
      calls += 1;
      return { call: calls, value: input.value };
    });
    const first = query({ value: 1 });
    expect(query({ value: 1 })).toBe(first);

    const left = query({ value: 1, token: Symbol("token") });
    const right = query({ value: 1, token: Symbol("token") });
    expect(right).not.toBe(left);

    query.invalidate();
    expect(query({ value: 1 })).not.toBe(first);
  });

  test("keys bigint values", () => {
    expect(queryCacheKey([42n])).toBe("bigint:42");
  });

  test("evicts cache entry when a memoized async function rejects", async () => {
    let calls = 0;
    let rejectNext = false;
    const query = memoizeQuery(async (input: { value: number }) => {
      calls += 1;
      if (rejectNext) {
        rejectNext = false;
        throw new Error("boom");
      }
      return { call: calls, value: input.value };
    });

    const first = await query({ value: 1 });
    expect(calls).toBe(1);

    // cached
    expect(await query({ value: 1 })).toBe(first);
    expect(calls).toBe(1);

    // reject — cache entry evicted
    rejectNext = true;
    await expect(query({ value: 2 })).rejects.toThrow("boom");
    expect(calls).toBe(2);

    // re-executes because the rejected entry was evicted
    const second = await query({ value: 2 });
    expect(calls).toBe(3);
    expect(second).not.toBe(first);
  });
});
