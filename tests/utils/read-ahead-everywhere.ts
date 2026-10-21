/**
 * Setup for `bun run test:read-ahead`: every assembly that does not set
 * `concurrentReads` reads rows together with a small count of rows ahead, and
 * every engine that does not set `queryCache` keeps answers since each
 * invocation's dispatch, so the whole suite checks that both answer as reading
 * one after another with every cache cleared at dispatch.
 */
import { vi } from "vite-plus/test";

vi.mock("@engine/reads/where-evaluation", async (importOriginal) => {
  const original = await importOriginal<typeof import("@engine/reads/where-evaluation")>();
  return {
    ...original,
    readAheadFor: (...[options, ...rest]: Parameters<typeof original.readAheadFor>) =>
      original.readAheadFor(options ?? { rowsAtOnce: 8, maxRowsAhead: 3 }, ...rest),
  };
});

vi.mock("@engine/reads/invocation-reads", async (importOriginal) => {
  const original = await importOriginal<typeof import("@engine/reads/invocation-reads")>();
  return {
    ...original,
    invocationReadsFor: (queryCache: string | undefined, holdMs?: number) =>
      original.invocationReadsFor(queryCache ?? "since-dispatch", holdMs),
  };
});
