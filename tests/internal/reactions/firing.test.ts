import { describe, expect, test } from "vite-plus/test";
import { FiringBook, type FiringFill } from "@sync-engine/internal/reactions/firing.ts";
import { MemoryStore } from "@sync-engine/internal/reactions/log-store.ts";

describe("firing bookkeeping", () => {
  test("an in-flight mark hands consumption to the durable firing record", () => {
    const store = new MemoryStore();
    const book = new FiringBook(store);
    const fill: FiringFill = {
      reaction: "Notify",
      flow: "flow",
      whenIds: ["ask"],
      bindings: { item: "a" },
      produced: ["notification"],
      branches: [],
    };
    const branch = book.newBranch(fill);
    book.mark(branch);
    expect(book.hasConsumed("ask", "Notify")).toBe(true);
    book.record(fill);
    expect(store.hasConsumed("ask", "Notify")).toBe(true);
    expect(book.firings("Notify")[0]).toMatchObject({ consumed: ["ask"] });
  });
});
