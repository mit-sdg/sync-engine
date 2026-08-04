import { describe, expect, test } from "vite-plus/test";
import { memoizeQuery } from "@engine/utils/memoize";

function deeplyNested(wrap: (value: unknown, depth: number) => unknown): unknown {
  let value: unknown = "leaf";
  for (let depth = 0; depth < 20_000; depth += 1) value = wrap(value, depth);
  return value;
}

describe("query cache", () => {
  test("keys equivalent plain mappings independently of property order", () => {
    const query = memoizeQuery((input: unknown) => ({ input }));
    expect(query({ left: 1, right: 2 })).toBe(query({ right: 2, left: 1 }));
    expect(query({ left: { value: 1 }, right: { value: 2 } })).toBe(
      query({ right: { value: 2 }, left: { value: 1 } }),
    );
  });

  test("keys cyclic values without recursing forever", () => {
    const left: Record<string, unknown> = { name: "cycle" };
    const right: Record<string, unknown> = { name: "cycle" };
    left.self = left;
    right.self = right;

    const query = memoizeQuery((input: unknown) => ({ input }));
    expect(query(left)).toBe(query(right));
  });

  test("does not make repeated references significant in structural values", () => {
    const shared = { value: 1 };

    const query = memoizeQuery((input: unknown) => ({ input }));
    expect(query([shared, shared])).toBe(query([{ value: 1 }, { value: 1 }]));
  });

  test("does not conflate sparse arrays with arrays of another length", () => {
    const query = memoizeQuery((input: unknown) => ({ input }));
    expect(query([])).not.toBe(query(Array(1)));
    expect(query(Array(1))).toBe(query([undefined]));
  });

  test("bypasses caching for over-limit keys and still caches normal keys", () => {
    let calls = 0;
    const query = memoizeQuery((input: unknown) => ({ call: ++calls, input }));
    const deep = deeplyNested((value) => ({ value }));

    expect(query(deep)).not.toBe(query(deep));
    const normal = query({ value: [1, 2, 3] });
    expect(query({ value: [1, 2, 3] })).toBe(normal);
    expect(calls).toBe(3);
  });

  test("memoizes structural records, arrays, and Date timestamps", () => {
    let calls = 0;
    const query = memoizeQuery((input: unknown) => ({ call: ++calls, input }));

    const record = query({ nested: [1, { right: 2 }] });
    expect(query({ nested: [1, { right: 2 }] })).toBe(record);

    const date = query(new Date(123));
    expect(query(new Date(123))).toBe(date);
    expect(query(new Date(124))).not.toBe(date);
  });

  test.each([
    ["maps", () => new Map([["value", 1]])],
    ["sets", () => new Set([1])],
    ["regular expressions", () => /value/gi],
    [
      "class instances",
      () =>
        new (class Value {
          value = 1;
        })(),
    ],
    ["objects with custom prototypes", () => Object.create({ value: 1 })],
  ])("keeps distinct identity-based %s separate", (_name, makeValue) => {
    let calls = 0;
    const query = memoizeQuery((input: unknown) => ({ call: ++calls, input }));
    const value = makeValue();
    const first = query(value);

    expect(query(value)).toBe(first);
    expect(query(makeValue())).not.toBe(first);
    expect(calls).toBe(2);
  });

  test("memoizes equal inputs, keeps symbol values separate, and invalidates", () => {
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
    const query = memoizeQuery((input: bigint) => ({ input }));
    expect(query(42n)).toBe(query(42n));
    expect(query(43n)).not.toBe(query(42n));
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

  test("evicts a rejected PromiseLike without requiring catch", async () => {
    let calls = 0;
    const query = memoizeQuery(() => {
      calls += 1;
      const failure = Promise.reject(new Error("boom"));
      return { then: failure.then.bind(failure) } as PromiseLike<never>;
    });

    await expect(Promise.resolve(query())).rejects.toThrow("boom");
    await expect(Promise.resolve(query())).rejects.toThrow("boom");
    expect(calls).toBe(2);
  });

  test("normalizes a memoized lazy PromiseLike only once", async () => {
    let calls = 0;
    let thens = 0;
    const query = memoizeQuery(() => {
      calls += 1;
      return {
        then(resolve: (value: string) => void) {
          thens += 1;
          resolve("value");
        },
      } as PromiseLike<string>;
    });

    const first = query();
    expect(await first).toBe("value");
    expect(query()).toBe(first);
    expect(calls).toBe(1);
    expect(thens).toBe(1);
  });

  test("keeps function identities separate", () => {
    let calls = 0;
    const query = memoizeQuery((input: () => number) => ({ call: ++calls, input }));
    const fn = () => 1;
    const first = query(fn);

    expect(query(fn)).toBe(first);
    expect(query(() => 1)).not.toBe(first);
  });

  test("includes symbol-keyed plain-record fields", () => {
    const key = Symbol("key");
    let calls = 0;
    const query = memoizeQuery((input: Record<PropertyKey, unknown>) => ({ call: ++calls, input }));
    const first = query({ [key]: 1 });

    expect(query({ [key]: 1 })).toBe(first);
    expect(query({ [Symbol("key")]: 1 })).not.toBe(first);
  });
});
