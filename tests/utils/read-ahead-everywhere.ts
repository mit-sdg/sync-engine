/**
 * Setup for `bun run test:read-ahead`: every assembly that does not set
 * `concurrentReads` reads rows together with a small count of rows ahead, so
 * the whole suite checks that reading together answers as reading one after
 * another.
 */
import { vi } from "vite-plus/test";

vi.mock("@engine/reads/where-evaluation", async (importOriginal) => {
  const original = await importOriginal<typeof import("@engine/reads/where-evaluation")>();
  return {
    ...original,
    readAheadFor: (options: Parameters<typeof original.readAheadFor>[0]) =>
      original.readAheadFor(options ?? { rowsAtOnce: 8, maxRowsAhead: 3 }),
  };
});
