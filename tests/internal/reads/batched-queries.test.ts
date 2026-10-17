/**
 * Batched queries: a query named under `batched` takes a list of inputs and
 * returns one answer per input, in order. Readers still ask with one input;
 * the engine groups the reads pending together into one call of the list form.
 */
import { describe, expect, test, vi } from "vite-plus/test";
import { vocabulary } from "@sync-engine/advanced";
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

  test("a group that fails is read again one input at a time, so only the bad input fails", async () => {
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

  test("an answer list of the wrong length fails every read in the group, naming the query", async () => {
    const { words } = library(4, { shortBy: 1 });
    const app = application(words, {}, { concurrentReads: { rowsAtOnce: 16 } });

    const reads = await Promise.allSettled([
      app.concepts.Library._book({ book: 1 }),
      app.concepts.Library._book({ book: 2 }),
    ]);

    for (const read of reads) {
      expect(read).toMatchObject({
        status: "rejected",
        reason: {
          message: expect.stringContaining(
            "Batched query Library._book returned 1 answer for 2 inputs",
          ),
        },
      });
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

  test("equal inputs share one slot and one answer", async () => {
    const lists: unknown[][] = [];
    const read = batchedQuery(
      async (inputs) => {
        lists.push(inputs);
        return inputs.map((input) => ({ echo: input }));
      },
      "Echo._echo",
      true,
    );

    const answers = await Promise.all([read({ a: 1 }), read({ a: 2 }), read({ a: 1 })]);

    expect(lists).toEqual([[{ a: 1 }, { a: 2 }]]);
    expect(answers).toEqual([{ echo: { a: 1 } }, { echo: { a: 2 } }, { echo: { a: 1 } }]);
    expect(answers[0]).toBe(answers[2]);
  });

  test("reads in later turns form later groups; nothing waits for more", async () => {
    const lists: unknown[][] = [];
    const read = batchedQuery(
      async (inputs) => {
        lists.push(inputs);
        return inputs;
      },
      "Echo._echo",
      true,
    );

    const first = read(1);
    await turn();
    await turn();
    const second = read(2);

    expect(await Promise.all([first, second])).toEqual([1, 2]);
    expect(lists).toEqual([[1], [2]]);
  });

  test("a list form that throws synchronously is retried one input at a time", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const read = batchedQuery(
        (inputs) => {
          if (inputs.length > 1) throw new Error("lists of one only");
          return inputs;
        },
        "Echo._echo",
        true,
      );

      expect(await Promise.all([read(1), read(2)])).toEqual([1, 2]);
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
      act(_: Empty) {
        return {};
      }
    }
    const declare = (batched: string[]) =>
      vocabulary({ concepts: { Plain: { class: Plain, batched } }, computations: {} });

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
  });
});

describe("checkBatchedQuery", () => {
  class Shelf {
    titles = new Map([
      ["a", "Alpha"],
      ["b", "Beta"],
    ]);

    async _good(inputs: { id: string }[]) {
      return inputs.map(({ id }) => {
        const title = this.titles.get(id);
        return title === undefined ? [] : [{ title }];
      });
    }

    async _sorted(inputs: { id: string }[]) {
      // Answers in sorted order rather than input order.
      return [...inputs]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(({ id }) => ({ id }));
    }

    async _shared(inputs: { id: string }[]) {
      const row = { title: "same" };
      return inputs.map(() => row);
    }

    async _deduped(inputs: { id: string }[]) {
      return [...new Set(inputs.map(({ id }) => id))].map((id) => ({ id }));
    }
  }
  const samples = [{ id: "a" }, { id: "b" }, { id: "missing" }];

  test("a list form that keeps the law passes", async () => {
    await expect(checkBatchedQuery(new Shelf(), "_good", samples)).resolves.toBeUndefined();
  });

  test("answers out of input order fail", async () => {
    await expect(checkBatchedQuery(new Shelf(), "_sorted", samples)).rejects.toThrow(
      "Batched query _sorted breaks its law: in the samples reversed",
    );
  });

  test("answers that share an object fail", async () => {
    await expect(checkBatchedQuery(new Shelf(), "_shared", samples)).rejects.toThrow(
      "answers at positions 0 and 1 share an object",
    );
  });

  test("a list form that drops duplicates fails on length", async () => {
    await expect(checkBatchedQuery(new Shelf(), "_deduped", samples)).rejects.toThrow(
      "the samples with each repeated gave 6 inputs and got 3 answers",
    );
  });
});
