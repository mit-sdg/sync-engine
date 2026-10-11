import { describe, expect, test, vi } from "vite-plus/test";
import { vocabulary } from "@sync-engine/advanced";
import { each, former } from "@sync-engine/language";
import type { Empty } from "@sync-engine/internal/reactions/types";
import type { ExecutionLimits } from "@sync-engine/boundary";
import type { OperationalEvent } from "@sync-engine/internal/reactions/runtime/operational";
import type { ConcurrentReads } from "@sync-engine/internal/reads/where-evaluation";
import type { QueryCacheMode } from "@sync-engine/internal/reactions/runtime/instrumenting";
import { assemble } from "@sync-engine/internal/boundary/assembly/assemble";

const limits = (overrides: Partial<ExecutionLimits> = {}): ExecutionLimits => ({
  maxActiveRootFlows: 64,
  maxPendingRequests: 64,
  maxActionsPerFlow: 100,
  maxFiringsPerFlow: 100,
  maxRowsPerEvaluation: 1_000,
  maxRequestDurationMs: 5_000,
  ...overrides,
});

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A concept whose detail reads take longer for earlier rows, and count what is in flight. */
function shelf(
  size: number,
  options: { failAt?: number[]; hangAt?: number[]; rowsPerDetail?: number; wideAt?: number } = {},
) {
  let release!: () => void;
  const hung = new Promise<void>((resolve) => (release = resolve));
  class ShelfConcept {
    static readonly queries = { _items: "many", _detail: "many", _note: "many" } as const;
    inFlight = 0;
    maxInFlight = 0;
    detailReads = 0;
    noteReads = 0;
    started: number[] = [];

    _items(_: Empty) {
      return Array.from({ length: size }, (_, index) => ({ item: index }));
    }

    async _detail({ item }: { item: number }) {
      this.detailReads += 1;
      this.started.push(item);
      this.inFlight += 1;
      this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
      try {
        if (options.hangAt?.includes(item)) await hung;
        await pause((size - item) * 2);
        if (options.failAt?.includes(item)) throw new Error(`detail ${item} failed`);
        const rows = item === options.wideAt ? 30 : (options.rowsPerDetail ?? 1);
        return Array.from({ length: rows }, (_, part) => ({ label: `${item}.${part}` }));
      } finally {
        this.inFlight -= 1;
      }
    }

    async _note({ label }: { label: string }) {
      this.noteReads += 1;
      this.inFlight += 1;
      this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
      try {
        await pause(1);
        return [{ note: `note ${label}` }];
      } finally {
        this.inFlight -= 1;
      }
    }
  }
  const words = vocabulary({ concepts: { Shelf: ShelfConcept }, computations: {} });
  const { Shelf } = words.concepts;
  const listing = former("the shelf ()", (_input, { item, label }) =>
    each(Shelf._items({}).is({ item }))
      .where(Shelf._detail({ item }).is({ label }))
      .form({ item, label }),
  );
  const nested = former("the shelf with notes ()", (_input, { item, label, note }) =>
    each(Shelf._items({}).is({ item })).form({
      item,
      notes: each(Shelf._detail({ item }).is({ label }))
        .where(Shelf._note({ label }).is({ note }))
        .form({ label, note }),
    }),
  );
  return { words, listing, nested, release };
}

function application(
  words: ReturnType<typeof shelf>["words"],
  composition: Record<string, unknown>,
  options: {
    concurrentReads?: ConcurrentReads;
    executionLimits?: ExecutionLimits;
    observers?: ((event: OperationalEvent) => void)[];
    queryCache?: QueryCacheMode;
  } = {},
) {
  return assemble({ vocabulary: words, composition, retention: { window: 0 }, ...options });
}

/** Rows started ahead and not yet settled, across the engine. */
const rowsAhead = (app: ReturnType<typeof application>) =>
  app.engine.readEnv().readAhead?.ahead.inUse ?? 0;

const breaches = (events: OperationalEvent[]) =>
  events.filter((event) => event.type === "execution-limit-breached").length;

describe("without concurrentReads, every line reads its rows one after another", () => {
  // `bun run test:read-ahead` gives every assembly concurrentReads.
  test.skipIf(process.env.READ_AHEAD_EVERYWHERE === "1")(
    "rows are read in order, one at a time",
    async () => {
      const { words, listing } = shelf(6);
      const app = application(words, { listing });

      await app.form(listing({}));

      expect(app.concepts.Shelf.maxInFlight).toBe(1);
      expect(app.concepts.Shelf.started).toEqual([0, 1, 2, 3, 4, 5]);
    },
  );
});

describe("with concurrentReads, rows are read together and consumed in row order", () => {
  test("rows keep their order when later rows answer first", async () => {
    const { words, listing } = shelf(12);
    const app = application(words, { listing }, { concurrentReads: { rowsAtOnce: 16 } });

    const formed = (await app.form(listing({}))) as { item: number; label: string }[];

    expect(formed.map((row) => row.item)).toEqual(Array.from({ length: 12 }, (_, index) => index));
    expect(formed.map((row) => row.label)).toEqual(
      Array.from({ length: 12 }, (_, index) => `${index}.0`),
    );
    expect(app.concepts.Shelf.maxInFlight).toBeGreaterThan(1);
    expect(rowsAhead(app)).toBe(0);
  });

  test("rowsAtOnce 1 reads rows one after another", async () => {
    const { words, listing } = shelf(6);
    const app = application(words, { listing }, { concurrentReads: { rowsAtOnce: 1 } });

    await app.form(listing({}));

    expect(app.concepts.Shelf.maxInFlight).toBe(1);
    expect(app.concepts.Shelf.started).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test("rowsAtOnce bounds the rows of one line evaluated at once, the consumed row included", async () => {
    const { words, listing } = shelf(20);
    const app = application(words, { listing }, { concurrentReads: { rowsAtOnce: 3 } });

    await app.form(listing({}));

    expect(app.concepts.Shelf.maxInFlight).toBe(3);
    expect(app.concepts.Shelf.detailReads).toBe(20);
  });

  test("maxRowsAhead bounds rows started ahead across nested selections and evaluations", async () => {
    const { words, nested } = shelf(12, { rowsPerDetail: 4 });
    const app = application(
      words,
      { nested },
      { concurrentReads: { rowsAtOnce: 8, maxRowsAhead: 2 } },
    );

    const [first, second] = (await Promise.all([app.form(nested({})), app.form(nested({}))])) as {
      item: number;
      notes: unknown[];
    }[][];

    expect(first).toEqual(second);
    expect(first).toHaveLength(12);
    expect(first.every((row) => row.notes.length === 4)).toBe(true);
    // Each evaluation reads its consumed rows one at a time, and two rows ahead are shared.
    expect(app.concepts.Shelf.maxInFlight).toBeLessThanOrEqual(2 + 2);
    expect(rowsAhead(app)).toBe(0);
  });

  test("a spent count of rows ahead is never waited on, so deep nesting completes", async () => {
    const { words, nested } = shelf(6, { rowsPerDetail: 3 });
    const app = application(
      words,
      { nested },
      { concurrentReads: { rowsAtOnce: 4, maxRowsAhead: 1 } },
    );
    const plain = shelf(6, { rowsPerDetail: 3 });
    const sequential = application(plain.words, { nested: plain.nested });

    expect(await app.form(nested({}))).toEqual(await sequential.form(plain.nested({})));
  });

  test("every row is read once, as when reading one after another", async () => {
    const read = async (concurrentReads?: ConcurrentReads) => {
      const { words, nested } = shelf(10, { rowsPerDetail: 3 });
      const app = application(words, { nested }, { concurrentReads, queryCache: "none" });
      await app.form(nested({}));
      return [app.concepts.Shelf.detailReads, app.concepts.Shelf.noteReads];
    };

    expect(await read({ rowsAtOnce: 4 })).toEqual(await read());
    expect(await read({ rowsAtOnce: 16, maxRowsAhead: 3 })).toEqual(await read());
  });

  test("the first failing row's fault is reported, though a later row failed first", async () => {
    const { words, listing } = shelf(10, { failAt: [3, 8] });
    const app = application(words, { listing }, { concurrentReads: { rowsAtOnce: 16 } });

    await expect(app.form(listing({}))).rejects.toThrow("detail 3 failed");
  });

  test("a fault is reported at once, though a row started ahead never settles", async () => {
    const { words, listing, release } = shelf(4, { failAt: [0], hangAt: [1] });
    const app = application(words, { listing }, { concurrentReads: { rowsAtOnce: 4 } });

    await expect(app.form(listing({}))).rejects.toThrow("detail 0 failed");
    await app.whenIdle();
    // The hung row keeps its place in the count of rows ahead until it settles.
    expect(rowsAhead(app)).toBe(1);

    release();
    await vi.waitFor(() => expect(rowsAhead(app)).toBe(0));
  });

  test("rows started ahead of a fault stop at their next line", async () => {
    const { words, nested, release } = shelf(4, { failAt: [0], hangAt: [1, 2, 3] });
    const app = application(words, { nested }, { concurrentReads: { rowsAtOnce: 4 } });

    await expect(app.form(nested({}))).rejects.toThrow("detail 0 failed");
    release();
    await vi.waitFor(() => expect(rowsAhead(app)).toBe(0));

    expect(app.concepts.Shelf.detailReads).toBe(4);
    expect(app.concepts.Shelf.noteReads).toBe(0);
  });

  test("a row limit reached inside a row started ahead is recorded once, when that row is consumed", async () => {
    const run = async (concurrentReads?: ConcurrentReads) => {
      const events: OperationalEvent[] = [];
      const { words, listing } = shelf(12, { wideAt: 5 });
      const app = application(
        words,
        { listing },
        {
          concurrentReads,
          executionLimits: limits({ maxRowsPerEvaluation: 20 }),
          observers: [(event) => events.push(event)],
        },
      );
      const fault = await app.form(listing({})).then(
        () => "answered",
        (error: Error) => error.message,
      );
      return { fault, breaches: breaches(events), reads: app.concepts.Shelf.detailReads };
    };

    const sequential = await run();
    const together = await run({ rowsAtOnce: 4 });

    expect(sequential.fault).toContain("row limit");
    expect(together.fault).toBe(sequential.fault);
    expect(sequential.breaches).toBe(1);
    expect(together.breaches).toBe(1);
    // Rows 0 to 5 are reached; at most three more were started past row 5.
    expect(together.reads).toBeLessThanOrEqual(6 + 3);
  });

  test("a row limit reached inside a row the evaluation never reaches is not recorded", async () => {
    const events: OperationalEvent[] = [];
    // Row 5 answers before row 3 and is over the limit; row 3 fails first in row order.
    const { words, listing } = shelf(12, { failAt: [3], wideAt: 5 });
    const app = application(
      words,
      { listing },
      {
        concurrentReads: { rowsAtOnce: 8 },
        executionLimits: limits({ maxRowsPerEvaluation: 20 }),
        observers: [(event) => events.push(event)],
      },
    );

    await expect(app.form(listing({}))).rejects.toThrow("detail 3 failed");
    expect(breaches(events)).toBe(0);
  });

  test("the option is validated", () => {
    const { words, listing } = shelf(2);
    const assembled = (concurrentReads: unknown) => () =>
      application(words, { listing }, { concurrentReads: concurrentReads as ConcurrentReads });

    expect(assembled({ rowsAtOnce: 0 })).toThrow(
      "concurrentReads.rowsAtOnce must be a positive finite integer",
    );
    expect(assembled({ rowsAtOnce: 4, maxRowsAhead: 1.5 })).toThrow(
      "concurrentReads.maxRowsAhead must be a positive finite integer",
    );
    expect(assembled({ window: 4 })).toThrow("concurrentReads.rowsAtOnce");
    expect(assembled(null)).toThrow("concurrentReads must be an object");
  });
});
