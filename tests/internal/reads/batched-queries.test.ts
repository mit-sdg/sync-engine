/**
 * Batched queries: a query named under `batched` takes a list of inputs and
 * returns one answer per input, in order. Readers still ask with one input;
 * the engine groups the reads pending together into one call of the list form.
 */
import { describe, expect, test, vi } from "vite-plus/test";
import type { EventEmitter } from "node:events";
import { vocabulary } from "@sync-engine/advanced";
import { vocabularyClasses } from "@sync-engine/internal/reactions/authoring/refs";
import { each, former } from "@sync-engine/language";
import type { Empty } from "@sync-engine/internal/reactions/types";
import type { ConcurrentReads } from "@sync-engine/internal/reads/where-evaluation";
import type { QueryCacheMode } from "@sync-engine/internal/reactions/runtime/instrumenting";
import { assemble } from "@sync-engine/internal/boundary/assembly/assemble";
import { batchedQuery } from "@sync-engine/internal/reactions/runtime/batching";
import { checkBatchedQuery } from "@sync-engine/assembly";
import { logger } from "@engine/utils/logger";

/** A library whose `_book` query is batched and records every list it receives. */
function library(size: number, options: { failOn?: number; shortBy?: number } = {}) {
  class LibraryConcept {
    static readonly queries = { _shelf: "many", _book: "optional" } as const;
    lists: number[][] = [];

    _shelf(_: Empty) {
      return Array.from({ length: size }, (_, index) => ({ book: index % 4 === 3 ? 99 : index }));
    }

    async _book(inputs: { book: number }[]) {
      this.lists.push(inputs.map(({ book }) => book));
      if (options.failOn !== undefined && inputs.some(({ book }) => book === options.failOn)) {
        throw new Error(`book ${options.failOn} cannot be read`);
      }
      const answers = inputs.map(({ book }) => (book === 99 ? [] : [{ title: `title ${book}` }]));
      return answers.slice(0, answers.length - (options.shortBy ?? 0));
    }

    /** An action may still call the list form on the raw instance. */
    async count({ books }: { books: number[] }) {
      const answers = await this._book(books.map((book) => ({ book })));
      return { found: answers.filter((rows) => rows.length > 0).length };
    }
  }
  const words = vocabulary({
    concepts: { Library: { class: LibraryConcept, batched: ["_book"] } },
    computations: {},
  });
  const { Library } = words.concepts;
  const listing = former("the library ()", (_input, { book, title }) =>
    each(Library._shelf({}).is({ book }))
      .where(Library._book({ book }).is({ title }))
      .form({ book, title }),
  );
  return { words, listing };
}

function application(
  words: ReturnType<typeof library>["words"],
  composition: Record<string, unknown>,
  options: {
    concurrentReads?: ConcurrentReads;
    queryCache?: QueryCacheMode;
    groupBatchedQueries?: boolean;
    instances?: Record<string, never>;
  } = {},
) {
  return assemble({ vocabulary: words, composition, retention: { window: 0 }, ...options });
}

const titles = (size: number) =>
  Array.from({ length: size }, (_, index) => index)
    .filter((index) => index % 4 !== 3)
    .map((book) => ({ book, title: `title ${book}` }));

describe("grouped reads", () => {
  test("reads issued together share one call of the list form, and each reader gets its own answer", async () => {
    const { words, listing } = library(8);
    const app = application(words, { listing }, { concurrentReads: { rowsAtOnce: 16 } });

    expect(await app.form(listing({}))).toEqual(titles(8));
    // The cache answers the repeated 99s, so the list holds each book once.
    expect(app.concepts.Library.lists).toEqual([[0, 1, 2, 99, 4, 5, 6]]);
  });

  test.each(["memoize", "since-dispatch"] as const)(
    "grouping works under queryCache %s",
    async (queryCache) => {
      const { words, listing } = library(8);
      const app = application(
        words,
        { listing },
        { concurrentReads: { rowsAtOnce: 16 }, queryCache },
      );

      expect(await app.form(listing({}))).toEqual(titles(8));
      expect(app.concepts.Library.lists).toHaveLength(1);
    },
  );

  test("a direct call asks with one input and gets one answer", async () => {
    const { words } = library(4);
    const app = application(words, {}, { concurrentReads: { rowsAtOnce: 16 } });

    expect(await app.concepts.Library._book({ book: 2 })).toEqual([{ title: "title 2" }]);
    expect(app.concepts.Library.lists).toEqual([[2]]);
  });

  test("an action calls the list form on the raw instance, untouched by grouping", async () => {
    const { words } = library(4);
    const app = application(words, {}, { concurrentReads: { rowsAtOnce: 16 } });

    expect(await app.concepts.Library.count({ books: [1, 99, 2] })).toEqual({ found: 2 });
    expect(app.concepts.Library.lists).toEqual([[1, 99, 2]]);
  });

  test("a group that fails is read again as lists of one, so only the bad input fails", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const { words } = library(4, { failOn: 2 });
      const app = application(words, {}, { concurrentReads: { rowsAtOnce: 16 } });
      const library_ = app.concepts.Library;

      const [first, second, third] = await Promise.allSettled([
        library_._book({ book: 1 }),
        library_._book({ book: 2 }),
        library_._book({ book: 3 }),
      ]);

      expect(first).toEqual({ status: "fulfilled", value: [{ title: "title 1" }] });
      expect(second).toMatchObject({
        status: "rejected",
        reason: { message: "book 2 cannot be read" },
      });
      expect(third).toEqual({ status: "fulfilled", value: [{ title: "title 3" }] });
      expect(library_.lists).toEqual([[1, 2, 3], [1], [2], [3]]);
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0]?.[0])).toContain("Library._book failed for 3 inputs");
    } finally {
      warn.mockRestore();
    }
  });

  test.each(["memoize", "since-dispatch"] as const)(
    "under queryCache %s, an action landing between a read and its group's call leaves no stale answer",
    async (queryCache) => {
      const { words } = library(4);
      const app = application(words, {}, { concurrentReads: { rowsAtOnce: 16 }, queryCache });
      const library_ = app.concepts.Library;

      const before = library_._book({ book: 1 });
      await library_.count({ books: [] });
      const after = await library_._book({ book: 1 });

      expect(await before).toEqual([{ title: "title 1" }]);
      expect(after).toEqual([{ title: "title 1" }]);
      // The action cleared the cache, so the read after it was asked again,
      // here in the same group, which is sent after the action's write.
      expect(library_.lists.flat().filter((book) => book === 1)).toHaveLength(2);
    },
  );

  test("an answer list of the wrong length is read again alone, naming the query", async () => {
    const { words } = library(4, { shortBy: 1 });
    const app = application(words, {}, { concurrentReads: { rowsAtOnce: 16 } });
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    try {
      const reads = await Promise.allSettled([
        app.concepts.Library._book({ book: 1 }),
        app.concepts.Library._book({ book: 2 }),
      ]);

      for (const read of reads) {
        expect(read).toMatchObject({
          status: "rejected",
          reason: {
            message: expect.stringContaining(
              "Batched query Library._book returned 0 answers for 1 input",
            ),
          },
        });
      }
      expect(warn).toHaveBeenCalledWith(
        "Batched query Library._book failed for 2 inputs; reading each alone.",
        expect.anything(),
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe("reads that are not grouped call the list form with a list of one", () => {
  test.skipIf(process.env.READ_AHEAD_EVERYWHERE === "1")("without concurrentReads", async () => {
    const { words, listing } = library(4);
    const app = application(words, { listing });

    expect(await app.form(listing({}))).toEqual(titles(4));
    expect(app.concepts.Library.lists).toEqual([[0], [1], [2], [99]]);
  });

  test("under queryCache none", async () => {
    const { words, listing } = library(4);
    const app = application(
      words,
      { listing },
      { concurrentReads: { rowsAtOnce: 16 }, queryCache: "none" },
    );

    expect(await app.form(listing({}))).toEqual(titles(4));
    expect(app.concepts.Library.lists.every((list) => list.length === 1)).toBe(true);
  });

  test("with groupBatchedQueries false", async () => {
    const { words, listing } = library(4);
    const app = application(
      words,
      { listing },
      { concurrentReads: { rowsAtOnce: 16 }, groupBatchedQueries: false },
    );

    expect(await app.form(listing({}))).toEqual(titles(4));
    expect(app.concepts.Library.lists).toEqual([[0], [1], [2], [99]]);
  });

  test("assembly rejects a groupBatchedQueries that is not true or false", () => {
    const { words } = library(1);
    expect(() =>
      application(words, {}, { groupBatchedQueries: "yes" as unknown as boolean }),
    ).toThrow("assemble: groupBatchedQueries must be true or false.");
  });
});

describe("the grouping adapter", () => {
  const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
  const echo = (lists: unknown[][]) => async (inputs: readonly unknown[]) => {
    lists.push([...inputs]);
    return inputs.map((input) => ({ echo: input }));
  };

  test("equal inputs each keep their own position and answer", async () => {
    const lists: unknown[][] = [];
    const read = batchedQuery(echo(lists), "Echo._echo", true);

    const answers = await Promise.all([read({ a: 1 }), read({ a: 2 }), read({ a: 1 })]);

    expect(lists).toEqual([[{ a: 1 }, { a: 2 }, { a: 1 }]]);
    expect(answers).toEqual([{ echo: { a: 1 } }, { echo: { a: 2 } }, { echo: { a: 1 } }]);
    expect(answers[0]).not.toBe(answers[2]);
  });

  test("reads in later turns form later groups; nothing waits for more", async () => {
    const lists: unknown[][] = [];
    const read = batchedQuery(echo(lists), "Echo._echo", true);

    const first = read(1);
    await turn();
    await turn();
    const second = read(2);

    expect(await Promise.all([first, second])).toEqual([{ echo: 1 }, { echo: 2 }]);
    expect(lists).toEqual([[1], [2]]);
  });

  test("an input is read as it was asked, even if the caller changes it before the group is sent", async () => {
    const lists: unknown[][] = [];
    const read = batchedQuery(echo(lists), "Echo._echo", true);
    const input = { book: 1 };

    const first = read(input);
    input.book = 2;
    const second = read(input);

    expect(await Promise.all([first, second])).toEqual([
      { echo: { book: 1 } },
      { echo: { book: 2 } },
    ]);
  });

  test.each([true, false])(
    "with grouping %s, a nested change by the caller after asking does not reach the list form",
    async (grouped) => {
      const lists: unknown[][] = [];
      const read = batchedQuery(echo(lists), "Echo._echo", grouped);
      const tags = new Set(["kept"]);
      const input = { book: 1, shelf: { row: 1 }, authors: ["a"], at: new Date(0), tags };

      const answer = read(input);
      input.shelf.row = 2;
      input.authors.push("b");
      input.at.setTime(1);

      const asked = { book: 1, shelf: { row: 1 }, authors: ["a"], at: new Date(0), tags };
      expect(await answer).toEqual({ echo: asked });
      expect(lists).toEqual([[asked]]);
      // Data is copied; other objects, such as a set, are passed as they are.
      expect((lists[0]![0] as typeof input).tags).toBe(tags);
    },
  );

  test("the list is frozen, so a list form that sorts its inputs in place is read again as lists of one", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const read = batchedQuery(
        async (inputs) => (inputs as number[]).sort((left, right) => left - right),
        "Echo._echo",
        true,
      );

      expect(await Promise.all([read(2), read(1)])).toEqual([2, 1]);
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });

  test("a failing group of one fails its read without being called again", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      let calls = 0;
      const read = batchedQuery(
        async () => {
          calls += 1;
          throw new Error("store unavailable");
        },
        "Echo._echo",
        true,
      );

      await expect(read(1)).rejects.toThrow("store unavailable");
      expect(calls).toBe(1);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("a failed group is read again as lists of one, all at once, as it would be ungrouped", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const lists: unknown[][] = [];
      let active = 0;
      let mostActive = 0;
      const read = batchedQuery(
        async (inputs) => {
          lists.push([...inputs]);
          active += 1;
          mostActive = Math.max(mostActive, active);
          await turn();
          active -= 1;
          if (inputs.length > 1) throw new Error("lists of one only");
          return inputs;
        },
        "Echo._echo",
        true,
      );

      expect(await Promise.all([read(1), read(2), read(3)])).toEqual([1, 2, 3]);
      expect(lists).toEqual([[1, 2, 3], [1], [2], [3]]);
      expect(mostActive).toBe(3);
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0]?.[0])).toContain("Echo._echo failed for 3 inputs");
    } finally {
      warn.mockRestore();
    }
  });

  test("after a failed group, an input whose read never settles delays no other input", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const read = batchedQuery(
        async (inputs) => {
          if (inputs.length > 1) throw new Error("lists of one only");
          return inputs[0] === 1 ? new Promise<never>(() => {}) : inputs;
        },
        "Echo._echo",
        true,
      );

      const hung = read(1);
      expect(await Promise.all([read(2), read(3)])).toEqual([2, 3]);
      expect(await Promise.race([hung, turn().then(() => "still waiting")])).toBe("still waiting");
    } finally {
      warn.mockRestore();
    }
  });

  test("a list form that answers something other than a list fails the read", async () => {
    const read = batchedQuery(async () => ({ not: "a list" }), "Echo._echo", false);

    await expect(read(1)).rejects.toThrow(
      "Batched query Echo._echo returned object for 1 input; it must return one answer per input, in the same order.",
    );
  });

  test("a list form that drops an input fails only that input's read", async () => {
    const dropping = async (inputs: readonly unknown[]) =>
      inputs.filter((input) => input !== 2).map((input) => ({ title: `title ${String(input)}` }));
    const read = batchedQuery(dropping, "Echo._echo", true);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    try {
      const reads = await Promise.allSettled([read(1), read(2), read(3)]);

      expect(reads).toEqual([
        { status: "fulfilled", value: { title: "title 1" } },
        {
          status: "rejected",
          reason: expect.objectContaining({
            message: expect.stringContaining("returned 0 answers for 1 input"),
          }),
        },
        { status: "fulfilled", value: { title: "title 3" } },
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  test("an answer list with an empty position is read again alone", async () => {
    const holed = async (inputs: readonly unknown[]) => {
      const answers: unknown[] = [];
      inputs.forEach((input, index) => {
        if (input !== 2) answers[index] = { title: `title ${String(input)}` };
      });
      answers.length = inputs.length;
      return answers;
    };
    const read = batchedQuery(holed, "Echo._echo", true);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    try {
      const reads = await Promise.allSettled([read(1), read(2), read(3)]);

      expect(reads.map(({ status }) => status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
      expect(reads[1]).toMatchObject({
        reason: { message: expect.stringContaining("left answer 1 of 1 input empty") },
      });
    } finally {
      warn.mockRestore();
    }
  });

  test("a malformed answer list's promises never reject unhandled", async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    const processEvents: EventEmitter = process;
    processEvents.on("unhandledRejection", record);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const dropping = (inputs: readonly unknown[]) =>
        inputs
          .filter((input) => input !== 2)
          .map(async (input) => {
            if (input === 3) throw new Error("element 3 fails");
            return { title: `title ${String(input)}` };
          });
      const read = batchedQuery(dropping, "Echo._echo", true);

      const reads = await Promise.allSettled([read(1), read(2), read(3)]);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(reads.map(({ status }) => status)).toEqual(["fulfilled", "rejected", "rejected"]);
      expect(unhandled).toEqual([]);
    } finally {
      processEvents.off("unhandledRejection", record);
      warn.mockRestore();
    }
  });

  test("a malformed list that throws as it is read still has every promise handled", async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    const processEvents: EventEmitter = process;
    processEvents.on("unhandledRejection", record);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const late = (label: string) =>
      new Promise((_, reject) => setTimeout(() => reject(new Error(label)), 1));
    try {
      const hostile = (inputs: readonly unknown[]) => {
        if (inputs.length === 1) return [{ title: "alone" }];
        // One too many answers: a getter that makes a new promise on each read,
        // an entry that throws as it is read, and a rejection after it.
        const answers: unknown[] = [];
        Object.defineProperty(answers, 0, { get: () => late("fresh"), enumerable: true });
        Object.defineProperty(answers, 1, {
          get: () => {
            throw new Error("entry 1");
          },
          enumerable: true,
        });
        answers[2] = late("after");
        answers[3] = late("extra");
        return answers;
      };
      const read = batchedQuery(hostile, "Echo._echo", true);

      const reads = await Promise.all([read(1), read(2), read(3)]);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(reads).toEqual([{ title: "alone" }, { title: "alone" }, { title: "alone" }]);
      expect(unhandled).toEqual([]);
    } finally {
      processEvents.off("unhandledRejection", record);
      warn.mockRestore();
    }
  });

  test("a warning that throws leaves no read of a failed group unsettled", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {
      throw new Error("warnings fail this test run");
    });
    try {
      let calls = 0;
      const failsGrouped = async (inputs: readonly unknown[]) => {
        calls += 1;
        if (inputs.length > 1) throw new Error("group fails");
        return inputs;
      };
      const read = batchedQuery(failsGrouped, "Echo._echo", true);

      expect(await Promise.all([read({ id: "a" }), read({ id: "b" })])).toEqual([
        { id: "a" },
        { id: "b" },
      ]);
      expect(calls).toBe(3);
    } finally {
      warn.mockRestore();
    }
  });

  test("an answer that throws as it is read fails only its own read", async () => {
    const proxied = async (inputs: readonly unknown[]) =>
      new Proxy(
        inputs.map((input) => ({ title: `title ${String(input)}` })),
        {
          get(target, key, receiver) {
            if (key === String(inputs.indexOf(2))) throw new Error("answer 2 cannot be read");
            return Reflect.get(target, key, receiver);
          },
        },
      );
    const read = batchedQuery(proxied, "Echo._echo", true);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    try {
      const reads = await Promise.allSettled([read(1), read(2), read(3)]);

      expect(reads).toEqual([
        { status: "fulfilled", value: { title: "title 1" } },
        {
          status: "rejected",
          reason: expect.objectContaining({ message: "answer 2 cannot be read" }),
        },
        { status: "fulfilled", value: { title: "title 3" } },
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  test("an input whose second copy throws is read again alone, not thrown from the flush", async () => {
    // A class instance is kept, not copied, so each copy asks for its prototype again.
    class Key {
      constructor(readonly id: string) {}
    }
    let asks = 0;
    const odd = new Proxy(new Key("b"), {
      getPrototypeOf(target) {
        asks += 1;
        if (asks === 2) throw new Error("the prototype cannot be read twice");
        return Reflect.getPrototypeOf(target);
      },
    });
    const echo = async (inputs: readonly unknown[]) =>
      inputs.map((input) => ({ id: (input as Key).id }));
    const read = batchedQuery(echo, "Echo._echo", true);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    try {
      const answers = await Promise.all([read(new Key("a")), read(odd)]);

      expect(answers).toEqual([{ id: "a" }, { id: "b" }]);
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });

  test("a group's call that changes its inputs before failing leaves the reads again unchanged", async () => {
    const seen: unknown[] = [];
    let calls = 0;
    const tidying = async (inputs: readonly { tags: string[] }[]) => {
      calls += 1;
      for (const input of inputs) input.tags.push("default");
      if (calls === 1) throw new Error("the group fails");
      seen.push(...inputs.map(({ tags }) => [...tags]));
      return inputs.map(({ tags }) => ({ tags: tags.join(",") }));
    };
    const read = batchedQuery(
      tidying as (inputs: readonly unknown[]) => unknown,
      "Echo._echo",
      true,
    );
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    try {
      const answers = await Promise.all([read({ tags: ["a"] }), read({ tags: ["b"] })]);

      expect(answers).toEqual([{ tags: "a,default" }, { tags: "b,default" }]);
    } finally {
      warn.mockRestore();
    }
  });

  test("grouping keeps working while a test fakes timers", async () => {
    vi.useFakeTimers();
    try {
      const lists: unknown[][] = [];
      const read = batchedQuery(echo(lists), "Echo._echo", true);
      const answer = read(1);
      vi.useRealTimers();

      expect(await answer).toEqual({ echo: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  test("where the host has no setImmediate, the module loads and reads are not grouped", async () => {
    vi.resetModules();
    vi.doMock("node:timers", () => ({ setImmediate: undefined }));
    let loaded: typeof import("@sync-engine/internal/reactions/runtime/batching");
    try {
      loaded = await import("@sync-engine/internal/reactions/runtime/batching");
    } finally {
      vi.doUnmock("node:timers");
    }
    const lists: unknown[][] = [];
    const read = loaded.batchedQuery(echo(lists), "Echo._echo", true);

    expect(await Promise.all([read(1), read(2)])).toEqual([{ echo: 1 }, { echo: 2 }]);
    expect(lists).toEqual([[1], [2]]);
  });

  test("timers faked before the module loads do not stall grouped reads", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    let loaded: typeof import("@sync-engine/internal/reactions/runtime/batching");
    try {
      loaded = await import("@sync-engine/internal/reactions/runtime/batching");
    } finally {
      vi.useRealTimers();
    }
    const lists: unknown[][] = [];
    const read = loaded.batchedQuery(echo(lists), "Echo._echo", true);

    expect(await Promise.all([read(1), read(2)])).toEqual([{ echo: 1 }, { echo: 2 }]);
    expect(lists).toEqual([[1, 2]]);
  });
});

describe("registration", () => {
  test("batched must name queries of the class, each once, in list form", () => {
    class Plain {
      _one({ id }: { id: string }) {
        return { id };
      }
      async _many(inputs: { id: string }[]) {
        return inputs.map(({ id }) => ({ id }));
      }
      async _spread(...inputs: { id: string }[]) {
        return inputs.map(({ id }) => ({ id }));
      }
      async _paged({ id, page = { size: 20 } }: { id: string; page?: { size: number } }) {
        return [{ id, size: page.size }];
      }
      async _nested({ id, filter: { tag } }: { id: string; filter: { tag: string } }) {
        return [{ id, tag }];
      }
      act(_: Empty) {
        return {};
      }
    }
    const declare = (batched: unknown) =>
      vocabulary({
        concepts: { Plain: { class: Plain, batched: batched as never } },
        computations: {},
      });

    expect(() => declare(["_many"])).not.toThrow();
    expect(() => declare(["_missing"])).toThrow(
      'Vocabulary: "Plain": batched names "_missing", which is not a query (a `_`-prefixed method) of Plain.',
    );
    expect(() => declare(["act"])).toThrow('batched names "act", which is not a query');
    expect(() => declare(["_many", "_many"])).toThrow(
      'Vocabulary: "Plain": batched names "_many" twice.',
    );
    expect(() => declare(["_one"])).toThrow(
      'Vocabulary: "Plain._one" is batched, so it takes a list of inputs, but Plain declares it to take one input.',
    );
    // A record destructured with a default or a nested pattern is still one input.
    expect(() => declare(["_paged"])).toThrow('"Plain._paged" is batched, so it takes a list');
    expect(() => declare(["_nested"])).toThrow('"Plain._nested" is batched, so it takes a list');
    // A rest parameter looks like a wrapper at runtime; `sync-engine check` rejects it.
    expect(() => declare(["_spread"])).not.toThrow();
    expect(() => declare(5)).toThrow('Vocabulary: "Plain": batched must list query names.');
  });

  test("assembly accepts a spy wrapped around a batched query", async () => {
    const { words, listing } = library(4);
    const instance = new (vocabularyClasses(words).Library as new () => {
      _book(inputs: readonly { book: number }[]): Promise<unknown[]>;
      lists: number[][];
    })();
    const spy = vi.spyOn(instance, "_book");
    const app = application(
      words,
      { listing },
      { concurrentReads: { rowsAtOnce: 16 }, instances: { Library: instance as never } },
    );

    expect(await app.form(listing({}))).toEqual(titles(4));
    expect(spy).toHaveBeenCalledOnce();
  });

  test("one method serving a batched and an unbatched name is called in each name's form", async () => {
    class SharedConcept {
      static readonly queries = { _plain: "one", _batch: "one" } as const;
      _plain({ id }: { id: string }) {
        return { id };
      }
      _batch(inputs: readonly { id: string }[]) {
        return inputs.map(({ id }) => ({ id }));
      }
    }
    const words = vocabulary({
      concepts: { Shared: { class: SharedConcept, batched: ["_batch"] } },
      computations: {},
    });
    for (const first of ["_plain", "_batch"] as const) {
      const received: unknown[] = [];
      const handler = (input: unknown) => {
        received.push(input);
        return Array.isArray(input) ? input.map(({ id }) => ({ id })) : input;
      };
      const app = assemble({
        vocabulary: words,
        composition: {},
        retention: { window: 0 },
        instances: { Shared: { _plain: handler, _batch: handler } as never },
      });
      const ask = (name: "_plain" | "_batch") => app.concepts.Shared[name]({ id: name });
      if (first === "_plain") {
        await ask("_plain");
        await ask("_batch");
      } else {
        await ask("_batch");
        await ask("_plain");
      }
      expect(received).toContainEqual({ id: "_plain" });
      expect(received).toContainEqual([{ id: "_batch" }]);
    }
  });

  test("assembly accepts an arrow list form whose body builds a record", async () => {
    const { words, listing } = library(2);
    const echo = (value: { inputs: readonly { book: number }[] }) =>
      value.inputs.map(({ book }) => [{ title: `title ${book}` }]);
    const arrow = {
      lists: [] as number[][],
      _shelf: () => [{ book: 0 }, { book: 1 }],
      // Read as written without parentheses, which the formatter would add.
      _book: Object.defineProperty(
        async (inputs: readonly { book: number }[]) => echo({ inputs }),
        "toString",
        { value: () => "async inputs => echo({ inputs })" },
      ),
      count: () => ({ found: 0 }),
    };
    const app = assemble({
      vocabulary: words,
      composition: { listing },
      instances: { Library: arrow as never },
      retention: { window: 0 },
    });

    expect(await app.form(listing({}))).toEqual(titles(2));
  });

  test("assembly rejects a selected implementation whose batched query takes one input", () => {
    const { words } = library(1);
    const single = {
      lists: [] as number[][],
      _shelf: () => [],
      _book: ({ book }: { book: number }) => [{ title: `title ${book}` }],
      count: () => ({ found: 0 }),
    };

    expect(() =>
      assemble({
        vocabulary: words,
        composition: {},
        instances: { Library: single as never },
        retention: { window: 0 },
      }),
    ).toThrow(
      'assemble: "Library._book" is batched, so it takes a list of inputs, but the selected implementation declares it to take one input.',
    );
  });
});

describe("checkBatchedQuery", () => {
  class Id {
    constructor(readonly value: string) {}
  }
  class Tally extends Map<string, number> {}
  class Secret {
    readonly #title: string;
    constructor(title: string) {
      this.#title = title;
    }
    get title() {
      return this.#title;
    }
  }
  class Shelf {
    titles = new Map([
      ["a", "Alpha"],
      ["b", "Beta"],
    ]);
    written = new Date(0);
    tags = new Map([
      ["a", ["x", "y"]],
      ["b", ["z"]],
    ]);

    async _good(inputs: readonly { id: string }[]) {
      return inputs.map(({ id }) => {
        const title = this.titles.get(id);
        return title === undefined ? [] : [{ title, id: { value: id } }];
      });
    }

    async _sharesForEqualInputs(inputs: readonly { id: string }[]) {
      // One date per stored row, shared by duplicates of the same input.
      const dates = new Map(inputs.map(({ id }) => [id, new Date(0)]));
      return inputs.map(({ id }) => ({ id, at: dates.get(id) }));
    }

    async _sorted(inputs: readonly { id: string }[]) {
      // Answers in sorted order rather than input order.
      return [...inputs]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(({ id }) => ({ id }));
    }

    async _shared(inputs: readonly { id: string }[]) {
      const row = { title: "same" };
      return inputs.map(() => row);
    }

    async _deduped(inputs: readonly { id: string }[]) {
      return [...new Set(inputs.map(({ id }) => id))].map((id) => ({ id }));
    }

    async _tagSets(inputs: readonly { id: string }[]) {
      // The same entries in a different order when the list is longer.
      return inputs.map(({ id }) => {
        const tags = this.tags.get(id) ?? [];
        const ordered = inputs.length > 1 ? [...tags].reverse() : tags;
        return { tags: new Set(ordered), rows: new Map(ordered.map((tag) => [tag, { id }])) };
      });
    }

    async _bytes(inputs: readonly { id: string }[]) {
      // Binary answers, empty for an input with nothing stored.
      return inputs.map(({ id }) => ({
        data: new Uint8Array((this.tags.get(id) ?? []).map((tag) => tag.charCodeAt(0))),
      }));
    }

    async _bytesOfAll(inputs: readonly { id: string }[]) {
      // Every input answered with the bytes of the whole list.
      return inputs.map(() => ({ data: new Uint8Array(inputs.length) }));
    }

    async _titlesOfAll(inputs: readonly { id: string }[]) {
      const all = inputs.flatMap(({ id }) => {
        const title = this.titles.get(id);
        return title === undefined ? [] : [[id, title] as const];
      });
      return inputs.map(() => new Map(all));
    }

    async _cycles(inputs: readonly { id: string }[]) {
      // In a longer list, a one-node cycle; alone, the same cycle unrolled to two nodes.
      return inputs.map(({ id }) => {
        if (inputs.length > 1) {
          const node: Record<string, unknown> = { id };
          node.next = node;
          return node;
        }
        const first: Record<string, unknown> = { id };
        const second: Record<string, unknown> = { id, next: first };
        first.next = second;
        return first;
      });
    }

    async _sharedBuffer(inputs: readonly { id: string }[]) {
      // Separate views of the same bytes.
      const buffer = new ArrayBuffer(2);
      return inputs.map(() => ({ data: new Uint8Array(buffer, 0, 2) }));
    }

    async _pooled(inputs: readonly { id: string }[]) {
      // Separate views of one buffer, as small Node Buffers from one pool are.
      const buffer = new ArrayBuffer(inputs.length * 2 + 2);
      return inputs.map((_, index) => ({ data: new Uint8Array(buffer, index * 2 + 2, 2) }));
    }

    async _tally(inputs: readonly { id: string }[]) {
      return inputs.map(({ id }) => new Tally([[id, 1]]));
    }

    async _ids(inputs: readonly { id: string }[]) {
      return inputs.map(({ id }) => [{ id: new Id(id) }]);
    }

    async _secrets(inputs: readonly { id: string }[]) {
      return inputs.map(({ id }) => [new Secret(this.titles.get(id) ?? "")]);
    }

    _promises(inputs: readonly { id: string }[]) {
      // The slip: a promise for each input rather than the answers.
      return inputs.map(async ({ id }) => {
        if (id === "missing") throw new Error("no such shelf");
        return { id };
      });
    }

    async _holed(inputs: readonly { id: string }[]) {
      const answers: { id: string }[] = [];
      inputs.forEach(({ id }, index) => {
        if (id !== "missing") answers[index] = { id };
      });
      answers.length = inputs.length;
      return answers;
    }
  }
  const samples = [{ id: "a" }, { id: "b" }, { id: "missing" }];

  test("a list form that keeps the law passes, with fresh records in its rows", async () => {
    await expect(checkBatchedQuery(new Shelf(), "_good", samples)).resolves.toBeUndefined();
  });

  test("answers to equal inputs may share objects", async () => {
    await expect(
      checkBatchedQuery(new Shelf(), "_sharesForEqualInputs", samples),
    ).resolves.toBeUndefined();
  });

  test("answers out of input order fail", async () => {
    await expect(checkBatchedQuery(new Shelf(), "_sorted", samples)).rejects.toThrow(
      "Batched query _sorted breaks its law: in the samples reversed",
    );
  });

  test("equivalent cycles of different lengths compare equal", async () => {
    await expect(checkBatchedQuery(new Shelf(), "_cycles", samples)).resolves.toBeUndefined();
  });

  test("binary answers for different inputs that share bytes fail", async () => {
    await expect(checkBatchedQuery(new Shelf(), "_sharedBuffer", samples)).rejects.toThrow(
      "share an object",
    );
  });

  test("binary answers that share a buffer without sharing bytes pass", async () => {
    await expect(checkBatchedQuery(new Shelf(), "_pooled", samples)).resolves.toBeUndefined();
  });

  test("a sample that cannot be shown as JSON still has its law checked", async () => {
    const odd = Object.assign(Object.create(null) as Record<string, unknown>, { id: "a", n: 1n });
    await expect(
      checkBatchedQuery(new Shelf(), "_cycles", [odd as Record<string, unknown>]),
    ).resolves.toBeUndefined();
  });

  test("answers to different inputs that share an object fail", async () => {
    await expect(checkBatchedQuery(new Shelf(), "_shared", samples)).rejects.toThrow(
      'the answers for {"id":"a"} and {"id":"b"} share an object',
    );
  });

  test("a list form that drops duplicates fails on length", async () => {
    await expect(checkBatchedQuery(new Shelf(), "_deduped", samples)).rejects.toThrow(
      "the samples with each repeated gave 6 inputs and got 3 answers",
    );
  });

  test("a list form that leaves a position empty fails", async () => {
    await expect(checkBatchedQuery(new Shelf(), "_holed", samples)).rejects.toThrow(
      'the list [{"id":"missing"}] left answer 0 empty',
    );
  });

  test("maps and sets fail, since the engine matches them by identity", async () => {
    await expect(checkBatchedQuery(new Shelf(), "_tagSets", samples)).rejects.toThrow(
      "cannot compare answers of class Set",
    );
    await expect(checkBatchedQuery(new Shelf(), "_titlesOfAll", samples)).rejects.toThrow(
      "cannot compare answers of class Map",
    );
  });

  test("binary answers compare by their bytes, empty ones included", async () => {
    await expect(checkBatchedQuery(new Shelf(), "_bytes", samples)).resolves.toBeUndefined();
    await expect(checkBatchedQuery(new Shelf(), "_bytesOfAll", samples)).rejects.toThrow("alone");
  });

  test("answers it cannot compare fail, naming their class", async () => {
    await expect(checkBatchedQuery(new Shelf(), "_secrets", samples)).rejects.toThrow(
      "checkBatchedQuery: cannot compare answers of class Secret",
    );
    await expect(checkBatchedQuery(new Shelf(), "_ids", samples)).rejects.toThrow(
      "checkBatchedQuery: cannot compare answers of class Id",
    );
    await expect(checkBatchedQuery(new Shelf(), "_tally", samples)).rejects.toThrow(
      "checkBatchedQuery: cannot compare answers of class Tally",
    );
  });

  test("a list form that returns a promise for each input is reported", async () => {
    await expect(
      checkBatchedQuery(new Shelf(), "_promises", [{ id: "missing" }, ...samples]),
    ).rejects.toThrow(
      'checkBatchedQuery: _promises gave a promise as answer 0 for the list [{"id":"missing"}]; ' +
        "a list form returns its answers, so await them first",
    );
  });
});
