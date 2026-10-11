/**
 * `queryCache: "since-dispatch"`: an outside invocation reuses only answers
 * whose query began at or after its dispatch, as when every cache is cleared
 * at dispatch, while invocations already running keep the answers they read.
 */
import { describe, expect, test } from "vite-plus/test";
import { vocabulary } from "@sync-engine/advanced";
import { endpoint, receive, respond } from "@sync-engine/boundary";
import { former, reaction, when, where } from "@sync-engine/language";
import type { Vars } from "@sync-engine/internal/reactions/types";
import type { QueryCacheMode } from "@sync-engine/internal/reactions/runtime/instrumenting";
import { assemble } from "@sync-engine/internal/boundary/assembly/assemble";
import { InvocationReads } from "@sync-engine/internal/reads/invocation-reads";
import { memoizeQuery } from "@engine/utils/memoize";

/** A query that counts its executions and answers with them. */
function counted() {
  let runs = 0;
  const points = { current: 1 };
  const query = memoizeQuery((key: string) => `${key}#${++runs}`, points);
  return { query, points, runs: () => runs };
}

describe("memoizeQuery with dispatch points", () => {
  test("a plain call reuses only answers begun at the current point", () => {
    const { query, points, runs } = counted();

    expect(query("a")).toBe("a#1");
    expect(query("a")).toBe("a#1");
    points.current = 2;
    expect(query("a")).toBe("a#2");
    expect(runs()).toBe(2);
  });

  test("an answer begun at or after a reader's point is reused, and one fresh answer serves every reader", () => {
    const { query, points, runs } = counted();

    expect(query.readSince(1, ["a"])).toBe("a#1");
    points.current = 2;
    expect(query.readSince(1, ["a"])).toBe("a#1");
    expect(query.readSince(2, ["a"])).toBe("a#2");
    // The reader from point 1 may use the answer begun at point 2.
    expect(query.readSince(1, ["a"])).toBe("a#2");
    expect(runs()).toBe(2);
  });

  test("pruning forgets answers begun before the oldest point, and a key read again is kept", () => {
    const { query, points, runs } = counted();

    query.readSince(1, ["a"]);
    query.readSince(1, ["b"]);
    points.current = 2;
    query.readSince(2, ["a"]);
    query.prune(2);

    expect(query.readSince(1, ["a"])).toBe("a#3");
    expect(query.readSince(1, ["b"])).toBe("b#4");
    expect(runs()).toBe(4);
  });

  test("without dispatch points, an answer is reused until invalidated", () => {
    let runs = 0;
    const query = memoizeQuery((key: string) => `${key}#${++runs}`);

    expect(query("a")).toBe("a#1");
    expect(query.readSince(0, ["a"])).toBe("a#1");
    query.prune(0);
    expect(query("a")).toBe("a#1");
    query.invalidate();
    expect(query("a")).toBe("a#2");
  });

  test("a rejected answer is never kept", async () => {
    let runs = 0;
    const query = memoizeQuery(
      async () => (++runs === 1 ? Promise.reject(new Error("first fails")) : "second"),
      { current: 1 },
    );

    await expect(query.readSince(1, [])).rejects.toThrow("first fails");
    await expect(query.readSince(1, [])).resolves.toBe("second");
  });
});

describe("InvocationReads", () => {
  test("a flow reads since its own point while open; any other read since the current", () => {
    const reads = new InvocationReads();
    const closeFirst = reads.openFor("first");
    reads.openFor("second");

    expect(reads.since("first")).toBe(1);
    expect(reads.since("second")).toBe(2);
    expect(reads.since("elsewhere")).toBe(2);
    expect(reads.since(undefined)).toBe(2);
    expect(reads.current).toBe(2);
    closeFirst();
    expect(reads.since("first")).toBe(2);
  });

  test("the oldest point is the earliest still open, whatever order they close in", () => {
    const reads = new InvocationReads();
    const closeFirst = reads.openFor("first");
    const closeSecond = reads.openFor("second");
    const closeThird = reads.openFor("third");

    closeSecond();
    expect(reads.oldest).toBe(1);
    closeFirst();
    expect(reads.oldest).toBe(3);
    closeThird();
    closeThird();
    expect(reads.oldest).toBe(3);
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
    recorded: unknown[] = [];

    async _value(_: { on?: string }) {
      this.reads += 1;
      const value = this.value;
      if (this.hold) await new Promise<void>((resolve) => gates.push(resolve));
      return { value };
    }

    async _pause(_: Record<string, never>) {
      await new Promise<void>((resolve) => gates.push(resolve));
      return { paused: true };
    }

    poke(_: Record<string, never>) {
      return {};
    }

    record({ reading }: { reading: unknown }) {
      this.recorded.push(reading);
      return {};
    }
  }
  const words = vocabulary({ concepts: { Shelf: ShelfConcept }, computations: {} });
  const { Shelf } = words.concepts;
  const twice = former("the value read twice ()", (_input, { value, again }) =>
    where(
      Shelf._value({}).is({ value }),
      Shelf._pause({}).is({ paused: true }),
      Shelf._value({}).is({ value: again }),
    ).form({ value, again }),
  );
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
  const FormTwice = endpoint("/form-twice", () => receive().then(respond({ reading: twice({}) })));
  const Ping = endpoint("/ping", () => receive().then(respond({ pong: true })));
  const Poked = reaction(() => when(Shelf.poke({})).then(Shelf.record({ reading: twice({}) })));
  const open = () => gates.splice(0).forEach((release) => release());
  return {
    words,
    twice,
    composition: { twice, Read, ReadTwice, FormTwice, Ping, Poked },
    open,
    waiting: () => gates.length,
  };
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

  test("reads serving no invocation reuse only answers begun since the latest dispatch, read by read", async () => {
    const { app: assembled, shelf: state, open, waiting } = app(queryCache);

    // An older invocation stays open, so pruning cannot hide a point fixed too early.
    const held = assembled.invoker.invoke("/read-twice", {});
    await until(() => waiting() === 1);
    const poked = assembled.concepts.Shelf.poke({});
    await until(() => waiting() === 2);
    state.value = 2;
    await assembled.invoker.invoke("/ping", {});
    open();
    await Promise.all([poked, held]);
    await assembled.whenIdle();

    expect(state.recorded).toEqual([{ value: 1, again: 2 }]);
  });
});

describe("queryCache since-dispatch", () => {
  /** Reads made by one ask that pauses between two reads of `_value` while `/ping` arrives. */
  const readsAcrossAPing = async (
    queryCache: QueryCacheMode,
    ask: (assembled: ReturnType<typeof app>) => Promise<unknown>,
  ) => {
    const parts = app(queryCache);
    const asked = ask(parts);
    await until(() => parts.waiting() === 1);
    await parts.app.invoker.invoke("/ping", {});
    parts.open();
    await asked;
    return parts.shelf.reads;
  };

  test("an invocation already running keeps the answers its where clause read when another arrives", async () => {
    const ask = ({ app: assembled }: ReturnType<typeof app>) =>
      assembled.invoker.invoke("/read-twice", {});

    expect(await readsAcrossAPing("memoize", ask)).toBe(2);
    expect(await readsAcrossAPing("since-dispatch", ask)).toBe(1);
  });

  test("so does a former it responds with", async () => {
    const ask = ({ app: assembled }: ReturnType<typeof app>) =>
      assembled.invoker.invoke("/form-twice", {});

    expect(await readsAcrossAPing("memoize", ask)).toBe(2);
    expect(await readsAcrossAPing("since-dispatch", ask)).toBe(1);
  });

  test("a direct form reads like an invocation, from its own start", async () => {
    const ask = ({ app: assembled, twice }: ReturnType<typeof app>) => assembled.form(twice({}));

    expect(await readsAcrossAPing("memoize", ask)).toBe(2);
    expect(await readsAcrossAPing("since-dispatch", ask)).toBe(1);
  });

  test("a direct query reads afresh without clearing a running invocation's answers", async () => {
    const reads = async (queryCache: QueryCacheMode) => {
      const { app: assembled, shelf: state, open, waiting } = app(queryCache);
      const twice = assembled.invoker.invoke("/read-twice", {});
      await until(() => waiting() === 1);
      state.value = 2;
      // Another key of the same query: memoize clears the invocation's answer with it.
      expect(await assembled.concepts.Shelf._value({ on: "elsewhere" })).toEqual({ value: 2 });
      open();
      expect((await twice).ok).toBe(true);
      return state.reads;
    };

    expect(await reads("memoize")).toBe(3);
    expect(await reads("since-dispatch")).toBe(2);
  });

  test("a later invocation still sees a change made while an earlier one runs", async () => {
    const { app: assembled, shelf: state, open, waiting } = app("since-dispatch");

    const twice = assembled.invoker.invoke("/read-twice", {});
    await until(() => waiting() === 1);
    state.value = 2;
    const later = await assembled.invoker.invoke("/read", {});
    open();

    expect(later).toEqual({ ok: true, value: { value: 2 } });
    expect((await twice).ok).toBe(true);
    expect(state.reads).toBe(2);
  });
});
