/**
 * Batched queries: a query named under `batched` takes a list of inputs and
 * returns one answer per input, in order. Readers still ask with one input;
 * the engine groups the reads pending together into one call of the list form.
 */
import { describe, expect, test, vi } from "vite-plus/test";
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

  test("an answer list with an empty position fails every read in the group", async () => {
    const holed = async () => {
      // Positions 1 and 3 answered; position 2 never set.
      const answers: unknown[] = [];
      answers[0] = { title: "one" };
      answers[2] = { title: "three" };
      return answers;
    };
    const read = batchedQuery(holed, "Echo._echo", true);

    const reads = await Promise.allSettled([read(1), read(2), read(3)]);

    for (const settled of reads) {
      expect(settled).toMatchObject({
        status: "rejected",
        reason: { message: expect.stringContaining("left answer 2 of 3 inputs empty") },
      });
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
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "setImmediate");
    vi.resetModules();
    Reflect.deleteProperty(globalThis, "setImmediate");
    let loaded: typeof import("@sync-engine/internal/reactions/runtime/batching");
    try {
      loaded = await import("@sync-engine/internal/reactions/runtime/batching");
    } finally {
      if (descriptor !== undefined) Object.defineProperty(globalThis, "setImmediate", descriptor);
    }
    const lists: unknown[][] = [];
    const read = loaded.batchedQuery(echo(lists), "Echo._echo", true);

    expect(await Promise.all([read(1), read(2)])).toEqual([{ echo: 1 }, { echo: 2 }]);
    expect(lists).toEqual([[1], [2]]);
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
      act(_: Empty) {
        return {};
      }
    }
    const declare = (batched: unknown) =>
      vocabulary({
        concepts: { Plain: { class: Plain, batched: batched as string[] } },
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

    async _tagsOfAll(inputs: readonly { id: string }[]) {
      // Every input answered with the tags of the whole list.
      const all = inputs.flatMap(({ id }) => this.tags.get(id) ?? []);
      return inputs.map(() => ({ tags: new Set(all) }));
    }

    async _titlesOfAll(inputs: readonly { id: string }[]) {
      const all = inputs.flatMap(({ id }) => {
        const title = this.titles.get(id);
        return title === undefined ? [] : [[id, title] as const];
      });
      return inputs.map(() => new Map(all));
    }

    async _sharedInSets(inputs: readonly { id: string }[]) {
      const row = { title: "same" };
      return inputs.map(() => new Set([row]));
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

  test("maps and sets compare by their entries, in any order", async () => {
    await expect(checkBatchedQuery(new Shelf(), "_tagSets", samples)).resolves.toBeUndefined();
  });

  test("binary answers compare by their bytes, empty ones included", async () => {
    await expect(checkBatchedQuery(new Shelf(), "_bytes", samples)).resolves.toBeUndefined();
    await expect(checkBatchedQuery(new Shelf(), "_bytesOfAll", samples)).rejects.toThrow("alone");
  });

  test("a list form that answers from the whole list through sets or maps fails", async () => {
    await expect(checkBatchedQuery(new Shelf(), "_tagsOfAll", samples)).rejects.toThrow(
      'in the samples in order, {"id":"a"} answered {"tags":["x","y","z"]} but answers {"tags":["x","y"]} alone',
    );
    await expect(checkBatchedQuery(new Shelf(), "_titlesOfAll", samples)).rejects.toThrow(
      'in the samples in order, {"id":"a"} answered [["a","Alpha"],["b","Beta"]] but answers [["a","Alpha"]] alone',
    );
  });

  test("answers to different inputs that share an object inside a set fail", async () => {
    await expect(checkBatchedQuery(new Shelf(), "_sharedInSets", samples)).rejects.toThrow(
      'the answers for {"id":"a"} and {"id":"b"} share an object',
    );
  });

  test("answers it cannot compare fail, naming their class", async () => {
    await expect(checkBatchedQuery(new Shelf(), "_secrets", samples)).rejects.toThrow(
      "checkBatchedQuery: cannot compare answers of class Secret",
    );
    await expect(checkBatchedQuery(new Shelf(), "_ids", samples)).rejects.toThrow(
      "checkBatchedQuery: cannot compare answers of class Id",
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
