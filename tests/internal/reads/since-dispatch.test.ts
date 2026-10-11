/**
 * `queryCache: "since-dispatch"`: an outside invocation reuses only answers
 * whose query began at or after its dispatch, as when every cache is cleared
 * at dispatch, while invocations already running keep the answers they read.
 */
import { describe, expect, test } from "vite-plus/test";
import { vocabulary } from "@sync-engine/advanced";
import { endpoint, receive, respond } from "@sync-engine/boundary";
import type { Vars } from "@sync-engine/internal/reactions/types";
import type { QueryCacheMode } from "@sync-engine/internal/reactions/runtime/instrumenting";
import { assemble } from "@sync-engine/internal/boundary/assembly/assemble";
import { InvocationReads } from "@sync-engine/internal/reads/invocation-reads";
import { memoizeQuerySinceDispatch } from "@engine/utils/memoize";

/** A query that counts its executions and answers with them. */
function counted() {
  let runs = 0;
  const points = { now: 1 };
  const query = memoizeQuerySinceDispatch((key: string) => `${key}#${++runs}`, points);
  return { query, points, runs: () => runs };
}

describe("memoizeQuerySinceDispatch", () => {
  test("a plain call reuses only answers begun at the latest dispatch point", () => {
    const { query, points, runs } = counted();

    expect(query("a")).toBe("a#1");
    expect(query("a")).toBe("a#1");
    points.now = 2;
    expect(query("a")).toBe("a#2");
    expect(runs()).toBe(2);
  });

  test("an answer begun at or after a reader's point is reused, and one fresh answer serves every reader", () => {
    const { query, points, runs } = counted();

    expect(query.readSince(1, ["a"])).toBe("a#1");
    points.now = 2;
    expect(query.readSince(1, ["a"])).toBe("a#1");
    expect(query.readSince(2, ["a"])).toBe("a#2");
    // The reader from point 1 may use the answer begun at point 2.
    expect(query.readSince(1, ["a"])).toBe("a#2");
    expect(runs()).toBe(2);
  });

  test("pruning forgets answers begun before the oldest point and keeps later ones", () => {
    const { query, points, runs } = counted();

    query.readSince(1, ["a"]);
    points.now = 2;
    query.readSince(2, ["b"]);
    query.prune(2);

    expect(query.readSince(1, ["a"])).toBe("a#3");
    expect(query.readSince(1, ["b"])).toBe("b#2");
    expect(runs()).toBe(3);
  });

  test("a rejected answer is never kept", async () => {
    let runs = 0;
    const query = memoizeQuerySinceDispatch(
      async () => (++runs === 1 ? Promise.reject(new Error("first fails")) : "second"),
      { now: 1 },
    );

    await expect(query.readSince(1, [])).rejects.toThrow("first fails");
    await expect(query.readSince(1, [])).resolves.toBe("second");
  });

  test("invalidation forgets every answer, whenever it began", () => {
    const { query, runs } = counted();

    query.readSince(1, ["a"]);
    query.invalidate();
    query.readSince(1, ["a"]);
    expect(runs()).toBe(2);
  });
});

describe("InvocationReads", () => {
  test("an invocation reads since its own dispatch; any other read since the latest", () => {
    const reads = new InvocationReads();
    reads.begin("first");
    reads.begin("second");

    expect(reads.since("first")).toBe(1);
    expect(reads.since("second")).toBe(2);
    expect(reads.since("elsewhere")).toBe(2);
    expect(reads.since(undefined)).toBe(2);
    expect(reads.now).toBe(2);
  });

  test("the oldest point is the earliest invocation still served, whatever order they close in", () => {
    const reads = new InvocationReads();
    const closeFirst = reads.begin("first");
    const closeSecond = reads.begin("second");
    const closeThird = reads.begin("third");

    closeSecond();
    expect(reads.oldest).toBe(1);
    closeFirst();
    expect(reads.oldest).toBe(3);
    closeThird();
    closeThird();
    expect(reads.oldest).toBe(3);
    expect(reads.since("first")).toBe(3);
  });
});

/** A shelf whose value is changed behind the engine's back, as another process would. */
function shelf() {
  const gates: Array<() => void> = [];
  class ShelfConcept {
    static readonly queries = { _value: "one", _pause: "one" } as const;
    value = 1;
    reads = 0;
    hold = false;

    async _value(_: Record<string, never>) {
      this.reads += 1;
      const value = this.value;
      if (this.hold) await new Promise<void>((resolve) => gates.push(resolve));
      return { value };
    }

    async _pause(_: Record<string, never>) {
      await new Promise<void>((resolve) => gates.push(resolve));
      return { paused: true };
    }
  }
  const words = vocabulary({ concepts: { Shelf: ShelfConcept }, computations: {} });
  const { Shelf } = words.concepts;
  const Read = endpoint("/read", ({ value }: Vars) =>
    receive().where(Shelf._value({}).is({ value })).then(respond({ value })),
  );
  const ReadTwice = endpoint("/read-twice", ({ value, again }: Vars) =>
    receive()
      .where(
        Shelf._value({}).is({ value }),
        Shelf._pause({}).is({ paused: true }),
        Shelf._value({}).is({ value: again }),
      )
      .then(respond({ value, again })),
  );
  const Ping = endpoint("/ping", () => receive().then(respond({ pong: true })));
  const open = () => gates.splice(0).forEach((release) => release());
  return { words, composition: { Read, ReadTwice, Ping }, open, waiting: () => gates.length };
}

const until = async (ready: () => boolean) => {
  for (let turn = 0; turn < 1000 && !ready(); turn++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  expect(ready()).toBe(true);
};

function app(queryCache: QueryCacheMode) {
  const parts = shelf();
  const assembled = assemble({
    vocabulary: parts.words,
    composition: parts.composition,
    queryCache,
    retention: { window: 0 },
  });
  return { ...parts, app: assembled, shelf: assembled.concepts.Shelf };
}

describe.each(["memoize", "since-dispatch"] as const)("queryCache %s", (queryCache) => {
  test("an invocation never reuses an answer begun before its dispatch, even one still in flight", async () => {
    const { app: assembled, shelf: state, open, waiting } = app(queryCache);
    state.hold = true;

    const first = assembled.invoker.invoke("/read", {});
    await until(() => waiting() === 1);
    state.value = 2;
    state.hold = false;
    const second = await assembled.invoker.invoke("/read", {});
    open();

    expect(second).toEqual({ ok: true, value: { value: 2 } });
    expect(await first).toEqual({ ok: true, value: { value: 1 } });
    expect(state.reads).toBe(2);
  });
});

describe("queryCache since-dispatch", () => {
  test("an invocation already running keeps its answers when another arrives", async () => {
    const reads = async (queryCache: QueryCacheMode) => {
      const { app: assembled, shelf: state, open, waiting } = app(queryCache);
      const twice = assembled.invoker.invoke("/read-twice", {});
      await until(() => waiting() === 1);
      await assembled.invoker.invoke("/ping", {});
      open();
      expect(await twice).toEqual({ ok: true, value: { value: 1, again: 1 } });
      return state.reads;
    };

    expect(await reads("memoize")).toBe(2);
    expect(await reads("since-dispatch")).toBe(1);
  });

  test("a later invocation still sees a change made while an earlier one runs", async () => {
    const { app: assembled, shelf: state, open, waiting } = app("since-dispatch");

    const twice = assembled.invoker.invoke("/read-twice", {});
    await until(() => waiting() === 1);
    state.value = 2;
    const later = await assembled.invoker.invoke("/read", {});
    open();

    expect(later).toEqual({ ok: true, value: { value: 2 } });
    // The earlier invocation may use the later answer: it began after its dispatch.
    const earlier = await twice;
    expect(earlier.ok).toBe(true);
    expect(state.reads).toBe(2);
  });
});
