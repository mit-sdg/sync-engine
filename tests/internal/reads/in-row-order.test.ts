/**
 * `inRowOrder` with rows the test settles by hand, so every bound is checked
 * at the moment it matters rather than by timing.
 */
import { describe, expect, test } from "vite-plus/test";
import { inRowOrder, RowsAhead } from "@sync-engine/internal/reads/where-evaluation";
import type { AssertRows, ReadAhead } from "@sync-engine/internal/reads/where-evaluation";

interface Row {
  readonly index: number;
  readonly guard: AssertRows | undefined;
  answer(value: string): void;
  fail(error: Error): void;
}

/** Rows that settle when the test says so, with a record of which were launched. */
function rows() {
  const launched: Row[] = [];
  const launch = (index: number, guard: AssertRows | undefined): Promise<string> =>
    new Promise<string>((answer, fail) => launched.push({ index, guard, answer, fail }));
  const row = (index: number) => {
    const found = launched.find((candidate) => candidate.index === index);
    if (found === undefined) throw new Error(`row ${index} was not launched`);
    return found;
  };
  return { launched, launch, row };
}

const readAhead = (rowsAtOnce: number, capacity: number): ReadAhead => ({
  rowsAtOnce,
  ahead: new RowsAhead(capacity),
});

/** Let every settled promise run its continuations. */
const turns = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A row-limit check that records each breach it throws. */
function limit(max: number) {
  const recorded: number[] = [];
  const assertRows = Object.assign(
    (count: number) => {
      if (count > max) {
        recorded.push(count);
        throw new Error(`row limit at ${count}`);
      }
    },
    { exceeds: (count: number) => count > max },
  );
  return { assertRows, recorded };
}

describe("inRowOrder", () => {
  test("without read-ahead, each row is launched only after the previous one is consumed", async () => {
    const { launched, launch, row } = rows();
    const consumed: string[] = [];
    const done = inRowOrder(3, undefined, undefined, launch, (_index, value) => {
      consumed.push(value);
    });

    for (const index of [0, 1, 2]) {
      await turns();
      expect(launched.map((candidate) => candidate.index)).toEqual(
        Array.from({ length: index + 1 }, (_, at) => at),
      );
      row(index).answer(`row ${index}`);
    }
    await done;
    expect(consumed).toEqual(["row 0", "row 1", "row 2"]);
  });

  test("at most rowsAtOnce rows are launched, the consumed row included, and answers are consumed in order", async () => {
    const { launched, launch, row } = rows();
    const reads = readAhead(3, 100);
    const consumed: number[] = [];
    const done = inRowOrder(6, reads, undefined, launch, (index) => {
      consumed.push(index);
    });

    await turns();
    expect(launched.map((candidate) => candidate.index)).toEqual([0, 1, 2]);
    row(2).answer("two");
    row(1).answer("one");
    await turns();
    expect(consumed).toEqual([]);
    row(0).answer("zero");
    await turns();
    expect(consumed).toEqual([0, 1, 2]);
    expect(launched.map((candidate) => candidate.index)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const index of [3, 4, 5]) row(index).answer(`${index}`);
    await done;
    expect(consumed).toEqual([0, 1, 2, 3, 4, 5]);
    expect(reads.ahead.inUse).toBe(0);
  });

  test("rows ahead are counted across evaluations, and a spent count reads inline", async () => {
    const first = rows();
    const second = rows();
    const reads = readAhead(4, 2);
    const one = inRowOrder(4, reads, undefined, first.launch, () => {});
    const two = inRowOrder(4, reads, undefined, second.launch, () => {});

    await turns();
    // The first evaluation took both rows ahead; the second reads only its own row.
    expect(first.launched.map((row) => row.index)).toEqual([0, 1, 2]);
    expect(second.launched.map((row) => row.index)).toEqual([0]);
    expect(reads.ahead.inUse).toBe(2);

    for (const index of [0, 1, 2, 3]) {
      await turns();
      first.row(index).answer("");
      second.row(index).answer("");
    }
    await Promise.all([one, two]);
    await turns();
    expect(reads.ahead.inUse).toBe(0);
  });

  test("a fault is rethrown as soon as its row is consumed, before rows ahead settle", async () => {
    const { launch, row } = rows();
    const reads = readAhead(4, 100);
    const done = inRowOrder(4, reads, undefined, launch, () => {});

    await turns();
    row(0).fail(new Error("row 0 failed"));
    await expect(done).rejects.toThrow("row 0 failed");
    expect(reads.ahead.inUse).toBe(3);

    row(1).answer("");
    row(2).fail(new Error("row 2 failed"));
    row(3).answer("");
    await turns();
    expect(reads.ahead.inUse).toBe(0);
  });

  test("the fault reported is the first in row order, though a later row failed first", async () => {
    const { launch, row } = rows();
    const done = inRowOrder(4, readAhead(4, 100), undefined, launch, () => {});

    await turns();
    row(3).fail(new Error("row 3 failed"));
    row(2).fail(new Error("row 2 failed"));
    await turns();
    row(0).answer("");
    row(1).fail(new Error("row 1 failed"));
    await expect(done).rejects.toThrow("row 1 failed");
  });

  test("a launch that throws synchronously is that row's fault, and no row ahead is lost", async () => {
    const { launch: settle, row } = rows();
    const reads = readAhead(4, 100);
    const launch = (index: number, guard: AssertRows | undefined) => {
      if (index === 2) throw new Error("row 2 threw");
      return settle(index, guard);
    };
    const done = inRowOrder(4, reads, undefined, launch, () => {});

    await turns();
    row(0).fail(new Error("row 0 failed"));
    await expect(done).rejects.toThrow("row 0 failed");
    row(1).answer("");
    row(3).answer("");
    await turns();
    expect(reads.ahead.inUse).toBe(0);
  });

  test("a row limit reached in a row read together is recorded when that row is consumed", async () => {
    const { launch, row } = rows();
    const { assertRows, recorded } = limit(5);
    const consumed: number[] = [];
    const done = inRowOrder(4, readAhead(4, 100), assertRows, launch, (index) => {
      consumed.push(index);
    });

    await turns();
    expect(() => row(2).guard?.(9)).toThrow("row limit reached at 9 rows");
    expect(recorded).toEqual([]);
    row(2).fail(captured(() => row(2).guard?.(9)));
    row(0).answer("");
    await turns();
    expect(recorded).toEqual([]);
    row(1).answer("");
    await expect(done).rejects.toThrow("row limit at 9");
    expect(recorded).toEqual([9]);
    expect(consumed).toEqual([0, 1]);
  });

  test("once an evaluation has finished, its rows ahead and the rows nested in them stop at their next check", async () => {
    const { launch, row } = rows();
    const done = inRowOrder(3, readAhead(3, 100), undefined, launch, () => {});

    await turns();
    const guard = row(1).guard;
    expect(() => guard?.(1)).not.toThrow();
    row(0).fail(new Error("row 0 failed"));
    await expect(done).rejects.toThrow("row 0 failed");

    expect(() => guard?.(1)).toThrow("has finished");
    // A selection nested in row 1 asks through row 1's check.
    const nested = rows();
    const inner = inRowOrder(2, readAhead(2, 100), guard, nested.launch, () => {});
    await turns();
    expect(() => nested.row(0).guard?.(1)).toThrow("has finished");
    nested.row(0).answer("");
    nested.row(1).answer("");
    await inner;
  });

  test("the count of rows ahead refuses to be given back more than it was taken", () => {
    const ahead = new RowsAhead(1);
    expect(ahead.take()).toBe(true);
    expect(ahead.take()).toBe(false);
    ahead.give();
    expect(() => ahead.give()).toThrow("never taken");
    expect(ahead.inUse).toBe(0);
  });
});

function captured(run: () => void): Error {
  try {
    run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a throw");
}
