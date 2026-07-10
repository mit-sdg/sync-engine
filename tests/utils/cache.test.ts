import { describe, expect, test } from "vite-plus/test";
import { cached, DEFAULT_CACHE_MAX_SIZE, DEFAULT_CACHE_TTL_MS } from "@sync-engine/utils";

describe("cached", () => {
  test("memoizes results for identical arguments", () => {
    let calls = 0;
    const fn = cached((a: number, b: number) => {
      calls++;
      return a + b;
    });
    expect(fn(1, 2)).toBe(3);
    expect(fn(1, 2)).toBe(3);
    expect(calls).toBe(1);
    expect(fn(2, 2)).toBe(4);
    expect(calls).toBe(2);
  });

  test("caches resolved promise values", async () => {
    let calls = 0;
    const fn = cached(async (x: number) => {
      calls++;
      return x * 2;
    });
    const a = await fn(5);
    const b = await fn(5);
    expect(a).toBe(10);
    expect(b).toBe(10);
    expect(calls).toBe(1);
  });

  test("does not cache rejected promises", async () => {
    let calls = 0;
    const fn = cached(async (fail: boolean) => {
      calls++;
      if (fail) throw new Error("boom");
      return "ok";
    });
    await expect(fn(true)).rejects.toThrow("boom");
    await expect(fn(true)).rejects.toThrow("boom");
    expect(calls).toBe(2);
  });

  test("exposes a size getter", () => {
    const fn = cached((x: number) => x);
    expect(fn.size).toBe(0);
    fn(1);
    fn(2);
    expect(fn.size).toBe(2);
    fn(1);
    expect(fn.size).toBe(2);
  });

  test("invalidate() empties the cache", () => {
    let calls = 0;
    const fn = cached((x: number) => {
      calls++;
      return x;
    });
    fn(1);
    fn(2);
    expect(fn.size).toBe(2);
    fn.invalidate();
    expect(fn.size).toBe(0);
    fn(1);
    expect(calls).toBe(3);
  });

  test("evicts the oldest entry when maxSize is exceeded", () => {
    const fn = cached((x: number) => x, { maxSize: 2 });
    fn(1);
    fn(2);
    expect(fn.size).toBe(2);
    fn(3);
    expect(fn.size).toBe(2);
  });

  test("recently-read entries survive eviction (LRU)", () => {
    let calls = 0;
    const fn = cached(
      (x: number) => {
        calls++;
        return x;
      },
      { maxSize: 2 },
    );
    fn(1);
    fn(2);
    // Touch key 1 so it becomes most-recently-used.
    fn(1);
    // Insert key 3 — should evict key 2 (the least-recently-used).
    fn(3);
    const before = calls;
    fn(1); // still cached → no recompute
    expect(calls).toBe(before);
    fn(2); // evicted → recompute
    expect(calls).toBe(before + 1);
  });

  test("invalidates entries after TTL expires", async () => {
    let calls = 0;
    const fn = cached(
      (x: number) => {
        calls++;
        return x;
      },
      { ttlMs: 20 },
    );
    fn(1);
    expect(calls).toBe(1);
    fn(1);
    expect(calls).toBe(1);
    await new Promise((r) => setTimeout(r, 40));
    fn(1);
    expect(calls).toBe(2);
  });

  test("uses defaults when no options are passed", () => {
    expect(DEFAULT_CACHE_MAX_SIZE).toBe(1000);
    expect(DEFAULT_CACHE_TTL_MS).toBe(300000);
    const fn = cached((x: number) => x);
    for (let i = 0; i < DEFAULT_CACHE_MAX_SIZE + 10; i++) {
      fn(i);
    }
    expect(fn.size).toBe(DEFAULT_CACHE_MAX_SIZE);
  });

  test("should distinguish Map arguments from Set arguments in the cache key", () => {
    let calls = 0;
    const fn = cached(
      (obj: unknown) => {
        calls++;
        return obj;
      },
      { maxSize: 10 },
    );

    fn(new Map([["a", 1]]));
    fn(new Set([1, 2, 3]));

    expect(calls).toBe(2);
  });

  test("should distinguish the value undefined from the string 'undefined' in the cache key", () => {
    let calls = 0;
    const fn = cached((x: unknown) => {
      calls++;
      return x;
    });

    fn("undefined");
    fn(undefined);

    expect(calls).toBe(2);
  });

  test("uses function identity rather than identical source text", () => {
    let calls = 0;
    const fn = cached((value: unknown) => {
      calls++;
      return value;
    });
    const first = () => "same";
    const second = () => "same";

    fn(first);
    fn(second);
    fn(first);

    expect(calls).toBe(2);
  });

  test("uses symbol identity rather than identical descriptions", () => {
    let calls = 0;
    const fn = cached((value: unknown) => {
      calls++;
      return value;
    });
    const first = Symbol("same");
    const second = Symbol("same");

    fn(first);
    fn(second);
    fn(first);

    expect(calls).toBe(2);
  });
});

describe("cached async TTL", () => {
  test("TTL expiration for async functions", async () => {
    let calls = 0;
    const fn = cached(
      async (x: number) => {
        calls++;
        return x * 2;
      },
      { ttlMs: 50 },
    );

    const result1 = await fn(1);
    expect(result1).toBe(2);
    expect(calls).toBe(1);

    await new Promise((r) => setTimeout(r, 60));

    const result2 = await fn(1);
    expect(result2).toBe(2);
    expect(calls).toBe(2);
  });

  test("two concurrent callers share in-flight promise", async () => {
    let calls = 0;
    let resolvePromise!: (v: string) => void;
    const slowFn = cached(() => {
      calls++;
      return new Promise<string>((resolve) => {
        resolvePromise = resolve;
      });
    });

    const p1 = slowFn();
    const p2 = slowFn();

    expect(calls).toBe(1);

    resolvePromise("done");

    const r1 = await p1;
    const r2 = await p2;
    expect(r1).toBe("done");
    expect(r2).toBe("done");
    expect(calls).toBe(1);
  });
});

describe("serialize cache key edge cases", () => {
  test("handles circular argument without stack overflow", () => {
    let calls = 0;
    const fn = cached((_obj: any) => {
      calls++;
      return "ok";
    });

    const circular: any = { name: "outer" };
    circular.inner = circular;

    expect(() => fn(circular)).not.toThrow();
    expect(calls).toBe(1);

    fn(circular);
    expect(calls).toBe(1);
  });

  test("handles BigInt argument", () => {
    let calls = 0;
    const fn = cached((x: unknown) => {
      calls++;
      return String(x);
    });

    fn(42n);
    fn(42n);
    expect(calls).toBe(1);

    fn(99n);
    expect(calls).toBe(2);
  });
});
