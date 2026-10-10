import { describe, expect, test } from "vite-plus/test";
import { vocabulary } from "@sync-engine/advanced";
import { compute, each, former } from "@sync-engine/language";
import type { Empty } from "@sync-engine/internal/reactions/types";
import type { ExecutionLimits } from "@sync-engine/boundary";
import type { OperationalEvent } from "@sync-engine/internal/reactions/runtime/operational";
import type { ConcurrentReads } from "@sync-engine/internal/reads/where-evaluation";
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
  options: { failAt?: number[]; hangAt?: number[]; rowsPerDetail?: number } = {},
) {
  let release!: () => void;
  const hung = new Promise<void>((resolve) => (release = resolve));
  class ShelfConcept {
    static readonly queries = { _items: "many", _detail: "many", _note: "many" } as const;
    inFlight = 0;
    maxInFlight = 0;
    detailReads = 0;
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
        return Array.from({ length: options.rowsPerDetail ?? 1 }, (_, part) => ({
          label: `${item}.${part}`,
        }));
      } finally {
        this.inFlight -= 1;
      }
    }

    async _note({ label }: { label: string }) {
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
  let ticks = 0;
  const words = vocabulary({
    concepts: { Shelf: ShelfConcept },
    computations: { tick: (_: { label: string }) => (ticks += 1) },
  });
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
  const ticked = former("the ticked shelf ()", (_input, { item, label, tick }) =>
    each(Shelf._items({}).is({ item })).form({
      item,
      ticks: each(Shelf._detail({ item }).is({ label }))
        .where(compute(words.computations.tick, { label }, tick))
        .form({ tick }),
    }),
  );
  return { words, listing, nested, ticked, release };
}

function application(
  words: ReturnType<typeof shelf>["words"],
  composition: Record<string, unknown>,
  options: {
    concurrentReads?: ConcurrentReads;
    executionLimits?: ExecutionLimits;
    observers?: ((event: OperationalEvent) => void)[];
  } = {},
) {
  return assemble({ vocabulary: words, composition, retention: { window: 0 }, ...options });
}

describe("without concurrentReads, every line reads its rows one after another", () => {
  test("rows are read in order, one at a time", async () => {
    const { words, listing } = shelf(6);
    const app = application(words, { listing });

    await app.form(listing({}));

    expect(app.concepts.Shelf.maxInFlight).toBe(1);
    expect(app.concepts.Shelf.started).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test("computations in nested row bodies run in row order", async () => {
    const { words, ticked } = shelf(6);
    const app = application(words, { ticked });

    const formed = (await app.form(ticked({}))) as { item: number; ticks: { tick: number }[] }[];

    expect(formed.map((row) => row.ticks[0].tick)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("with concurrentReads, rows are read together and consumed in row order", () => {
  test("rows keep their order when later rows answer first", async () => {
    const { words, listing } = shelf(12);
    const app = application(words, { listing }, { concurrentReads: { window: 16 } });

    const formed = (await app.form(listing({}))) as { item: number; label: string }[];

    expect(formed.map((row) => row.item)).toEqual(Array.from({ length: 12 }, (_, index) => index));
    expect(formed.map((row) => row.label)).toEqual(
      Array.from({ length: 12 }, (_, index) => `${index}.0`),
    );
    expect(app.concepts.Shelf.maxInFlight).toBeGreaterThan(1);
  });

  test("a window of 1 reads rows one after another", async () => {
    const { words, listing } = shelf(6);
    const app = application(words, { listing }, { concurrentReads: { window: 1 } });

    await app.form(listing({}));

    expect(app.concepts.Shelf.maxInFlight).toBe(1);
    expect(app.concepts.Shelf.started).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test("the window bounds the rows of one line evaluated at once, the consumed row included", async () => {
    const { words, listing } = shelf(20);
    const app = application(words, { listing }, { concurrentReads: { window: 3 } });

    await app.form(listing({}));

    expect(app.concepts.Shelf.maxInFlight).toBe(3);
    expect(app.concepts.Shelf.detailReads).toBe(20);
  });

  test("maxRowsAhead bounds rows started ahead across nested selections and evaluations", async () => {
    const { words, nested } = shelf(12, { rowsPerDetail: 4 });
    const app = application(words, { nested }, { concurrentReads: { window: 8, maxRowsAhead: 2 } });

    const [first, second] = (await Promise.all([app.form(nested({})), app.form(nested({}))])) as {
      item: number;
      notes: unknown[];
    }[][];

    expect(first).toEqual(second);
    expect(first).toHaveLength(12);
    expect(first.every((row) => row.notes.length === 4)).toBe(true);
    // Each evaluation reads its consumed rows one at a time, and two rows ahead are shared.
    expect(app.concepts.Shelf.maxInFlight).toBeLessThanOrEqual(2 + 2);
  });

  test("a spent count of rows ahead is never waited on, so deep nesting completes", async () => {
    const { words, nested } = shelf(6, { rowsPerDetail: 3 });
    const app = application(words, { nested }, { concurrentReads: { window: 4, maxRowsAhead: 1 } });
    const plain = shelf(6, { rowsPerDetail: 3 });
    const sequential = application(plain.words, { nested: plain.nested });

    expect(await app.form(nested({}))).toEqual(await sequential.form(plain.nested({})));
  });

  test("the first failing row's fault is reported, though a later row failed first", async () => {
    const { words, listing } = shelf(10, { failAt: [3, 8] });
    const app = application(words, { listing }, { concurrentReads: { window: 16 } });

    await expect(app.form(listing({}))).rejects.toThrow("detail 3 failed");
  });

  test("a failed evaluation answers only after the rows it started have settled", async () => {
    const { words, listing } = shelf(10, { failAt: [0] });
    const app = application(words, { listing }, { concurrentReads: { window: 16 } });

    await expect(app.form(listing({}))).rejects.toThrow("detail 0 failed");
    expect(app.concepts.Shelf.inFlight).toBe(0);
  });

  test("a started row that never settles keeps a failed evaluation open until it does", async () => {
    const { words, listing, release } = shelf(4, { failAt: [0], hangAt: [1] });
    const app = application(words, { listing }, { concurrentReads: { window: 4 } });

    const outcome = app.form(listing({})).then(
      () => "answered",
      (error: Error) => error.message,
    );
    expect(await Promise.race([outcome, pause(50).then(() => "open")])).toBe("open");

    release();
    expect(await outcome).toContain("detail 0 failed");
  });

  test("a row limit reached by a row started ahead is recorded once, at the row that reaches it", async () => {
    const events: OperationalEvent[] = [];
    const { words, listing } = shelf(20, { rowsPerDetail: 3 });
    const app = application(
      words,
      { listing },
      {
        concurrentReads: { window: 4 },
        executionLimits: limits({ maxRowsPerEvaluation: 20 }),
        observers: [(event) => events.push(event)],
      },
    );

    await expect(app.form(listing({}))).rejects.toThrow("row limit");

    const breaches = events.filter((event) => event.type === "execution-limit-breached");
    expect(breaches).toHaveLength(1);
    // The seventh row's three labels take the frame count past 20; at most the
    // window's other rows were started beyond it.
    expect(app.concepts.Shelf.detailReads).toBeLessThanOrEqual(7 + 3);
    expect(app.concepts.Shelf.inFlight).toBe(0);
  });

  test("computations in nested row bodies may run out of row order, so they must be free of side effects", async () => {
    const { words, ticked } = shelf(6);
    const app = application(words, { ticked }, { concurrentReads: { window: 6 } });

    const formed = (await app.form(ticked({}))) as { item: number; ticks: { tick: number }[] }[];

    expect(formed.map((row) => row.item)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(formed.map((row) => row.ticks[0].tick)).not.toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("the option is validated", () => {
    const { words, listing } = shelf(2);
    expect(() => application(words, { listing }, { concurrentReads: { window: 0 } })).toThrow(
      "concurrentReads.window",
    );
    expect(() =>
      application(words, { listing }, { concurrentReads: { window: 4, maxRowsAhead: 1.5 } }),
    ).toThrow("concurrentReads.maxRowsAhead");
  });
});
