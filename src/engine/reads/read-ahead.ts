/**
 * Run independent reads ahead of the evaluation that consumes them.
 *
 * The rows of one line, and the rows of one selection, do not depend on each
 * other, so their reads may overlap. Answers are still consumed in row order,
 * so results, their order, and the reported fault are those of evaluating the
 * rows one after another. Two bounds keep this cheap: a window of rows read
 * ahead of the one being consumed, and a cap on reads in flight per engine.
 */

/** Check a running row count; an engine-owned check can also be asked without recording. */
export type AssertRows = ((count: number) => void) & {
  /** Whether `count` rows would breach the limit, without recording a breach. */
  readonly exceeds?: (count: number) => boolean;
};

export const DEFAULT_READ_AHEAD = 16;
export const DEFAULT_CONCURRENT_READS = 64;

/** Bounds on overlapping reads, shared by every evaluation one engine runs. */
export interface ReadConcurrency {
  /** Rows read ahead of the row being consumed, per line or selection. 1 reads in sequence. */
  readonly readAhead: number;
  /** Query calls in flight at once. */
  readonly slots: ReadSlots;
}

/** A counting semaphore held only around leaf query calls, so nested evaluation cannot deadlock. */
export class ReadSlots {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(readonly capacity: number) {}

  async run<T>(read: () => Promise<T> | T): Promise<T> {
    if (this.active >= this.capacity) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await read();
    } finally {
      const next = this.waiting.shift();
      if (next === undefined) this.active -= 1;
      else next();
    }
  }
}

export function readConcurrency(
  readAhead = DEFAULT_READ_AHEAD,
  concurrentReads = DEFAULT_CONCURRENT_READS,
): ReadConcurrency {
  return { readAhead, slots: new ReadSlots(concurrentReads) };
}

/** A row limit reached by a row read ahead, recorded only if evaluation reaches that row. */
class DeferredRowLimit extends Error {
  constructor(readonly count: number) {
    super(`row limit reached at ${count} rows`);
  }
}

function deferredGuard(assertRows: AssertRows | undefined): AssertRows | undefined {
  if (assertRows === undefined) return undefined;
  const exceeds = assertRows.exceeds as (count: number) => boolean;
  return Object.assign(
    (count: number) => {
      if (exceeds(count)) throw new DeferredRowLimit(count);
    },
    { exceeds },
  );
}

/**
 * Evaluate `count` independent rows: `launch` starts row `index`'s work, and
 * `consume` takes its answer in row order, returning `false` to stop. Rows
 * launched ahead check limits without recording; a limit one of them reached
 * is recorded through the caller's guard when its row is consumed. Before
 * returning or rethrowing, the rows already launched settle, so an evaluation
 * never finishes with its reads still running.
 */
export async function inRowOrder<T>(
  count: number,
  reads: ReadConcurrency | undefined,
  assertRows: AssertRows | undefined,
  launch: (index: number, assertRows: AssertRows | undefined) => Promise<T>,
  consume: (index: number, value: T) => boolean | void,
): Promise<void> {
  const canDefer = assertRows === undefined || assertRows.exceeds !== undefined;
  const window = canDefer ? Math.max(1, reads?.readAhead ?? 1) : 1;
  if (window === 1 || count <= 1) {
    for (let index = 0; index < count; index += 1) {
      if (consume(index, await launch(index, assertRows)) === false) return;
    }
    return;
  }
  const guard = deferredGuard(assertRows);
  const launched: (Promise<T> | undefined)[] = [];
  let next = 0;
  let index = 0;
  try {
    for (; index < count; index += 1) {
      while (next < count && next < index + window) {
        const pending = launch(next, guard);
        pending.catch(() => {});
        launched[next] = pending;
        next += 1;
      }
      let value: T;
      try {
        value = await (launched[index] as Promise<T>);
      } catch (error) {
        if (error instanceof DeferredRowLimit) assertRows?.(error.count);
        throw error;
      }
      launched[index] = undefined;
      if (consume(index, value) === false) return;
    }
  } finally {
    const unsettled = launched.filter((pending) => pending !== undefined);
    if (unsettled.length > 0) await Promise.allSettled(unsettled);
  }
}
