import { describe, expect, test } from "vite-plus/test";
import { vocabulary } from "@sync-engine/advanced";
import { each, former } from "@sync-engine/language";
import type { Empty } from "@sync-engine/internal/reactions/types";
import type { ExecutionLimits } from "@sync-engine/boundary";
import type { OperationalEvent } from "@sync-engine/internal/reactions/runtime/operational";
import { assemble } from "@sync-engine/internal/boundary/assembly/assemble";

const limits = (overrides: Partial<ExecutionLimits> = {}): ExecutionLimits => ({
  maxActiveRootFlows: 4,
  maxPendingRequests: 4,
  maxActionsPerFlow: 100,
  maxFiringsPerFlow: 100,
  maxRowsPerEvaluation: 1_000,
  maxRequestDurationMs: 5_000,
  ...overrides,
});

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A concept whose detail reads take longer for earlier rows, and count what is in flight. */
function shelf(size: number, options: { failAt?: number[]; rowsPerDetail?: number } = {}) {
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
  return { words, listing, nested };
}

describe("reads run ahead of the row being consumed", () => {
  test("rows keep their order when later rows answer first", async () => {
    const { words, listing } = shelf(12);
    const app = assemble({ vocabulary: words, composition: { listing }, retention: { window: 0 } });

    const formed = (await app.form(listing({}))) as { item: number; label: string }[];

    expect(formed.map((row) => row.item)).toEqual(Array.from({ length: 12 }, (_, index) => index));
    expect(formed.map((row) => row.label)).toEqual(
      Array.from({ length: 12 }, (_, index) => `${index}.0`),
    );
    expect(app.concepts.Shelf.maxInFlight).toBeGreaterThan(1);
  });

  test("a read-ahead of 1 reads rows one after another", async () => {
    const { words, listing } = shelf(6);
    const app = assemble({
      vocabulary: words,
      composition: { listing },
      executionLimits: limits({ maxReadAhead: 1 }),
      retention: { window: 0 },
    });

    await app.form(listing({}));

    expect(app.concepts.Shelf.maxInFlight).toBe(1);
    expect(app.concepts.Shelf.started).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test("the first failing row's fault is reported, though a later row failed first", async () => {
    const { words, listing } = shelf(10, { failAt: [3, 8] });
    const app = assemble({ vocabulary: words, composition: { listing }, retention: { window: 0 } });

    await expect(app.form(listing({}))).rejects.toThrow("detail 3 failed");
  });

  test("a failed evaluation answers only after the reads it launched have settled", async () => {
    const { words, listing } = shelf(10, { failAt: [0] });
    const app = assemble({ vocabulary: words, composition: { listing }, retention: { window: 0 } });

    await expect(app.form(listing({}))).rejects.toThrow("detail 0 failed");
    expect(app.concepts.Shelf.inFlight).toBe(0);
  });

  test("the window bounds reads launched ahead within one line", async () => {
    const { words, listing } = shelf(20);
    const app = assemble({
      vocabulary: words,
      composition: { listing },
      executionLimits: limits({ maxReadAhead: 3 }),
      retention: { window: 0 },
    });

    await app.form(listing({}));

    expect(app.concepts.Shelf.maxInFlight).toBeLessThanOrEqual(3);
    expect(app.concepts.Shelf.detailReads).toBe(20);
  });

  test("the engine-wide cap bounds reads in flight across nested selections", async () => {
    const { words, nested } = shelf(12, { rowsPerDetail: 4 });
    const app = assemble({
      vocabulary: words,
      composition: { nested },
      executionLimits: limits({ maxReadAhead: 8, maxConcurrentReads: 3 }),
      retention: { window: 0 },
    });

    const formed = (await app.form(nested({}))) as { item: number; notes: unknown[] }[];

    expect(formed).toHaveLength(12);
    expect(formed.every((row) => row.notes.length === 4)).toBe(true);
    expect(app.concepts.Shelf.maxInFlight).toBeLessThanOrEqual(3);
  });

  test("a row limit reached by a row read ahead is recorded once, at the row that reaches it", async () => {
    const events: OperationalEvent[] = [];
    const { words, listing } = shelf(20, { rowsPerDetail: 3 });
    const app = assemble({
      vocabulary: words,
      composition: { listing },
      executionLimits: limits({ maxRowsPerEvaluation: 20, maxReadAhead: 4 }),
      observers: [(event) => events.push(event)],
      retention: { window: 0 },
    });

    await expect(app.form(listing({}))).rejects.toThrow("row limit");

    const breaches = events.filter((event) => event.type === "execution-limit-breached");
    expect(breaches).toHaveLength(1);
    // The seventh row's three labels take the frame count past 20; at most the
    // window's rows beyond it were read.
    expect(app.concepts.Shelf.detailReads).toBeLessThanOrEqual(7 + 4);
    expect(app.concepts.Shelf.inFlight).toBe(0);
  });

  test("execution limits reject a read-ahead or cap that is not a positive integer", () => {
    const { words, listing } = shelf(2);
    expect(() =>
      assemble({
        vocabulary: words,
        composition: { listing },
        executionLimits: limits({ maxReadAhead: 0 }),
      }),
    ).toThrow("maxReadAhead");
    expect(() =>
      assemble({
        vocabulary: words,
        composition: { listing },
        executionLimits: limits({ maxConcurrentReads: 1.5 }),
      }),
    ).toThrow("maxConcurrentReads");
  });
});
